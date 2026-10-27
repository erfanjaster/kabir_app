#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kabir - self-contained cross-platform updater
=============================================
Works even when it is the ONLY new file the user received, and even on
installations that were extracted from a ZIP (no git folder).

What it does, in order:
  1. Fetches the latest code into the app folder:
       - "git pull --ff-only" if the folder is a git checkout, otherwise
       - downloads the repository ZIP from GitHub and overlays the files
         (existing extra files are never deleted; user data is not here).
  2. Installs/updates Python dependencies (requirements.txt).
  3. Creates a pre-update backup of the database, then applies migrations
     WITHOUT touching user data (projects, materials, invoices, settings).
  4. Recalculates project prices with the current material rates.

User data lives OUTSIDE the program folder, so updating code never
destroys it:
  Windows : %APPDATA%\\KabirCabinet
  Linux   : ~/.local/share/KabirCabinet
  macOS   : ~/Library/Application Support/KabirCabinet

Usage:
  python update.py                      update the folder this script is in
  python update.py --app-dir "C:\\Kabir"  update another folder
  python update.py --force-zip          download ZIP even if git is available
  python update.py --no-fetch           skip code download (deps+migrate only)
  python update.py --skip-deps          do not touch pip packages
  python update.py --no-backup          skip the pre-update database backup
  python update.py --no-recalc          skip project price recalculation

All console output is ASCII-only so it renders correctly everywhere
(including the Windows console). Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import List, Optional

REPO_ZIP_URL = "https://github.com/erfanjaster/kabir_app/archive/refs/heads/main.zip"

# Files that must not be replaced while they may be running (Windows cmd
# re-reads .bat files line by line; replacing one mid-run corrupts it).
_SKIP_ON_WINDOWS = {"update.bat"}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _hr(title: str = "") -> None:
    print("=" * 58)
    if title:
        print(f"  {title}")
        print("=" * 58)


def _run(cmd: List, cwd) -> int:
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    return subprocess.run([str(c) for c in cmd], cwd=str(cwd)).returncode


def _download(url: str, dest: Path, timeout: int = 180) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "kabir-updater"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def read_version(app_dir: Path) -> str:
    """Read the app version from disk WITHOUT importing it (safe pre-update)."""
    try:
        text = (app_dir / "kabir" / "__init__.py").read_text(encoding="utf-8")
        m = re.search(r'__version__\s*=\s*"([^"]+)"', text)
        return m.group(1) if m else "unknown"
    except OSError:
        return "(not installed yet)"


def _find_repo_root(base: Path) -> Optional[Path]:
    """GitHub ZIPs extract into a single top folder (kabir_app-<branch>)."""
    if (base / "main.py").is_file():
        return base
    try:
        for p in sorted(base.iterdir()):
            if p.is_dir() and (p / "main.py").is_file():
                return p
    except OSError:
        pass
    return None


def _warn_if_server_running() -> None:
    import socket
    ports = {8080}
    try:
        ports.add(int(os.environ.get("KABIR_WEB_PORT", "") or 8080))
    except ValueError:
        pass
    for p in sorted(ports):
        try:
            with socket.create_connection(("127.0.0.1", p), timeout=0.4):
                print(f"  [WARN] Port {p} is in use. If Kabir is running right now,")
                print("         close it (Ctrl+C in its window) for a clean update.")
                return
        except OSError:
            continue


# ---------------------------------------------------------------------------
# step 1: fetch the latest code
# ---------------------------------------------------------------------------

def git_update(app_dir: Path) -> bool:
    git = shutil.which("git")
    if not git or not (app_dir / ".git").is_dir():
        return False
    print("  Folder is a git checkout - trying 'git pull --ff-only' ...")
    if _run([git, "pull", "--ff-only"], cwd=app_dir) == 0:
        return True
    print("  [WARN] git pull failed (local changes or diverged history).")
    print("         Falling back to the ZIP download ...")
    return False


def zip_update(app_dir: Path) -> None:
    """Download the repository ZIP from GitHub and overlay it on app_dir."""
    url = os.environ.get("KABIR_UPDATE_ZIP_URL") or REPO_ZIP_URL
    print("  Downloading the latest version from GitHub ...")
    print(f"    {url}")
    tmp = Path(tempfile.mkdtemp(prefix="kabir-update-"))
    try:
        zpath = tmp / "repo.zip"
        _download(url, zpath)
        print(f"  Downloaded {zpath.stat().st_size // 1024} KB - extracting ...")
        ex = tmp / "ex"
        with zipfile.ZipFile(zpath) as zf:
            zf.extractall(ex)
        src = _find_repo_root(ex)
        if src is None:
            raise SystemExit("[ERROR] The downloaded archive has an unexpected "
                             "structure (main.py not found). Aborting.")
        skip = _SKIP_ON_WINDOWS if os.name == "nt" else set()
        n = 0
        for item in sorted(src.rglob("*")):
            rel = item.relative_to(src)
            if rel.parts and rel.parts[0] in (".git", "__pycache__"):
                continue
            if item.is_dir():
                if "__pycache__" in rel.parts:
                    continue
                (app_dir / rel).mkdir(parents=True, exist_ok=True)
                continue
            if len(rel.parts) == 1 and rel.name in skip:
                # never replace the Windows script that may be running right now
                continue
            dest = app_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, dest)
            n += 1
        print(f"  [OK] {n} file(s) installed into: {app_dir}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def step_fetch_code(app_dir: Path, no_fetch: bool, force_zip: bool) -> str:
    print("\n[1/3] Updating the program files ...")
    if no_fetch:
        print("  Skipped (--no-fetch): keeping the code currently on disk.")
        return "skip"
    if not force_zip and git_update(app_dir):
        return "git"
    zip_update(app_dir)
    return "zip"


# ---------------------------------------------------------------------------
# step 2: dependencies
# ---------------------------------------------------------------------------

def step_deps(app_dir: Path, skip: bool) -> None:
    print("\n[2/3] Installing Python dependencies ...")
    if skip:
        print("  Skipped (--skip-deps).")
        return
    req = app_dir / "requirements.txt"
    if not req.is_file():
        print("  requirements.txt not found - skipping.")
        return
    code = _run([sys.executable, "-m", "pip", "install", "-r", str(req)], cwd=app_dir)
    if code != 0:
        print("  [WARN] Some dependencies failed to install.")
        print("         The core app still runs; PDF/Excel exports may be limited.")


# ---------------------------------------------------------------------------
# step 3: backup + migrate + recalc (in a fresh subprocess => runs the NEW code)
# ---------------------------------------------------------------------------

def step_migrate(app_dir: Path, no_backup: bool, no_recalc: bool) -> None:
    print("\n[3/3] Backing up and migrating the database ...")
    if not (app_dir / "kabir" / "data" / "migrate.py").is_file():
        print("  [WARN] This copy of Kabir has no migration module - nothing to do.")
        return
    cmd = [sys.executable, "-m", "kabir.data.migrate"]
    if no_backup:
        cmd.append("--no-backup")
    if not no_recalc:
        cmd.append("--recalc")
    code = _run(cmd, cwd=app_dir)
    if code != 0:
        raise SystemExit("[ERROR] Database migration failed (exit code "
                         f"{code}). Your data was not modified after the backup; "
                         "check the messages above.")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="update", description="Kabir updater (safe for user data)")
    ap.add_argument("--app-dir", default=None,
                    help="folder of the Kabir installation (default: this script's folder)")
    ap.add_argument("--force-zip", action="store_true",
                    help="download the ZIP even if a git checkout is present")
    ap.add_argument("--no-fetch", action="store_true",
                    help="do not download new code (dependencies + migration only)")
    ap.add_argument("--no-git", action="store_true",
                    help="alias of --no-fetch (kept for compatibility)")
    ap.add_argument("--skip-deps", action="store_true",
                    help="do not install pip dependencies")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip pre-update database backup")
    ap.add_argument("--no-recalc", action="store_true",
                    help="skip project price recalculation")
    args = ap.parse_args(argv)

    app_dir = (Path(args.app_dir).expanduser().resolve() if args.app_dir
               else Path(__file__).resolve().parent)
    app_dir.mkdir(parents=True, exist_ok=True)
    no_fetch = bool(args.no_fetch or args.no_git)

    _hr("Kabir - Update")
    print(f"  App folder        : {app_dir}")
    print(f"  Version on disk   : {read_version(app_dir)}")
    _warn_if_server_running()

    mode = step_fetch_code(app_dir, no_fetch, args.force_zip)
    print(f"  Version now       : {read_version(app_dir)}  (source: {mode})")

    step_deps(app_dir, args.skip_deps)
    step_migrate(app_dir, args.no_backup, args.no_recalc)

    print()
    _hr("Update finished")
    print("  Start the app with:")
    if os.name == "nt":
        print(f'    "{app_dir}\\run.bat"')
    else:
        print(f'    "{app_dir}/run.sh"')
    print()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[ABORT] Interrupted by user.")
        raise SystemExit(130)

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

Windows specifics handled here (these were real crashes before):
  * pythonw.exe / "no console" launches  -> stdout is None, every print()
    used to raise AttributeError.
  * legacy console code pages (cp1252/cp437/cp1025...) + Persian paths or
    non-ASCII error text -> UnicodeEncodeError while printing.
  * files locked by a running Kabir instance -> PermissionError
    (WinError 32/5) right in the middle of the ZIP overlay, leaving a
    half-updated installation.
  * files extracted from a ZIP that are read-only -> os.replace() refused.
  * writes into a protected folder (C:\\Program Files\\...) -> traceback.
  * overwriting in place instead of an atomic rename -> truncated files if
    the update is interrupted (power loss, antivirus, Ctrl+C).
  * stale __pycache__ next to freshly overlaid sources.

All console output is ASCII-only so it renders correctly everywhere
(including the Windows console). Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import List, Optional, Sequence

REPO_ZIP_URL = "https://github.com/erfanjaster/kabir_app/archive/refs/heads/main.zip"

IS_WINDOWS = os.name == "nt"

# Files that must not be replaced while they may be running (Windows cmd
# re-reads .bat files line by line; replacing one mid-run corrupts it).
# Compared case-insensitively because Windows filenames are.
_SKIP_ON_WINDOWS = {"update.bat", "update.cmd"}

# Never copied from the archive / never kept next to the new sources.
_IGNORED_TOP_DIRS = {".git", "__pycache__"}

# Suffix used for the temp file created next to a target while replacing it.
_TMP_SUFFIX = ".kabirnew"


# ---------------------------------------------------------------------------
# console / printing (must run before anything prints)
# ---------------------------------------------------------------------------

def _init_console() -> None:
    """Make printing impossible to crash on Windows.

    Two distinct failure modes:
      * pythonw.exe (double-clicked .py/.pyw, or a shortcut with "Hidden"
        window): sys.stdout / sys.stderr are None -> print() raises
        AttributeError: 'NoneType' object has no attribute 'write'.
      * a legacy console code page that cannot encode the text (Persian
        paths, localized OSError messages) -> UnicodeEncodeError.
    """
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            try:
                setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))
            except OSError:
                pass
            continue
        try:
            # errors="replace" degrades gracefully instead of raising.
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            # Python < 3.7, or a stream that refuses to be reconfigured.
            pass


def _hr(title: str = "") -> None:
    print("=" * 58)
    if title:
        print(f"  {title}")
        print("=" * 58)


def _child_env() -> dict:
    """Env for child Python processes: UTF-8 output, so pip/migrate never
    die on a Windows code page either."""
    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    return env


def _run(cmd: Sequence, cwd, quiet: bool = False) -> int:
    # Keep our own output in order relative to the child's output when the
    # console is a file / pipe (Windows cmd without a real console does that).
    try:
        sys.stdout.flush()
    except (AttributeError, ValueError, OSError):
        pass
    if not quiet:
        print(f"  $ {' '.join(str(c) for c in cmd)}")
    try:
        # No shell=True: the argument list is passed straight to Windows and
        # spaces / non-ASCII characters in paths are preserved.
        return subprocess.run(
            [str(c) for c in cmd],
            cwd=str(cwd),
            env=_child_env(),
        ).returncode
    except FileNotFoundError:
        print(f"  [WARN] Command not found: {cmd[0]}")
        return 127
    except OSError as exc:
        print(f"  [WARN] Could not start {cmd[0]}: {exc}")
        return 126


def _die(msg: str, code: int = 1):
    print(msg)
    raise SystemExit(code)


# ---------------------------------------------------------------------------
# file helpers (Windows-safe replace)
# ---------------------------------------------------------------------------

def _win_long(path: Path) -> str:
    """Return a string usable for very long paths on Windows (> MAX_PATH).

    Without the \\\\?\\ prefix, os/shutil calls fail with
    [WinError 206] / [Errno 2] on deeply nested folders.
    """
    s = str(path)
    if IS_WINDOWS and len(s) > 240 and not s.startswith("\\\\?\\"):
        try:
            s = "\\\\?\\" + os.path.abspath(s)
        except OSError:
            pass
    return s


def _remove_quietly(path: Path) -> None:
    try:
        if path.exists():
            try:
                os.chmod(_win_long(path), stat.S_IWRITE)
            except OSError:
                pass
            os.unlink(_win_long(path))
    except OSError:
        pass


def _replace_file(src: Path, dst: Path, retries: int = 5) -> None:
    """Atomically install `src` at `dst`, surviving Windows file locks.

    * The data is first written to a temp file in the *destination* folder
      and then renamed with os.replace(), which is atomic on NTFS. A crash
      can therefore never leave a half-written .py next to the old one
      (the previous behaviour with shutil.copy2 truncated files in place).
    * PermissionError (WinError 32 "being used by another process" /
      WinError 5 "access denied" from a read-only file) is retried a few
      times, because antivirus scanners and a closing app release their
      handles after a moment.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + _TMP_SUFFIX)
    _remove_quietly(tmp)
    shutil.copyfile(_win_long(src), _win_long(tmp))
    try:
        shutil.copystat(_win_long(src), _win_long(tmp))
    except OSError:
        pass  # timestamps are cosmetic; never fail an update over them

    last_exc: Optional[BaseException] = None
    for attempt in range(retries):
        try:
            if IS_WINDOWS and dst.exists():
                # A file extracted from a ZIP / restored from a backup can be
                # read-only, and os.replace() then fails on the target.
                try:
                    os.chmod(_win_long(dst), stat.S_IWRITE)
                except OSError:
                    pass
            os.replace(_win_long(tmp), _win_long(dst))
            return
        except PermissionError as exc:          # locked or read-only
            last_exc = exc
            time.sleep(0.2 * (attempt + 1))
        except OSError as exc:                  # disk full, path too long...
            last_exc = exc
            break

    _remove_quietly(tmp)
    assert last_exc is not None
    raise last_exc


def _purge_pycache(root: Path) -> int:
    """Delete stale __pycache__ folders after the ZIP overlay.

    Windows keeps .pyc files locked for a moment and OneDrive/antivirus can
    hold them longer, so failures are ignored on purpose: a stale cache is
    harmless, a crash is not.
    """
    removed = 0
    for dirpath, dirnames, _files in os.walk(str(root)):
        for d in list(dirnames):
            if d == "__pycache__":
                dirnames.remove(d)
                shutil.rmtree(os.path.join(dirpath, d), ignore_errors=True)
                removed += 1
    return removed


# ---------------------------------------------------------------------------
# misc helpers
# ---------------------------------------------------------------------------

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


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def _warn_if_server_running() -> None:
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


def zip_update(app_dir: Path) -> List[str]:
    """Download the repository ZIP and overlay it on app_dir.

    Returns the list of files that could NOT be replaced (normally: open by
    a running Kabir or an antivirus). An empty list means "fully updated".
    """
    url = os.environ.get("KABIR_UPDATE_ZIP_URL") or REPO_ZIP_URL
    print("  Downloading the latest version from GitHub ...")
    print(f"    {url}")

    tmp = Path(tempfile.mkdtemp(prefix="kabir-update-"))
    failed: List[str] = []
    try:
        zpath = tmp / "repo.zip"
        _download(url, zpath)
        print(f"  Downloaded {zpath.stat().st_size // 1024} KB - extracting ...")

        ex = tmp / "ex"
        with zipfile.ZipFile(zpath) as zf:
            bad = zf.testzip()
            if bad is not None:
                _die(f"[ERROR] The downloaded archive is corrupt ({bad}). "
                     "Aborting; nothing was changed.", 2)
            zf.extractall(ex)

        src = _find_repo_root(ex)
        if src is None:
            _die("[ERROR] The downloaded archive has an unexpected structure "
                 "(main.py not found). Aborting.", 2)

        skip = {n.lower() for n in _SKIP_ON_WINDOWS} if IS_WINDOWS else set()
        n = 0
        for item in sorted(src.rglob("*")):
            rel = item.relative_to(src)
            if not rel.parts:
                continue
            # .git / __pycache__ anywhere in the tree, not only at the top.
            if any(part in _IGNORED_TOP_DIRS for part in rel.parts):
                continue

            dest = app_dir / rel

            # Refuse anything that would escape the app folder ("zip slip").
            if not _is_within(dest, app_dir):
                print(f"  [WARN] Skipping unsafe path: {rel}")
                continue

            if item.is_dir():
                try:
                    dest.mkdir(parents=True, exist_ok=True)
                except OSError as exc:
                    print(f"  [WARN] Cannot create {rel}: {exc}")
                    failed.append(str(rel))
                continue

            if len(rel.parts) == 1 and rel.name.lower() in skip:
                # Never replace the Windows script that may be running now.
                print(f"  [NOTE] Left {rel.name} untouched (it may be running).")
                continue

            try:
                _replace_file(item, dest)
                n += 1
            except OSError as exc:
                # Locked / read-only / no permission: keep the rest going so
                # the user sees the full picture instead of a traceback.
                print(f"  [WARN] Could not replace {rel}: {exc}")
                failed.append(str(rel))

        cache_dirs = _purge_pycache(app_dir)
        if cache_dirs:
            print(f"  Cleared {cache_dirs} stale __pycache__ folder(s).")

        if failed:
            print(f"  [WARN] {n} file(s) installed, {len(failed)} file(s) NOT "
                  "updated:")
            for f in failed[:10]:
                print(f"           - {f}")
            if len(failed) > 10:
                print(f"           ... and {len(failed) - 10} more")
        else:
            print(f"  [OK] {n} file(s) installed into: {app_dir}")
        return failed
    finally:
        # On Windows a still-open handle (antivirus) can make rmtree fail or
        # raise; the temp folder is disposable, so give up quietly.
        shutil.rmtree(tmp, ignore_errors=True)


def step_fetch_code(app_dir: Path, no_fetch: bool, force_zip: bool) -> str:
    print("\n[1/3] Updating the program files ...")
    if no_fetch:
        print("  Skipped (--no-fetch): keeping the code currently on disk.")
        return "skip"
    if not force_zip and git_update(app_dir):
        return "git"

    failed = zip_update(app_dir)
    if failed:
        # Abort BEFORE touching dependencies or the database: a half-updated
        # tree plus a migration run against a live DB is the worst case.
        _die("\n[ERROR] The program folder is partially updated because some "
             "files are in use.\n"
             "        Close Kabir (and any opened file inside the program "
             "folder), then run\n"
             "        this updater again. Your data has not been touched.", 2)
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

    if _run([sys.executable, "-m", "pip", "--version"],
            cwd=app_dir, quiet=True) != 0:
        print("  pip is not available - trying 'ensurepip' ...")
        _run([sys.executable, "-m", "ensurepip", "--upgrade"], cwd=app_dir)

    code = _run([sys.executable, "-m", "pip", "install", "-r", str(req)],
                cwd=app_dir)
    if code != 0:
        print("  [WARN] Some dependencies failed to install.")
        print("         The core app still runs; PDF/Excel exports may be limited.")
        if IS_WINDOWS:
            print("         If this folder is protected (e.g. C:\\Program Files),")
            print("         move Kabir to a user folder such as C:\\Kabir and retry.")


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
        _die("[ERROR] Database migration failed (exit code "
             f"{code}). Your data was not modified after the backup; "
             "check the messages above.", 3)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    _init_console()

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

    if args.app_dir:
        # expandvars: lets "%APPDATA%\\..." work even from PowerShell, where
        # single quotes prevent cmd's own expansion.
        app_dir = Path(os.path.expandvars(
            os.path.expanduser(args.app_dir))).resolve()
    else:
        app_dir = Path(__file__).resolve().parent

    no_fetch = bool(args.no_fetch or args.no_git)

    _hr("Kabir - Update")
    print(f"  App folder        : {app_dir}")
    print(f"  Version on disk   : {read_version(app_dir)}")
    print(f"  Platform          : {'Windows' if IS_WINDOWS else os.name}")
    _warn_if_server_running()

    try:
        app_dir.mkdir(parents=True, exist_ok=True)
        mode = step_fetch_code(app_dir, no_fetch, args.force_zip)
        print(f"  Version now       : {read_version(app_dir)}  (source: {mode})")

        step_deps(app_dir, args.skip_deps)
        step_migrate(app_dir, args.no_backup, args.no_recalc)
    except PermissionError as exc:
        _hr("Update failed")
        print("  [ERROR] Access denied while writing to the program folder.")
        print(f"          {exc}")
        if IS_WINDOWS:
            print("          - Close Kabir / the file explorer window on that "
                  "folder and retry.")
            print("          - Do not install Kabir under C:\\Program Files; "
                  "use e.g. C:\\Kabir.")
            print("          - Or start this updater as Administrator.")
        return 5
    except OSError as exc:
        _hr("Update failed")
        print("  [ERROR] Filesystem error - nothing else was attempted.")
        print(f"          {exc}")
        return 6

    print()
    _hr("Update finished")
    print("  Start the app with:")
    if IS_WINDOWS:
        print(f'    "{app_dir}\\run.bat"')
        print("  (or: python main.py)")
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

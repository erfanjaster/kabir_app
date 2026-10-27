#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kabir - cross-platform updater
==============================
Performs a safe, in-place update:

  1. Pulls the latest code from git (if this folder is a git checkout)
  2. Installs/updates Python dependencies (requirements.txt)
  3. Creates a pre-update backup of the local database (automatic)
  4. Applies database migrations WITHOUT touching user data
     (projects, materials, invoices, settings are all preserved)
  5. Recalculates project prices with the current material rates

User data lives OUTSIDE the program folder (so re-extracting a new
version never destroys it):
  Windows : %APPDATA%\\KabirCabinet
  Linux   : ~/.local/share/KabirCabinet
  macOS   : ~/Library/Application Support/KabirCabinet

Usage:
  python update.py               # full update (recommended)
  python update.py --skip-deps   # do not touch pip packages
  python update.py --no-git      # do not run git pull
  python update.py --no-backup   # skip the pre-update database backup
  python update.py --no-recalc   # skip recalculating project prices

All console output is ASCII-only so it renders correctly everywhere
(including the Windows console).
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_URL = "https://github.com/erfanjaster/kabir_app.git"


def _hr(title: str = "") -> None:
    print("=" * 58)
    if title:
        print(f"  {title}")
        print("=" * 58)


def _run(cmd, cwd=None, check=False):
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    proc = subprocess.run([str(c) for c in cmd], cwd=str(cwd or ROOT))
    if check and proc.returncode != 0:
        raise SystemExit(f"[ERROR] Command failed: {' '.join(str(c) for c in cmd)}")
    return proc.returncode


def step_git_pull() -> None:
    print("\n[1/4] Checking for a newer version ...")
    if not (ROOT / ".git").is_dir():
        print("  This folder is not a git checkout - skipping git pull.")
        print("  (If you update by downloading the ZIP, extract the new files")
        print("   over this folder first, then run this script again.)")
        return
    git = shutil.which("git")
    if not git:
        print("  git is not installed - skipping pull. Update the files manually:")
        print(f"    {REPO_URL}")
        return
    code = _run([git, "pull", "--ff-only"], cwd=ROOT)
    if code != 0:
        print("  [WARN] git pull failed (local changes or diverged history).")
        print("         Continuing with the files currently on disk.")


def step_deps() -> None:
    print("\n[2/4] Installing Python dependencies ...")
    req = ROOT / "requirements.txt"
    if not req.is_file():
        print("  requirements.txt not found - skipping.")
        return
    code = _run([sys.executable, "-m", "pip", "install", "-r", str(req)])
    if code != 0:
        print("  [WARN] Some dependencies failed to install.")
        print("         The core app still runs; PDF/Excel exports may be limited.")


def step_migrate(do_backup: bool, do_recalc: bool) -> None:
    print("\n[3/4] Backing up and migrating the database ...")
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from kabir.data import migrate

    if do_backup:
        path = migrate.backup_before_migrate()
        if path:
            print(f"  [OK] Backup created: {path}")
        else:
            print("  [INFO] No existing database - nothing to back up (fresh install).")

    from kabir.data.db import Database
    from kabir import config

    db = Database.instance()          # applies migrations automatically
    ver = migrate.user_version(db.conn)
    print(f"  [OK] Database: {db.path}")
    print(f"  [OK] Schema version: {ver} (target {migrate.SCHEMA_VERSION})")
    counts = {
        "projects": db.scalar("SELECT COUNT(*) FROM projects", default=0),
        "materials": db.scalar("SELECT COUNT(*) FROM materials", default=0),
        "invoices": db.scalar("SELECT COUNT(*) FROM invoices", default=0),
    }
    print("  [OK] Your data is intact: "
          f"{counts['projects']} project(s), {counts['materials']} material(s), "
          f"{counts['invoices']} invoice(s).")

    print("\n[4/4] Recalculating project prices ...")
    if do_recalc:
        from kabir.data.recalc import recalc_all_projects
        changed = recalc_all_projects(db)
        print(f"  [OK] {len(changed)} project(s) recalculated with current rates.")
    else:
        print("  Skipped (--no-recalc).")
    print(f"  [INFO] Data directory: {config.data_dir()}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="update", description="Kabir updater (safe for user data)")
    ap.add_argument("--skip-deps", action="store_true", help="do not install pip dependencies")
    ap.add_argument("--no-git", action="store_true", help="do not run git pull")
    ap.add_argument("--no-backup", action="store_true", help="skip pre-update database backup")
    ap.add_argument("--no-recalc", action="store_true", help="skip project price recalculation")
    args = ap.parse_args(argv)

    _hr("Kabir - Update")
    try:
        from kabir import __version__
        print(f"  Current version on disk: {__version__}")
    except Exception:
        print("  (could not read current version)")

    if not args.no_git:
        step_git_pull()
    else:
        print("\n[1/4] git pull skipped (--no-git).")

    if not args.skip_deps:
        step_deps()
    else:
        print("\n[2/4] Dependencies skipped (--skip-deps).")

    step_migrate(do_backup=not args.no_backup, do_recalc=not args.no_recalc)

    print()
    _hr("Update finished")
    print("  Start the app with:")
    if sys.platform == "win32":
        print("    run.bat")
    else:
        print("    ./run.sh")
    print()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[ABORT] Interrupted by user.")
        raise SystemExit(130)

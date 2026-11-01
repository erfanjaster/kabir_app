#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kabir — به‌روزرسانِ خودبسنده و چندسکویی (ویندوز / لینوکس / مک)
================================================================
این فایل تنها چیزی است که کاربر برای به‌روز کردن نیاز دارد؛ حتی اگر نصبِ
فعلی از یک ZIP استخراج شده باشد (بدون پوشه‌ی .git) کار می‌کند.

مراحل، به ترتیب:
  ۱) گرفتن کدِ نسخه‌ی تازه در پوشه‌ی برنامه:
       - اگر پوشه checkout گیت است: «git pull --ff-only»
       - وگرنه: دانلود ZIP مخزن از گیت‌هاب و جایگذاری فایل‌ها
         (فایل‌های اضافه‌ی کاربر هرگز پاک نمی‌شوند)
  ۲) نصب/به‌روزرسانی وابستگی‌های پایتون (requirements.txt)
  ۳) پشتیبان‌گیری از پایگاه‌داده، سپس مهاجرتِ امن
  ۴) بازمحاسبه‌ی قیمت پروژه‌ها با نرخ‌های جاری

داده‌های کاربر «بیرون» از پوشه‌ی برنامه نگه داشته می‌شوند، پس به‌روزرسانیِ کد
هرگز آن‌ها را از بین نمی‌برد:
  ویندوز : %APPDATA%\\KabirCabinet
  لینوکس : ~/.local/share/KabirCabinet
  مک     : ~/Library/Application Support/KabirCabinet

اجرا:
  python update.py                        به‌روزرسانیِ همان پوشه‌ای که اسکریپت در آن است
  python update.py --app-dir "C:\\Kabir"  به‌روزرسانیِ پوشه‌ای دیگر
  python update.py --force-zip            دانلود ZIP حتی اگر گیت در دسترس است
  python update.py --no-fetch             فقط وابستگی‌ها + مهاجرت (بدون دانلود کد)
  python update.py --skip-deps            دست‌نزدن به بسته‌های pip
  python update.py --no-backup            رد کردن پشتیبان‌گیریِ پیش از به‌روزرسانی
  python update.py --no-recalc            رد کردن بازمحاسبه‌ی قیمت پروژه‌ها

مشکلات ویندوزی که این‌جا حل شده‌اند (همه قبلاً crash واقعی بودند):
  * اجرای pythonw.exe / بدون کنسول → stdout مقدار None است و هر print()
    با AttributeError می‌ترکید.
  * code page قدیمی کنسول (cp1252/cp437/…) + مسیر فارسی → UnicodeEncodeError.
  * فایل‌های قفل‌شده توسط کبیرِ در حال اجرا → PermissionError (WinError 32/5)
    وسطِ جایگذاری ZIP و نصبِ نیمه‌تمام.
  * فایل‌های فقط‌خواندنیِ استخراج‌شده از ZIP → os.replace() رد می‌کرد.
  * نوشتن در پوشه‌ی محافظت‌شده (C:\\Program Files) → traceback.
  * نوشتنِ درجا به‌جای rename اتمیک → فایلِ نیمه‌نویس هنگام قطعی برق/Ctrl+C.
  * __pycache__ کهنه کنار کدِ تازه.
  * مسیرهای بلندتر از ۲۶۰ نویسه (prefix «\\\\?\\»).

مشکلات لینوکس/مک که حل شده‌اند:
  * ZIP گیت‌هاب «مجوز اجرا» را نگه نمی‌دارد → run.sh/update.sh بعد از
    به‌روزرسانی غیرقابل‌اجرا می‌شدند (۶۴۴). این‌جا مجوز اجرا بازمی‌گردد.

خروجیِ کنسول عمداً فقط ASCII است تا روی هر کنسولی درست نمایش داده شود.
فقط از کتابخانه‌ی استاندارد پایتون استفاده می‌شود.
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
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import List, Optional, Sequence

REPO_ZIP_URL = "https://github.com/erfanjaster/kabir_app/archive/refs/heads/main.zip"

IS_WINDOWS = os.name == "nt"

#: فایل‌هایی که نباید جایگزین شوند چون ممکن است «همین الان» در حال اجرا باشند.
#: cmd.exe فایل .bat/.cmd را خط‌به‌خط می‌خواند و بازنویسیِ میانه‌ی اجرا خرابش
#: می‌کند. (در لینوکس/مک، update.sh با `exec` جای خودش را به پایتون می‌دهد،
#: پس بازنویسی‌اش بی‌خطر است.) مقایسه بدون توجه به بزرگی/کوچکی حروف است.
_SKIP_WHILE_RUNNING = {"update.bat", "update.cmd"}

#: هرگز از آرشیو کپی نمی‌شوند — در «هر» سطحی از مسیر، نه فقط سطح اول.
#: (یک ZIP آینه‌شده می‌تواند .git یا __pycache__ تودرتو داشته باشد و کپی‌شدنِ
#:  .git تودرتو، تاریخچه‌ی گیتِ کاربر را خراب می‌کند.)
_IGNORED_DIR_NAMES = {".git", "__pycache__", ".hg", ".svn"}

#: پسوندِ فایل موقتِ کنارِ مقصد، برای جایگزینیِ اتمیک
_TMP_SUFFIX = ".kabirnew"

#: فایل‌هایی که در لینوکس/مک باید مجوز اجرا بگیرند
_EXECUTABLE_SUFFIXES = {".sh", ".bash", ".command"}

#: مهلت‌های پیش‌فرض (ثانیه). pip روی اینترنت کند یا هنگام ساختِ بسته‌ی بومی
#: می‌تواند خیلی طول بکشد، پس مهلتِ جداگانه و بلندتری دارد.
_TIMEOUT_DEFAULT = 600
_TIMEOUT_PIP = 1800


# ---------------------------------------------------------------------------
# کنسول
# ---------------------------------------------------------------------------

def _init_console() -> None:
    """چاپ کردن را روی ویندوز غیرقابل‌خراب‌شدن می‌کند.

    دو حالت خرابیِ جدا:
      * pythonw.exe (دابل‌کلیک روی .py/.pyw یا میان‌بُرِ «Hidden»):
        sys.stdout / sys.stderr مقدار None هستند → print() با
        AttributeError: 'NoneType' object has no attribute 'write' می‌ترکد.
      * code page قدیمی کنسول که نمی‌تواند متن را رمزگذاری کند (مسیر فارسی،
        پیام خطای محلی‌شده) → UnicodeEncodeError.
      * جریانِ بسته‌شده (کنسول بسته شده ولی فرایند زنده است).
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
            if stream.closed:
                setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))
                continue
        except (AttributeError, OSError):
            pass
        try:
            # errors="replace" به‌جای ترکیدن، نویسه‌ی جایگزین می‌گذارد.
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def _hr(title: str = "") -> None:
    print("=" * 58)
    if title:
        print(f"  {title}")
        print("=" * 58)


def _child_env() -> dict:
    """محیط برای فرایندهای فرزندان: خروجی UTF-8 تا pip/migrate هم روی
    code page ویندوزی نمیرند."""
    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    return env


def _run(cmd: Sequence, cwd: Path, quiet: bool = False,
         timeout: int = _TIMEOUT_DEFAULT) -> int:
    """اجرای یک فرمان و برگرداندن کد خروج آن (بدون shell=True)."""
    if not quiet:
        cmd_str = " ".join(f'"{c}"' if " " in str(c) else str(c) for c in cmd)
        print(f"  $ {cmd_str}")
    # ★ مهم: «بعد از» چاپِ فرمان flush می‌کنیم، نه قبل از آن. وگرنه وقتی خروجی
    #   به pipe/فایل می‌رود، متنِ فرزند زودتر از عنوانِ فرمانِ خودمان روی
    #   دیسک می‌نشیند و لاگ به هم ریخته نشان داده می‌شود (فرمان بعد از
    #   خروجیِ خودش چاپ می‌شد).
    try:
        sys.stdout.flush()
    except (AttributeError, ValueError, OSError):
        pass
    try:
        return subprocess.run(
            [str(c) for c in cmd],
            # نکته: مسیر cwd را با prefix «\\?\» به CreateProcess نمی‌دهیم؛
            # برخی ابزارها (pip/git) آن را درست تفسیر نمی‌کنند.
            cwd=str(cwd),
            env=_child_env(),
            timeout=timeout,
        ).returncode
    except FileNotFoundError:
        print(f"  [WARN] Command not found: {cmd[0]}")
        return 127
    except subprocess.TimeoutExpired:
        print(f"  [WARN] Command timed out after {timeout // 60} minute(s): {cmd[0]}")
        return 124
    except OSError as exc:
        print(f"  [WARN] Could not start {cmd[0]}: {exc}")
        return 126


def _die(msg: str, code: int = 1):
    print(msg)
    raise SystemExit(code)


# ---------------------------------------------------------------------------
# کمکی‌های فایل
# ---------------------------------------------------------------------------

def _win_long(path) -> str:
    """مسیرِ بلندِ ویندوزی: برای مسیرهای >۲۴۰ نویسه prefix «\\\\?\\» می‌گذارد."""
    s = str(path)
    if IS_WINDOWS and len(s) > 240 and not s.startswith("\\\\?\\"):
        try:
            abs_path = os.path.abspath(s)
            if len(abs_path) > 240:
                return "\\\\?\\" + abs_path
        except OSError:
            pass
    return s


def _safe_path(path) -> str:
    """مسیرِ امن برای عملیات فایل (روی لینوکس/مک همان str ساده)."""
    return _win_long(path) if IS_WINDOWS else str(path)


def _remove_quietly(path: Path) -> None:
    try:
        # exists() سمبُلینک را دنبال می‌کند، پس برای سمبُلینکِ شکسته
        # is_symlink() هم لازم است.
        if path.exists() or path.is_symlink():
            try:
                os.chmod(_safe_path(path), stat.S_IWRITE | stat.S_IREAD)
            except OSError:
                pass
            try:
                os.unlink(_safe_path(path))
            except PermissionError:
                # روی ویندوز ممکن است آنتی‌ویروس لحظه‌ای قفلش کرده باشد.
                time.sleep(0.5)
                try:
                    os.unlink(_safe_path(path))
                except OSError:
                    pass
    except OSError:
        pass


def _apply_permissions(src: Path, dst: Path) -> None:
    """مجوزهای درست را روی فایلِ مقصد می‌گذارد.

    روی ویندوز فقط زمان/صفت‌ها کپی می‌شود. روی لینوکس/مک مجوزِ همان فایلِ
    مبدأ گرفته می‌شود و برای اسکریپت‌ها (run.sh و…) «مجوز اجرا» اضافه
    می‌شود — چون ZIP گیت‌هاب این بیت را نگه نمی‌دارد و بدون آن، برنامه بعد از
    به‌روزرسانی با «Permission denied» اجرا نمی‌شد.
    """
    if IS_WINDOWS:
        try:
            shutil.copystat(_safe_path(src), _safe_path(dst))
        except OSError:
            pass
        return

    try:
        mode = src.stat().st_mode & 0o7777
    except OSError:
        mode = 0o644

    if src.suffix.lower() in _EXECUTABLE_SUFFIXES:
        mode |= stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH

    try:
        os.chmod(_safe_path(dst), mode)
    except OSError:
        pass


def _replace_file(src: Path, dst: Path, retries: int = 5) -> None:
    """جایگذاریِ اتمیکِ `src` در `dst`، با تحملِ قفل‌های ویندوزی.

    * داده اول در یک فایلِ موقت «در همان پوشه‌ی مقصد» نوشته می‌شود و بعد با
      os.replace() تغییر نام می‌یابد که روی NTFS اتمیک است. پس قطعی برق
      هرگز فایلِ نیمه‌نوشته کنارِ فایل قبلی نمی‌گذارد.
    * PermissionError (WinError 32 «being used by another process» یا
      WinError 5 «access denied» برای فایلِ فقط‌خواندنی) چند بار با مکث
      تکرار می‌شود، چون آنتی‌ویروس و برنامه‌ی در حالِ بسته‌شدن پس از لحظه‌ای
      دسته‌شان را آزاد می‌کنند.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + _TMP_SUFFIX)
    _remove_quietly(tmp)

    shutil.copyfile(_safe_path(src), _safe_path(tmp))
    _apply_permissions(src, tmp)

    last_exc: Optional[BaseException] = None
    for attempt in range(max(1, retries)):
        try:
            if IS_WINDOWS and dst.exists():
                # فایلی که از ZIP استخراج شده می‌تواند فقط‌خواندنی باشد و
                # os.replace() روی مقصد شکست بخورد.
                try:
                    os.chmod(_safe_path(dst), stat.S_IWRITE | stat.S_IREAD)
                except OSError:
                    pass
            os.replace(_safe_path(tmp), _safe_path(dst))
            return
        except PermissionError as exc:              # قفل یا فقط‌خواندنی
            last_exc = exc
            time.sleep((0.5 if IS_WINDOWS else 0.2) * (attempt + 1))
        except OSError as exc:                      # دیسک پر، مسیر بلند، …
            last_exc = exc
            text = str(exc)
            if "Device or resource busy" in text or "Access denied" in text:
                time.sleep(0.5 * (attempt + 1))
            else:
                break

    _remove_quietly(tmp)
    # ★ به‌جای assert (که با python -O حذف می‌شود و raise None می‌سازد)
    #   یک خطای روشن و همیشگی پرتاب می‌کنیم.
    if last_exc is None:
        raise RuntimeError(f"Could not install {dst} (unknown reason).")
    raise last_exc


def _purge_pycache(root: Path) -> int:
    removed = 0
    for dirpath, dirnames, _files in os.walk(str(root)):
        for d in list(dirnames):
            if d == "__pycache__":
                dirnames.remove(d)          # تا os.walk داخلش نرود
                target = Path(dirpath) / d
                try:
                    shutil.rmtree(str(target), ignore_errors=False)
                    removed += 1
                except OSError as exc:
                    if IS_WINDOWS:
                        print(f"  [WARN] Could not remove {target} "
                              f"(files may be locked): {exc.__class__.__name__}")
    return removed


# ---------------------------------------------------------------------------
# متفرقه
# ---------------------------------------------------------------------------

def _download(url: str, dest: Path, timeout: int = 180, attempts: int = 2) -> None:
    """دانلود با تلاشِ دوباره و پیام خطای تفکیک‌شده.

    ★ ترتیب except مهم است: HTTPError «زیرکلاسِ» URLError است، پس اگر
      URLError اول بیاید، شاخه‌ی HTTPError هرگز اجرا نمی‌شود و خطای ۴۰۴
      به‌شکلِ گمراه‌کننده‌ی «Network error: Not Found» گزارش می‌شد.
    """
    last: Optional[BaseException] = None
    for i in range(max(1, attempts)):
        if i:
            time.sleep(1.5 * i)
            print(f"  [WARN] Retrying download ({i + 1}/{attempts}) ...")
        req = urllib.request.Request(url, headers={"User-Agent": "kabir-updater"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            return
        except urllib.error.HTTPError as exc:            # باید اول بیاید
            # ۴۰۴/۴۰۳ یعنی آدرس یا دسترسی غلط است؛ تلاشِ دوباره فایده ندارد.
            raise OSError(f"HTTP error {exc.code}: {exc.reason}") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            last = OSError(f"Network error: {reason}")
        except OSError as exc:                           # timeout، قطع اتصال، …
            last = exc
    raise OSError(str(last) if last else "Download failed.") from last


def read_version(app_dir: Path) -> str:
    try:
        text = (app_dir / "kabir" / "__init__.py").read_text(
            encoding="utf-8", errors="replace")
        m = re.search(r'__version__\s*=\s*[\'"]([^\'"]+)[\'"]', text)
        return m.group(1) if m else "unknown"
    except (OSError, UnicodeDecodeError):
        return "(not installed yet)"


def _find_repo_root(base: Path) -> Optional[Path]:
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
# گام ۱ — کد
# ---------------------------------------------------------------------------

def git_update(app_dir: Path) -> bool:
    git = shutil.which("git")
    if not git or not (app_dir / ".git").is_dir():
        return False
    print("  Folder is a git checkout - trying 'git pull --ff-only' ...")
    if _run([git, "pull", "--ff-only"], cwd=app_dir) == 0:
        cache = _purge_pycache(app_dir)
        if cache:
            print(f"  Cleared {cache} stale __pycache__ folder(s).")
        return True
    print("  [WARN] git pull failed (local changes or diverged history).")
    print("         Falling back to the ZIP download ...")
    return False


def zip_update(app_dir: Path) -> List[str]:
    url = os.environ.get("KABIR_UPDATE_ZIP_URL") or REPO_ZIP_URL
    print("  Downloading the latest version from GitHub ...")
    print(f"    {url}")

    tmp = Path(tempfile.mkdtemp(prefix="kabir-update-"))
    failed: List[str] = []
    try:
        zpath = tmp / "repo.zip"
        try:
            _download(url, zpath)
        except OSError as exc:
            _die(f"[ERROR] Could not download the update: {exc}\n"
                 "        Check your internet connection (or proxy settings) "
                 "and try again.", 2)

        print(f"  Downloaded {zpath.stat().st_size // 1024} KB - extracting ...")

        ex = tmp / "ex"
        try:
            with zipfile.ZipFile(zpath) as zf:
                bad = zf.testzip()
                if bad is not None:
                    _die(f"[ERROR] The downloaded archive is corrupt ({bad}). "
                         "Aborting; nothing was changed.", 2)
                # extractall خودش مسیرهای مطلق و «..» را پاکسازی می‌کند
                # (Zip-Slip ایمن)، ولی بعداً هم با _is_within چک می‌کنیم.
                zf.extractall(ex)
        except zipfile.BadZipFile as exc:
            _die(f"[ERROR] The downloaded archive is not a valid ZIP file "
                 f"({exc}). Aborting.", 2)
        except OSError as exc:
            _die(f"[ERROR] Could not extract the archive: {exc}", 2)

        src = _find_repo_root(ex)
        if src is None:
            _die("[ERROR] The downloaded archive has an unexpected structure "
                 "(main.py not found). Aborting.", 2)

        skip = {n.lower() for n in _SKIP_WHILE_RUNNING} if IS_WINDOWS else set()
        n = 0
        for item in sorted(src.rglob("*")):
            rel = item.relative_to(src)
            if not rel.parts:
                continue

            # ★ «هر» بخشی از مسیر که نامِ ممنوعه دارد رد می‌شود، نه فقط بخشِ
            #   اول. بررسیِ تنها-سطحِ-اول باعث می‌شد یک .git تودرتو (در ZIP
            #   آینه‌شده) داخل پوشه‌ی نصب کپی شود و تاریخچه‌ی گیتِ کاربر
            #   خراب شود.
            if any(part in _IGNORED_DIR_NAMES for part in rel.parts):
                continue

            dest = app_dir / rel
            if not _is_within(dest, app_dir):
                print(f"  [WARN] Skipping unsafe path: {rel}")
                continue

            if item.is_dir():
                try:
                    # اگر مقصد سمبُلینک یا فایلِ هم‌نام است، اول برداریم؛
                    # وگرنه mkdir شکست می‌خورد.
                    if dest.is_symlink():
                        dest.unlink()
                    elif dest.exists() and not dest.is_dir():
                        dest.unlink()
                    dest.mkdir(parents=True, exist_ok=True)
                except OSError as exc:
                    print(f"  [WARN] Cannot create {rel}: {exc}")
                    failed.append(str(rel))
                continue

            # فایل‌های .bat/.cmd فقط وقتی از قبل موجودند رد می‌شوند (چون ممکن
            # است همین الان در حال اجرا باشند)؛ اگر نباشند، نصب می‌شوند.
            if (len(rel.parts) == 1 and rel.name.lower() in skip
                    and (app_dir / rel).exists()):
                print(f"  [NOTE] Left {rel.name} untouched (it may be running).")
                continue

            try:
                _replace_file(item, dest)
                n += 1
            except PermissionError as exc:
                print(f"  [WARN] Permission denied replacing {rel}: {exc}")
                if IS_WINDOWS:
                    print("           File may be locked or in use. Try closing Kabir.")
                failed.append(str(rel))
            except OSError as exc:
                print(f"  [WARN] Could not replace {rel}: {exc}")
                failed.append(str(rel))

        cache_dirs = _purge_pycache(app_dir)
        if cache_dirs:
            print(f"  Cleared {cache_dirs} stale __pycache__ folder(s).")

        # اسکریپت‌های اجراییِ ریشه باید قابل‌اجرا بمانند (ZIP گیت‌هاب بیتِ
        # اجرا را نگه نمی‌دارد).
        if not IS_WINDOWS:
            for name in ("run.sh", "update.sh", "install.sh", "web.py"):
                f = app_dir / name
                if f.is_file() and not f.is_symlink() and f.suffix in _EXECUTABLE_SUFFIXES:
                    try:
                        f.chmod(f.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                    except OSError:
                        pass

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
        _die("\n[ERROR] The program folder is partially updated because some "
             "files are in use.\n"
             "        Close Kabir (and any opened file inside the program "
             "folder), then run\n"
             "        this updater again. Your data has not been touched.", 2)
    return "zip"


# ---------------------------------------------------------------------------
# گام ۲ — وابستگی‌ها
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
            cwd=app_dir, quiet=True, timeout=120) != 0:
        print("  pip is not available - trying 'ensurepip' ...")
        _run([sys.executable, "-m", "ensurepip", "--upgrade"], cwd=app_dir,
             timeout=300)

    code = _run([sys.executable, "-m", "pip", "install", "-r", _safe_path(req)],
                cwd=app_dir, timeout=_TIMEOUT_PIP)
    if code == 124:
        print("  [WARN] pip did not finish in time. Re-run the updater with a")
        print("         faster connection, or install requirements.txt manually.")
    elif code != 0:
        print("  [WARN] Some dependencies failed to install.")
        print("         The core app still runs; PDF/Excel exports may be limited.")
        if IS_WINDOWS:
            print("         If this folder is protected (e.g. C:\\Program Files),")
            print("         move Kabir to a user folder such as C:\\Kabir and retry.")
            print("         Or run this updater as Administrator.")
        else:
            print("         If this folder is protected (e.g. /opt or /usr/local),")
            print("         try running with sudo or move Kabir to your home folder.")


# ---------------------------------------------------------------------------
# گام ۳ — پایگاه‌داده
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
    code = _run(cmd, cwd=app_dir, timeout=_TIMEOUT_DEFAULT)
    if code != 0:
        if code == 124:
            # در این حالت «نمی‌دانیم» مهاجرت تا کجا رفته، پس صادقانه می‌گوییم
            # از پشتیبان برگردانید — نه اینکه ادعا کنیم داده دست‌نخورده است.
            _die("[ERROR] Database migration timed out. Its final state is "
                 "unknown.\n"
                 "        Re-run this updater; if it fails again, restore the "
                 "latest backup\n"
                 "        from the 'backups' folder inside your data directory.", 3)
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
        app_dir = Path(os.path.expandvars(
            os.path.expanduser(args.app_dir))).resolve()
    else:
        app_dir = Path(__file__).resolve().parent

    no_fetch = bool(args.no_fetch or args.no_git)

    _hr("Kabir - Update")
    print(f"  App folder        : {app_dir}")
    print(f"  Version on disk   : {read_version(app_dir)}")
    print(f"  Platform          : {'Windows' if IS_WINDOWS else os.name}")
    print(f"  Python            : {sys.version.split()[0]}")
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
            print("          - Or start this updater as Administrator "
                  "(right-click > Run as Administrator).")
        else:
            print("          - Check folder permissions (e.g. ls -ld <folder>).")
            print("          - If installed in /opt or /usr, run with sudo:")
            print(f"            sudo {sys.argv[0]}")
            print("          - Or move Kabir to your home folder.")
        return 5
    except OSError as exc:
        _hr("Update failed")
        print("  [ERROR] Filesystem error - nothing else was attempted.")
        print(f"          {exc}")
        if IS_WINDOWS and "206" in str(exc):
            print("          (Path too long - move Kabir to a shorter path "
                  "like C:\\Kabir)")
        return 6

    print()
    _hr("Update finished")
    print("  Start the app with:")
    if IS_WINDOWS:
        print(f'    "{app_dir}\\run.bat"')
        print("  (or: python main.py)")
    else:
        print(f'    "{app_dir}/run.sh"')
        print(f"  (or: python3 {app_dir}/main.py)")
    print()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[ABORT] Interrupted by user.")
        raise SystemExit(130)

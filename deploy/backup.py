#!/usr/bin/env python3
"""Take a transaction-consistent online SQLite backup; retain latest 14."""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

os.umask(0o077)
source = Path("/var/lib/notionx/notionx.sqlite")
if not source.is_file():
    raise SystemExit("SQLite database does not exist yet")
directory = source.parent / "backups"
directory.mkdir(mode=0o700, exist_ok=True)
backup = directory / ("notionx-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite")
with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as src:
    with sqlite3.connect(backup) as dest:
        src.backup(dest)
        if dest.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Backup integrity check failed")
for old in sorted(directory.glob("notionx-*.sqlite"), reverse=True)[14:]:
    old.unlink()
print("SQLite backup verified:", backup)

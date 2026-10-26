#!/usr/bin/env bash
# Run in a PromptX managed terminal: remote systemd owns the app lifecycle.
set -euo pipefail
REMOTE=root@8.130.37.52
exec ssh -o ExitOnForwardFailure=yes -L 127.0.0.1:53220:127.0.0.1:3220 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "$REMOTE" '
  set -eu
  systemctl enable notionx.service notionx-backup.timer
  systemctl restart notionx.service
  systemctl start notionx-backup.timer
  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3220/api/health >/dev/null; then
      systemctl start notionx-backup.service
      echo "NotionX online: https://notionx.mushayu.com"
      exec journalctl --unit=notionx.service --follow --lines=20 --no-pager
    fi
    sleep 1
  done
  systemctl status notionx.service --no-pager
  exit 1
'

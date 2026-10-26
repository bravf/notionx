#!/usr/bin/env bash
# Prepare a release. Activation is separate: run-aliyun.sh.
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE=root@8.130.37.52
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
STAGE="$(mktemp -d /tmp/notionx-deploy.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
cd "$ROOT_DIR"
npm test
npm run build
mkdir "$STAGE/package"
cp -R dist server shared deploy "$STAGE/package/"
cp package.json package-lock.json "$STAGE/package/"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$STAGE/release.tgz" -C "$STAGE/package" .
scp "$STAGE/release.tgz" "$REMOTE:/tmp/notionx-$RELEASE.tgz"
ssh "$REMOTE" "bash -s -- '$RELEASE'" <<'REMOTE_SCRIPT'
set -euo pipefail
umask 077
release="$1"
archive="/tmp/notionx-$release.tgz"
trap 'rm -f "$archive"' EXIT
node_bin=/root/.nvm/versions/node/v22.22.1/bin
export PATH="$node_bin:$PATH"
id notionx >/dev/null 2>&1 || useradd --system --home-dir /var/lib/notionx --shell /usr/sbin/nologin notionx
install -d -m 755 /opt/notionx /opt/notionx/releases /opt/notionx/runtime
install -d -m 700 /etc/notionx
install -d -o notionx -g notionx -m 700 /var/lib/notionx /var/lib/notionx/backups
if [ ! -x /opt/notionx/runtime/node ]; then install -m 755 "$node_bin/node" /opt/notionx/runtime/node; fi
if [ ! -f /etc/notionx/notionx.env ]; then
  python3 - <<'ENV_SCRIPT'
from pathlib import Path
import secrets
p = Path('/etc/notionx/notionx.env')
p.write_text('NODE_ENV=production\nHOST=127.0.0.1\nPORT=3220\nDATABASE_PATH=/var/lib/notionx/notionx.sqlite\nCOOKIE_SECURE=true\nAPP_PASSWORD=' + secrets.token_urlsafe(24) + '\n')
p.chmod(0o600)
ENV_SCRIPT
fi
install -d -m 755 "/opt/notionx/releases/$release"
tar -xzf "$archive" -C "/opt/notionx/releases/$release"
chmod -R u=rwX,go=rX "/opt/notionx/releases/$release"
cd "/opt/notionx/releases/$release"
npm ci --omit=dev --no-audit --no-fund </dev/null
chmod -R u=rwX,go=rX node_modules
/opt/notionx/runtime/node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database(':memory:'); console.log('SQLite native module ready:',db.prepare('select sqlite_version() as version').get().version); db.close()"
if [ -f /var/lib/notionx/notionx.sqlite ]; then
  runuser -u notionx -- python3 deploy/backup.py
fi
install -m 644 deploy/notionx.service deploy/notionx-backup.service deploy/notionx-backup.timer /etc/systemd/system/
install -m 644 deploy/notionx-proxy.conf /usr/local/nginx/conf/notionx-proxy.conf
vhost=/usr/local/nginx/conf/vhost/notionx.conf
if [ ! -e /etc/letsencrypt/live/notionx.mushayu.com/fullchain.pem ]; then
  if [ -e "$vhost" ]; then cp -p "$vhost" "$vhost.previous"; fi
  cat > "$vhost" <<'ACME'
server {
    listen 80;
    server_name notionx.mushayu.com;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 503; }
}
ACME
  /usr/local/nginx/sbin/nginx -t
  systemctl reload nginx
  certbot certonly --webroot -w /var/www/certbot -d notionx.mushayu.com --non-interactive --agree-tos </dev/null
fi
if [ -e "$vhost" ]; then cp -p "$vhost" "$vhost.previous"; fi
install -m 644 deploy/notionx.nginx.conf "$vhost"
if ! /usr/local/nginx/sbin/nginx -t; then
  mv "$vhost.previous" "$vhost"
  exit 1
fi
systemctl reload nginx
if [ -L /opt/notionx/current ]; then
  ln -sfn "$(readlink /opt/notionx/current)" /opt/notionx/previous
fi
ln -sfn "/opt/notionx/releases/$release" /opt/notionx/current
systemctl daemon-reload
echo "Prepared release: $release"
REMOTE_SCRIPT
scp "$REMOTE:/etc/notionx/notionx.env" "$ROOT_DIR/.env.aliyun"
chmod 600 "$ROOT_DIR/.env.aliyun"
echo "Release prepared. Activate with scripts/run-aliyun.sh in a managed foreground terminal."

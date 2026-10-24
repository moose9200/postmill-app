#!/usr/bin/env bash
# Hosts such as Railway mount volumes owned by root, which the unprivileged `app`
# user cannot write. Started as root (Railway: RAILWAY_RUN_UID=0), this hands the
# uploads directory to `app` and drops privileges before anything serves traffic.
# Started as `app` (the image default), it changes nothing.
set -eu
if [ "$(id -u)" = "0" ]; then
  UPLOADS="${UPLOAD_DIRECTORY:-/uploads}"
  mkdir -p "$UPLOADS"
  chown -R app:app "$UPLOADS"
  export HOME=/app
  exec setpriv --reuid=app --regid=app --init-groups bash /app/docker/entrypoint.sh
fi
exec bash /app/docker/entrypoint.sh

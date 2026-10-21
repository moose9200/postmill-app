#!/usr/bin/env bash
# Apply the committed Prisma migrations inside the live Postmill container.
#
#   ./tools/db/postmill-migrate.sh            # prisma migrate deploy (extra args are passed through)
#
# This applies the migrations baked into the RUNNING image (forward-only, the same
# `prisma migrate deploy` the upgrade guide documents). The container does NOT apply
# migrations on boot (docker/entrypoint.sh runs no prisma), so run this after
# redeploying a new image tag. Take a backup first when a release ships a destructive
# migration.
#
# The runtime image has no pnpm, so this uses the prisma CLI already installed in the
# image's production node_modules (pinned 6.5.0) — no network fetch.
set -euo pipefail
CONTAINER="${POSTMILL_CONTAINER:-postmill}"
SCHEMA="./libraries/nestjs-libraries/src/database/prisma/schema.prisma"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "ERROR: container '$CONTAINER' not running. Set POSTMILL_CONTAINER=<name>." >&2
  exit 1
fi

echo ">> Reminder: take a backup first if this release ships a destructive migration."
echo ">> prisma migrate deploy in $CONTAINER $*"
docker exec -w /app "$CONTAINER" node_modules/.bin/prisma migrate deploy --schema "$SCHEMA" "$@"
echo ">> done."

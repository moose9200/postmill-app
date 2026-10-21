#!/usr/bin/env bash
# `pnpm run prisma-schema-check` — run the destructive-schema guard.
#
#   pnpm run prisma-schema-check                      # guard the live diff (DATABASE_URL → schema.prisma)
#   pnpm run prisma-schema-check -- --file path.sql   # guard a saved diff; no DB needed
#
# Any arguments go to tools/db/schema-destructive-guard.mjs. With --file the guard reads
# that SQL, so the live `prisma migrate diff` is skipped.
set -euo pipefail
GUARD=tools/db/schema-destructive-guard.mjs
SCHEMA=./libraries/nestjs-libraries/src/database/prisma/schema.prisma

# pnpm may forward a literal `--` separator; drop it.
if [ "${1:-}" = "--" ]; then shift; fi

if [ "$#" -gt 0 ]; then
  exec node "$GUARD" "$@"
fi

pnpm dlx prisma@6.5.0 migrate diff --from-url "${DATABASE_URL:?DATABASE_URL must be set (or pass --file)}" --to-schema-datamodel "$SCHEMA" --script \
  | node "$GUARD"

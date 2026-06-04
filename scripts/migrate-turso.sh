#!/usr/bin/env bash
# Apply versioned Prisma migrations to a remote Turso database.
#
# Usage:
#   DATABASE_URL="libsql://<db>-<org>.turso.io" \
#   DATABASE_AUTH_TOKEN="<token>" \
#   npm run db:migrate:turso
#
# Requires:
#   - turso CLI installed (https://docs.turso.tech/cli/introduction); no interactive
#     `turso auth login` needed — the --auth-token flag authenticates each command
#   - DATABASE_URL set to a libsql:// URL (not a file: path)
#   - DATABASE_AUTH_TOKEN set to a valid Turso token

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

if [[ -z "${DATABASE_AUTH_TOKEN:-}" ]]; then
  echo "ERROR: DATABASE_AUTH_TOKEN is not set." >&2
  exit 1
fi

if [[ "${DATABASE_URL}" != libsql://* ]]; then
  echo "ERROR: DATABASE_URL must be a libsql:// URL for Turso migrations, got: ${DATABASE_URL}" >&2
  exit 1
fi

if ! command -v turso &> /dev/null; then
  echo "ERROR: turso CLI not found. Install it with: curl -sSfL https://get.tur.so/install.sh | bash" >&2
  exit 1
fi

# Derive the database name from the URL: libsql://<name>-<org>.turso.io
DB_URL="${DATABASE_URL}"

MIGRATIONS_DIR="$(dirname "$0")/../prisma/migrations"

# Collect migration SQL files in chronological order (directory names are timestamped).
# Use a read loop instead of `mapfile` for compatibility with bash 3.2 (default on macOS).
MIGRATION_FILES=()
while IFS= read -r SQL_FILE; do
  MIGRATION_FILES+=("${SQL_FILE}")
done < <(find "${MIGRATIONS_DIR}" -name "migration.sql" | sort)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  echo "No migration.sql files found in ${MIGRATIONS_DIR}" >&2
  exit 1
fi

echo "Applying ${#MIGRATION_FILES[@]} migration(s) to ${DB_URL}"

for SQL_FILE in "${MIGRATION_FILES[@]}"; do
  MIGRATION_NAME="$(basename "$(dirname "${SQL_FILE}")")"
  echo "  → ${MIGRATION_NAME}"
  turso db shell "${DB_URL}" --auth-token "${DATABASE_AUTH_TOKEN}" < "${SQL_FILE}"
done

echo "All migrations applied successfully."

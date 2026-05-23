#!/bin/bash
set -e

# Run database migrations if using PostgreSQL
if [ "${DATABASE_URL#*postgresql}" != "$DATABASE_URL" ]; then
    echo "Running database migrations..."
    alembic upgrade head || echo "Migration failed or not applicable"
fi

# Execute the main command
exec "$@"

-- This is an empty migration.CREATE INDEX IF NOT EXISTS location_name_trgm_idx
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS location_name_trgm_idx
ON "Location"
USING gin (name gin_trgm_ops);
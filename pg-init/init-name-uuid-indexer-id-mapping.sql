-- /docker-entrypoint-initdb.d/init-name-uuid-indexer-id-mapping.sql

-- Create the mapping table for the combination of contract name and report uuid (name_uuid) to indexer_id
-- name_uuid is the Primary Key
-- indexer_id is NOT NULL and must be UNIQUE to ensure a 1-to-1 relationship
CREATE TABLE IF NOT EXISTS name_uuid_indexer_id_mapping (
    name_uuid VARCHAR(255) PRIMARY KEY,
    indexer_id VARCHAR(255) NOT NULL UNIQUE
);
-- Enable pg_stat_statements for query performance monitoring.
-- Requires shared_preload_libraries to include 'pg_stat_statements' in postgresql.conf
-- (managed via the rindexer-ingestion-db ConfigMap + init container).
-- If this migration fails, verify the PostgreSQL configuration is applied before retrying.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

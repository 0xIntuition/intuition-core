-- Custom TimescaleDB migration for kg.events.
--
-- Applied AFTER the drizzle-generated table DDL (drizzle/) by src/migrate.ts.
-- Statements are separated by `--> statement-breakpoint` and run one at a time
-- in autocommit, matching drizzle's convention and respecting TimescaleDB DDL
-- transaction rules.
--
-- Requires the `timescaledb` extension, which is preloaded in the
-- timescale/timescaledb-ha image used for the postgres-kg datastore. On a plain
-- Postgres instance these statements are skipped (see src/migrate.ts) and
-- kg.events remains an ordinary table — correct, just without time partitioning.

CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint
-- Convert the append-only graph event log into a hypertable partitioned on
-- event_time. Idempotent: if_not_exists returns the existing hypertable on
-- re-run; migrate_data moves any rows already present into chunks.
SELECT create_hypertable('kg.events', 'event_time', if_not_exists => TRUE, migrate_data => TRUE);

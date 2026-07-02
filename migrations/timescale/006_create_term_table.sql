CREATE TABLE IF NOT EXISTS term (
    term_id TEXT PRIMARY KEY,
    term_type TEXT NOT NULL CHECK (term_type IN ('atom', 'triple')),
    creator TEXT NOT NULL,
    atom_data TEXT,
    atom_data_hex TEXT,
    subject_id TEXT,
    predicate_id TEXT,
    object_id TEXT,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
    transaction_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_term_type ON term (term_type);
CREATE INDEX IF NOT EXISTS idx_term_creator ON term (creator);
CREATE INDEX IF NOT EXISTS idx_term_subject ON term (subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_term_predicate ON term (predicate_id) WHERE predicate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_term_object ON term (object_id) WHERE object_id IS NOT NULL;

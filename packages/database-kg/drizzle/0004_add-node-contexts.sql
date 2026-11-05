CREATE TABLE "kg"."node_contexts" (
	"node_id" text NOT NULL,
	"event_sequence" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"block_hash" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"registrant" text NOT NULL,
	"uri_hex" text NOT NULL,
	"uri_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_contexts_pkey" PRIMARY KEY("node_id","transaction_hash","log_index","ordinal"),
	CONSTRAINT "chk_node_contexts_event_sequence" CHECK ("kg"."node_contexts"."event_sequence" >= 0),
	CONSTRAINT "chk_node_contexts_block_number" CHECK ("kg"."node_contexts"."block_number" >= 0),
	CONSTRAINT "chk_node_contexts_log_index" CHECK ("kg"."node_contexts"."log_index" >= 0),
	CONSTRAINT "chk_node_contexts_ordinal" CHECK ("kg"."node_contexts"."ordinal" >= 0),
	CONSTRAINT "chk_node_contexts_uri_hex" CHECK ("kg"."node_contexts"."uri_hex" ~ '^0x([0-9a-f]{2})*$')
);
--> statement-breakpoint
ALTER TABLE "kg"."node_contexts" ADD CONSTRAINT "node_contexts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "kg"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_node_contexts_event_ordinal" ON "kg"."node_contexts" USING btree ("event_sequence","ordinal");--> statement-breakpoint
CREATE INDEX "idx_node_contexts_node_sequence" ON "kg"."node_contexts" USING btree ("node_id","event_sequence","ordinal");--> statement-breakpoint
CREATE INDEX "idx_node_contexts_transaction" ON "kg"."node_contexts" USING btree ("transaction_hash","log_index");
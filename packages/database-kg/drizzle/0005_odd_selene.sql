CREATE TABLE "kg"."node_identifiers" (
	"node_id" text NOT NULL,
	"iid" text NOT NULL,
	"scheme" text NOT NULL,
	"rung" text NOT NULL,
	"source" text DEFAULT 'rung' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_identifiers_pkey" PRIMARY KEY("node_id","iid"),
	CONSTRAINT "chk_node_identifiers_source" CHECK ("kg"."node_identifiers"."source" IN ('rung'))
);
--> statement-breakpoint
ALTER TABLE "kg"."node_identifiers" ADD CONSTRAINT "node_identifiers_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "kg"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_node_identifiers_iid" ON "kg"."node_identifiers" USING btree ("iid");
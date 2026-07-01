CREATE SCHEMA "kg";
--> statement-breakpoint
CREATE TABLE "kg"."account_stats" (
	"account_id" text PRIMARY KEY NOT NULL,
	"created_node_count" bigint DEFAULT 0 NOT NULL,
	"created_triple_count" bigint DEFAULT 0 NOT NULL,
	"deposit_count" bigint DEFAULT 0 NOT NULL,
	"withdrawal_count" bigint DEFAULT 0 NOT NULL,
	"last_deposit_at" timestamp with time zone,
	"last_withdrawal_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kg"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kg"."adjacency" (
	"source_id" text NOT NULL,
	"source_type" text DEFAULT 'node' NOT NULL,
	"direction" text NOT NULL,
	"predicate_id" text NOT NULL,
	"predicate_type" text DEFAULT 'node' NOT NULL,
	"neighbor_id" text NOT NULL,
	"neighbor_type" text DEFAULT 'node' NOT NULL,
	"triple_id" text NOT NULL,
	"weight" numeric,
	"market_weight" numeric,
	"social_weight" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjacency_pkey" PRIMARY KEY("source_id","source_type","direction","predicate_id","predicate_type","neighbor_id","neighbor_type","triple_id"),
	CONSTRAINT "chk_adjacency_source_type" CHECK ("kg"."adjacency"."source_type" IN ('node', 'triple')),
	CONSTRAINT "chk_adjacency_predicate_type" CHECK ("kg"."adjacency"."predicate_type" IN ('node', 'triple')),
	CONSTRAINT "chk_adjacency_neighbor_type" CHECK ("kg"."adjacency"."neighbor_type" IN ('node', 'triple'))
);
--> statement-breakpoint
CREATE TABLE "kg"."artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"node_id" text NOT NULL,
	"artifact_kind" text NOT NULL,
	"artifact_version" text NOT NULL,
	"status" text NOT NULL,
	"source_uri" text,
	"source_hash" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"created_by_account_id" text
);
--> statement-breakpoint
CREATE TABLE "kg"."events" (
	"event_time" timestamp with time zone NOT NULL,
	"id" text NOT NULL,
	"actor_id" text,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"event_type" text NOT NULL,
	"classification_type" text,
	"is_onchain" boolean DEFAULT false NOT NULL,
	"block_number" bigint,
	"tx_hash" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kg_events_pkey" PRIMARY KEY("event_time","id"),
	CONSTRAINT "chk_kg_events_entity_kind" CHECK ("kg"."events"."entity_kind" IN ('node', 'triple', 'predicate', 'artifact'))
);
--> statement-breakpoint
CREATE TABLE "kg"."node_urls" (
	"node_id" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"source" text,
	"artifact_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_urls_pkey" PRIMARY KEY("node_id","url"),
	CONSTRAINT "chk_node_urls_url_nonempty" CHECK ("kg"."node_urls"."url" <> ''),
	CONSTRAINT "chk_node_urls_domain_nonempty" CHECK ("kg"."node_urls"."domain" <> '')
);
--> statement-breakpoint
CREATE TABLE "kg"."node_stats" (
	"node_id" text PRIMARY KEY NOT NULL,
	"in_degree" bigint NOT NULL,
	"out_degree" bigint NOT NULL,
	"neighbor_kind_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"predicate_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kg"."nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_onchain" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_by" text,
	"raw_type" text NOT NULL,
	"data" text,
	"data_hex" text,
	"data_resolved" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parse_attempts" integer DEFAULT 0 NOT NULL,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parse_started_at" timestamp with time zone,
	"parse_lease_expires_at" timestamp with time zone,
	"parsed_at" timestamp with time zone,
	"parse_error" jsonb,
	"parse_result" jsonb,
	"classification_attempts" integer DEFAULT 0 NOT NULL,
	"classification_status" text DEFAULT 'pending' NOT NULL,
	"classification_started_at" timestamp with time zone,
	"classification_lease_expires_at" timestamp with time zone,
	"classified_at" timestamp with time zone,
	"classification_error" jsonb,
	"classification_result" jsonb,
	"classification_type" text DEFAULT 'Unknown' NOT NULL,
	"enrichment_attempts" integer DEFAULT 0 NOT NULL,
	"enrichment_status" text DEFAULT 'pending' NOT NULL,
	"enrichment_started_at" timestamp with time zone,
	"enrichment_lease_expires_at" timestamp with time zone,
	"enriched_at" timestamp with time zone,
	"enrichment_error" jsonb,
	"processing_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	CONSTRAINT "chk_nodes_visibility" CHECK ("kg"."nodes"."visibility" IN ('public', 'unlisted')),
	CONSTRAINT "chk_nodes_status" CHECK ("kg"."nodes"."status" IN ('active', 'draft')),
	CONSTRAINT "chk_nodes_raw_type" CHECK ("kg"."nodes"."raw_type" IN ('string', 'json', 'http_uri', 'ipfs_uri')),
	CONSTRAINT "chk_nodes_parse_status" CHECK ("kg"."nodes"."parse_status" IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
	CONSTRAINT "chk_nodes_classification_status" CHECK ("kg"."nodes"."classification_status" IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
	CONSTRAINT "chk_nodes_enrichment_status" CHECK ("kg"."nodes"."enrichment_status" IN ('pending', 'processing', 'completed', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "kg"."predicate_stats" (
	"predicate_id" text NOT NULL,
	"predicate_type" text DEFAULT 'node' NOT NULL,
	"triple_count" bigint NOT NULL,
	"distinct_subject_count" bigint NOT NULL,
	"distinct_object_count" bigint NOT NULL,
	"avg_out_degree" numeric,
	"avg_in_degree" numeric,
	"selectivity_score" numeric,
	"updated_at" timestamp with time zone,
	CONSTRAINT "predicate_stats_pkey" PRIMARY KEY("predicate_type","predicate_id"),
	CONSTRAINT "chk_predicate_stats_predicate_type" CHECK ("kg"."predicate_stats"."predicate_type" IN ('node', 'triple'))
);
--> statement-breakpoint
CREATE TABLE "kg"."predicates" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"inverse_predicate_id" text,
	"is_transitive" boolean DEFAULT false NOT NULL,
	"is_symmetric" boolean DEFAULT false NOT NULL,
	"is_hierarchical" boolean DEFAULT false NOT NULL,
	"is_social" boolean DEFAULT false NOT NULL,
	"is_market" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predicates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "kg"."triple_pattern_stats" (
	"subject_kind" text NOT NULL,
	"predicate_id" text NOT NULL,
	"predicate_type" text DEFAULT 'node' NOT NULL,
	"object_kind" text NOT NULL,
	"triple_count" bigint NOT NULL,
	"distinct_subject_count" bigint NOT NULL,
	"distinct_object_count" bigint NOT NULL,
	"selectivity_score" numeric,
	"updated_at" timestamp with time zone,
	CONSTRAINT "triple_pattern_stats_pkey" PRIMARY KEY("subject_kind","predicate_type","predicate_id","object_kind"),
	CONSTRAINT "chk_triple_pattern_stats_predicate_type" CHECK ("kg"."triple_pattern_stats"."predicate_type" IN ('node', 'triple'))
);
--> statement-breakpoint
CREATE TABLE "kg"."triples" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_onchain" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_by" text,
	"subject_id" text NOT NULL,
	"subject_type" text DEFAULT 'node' NOT NULL,
	"predicate_id" text NOT NULL,
	"predicate_type" text DEFAULT 'node' NOT NULL,
	"object_id" text NOT NULL,
	"object_type" text DEFAULT 'node' NOT NULL,
	"is_counter_triple" boolean DEFAULT false NOT NULL,
	"sibling_triple_id" text,
	"edge_kind" text DEFAULT 'claim' NOT NULL,
	"source" text,
	"source_uri" text,
	"confidence" numeric(6, 5),
	"inferred" boolean DEFAULT false NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "chk_triples_visibility" CHECK ("kg"."triples"."visibility" IN ('public', 'unlisted')),
	CONSTRAINT "chk_triples_status" CHECK ("kg"."triples"."status" IN ('active', 'draft')),
	CONSTRAINT "chk_triples_subject_type" CHECK ("kg"."triples"."subject_type" IN ('node', 'triple')),
	CONSTRAINT "chk_triples_predicate_type" CHECK ("kg"."triples"."predicate_type" IN ('node', 'triple')),
	CONSTRAINT "chk_triples_object_type" CHECK ("kg"."triples"."object_type" IN ('node', 'triple')),
	CONSTRAINT "chk_triples_counter_sibling_required" CHECK ("kg"."triples"."is_counter_triple" = false OR "kg"."triples"."sibling_triple_id" IS NOT NULL),
	CONSTRAINT "chk_triples_sibling_not_self" CHECK ("kg"."triples"."sibling_triple_id" IS NULL OR "kg"."triples"."sibling_triple_id" <> "kg"."triples"."id"),
	CONSTRAINT "chk_triples_confidence_range" CHECK ("kg"."triples"."confidence" IS NULL OR ("kg"."triples"."confidence" >= 0 AND "kg"."triples"."confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "kg"."account_stats" ADD CONSTRAINT "account_stats_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "kg"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."adjacency" ADD CONSTRAINT "adjacency_triple_id_triples_id_fk" FOREIGN KEY ("triple_id") REFERENCES "kg"."triples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."artifacts" ADD CONSTRAINT "artifacts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "kg"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."artifacts" ADD CONSTRAINT "artifacts_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "kg"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."node_urls" ADD CONSTRAINT "node_urls_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "kg"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."node_urls" ADD CONSTRAINT "node_urls_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "kg"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."node_stats" ADD CONSTRAINT "node_stats_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "kg"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."nodes" ADD CONSTRAINT "nodes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "kg"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."triples" ADD CONSTRAINT "triples_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "kg"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg"."triples" ADD CONSTRAINT "triples_sibling_triple_id_triples_id_fk" FOREIGN KEY ("sibling_triple_id") REFERENCES "kg"."triples"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_last_seen_at" ON "kg"."accounts" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_accounts_deleted_at" ON "kg"."accounts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_adjacency_source_ref" ON "kg"."adjacency" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_adjacency_predicate_ref" ON "kg"."adjacency" USING btree ("predicate_type","predicate_id");--> statement-breakpoint
CREATE INDEX "idx_adjacency_neighbor_ref" ON "kg"."adjacency" USING btree ("neighbor_type","neighbor_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_node_id" ON "kg"."artifacts" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_created_by_account_id" ON "kg"."artifacts" USING btree ("created_by_account_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_kind_version_status" ON "kg"."artifacts" USING btree ("artifact_kind","artifact_version","status");--> statement-breakpoint
CREATE INDEX "idx_artifacts_kind_source_hash" ON "kg"."artifacts" USING btree ("artifact_kind","source_hash");--> statement-breakpoint
CREATE INDEX "idx_kg_events_entity" ON "kg"."events" USING btree ("entity_kind","entity_id","event_time");--> statement-breakpoint
CREATE INDEX "idx_kg_events_actor" ON "kg"."events" USING btree ("actor_id","event_time");--> statement-breakpoint
CREATE INDEX "idx_kg_events_type" ON "kg"."events" USING btree ("event_type","event_time");--> statement-breakpoint
CREATE INDEX "idx_node_urls_node_domain" ON "kg"."node_urls" USING btree ("node_id","domain");--> statement-breakpoint
CREATE INDEX "idx_node_urls_domain" ON "kg"."node_urls" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_node_urls_one_primary_per_node" ON "kg"."node_urls" USING btree ("node_id") WHERE "kg"."node_urls"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "idx_nodes_status_visibility_created_at" ON "kg"."nodes" USING btree ("status","visibility","created_at");--> statement-breakpoint
CREATE INDEX "idx_nodes_visibility" ON "kg"."nodes" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_nodes_raw_type_data_hex" ON "kg"."nodes" USING btree ("raw_type","data_hex");--> statement-breakpoint
CREATE INDEX "idx_nodes_classification_type" ON "kg"."nodes" USING btree ("classification_type");--> statement-breakpoint
CREATE INDEX "idx_nodes_created_by_created_at" ON "kg"."nodes" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "idx_nodes_data_hex" ON "kg"."nodes" USING btree ("data_hex");--> statement-breakpoint
CREATE INDEX "idx_nodes_parse_recovery" ON "kg"."nodes" USING btree ("parse_status","parse_lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_nodes_classification_recovery" ON "kg"."nodes" USING btree ("classification_status","classification_lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_nodes_enrichment_recovery" ON "kg"."nodes" USING btree ("enrichment_status","enrichment_lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_nodes_processing_statuses" ON "kg"."nodes" USING btree ("parse_status","classification_status","enrichment_status");--> statement-breakpoint
CREATE INDEX "idx_triples_spo" ON "kg"."triples" USING btree ("subject_type","subject_id","predicate_type","predicate_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "idx_triples_sop" ON "kg"."triples" USING btree ("subject_type","subject_id","object_type","object_id","predicate_type","predicate_id");--> statement-breakpoint
CREATE INDEX "idx_triples_pso" ON "kg"."triples" USING btree ("predicate_type","predicate_id","subject_type","subject_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "idx_triples_pos" ON "kg"."triples" USING btree ("predicate_type","predicate_id","object_type","object_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_triples_osp" ON "kg"."triples" USING btree ("object_type","object_id","subject_type","subject_id","predicate_type","predicate_id");--> statement-breakpoint
CREATE INDEX "idx_triples_ops" ON "kg"."triples" USING btree ("object_type","object_id","predicate_type","predicate_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_triples_subject_ref" ON "kg"."triples" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_triples_predicate_ref" ON "kg"."triples" USING btree ("predicate_type","predicate_id");--> statement-breakpoint
CREATE INDEX "idx_triples_object_ref" ON "kg"."triples" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "idx_triples_status_visibility_created_at" ON "kg"."triples" USING btree ("status","visibility","created_at");--> statement-breakpoint
CREATE INDEX "idx_triples_sibling_triple_id" ON "kg"."triples" USING btree ("sibling_triple_id");--> statement-breakpoint
CREATE INDEX "idx_triples_counter_triple" ON "kg"."triples" USING btree ("is_counter_triple");--> statement-breakpoint
CREATE INDEX "idx_triples_created_by_created_at" ON "kg"."triples" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "idx_triples_edge_kind_status_created_at" ON "kg"."triples" USING btree ("edge_kind","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_triples_source_uri" ON "kg"."triples" USING btree ("source_uri");--> statement-breakpoint
CREATE INDEX "idx_triples_confidence_desc" ON "kg"."triples" USING btree ("confidence");
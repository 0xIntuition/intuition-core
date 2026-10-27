ALTER TABLE "kg"."nodes" ADD COLUMN "iid" text;--> statement-breakpoint
ALTER TABLE "kg"."nodes" ADD CONSTRAINT "chk_nodes_raw_type_iid" CHECK ("kg"."nodes"."raw_type" IN ('string', 'json', 'http_uri', 'ipfs_uri', 'iid')) NOT VALID;--> statement-breakpoint
ALTER TABLE "kg"."nodes" VALIDATE CONSTRAINT "chk_nodes_raw_type_iid";--> statement-breakpoint
ALTER TABLE "kg"."nodes" DROP CONSTRAINT "chk_nodes_raw_type";--> statement-breakpoint
ALTER TABLE "kg"."nodes" RENAME CONSTRAINT "chk_nodes_raw_type_iid" TO "chk_nodes_raw_type";--> statement-breakpoint
CREATE INDEX "idx_nodes_iid" ON "kg"."nodes" USING btree ("iid") WHERE "kg"."nodes"."iid" IS NOT NULL;

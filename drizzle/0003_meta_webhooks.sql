CREATE TABLE "salon"."meta_webhook_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"platform" varchar(16) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"account_id" varchar(40) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"outcome" varchar(80),
	"event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "meta_webhook_events_status" CHECK ("salon"."meta_webhook_events"."status" in ('pending', 'processing', 'done', 'skipped', 'expired', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "salon"."meta_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "meta_webhook_events_queue" ON "salon"."meta_webhook_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "meta_webhook_events_created" ON "salon"."meta_webhook_events" USING btree ("created_at");
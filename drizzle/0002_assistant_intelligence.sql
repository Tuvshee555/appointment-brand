CREATE TABLE "salon"."assistant_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" varchar(40) NOT NULL,
	"level" varchar(8) DEFAULT 'info' NOT NULL,
	"appointment_id" uuid,
	"detail" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."assistant_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."assistant_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"topic" varchar(24) DEFAULT 'general' NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"keywords" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "salon"."assistant_knowledge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."assistant_settings" (
	"salon_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"provider" varchar(16) DEFAULT 'auto' NOT NULL,
	"model" varchar(80) DEFAULT 'gpt-4.1-mini' NOT NULL,
	"daily_budget_usd" double precision DEFAULT 2 NOT NULL,
	"use_model_for_understanding" boolean DEFAULT true NOT NULL,
	"use_model_for_answers" boolean DEFAULT true NOT NULL,
	"english_replies" boolean DEFAULT true NOT NULL,
	"handover_auto_resume_hours" integer DEFAULT 24 NOT NULL,
	"greeting" text,
	"handover_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "salon"."assistant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."assistant_usage" (
	"day" date NOT NULL,
	"environment" varchar(16) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"model" varchar(80) NOT NULL,
	"source" varchar(24) NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "assistant_usage_day_environment_model_source_pk" PRIMARY KEY("day","environment","model","source")
);
--> statement-breakpoint
ALTER TABLE "salon"."assistant_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salon"."chat_messages" ADD COLUMN "client_message_id" varchar(80);--> statement-breakpoint
ALTER TABLE "salon"."chat_messages" ADD COLUMN "author_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "status" varchar(16) DEFAULT 'bot' NOT NULL;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "handoff_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "handoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "assigned_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "last_staff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "locale" varchar(2) DEFAULT 'mn' NOT NULL;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "lease_owner" uuid;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "salon"."assistant_events" ADD CONSTRAINT "assistant_events_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."assistant_events" ADD CONSTRAINT "assistant_events_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "salon"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."assistant_events" ADD CONSTRAINT "assistant_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."assistant_knowledge" ADD CONSTRAINT "assistant_knowledge_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."assistant_knowledge" ADD CONSTRAINT "assistant_knowledge_verified_by_admin_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "salon"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."assistant_knowledge" ADD CONSTRAINT "assistant_knowledge_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "salon"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."assistant_settings" ADD CONSTRAINT "assistant_settings_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."assistant_settings" ADD CONSTRAINT "assistant_settings_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "salon"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_events_salon_created" ON "salon"."assistant_events" USING btree ("salon_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_events_level" ON "salon"."assistant_events" USING btree ("salon_id","level","created_at");--> statement-breakpoint
CREATE INDEX "assistant_knowledge_salon" ON "salon"."assistant_knowledge" USING btree ("salon_id","sort_order");--> statement-breakpoint
ALTER TABLE "salon"."chat_messages" ADD CONSTRAINT "chat_messages_author_admin_id_admin_users_id_fk" FOREIGN KEY ("author_admin_id") REFERENCES "salon"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD CONSTRAINT "chat_sessions_assigned_admin_id_admin_users_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "salon"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_client_id" ON "salon"."chat_messages" USING btree ("session_id","client_message_id") WHERE "salon"."chat_messages"."client_message_id" is not null;--> statement-breakpoint
CREATE INDEX "chat_sessions_status" ON "salon"."chat_sessions" USING btree ("salon_id","status","last_message_at");
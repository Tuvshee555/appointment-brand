CREATE SCHEMA IF NOT EXISTS "salon";
--> statement-breakpoint
CREATE TYPE "salon"."actor_type" AS ENUM('customer', 'staff', 'system', 'assistant');--> statement-breakpoint
CREATE TYPE "salon"."appointment_source" AS ENUM('website', 'admin', 'assistant', 'messenger', 'phone', 'walk_in');--> statement-breakpoint
CREATE TYPE "salon"."appointment_status" AS ENUM('awaiting_deposit', 'pending', 'confirmed', 'completed', 'no_show', 'cancelled', 'rejected', 'expired', 'rescheduled');--> statement-breakpoint
CREATE TYPE "salon"."confirmation_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "salon"."deposit_mode" AS ENUM('none', 'fixed', 'percent');--> statement-breakpoint
CREATE TYPE "salon"."deposit_outcome" AS ENUM('none', 'refund', 'forfeit', 'transfer');--> statement-breakpoint
CREATE TYPE "salon"."notification_audience" AS ENUM('customer', 'staff');--> statement-breakpoint
CREATE TYPE "salon"."notification_channel" AS ENUM('web', 'email', 'sms', 'messenger', 'telegram');--> statement-breakpoint
CREATE TYPE "salon"."notification_status" AS ENUM('logged', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "salon"."payment_kind" AS ENUM('deposit', 'balance', 'full', 'refund');--> statement-breakpoint
CREATE TYPE "salon"."payment_method" AS ENUM('qpay', 'cash', 'card', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "salon"."payment_status" AS ENUM('pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "salon"."price_type" AS ENUM('fixed', 'from');--> statement-breakpoint
CREATE TYPE "salon"."special_day_kind" AS ENUM('closed', 'special_hours');--> statement-breakpoint
CREATE TYPE "salon"."time_off_kind" AS ENUM('day_off', 'vacation', 'sick', 'training', 'other');--> statement-breakpoint
CREATE TABLE "salon"."admin_roles" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"description" varchar(300) DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."admin_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."admin_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"demo_visitor_hash" varchar(64),
	"user_agent" varchar(255),
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."admin_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"name" varchar(100) NOT NULL,
	"password_hash" varchar(200),
	"role_key" varchar(32) NOT NULL,
	"staff_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "salon"."admin_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."ai_usage" (
	"day" date NOT NULL,
	"model" varchar(80) NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_day_model_pk" PRIMARY KEY("day","model")
);
--> statement-breakpoint
ALTER TABLE "salon"."ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."appointment_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"appointment_service_id" uuid NOT NULL,
	"addon_id" uuid,
	"addon_name" varchar(120) NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"price" integer NOT NULL,
	"price_type" "salon"."price_type" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."appointment_addons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."appointment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"from_status" "salon"."appointment_status",
	"to_status" "salon"."appointment_status",
	"actor_type" "salon"."actor_type" NOT NULL,
	"actor_admin_id" uuid,
	"note" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."appointment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."appointment_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid,
	"service_name" varchar(120) NOT NULL,
	"category_name" varchar(80) NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"price" integer NOT NULL,
	"price_type" "salon"."price_type" NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."appointment_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"reference" varchar(16) NOT NULL,
	"customer_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"status" "salon"."appointment_status" NOT NULL,
	"source" "salon"."appointment_source" DEFAULT 'website' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"occupied_until" timestamp with time zone NOT NULL,
	"buffer_minutes" smallint DEFAULT 0 NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"services_total" integer NOT NULL,
	"addons_total" integer DEFAULT 0 NOT NULL,
	"total_price" integer NOT NULL,
	"has_from_price" boolean DEFAULT false NOT NULL,
	"deposit_amount" integer DEFAULT 0 NOT NULL,
	"staff_requested" boolean DEFAULT true NOT NULL,
	"customer_note" text,
	"internal_note" text,
	"hold_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"rescheduled_from_id" uuid,
	"manage_token_hash" varchar(64),
	"demo_visitor_hash" varchar(64),
	"created_by_admin_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "appointments_times" CHECK ("salon"."appointments"."starts_at" < "salon"."appointments"."ends_at" and "salon"."appointments"."ends_at" <= "salon"."appointments"."occupied_until"),
	CONSTRAINT "appointments_money" CHECK ("salon"."appointments"."total_price" >= 0 and "salon"."appointments"."deposit_amount" >= 0 and "salon"."appointments"."deposit_amount" <= "salon"."appointments"."total_price")
);
--> statement-breakpoint
ALTER TABLE "salon"."appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"admin_user_id" uuid,
	"action" varchar(60) NOT NULL,
	"entity" varchar(40) NOT NULL,
	"entity_id" uuid,
	"summary" text NOT NULL,
	"detail" jsonb,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."business_settings" (
	"salon_id" uuid PRIMARY KEY NOT NULL,
	"tagline" varchar(160) DEFAULT '' NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"announcement" varchar(200),
	"phone" varchar(32) DEFAULT '' NOT NULL,
	"email" varchar(254),
	"address_line" varchar(200) DEFAULT '' NOT NULL,
	"address_note" varchar(200),
	"map_url" varchar(500),
	"instagram" varchar(100),
	"facebook" varchar(100),
	"slot_interval_minutes" smallint DEFAULT 15 NOT NULL,
	"min_advance_minutes" integer DEFAULT 120 NOT NULL,
	"max_advance_days" smallint DEFAULT 60 NOT NULL,
	"default_buffer_minutes" smallint DEFAULT 10 NOT NULL,
	"max_services_per_booking" smallint DEFAULT 3 NOT NULL,
	"cancellation_notice_hours" smallint DEFAULT 12 NOT NULL,
	"reschedule_notice_hours" smallint DEFAULT 12 NOT NULL,
	"confirmation_mode" "salon"."confirmation_mode" DEFAULT 'manual' NOT NULL,
	"deposit_mode" "salon"."deposit_mode" DEFAULT 'none' NOT NULL,
	"deposit_fixed_amount" integer DEFAULT 0 NOT NULL,
	"deposit_percent_bps" integer DEFAULT 0 NOT NULL,
	"deposit_min_total" integer DEFAULT 0 NOT NULL,
	"hold_minutes" smallint DEFAULT 20 NOT NULL,
	"late_arrival_minutes" smallint DEFAULT 15 NOT NULL,
	"reminder_hours_before" smallint DEFAULT 24 NOT NULL,
	"cancellation_policy" text DEFAULT '' NOT NULL,
	"deposit_policy" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_slot_interval" CHECK ("salon"."business_settings"."slot_interval_minutes" in (5, 10, 15, 20, 30, 60)),
	CONSTRAINT "settings_deposit_bps" CHECK ("salon"."business_settings"."deposit_percent_bps" between 0 and 10000),
	CONSTRAINT "settings_non_negative" CHECK ("salon"."business_settings"."deposit_fixed_amount" >= 0 and "salon"."business_settings"."deposit_min_total" >= 0 and "salon"."business_settings"."min_advance_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "salon"."business_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."cancellation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"cancelled_by" "salon"."actor_type" NOT NULL,
	"actor_admin_id" uuid,
	"reason_code" varchar(40) NOT NULL,
	"reason_text" text,
	"notice_hours" integer NOT NULL,
	"within_policy" boolean NOT NULL,
	"deposit_outcome" "salon"."deposit_outcome" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."cancellation_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"channel" varchar(16) DEFAULT 'web' NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"handed_off" boolean DEFAULT false NOT NULL,
	"appointment_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone" varchar(16) NOT NULL,
	"email" varchar(254),
	"notes" text,
	"preferences" text,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" varchar(40) NOT NULL,
	"channel" "salon"."notification_channel" NOT NULL,
	"audience" "salon"."notification_audience" NOT NULL,
	"recipient" varchar(120),
	"subject" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"status" "salon"."notification_status" NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"error" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_dedupeKey_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "salon"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."opening_hours" (
	"salon_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"opens_at" smallint DEFAULT 600 NOT NULL,
	"closes_at" smallint DEFAULT 1200 NOT NULL,
	CONSTRAINT "opening_hours_salon_id_weekday_pk" PRIMARY KEY("salon_id","weekday"),
	CONSTRAINT "opening_weekday" CHECK ("salon"."opening_hours"."weekday" between 1 and 7),
	CONSTRAINT "opening_range" CHECK ("salon"."opening_hours"."is_closed" or ("salon"."opening_hours"."opens_at" >= 0 and "salon"."opening_hours"."opens_at" < "salon"."opening_hours"."closes_at" and "salon"."opening_hours"."closes_at" <= 1440))
);
--> statement-breakpoint
ALTER TABLE "salon"."opening_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"event" varchar(40) NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."payment_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" "salon"."payment_kind" NOT NULL,
	"method" "salon"."payment_method" NOT NULL,
	"status" "salon"."payment_status" DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_invoice_id" varchar(120),
	"provider_payment_id" varchar(120),
	"qr_text" text,
	"short_url" varchar(500),
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"verified_by" varchar(24),
	"recorded_by_admin_id" uuid,
	"note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount" CHECK ("salon"."payments"."amount" > 0),
	CONSTRAINT "payments_paid_is_verified" CHECK ("salon"."payments"."status" <> 'paid' or ("salon"."payments"."paid_at" is not null and "salon"."payments"."verified_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "salon"."payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."rate_limits" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."salons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Ulaanbaatar' NOT NULL,
	"currency" varchar(3) DEFAULT 'MNT' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "salon"."salons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."service_addon_links" (
	"service_id" uuid NOT NULL,
	"addon_id" uuid NOT NULL,
	CONSTRAINT "service_addon_links_service_id_addon_id_pk" PRIMARY KEY("service_id","addon_id")
);
--> statement-breakpoint
ALTER TABLE "salon"."service_addon_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."service_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(300) DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"price_type" "salon"."price_type" DEFAULT 'fixed' NOT NULL,
	"duration_minutes" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_addons_values" CHECK ("salon"."service_addons"."price" >= 0 and "salon"."service_addons"."duration_minutes" between 0 and 240)
);
--> statement-breakpoint
ALTER TABLE "salon"."service_addons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" varchar(500),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."service_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."service_skills" (
	"service_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "service_skills_service_id_skill_id_pk" PRIMARY KEY("service_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "salon"."service_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"short_description" varchar(220) DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"price" integer NOT NULL,
	"price_type" "salon"."price_type" DEFAULT 'fixed' NOT NULL,
	"buffer_minutes" smallint,
	"image_url" varchar(500),
	"image_alt" varchar(200),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"online_bookable" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_duration" CHECK ("salon"."services"."duration_minutes" between 5 and 600),
	CONSTRAINT "services_price" CHECK ("salon"."services"."price" >= 0),
	CONSTRAINT "services_buffer" CHECK ("salon"."services"."buffer_minutes" is null or "salon"."services"."buffer_minutes" between 0 and 120)
);
--> statement-breakpoint
ALTER TABLE "salon"."services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(200) DEFAULT '' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."special_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "salon"."special_day_kind" NOT NULL,
	"opens_at" smallint,
	"closes_at" smallint,
	"label" varchar(120) NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_days_hours" CHECK ("salon"."special_days"."kind" = 'closed' or ("salon"."special_days"."opens_at" is not null and "salon"."special_days"."closes_at" is not null and "salon"."special_days"."opens_at" < "salon"."special_days"."closes_at"))
);
--> statement-breakpoint
ALTER TABLE "salon"."special_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"display_name" varchar(60) NOT NULL,
	"title" varchar(100) NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"experience_years" smallint DEFAULT 0 NOT NULL,
	"experience_text" varchar(300) DEFAULT '' NOT NULL,
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"photo_url" varchar(500),
	"photo_alt" varchar(200),
	"cover_url" varchar(500),
	"calendar_color" varchar(7) DEFAULT '#8a6a58' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"accepts_online_bookings" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon"."staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."staff_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"weekday" smallint,
	"starts_at" smallint NOT NULL,
	"ends_at" smallint NOT NULL,
	"label" varchar(60) DEFAULT 'Завсарлага' NOT NULL,
	CONSTRAINT "staff_breaks_range" CHECK ("salon"."staff_breaks"."starts_at" >= 0 and "salon"."staff_breaks"."starts_at" < "salon"."staff_breaks"."ends_at" and "salon"."staff_breaks"."ends_at" <= 1440),
	CONSTRAINT "staff_breaks_weekday" CHECK ("salon"."staff_breaks"."weekday" is null or "salon"."staff_breaks"."weekday" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "salon"."staff_breaks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."staff_schedules" (
	"staff_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"is_working" boolean DEFAULT true NOT NULL,
	"starts_at" smallint DEFAULT 600 NOT NULL,
	"ends_at" smallint DEFAULT 1200 NOT NULL,
	CONSTRAINT "staff_schedules_staff_id_weekday_pk" PRIMARY KEY("staff_id","weekday"),
	CONSTRAINT "staff_schedules_weekday" CHECK ("salon"."staff_schedules"."weekday" between 1 and 7),
	CONSTRAINT "staff_schedules_range" CHECK (not "salon"."staff_schedules"."is_working" or ("salon"."staff_schedules"."starts_at" >= 0 and "salon"."staff_schedules"."starts_at" < "salon"."staff_schedules"."ends_at" and "salon"."staff_schedules"."ends_at" <= 1440))
);
--> statement-breakpoint
ALTER TABLE "salon"."staff_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."staff_services" (
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "staff_services_staff_id_service_id_pk" PRIMARY KEY("staff_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "salon"."staff_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."staff_skills" (
	"staff_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" varchar(16) DEFAULT 'standard' NOT NULL,
	CONSTRAINT "staff_skills_staff_id_skill_id_pk" PRIMARY KEY("staff_id","skill_id"),
	CONSTRAINT "staff_skills_level" CHECK ("salon"."staff_skills"."level" in ('standard', 'senior'))
);
--> statement-breakpoint
ALTER TABLE "salon"."staff_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salon"."staff_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" "salon"."time_off_kind" DEFAULT 'day_off' NOT NULL,
	"note" varchar(200),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_time_off_range" CHECK ("salon"."staff_time_off"."starts_at" < "salon"."staff_time_off"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "salon"."staff_time_off" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salon"."admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "salon"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."admin_users" ADD CONSTRAINT "admin_users_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."admin_users" ADD CONSTRAINT "admin_users_role_key_admin_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "salon"."admin_roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."admin_users" ADD CONSTRAINT "admin_users_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "salon"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointment_addons" ADD CONSTRAINT "appointment_addons_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointment_addons" ADD CONSTRAINT "appointment_addons_appointment_service_id_appointment_services_id_fk" FOREIGN KEY ("appointment_service_id") REFERENCES "salon"."appointment_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointment_addons" ADD CONSTRAINT "appointment_addons_addon_id_service_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "salon"."service_addons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointment_services" ADD CONSTRAINT "appointment_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "salon"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointments" ADD CONSTRAINT "appointments_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "salon"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."appointments" ADD CONSTRAINT "appointments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "salon"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."audit_log" ADD CONSTRAINT "audit_log_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."business_settings" ADD CONSTRAINT "business_settings_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."cancellation_records" ADD CONSTRAINT "cancellation_records_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "salon"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD CONSTRAINT "chat_sessions_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."chat_sessions" ADD CONSTRAINT "chat_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."customers" ADD CONSTRAINT "customers_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."notifications" ADD CONSTRAINT "notifications_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."notifications" ADD CONSTRAINT "notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."opening_hours" ADD CONSTRAINT "opening_hours_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."payment_records" ADD CONSTRAINT "payment_records_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "salon"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."payments" ADD CONSTRAINT "payments_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "salon"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."service_addon_links" ADD CONSTRAINT "service_addon_links_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "salon"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."service_addon_links" ADD CONSTRAINT "service_addon_links_addon_id_service_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "salon"."service_addons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."service_addons" ADD CONSTRAINT "service_addons_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."service_categories" ADD CONSTRAINT "service_categories_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."service_skills" ADD CONSTRAINT "service_skills_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "salon"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."service_skills" ADD CONSTRAINT "service_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "salon"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."services" ADD CONSTRAINT "services_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."services" ADD CONSTRAINT "services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "salon"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."skills" ADD CONSTRAINT "skills_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."special_days" ADD CONSTRAINT "special_days_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff" ADD CONSTRAINT "staff_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "salon"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff_breaks" ADD CONSTRAINT "staff_breaks_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "salon"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff_schedules" ADD CONSTRAINT "staff_schedules_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "salon"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff_services" ADD CONSTRAINT "staff_services_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "salon"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff_services" ADD CONSTRAINT "staff_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "salon"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff_skills" ADD CONSTRAINT "staff_skills_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "salon"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff_skills" ADD CONSTRAINT "staff_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "salon"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon"."staff_time_off" ADD CONSTRAINT "staff_time_off_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "salon"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_user" ON "salon"."admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires" ON "salon"."admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "admin_users_salon" ON "salon"."admin_users" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX "appointment_addons_appointment" ON "salon"."appointment_addons" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_events_appointment" ON "salon"."appointment_events" USING btree ("appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "appointment_events_created" ON "salon"."appointment_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "appointment_services_appointment" ON "salon"."appointment_services" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_services_service" ON "salon"."appointment_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "appointments_salon_start" ON "salon"."appointments" USING btree ("salon_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_staff_start" ON "salon"."appointments" USING btree ("staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_customer" ON "salon"."appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "appointments_status" ON "salon"."appointments" USING btree ("salon_id","status");--> statement-breakpoint
CREATE INDEX "appointments_rescheduled_from" ON "salon"."appointments" USING btree ("rescheduled_from_id");--> statement-breakpoint
CREATE INDEX "appointments_demo_visitor" ON "salon"."appointments" USING btree ("demo_visitor_hash");--> statement-breakpoint
CREATE INDEX "audit_log_salon_created" ON "salon"."audit_log" USING btree ("salon_id","created_at");--> statement-breakpoint
CREATE INDEX "cancellation_records_appointment" ON "salon"."cancellation_records" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "chat_messages_session" ON "salon"."chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_visitor" ON "salon"."chat_sessions" USING btree ("salon_id","visitor_hash");--> statement-breakpoint
CREATE INDEX "chat_sessions_last" ON "salon"."chat_sessions" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_salon_phone" ON "salon"."customers" USING btree ("salon_id","phone");--> statement-breakpoint
CREATE INDEX "customers_salon_name" ON "salon"."customers" USING btree ("salon_id","name");--> statement-breakpoint
CREATE INDEX "notifications_salon_created" ON "salon"."notifications" USING btree ("salon_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_appointment" ON "salon"."notifications" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "payment_records_payment" ON "salon"."payment_records" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_appointment" ON "salon"."payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "payments_salon_created" ON "salon"."payments" USING btree ("salon_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_invoice" ON "salon"."payments" USING btree ("provider_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_addons_salon_slug" ON "salon"."service_addons" USING btree ("salon_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_salon_slug" ON "salon"."service_categories" USING btree ("salon_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "services_salon_slug" ON "salon"."services" USING btree ("salon_id","slug");--> statement-breakpoint
CREATE INDEX "services_category" ON "salon"."services" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_salon_key" ON "salon"."skills" USING btree ("salon_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "special_days_salon_date" ON "salon"."special_days" USING btree ("salon_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_salon_slug" ON "salon"."staff" USING btree ("salon_id","slug");--> statement-breakpoint
CREATE INDEX "staff_breaks_staff" ON "salon"."staff_breaks" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_services_service" ON "salon"."staff_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "staff_time_off_staff_range" ON "salon"."staff_time_off" USING btree ("staff_id","starts_at");
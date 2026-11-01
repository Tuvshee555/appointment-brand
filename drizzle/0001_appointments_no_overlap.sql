-- Double-booking protection at the database level.
-- No two slot-holding appointments of the same specialist may overlap,
-- where each occupies [starts_at, occupied_until) (service time + buffer).
-- The booking service also serialises bookings per salon day with an
-- advisory lock and re-validates availability; this constraint is the last
-- line of defence for any code path (admin edits, scripts, races).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "salon"."appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    tstzrange("starts_at", "occupied_until", '[)') WITH &&
  ) WHERE ("status" IN ('awaiting_deposit', 'pending', 'confirmed', 'completed', 'no_show'));
--> statement-breakpoint
ALTER TABLE "salon"."appointments"
  ADD CONSTRAINT "appointments_rescheduled_from_fk"
  FOREIGN KEY ("rescheduled_from_id") REFERENCES "salon"."appointments"("id") ON DELETE SET NULL;

# Database

PostgreSQL 14+ (production: Neon, us-east-2). Drizzle ORM with snake_case columns.

## Isolation

Everything lives in the dedicated **`salon`** schema, and the migration journal is
`salon.__migrations`. The app creates or changes nothing outside that schema, so it can share
a database with other projects. Row-level security is enabled on every table with no
policies: only the owning role used by the app's server can read or write. The connection
string is server-only, and nothing reaches the browser.

## Tables

| Area       | Tables                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Salon      | `salons`, `business_settings`, `opening_hours`, `special_days`                                                          |
| Catalogue  | `service_categories`, `services`, `service_addons`, `service_addon_links`, `skills`, `service_skills`                   |
| Staff      | `staff`, `staff_skills`, `staff_services`, `staff_schedules`, `staff_breaks`, `staff_time_off`                          |
| Bookings   | `customers`, `appointments`, `appointment_services`, `appointment_addons`, `appointment_events`, `cancellation_records` |
| Payments   | `payments`, `payment_records`                                                                                           |
| Admin      | `admin_roles`, `admin_users`, `admin_sessions`, `audit_log`                                                             |
| Messaging  | `notifications`, `chat_sessions`, `chat_messages`, `ai_usage`                                                           |
| Protection | `rate_limits`                                                                                                           |

### Appointments

- `starts_at`, `ends_at` and `occupied_until` (end + buffer) are `timestamptz`.
- **Price snapshot:** `appointment_services` and `appointment_addons` copy each name, price,
  price type and duration at booking time, and the appointment stores the totals and the
  deposit. Later catalogue changes never alter an existing booking. A reschedule copies the
  snapshot to the new appointment.
- History: `appointment_events` records every status change with the actor, and
  `cancellation_records` stores who cancelled, the notice given, whether it was within policy
  and what happened to the deposit. Rescheduling keeps the original row (`rescheduled`) and
  links the replacement through `rescheduled_from_id`.
- Only a hash of the customer's manage link (`manage_token_hash`) is stored.

### Double-booking constraint

`drizzle/0001_appointments_no_overlap.sql` adds

```sql
EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, occupied_until, '[)') WITH &&)
WHERE (status IN ('awaiting_deposit','pending','confirmed','completed','no_show'))
```

(`btree_gist`). This is the last line of defence; the booking service also locks the salon day
and re-validates before inserting (see [booking.md](booking.md)). A unit test checks that this
status list matches `SLOT_HOLDING_STATUSES` in the code.

### Payments

`payments.status = 'paid'` requires `paid_at` and `verified_by` (check constraint).
`verified_by` is either `provider_check` (the payment provider confirmed it) or `staff_record`
(staff recorded money received in the salon). `payment_records` is the append-only event
log: invoice created, provider checks, the simulated bank event, refunds.

## Migrations

```bash
npm run db:generate   # after editing src/server/db/schema.ts
npm run db:migrate
```

Migrations are additive. Review generated SQL before applying it: drizzle-kit can emit an
unqualified enum type for the `salon` schema, which must be qualified as `"salon"."…"`. Back up
the database (a Neon branch) before any change that drops or rewrites data.

## Seeds

- `npm run db:seed` — idempotent base seed: the salon, settings, opening hours (Monday
  closed), fixed public holidays, roles, 5 categories, 24 services with Mongolian
  descriptions, 7 add-ons, 8 skills, 5 staff with schedules and breaks, staff–service
  eligibility, demo access accounts, and the owner account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
  Running it again changes nothing.
- `npm run db:seed:demo` — adds sample data if none exists: 40 customers, about 75
  appointments across the last 40 and next 30 days in every status, placed by the
  availability engine (no overlaps), with matching payments, events, cancellations and
  logged notifications. All rows carry `is_demo = true`.

## Demo reset

`npm run db:reset-demo`, the owner's settings button and the daily cron delete only rows
flagged `is_demo` for the demo salon, then reseed with today's dates in one transaction.
The catalogue, settings, holiday calendar, accounts and any non-demo booking are untouched.
A salon that is not marked as a demo is never reset.

## Inspecting

`npm run db:inspect` prints row counts, the status mix and the number of overlapping
slot-holding appointments (must be 0).

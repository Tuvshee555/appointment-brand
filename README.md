# Сувд — salon booking and management platform

**Сувд (SUVD)** is a fictional nail and beauty atelier in Ulaanbaatar, built as one of the five
Ursgal Digital portfolio demos. It is a working product, not a mock-up: services, staff schedules,
availability, bookings, deposits, the admin dashboard and the assistant all run on a PostgreSQL
database through a real booking engine.

- **Live:** https://appointment-brand.vercel.app/portfolio/appointments
- **Admin demo:** `/portfolio/appointments/admin/login` → «Админ самбар үзэх» (read-only, see below)
- **Base path:** the app lives under `/portfolio/appointments` so the Ursgal site can serve it as a
  zone of its own domain (see [docs/deployment.md](docs/deployment.md#serving-it-from-the-ursgal-site)).

All salon names, staff, customers, phone numbers and bookings are fictional sample data.

## What is real and what is simulated

| Area                                                                                              | Status                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability (shifts, breaks, time off, buffers, holidays, special hours, notice, booking window) | Real, computed from the database                                                                                                                                                       |
| Double-booking protection                                                                         | Real: per-day advisory lock, re-validation in the transaction, Postgres exclusion constraint                                                                                           |
| Booking, cancel, reschedule, staff confirm/reject/complete/no-show, history                       | Real                                                                                                                                                                                   |
| Admin dashboard, calendar, catalogue, staff, customers, payments, reports, settings               | Real data. Demo visitors' changes are validated by the server and then rolled back                                                                                                     |
| Deposits (QPay)                                                                                   | **Simulation** in the public demo, clearly labelled; no money moves. A QPay Merchant v2 adapter is implemented; the supplied credentials were verified with an auth-token request only |
| AI assistant                                                                                      | Rule-based engine is live and reads the database. The Claude tool-use path is implemented but needs `ANTHROPIC_API_KEY`                                                                |
| Notifications                                                                                     | Logged in the database only (demo). Telegram delivery to staff is implemented for non-demo salons                                                                                      |
| Facebook Messenger                                                                                | Webhook prepared and signature-checked, **inactive** until a Meta app is configured                                                                                                    |
| SMS                                                                                               | Not integrated                                                                                                                                                                         |
| Image uploads                                                                                     | Cloudinary uploads work for the owner account; disabled for demo visitors                                                                                                              |

## Stack

Next.js 16 (App Router, Cache Components, Partial Prefetching) · React 19 · TypeScript ·
Tailwind CSS 4 · Drizzle ORM · PostgreSQL (Neon) · Zod 4 · Anthropic SDK · Vitest · Playwright ·
Vercel (functions in `cle1`, next to the Neon database in us-east-2).

## Getting started

```bash
npm install
cp .env.example .env.local      # fill in SESSION_SECRET, CRON_SECRET, ADMIN_PASSWORD
npm run db:dev                  # own terminal: local PostgreSQL; the first run migrates and seeds sample bookings
npm run dev                     # http://localhost:3210/portfolio/appointments
```

Local development and tests use only the local database from `npm run db:dev`
(`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/salon_dev`, data in `.dev-db/`). The
production database URL is set only in the Vercel project; never put it in `.env.local`.

The owner account (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) has full access. Keep it private: the public
demo uses separate read-only demo accounts.

## Scripts

| Command                            | Purpose                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `npm run dev` / `build` / `start`  | Next.js on port 3210                                               |
| `npm run db:dev`                   | Local development PostgreSQL (first run: migrate + demo seed)      |
| `npm run check`                    | Lint, typecheck, tests and production build                        |
| `npm test`                         | Unit and integration tests (Vitest)                                |
| `npm run test:e2e`                 | Playwright against the dev server, or `E2E_BASE_URL`               |
| `npm run db:generate`              | Generate a migration from `src/server/db/schema.ts`                |
| `npm run db:migrate`               | Apply migrations (non-destructive, `salon` schema only)            |
| `npm run db:seed` / `db:seed:demo` | Idempotent base seed, optionally with sample bookings              |
| `npm run db:reset-demo`            | Replace sample data (only rows flagged `is_demo`, demo salon only) |
| `npm run db:inspect`               | Row counts, status mix and the no-overlap check                    |

## Testing

- **Unit (46):** availability engine, pricing and deposits, status machine (checked against the
  constraint SQL), Ulaanbaatar time, money, phone numbers, assistant rules and the reply guard.
- **Integration (19):** a throwaway PostgreSQL (embedded-postgres) with the real migrations;
  each test file gets its own database cloned from a seeded template. Covers price snapshots,
  buffers, breaks, notice, three simultaneous requests for one slot, the exclusion constraint,
  hold expiry, reschedule and cancellation history, provider-verified deposits, refunds,
  seed idempotency and the demo-only reset.
- **End-to-end (10):** home, services filter, a full booking and cancellation on desktop and
  mobile, the assistant's prices, the demo admin's dry run and masked contacts.

## Documentation

- [Architecture](docs/architecture.md)
- [Database](docs/database.md)
- [Booking engine](docs/booking.md)
- [Security and the public demo](docs/security.md)
- [Deployment and going live](docs/deployment.md)

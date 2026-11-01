# Architecture

## Layout

```
src/
  app/
    (site)/            customer website: home, services, staff, book, booking/[reference], policies, credits
    admin/login        staff and demo sign-in
    admin/(dash)/      dashboard, calendar, appointments, services, staff, customers,
                       payments, reports, settings, notifications, assistant
    api/               chat, payments/qpay/callback, cron/maintenance, messenger/webhook, health
  components/          UI by area (site, home, catalog, booking, assistant, admin, ui)
  lib/                 pure, isomorphic code: availability engine, pricing, status machine,
                       datetime (Asia/Ulaanbaatar), money, phone, validation, brand
  server/
    db/                Drizzle schema and client (`parallel()` helper)
    services/          business rules: salon, catalog, availability, booking
    payments/          provider interface, simulated QPay, QPay Merchant v2, payment service
    assistant/         shared tools, rule engine, Claude tool loop, reply guard, chat engine
    auth/              password hashing, sessions, page guards
    actions/           Server Actions (thin: parse input, check access, call services)
    queries/           read models for pages
    seed/              catalogue data, base seed, demo data generator
    security/          tokens/HMAC, rate limits
    notifications/     queue with de-duplication, Telegram delivery (non-demo)
scripts/               migrate, seed, reset-demo, inspect, image preparation
drizzle/               SQL migrations
tests/                 unit, integration (embedded Postgres), e2e (Playwright)
```

## Request flow

- **Pages** read through `server/queries`. Public read models use `'use cache'` with the
  `salon` and `catalog` cache tags (`cacheLife('hours')`); admin changes call `updateTag()`.
  Anything per-request (session, live slots, the clock) sits inside `<Suspense>` and calls
  `connection()` before reading the time.
- **Mutations** are Server Actions. Admin actions go through `runAdminAction(permission, fn)`,
  which checks the role's permissions on the server and runs demo sessions as a dry run.
- **Services** receive a `ServiceContext` (`db`, `salonId`, `actor`, `now`) and contain no
  Next.js imports, so actions, route handlers, scripts and tests call the same code.
- **The availability engine** (`lib/availability/engine.ts`) is pure. The server loads hours,
  shifts, breaks, time off and slot-holding appointments and the engine returns bookable
  starts. The booking transaction runs it again on fresh rows before inserting.

## Rendering

Cache Components with Partial Prefetching: public pages are static or partially prerendered;
admin pages prerender a shell (sidebar, skeleton) and stream the authorised content. Every
admin segment has a `loading.tsx`, so navigations show the skeleton immediately.

## Time

All instants are stored in UTC (`timestamptz`). Wall-clock times are minutes from local
midnight in Asia/Ulaanbaatar (UTC+8, no daylight saving). `lib/datetime.ts` converts between
them; dates are `YYYY-MM-DD` keys in the salon's local calendar.

## Assistant

`api/chat` keeps a conversation in `salon.chat_sessions` (visitor cookie hashed). Both engines
use the same tools in `server/assistant/tools.ts` (search services, salon info, staff, check
availability, next openings, prepare booking), so prices and times always come from the
database.

- **Rule engine** (default): Mongolian keyword and Latin-transliteration matching, a
  button-driven booking flow, and a hand-off to staff when unsure.
- **Claude path** (with `ANTHROPIC_API_KEY`): `claude-opus-5-5` at low effort with strict tool
  schemas, a cached system prompt and the server-side fallback beta. A reply guard rejects
  any price or time that does not appear in the tool results, and a daily budget
  (`AI_DAILY_BUDGET_USD`) stops model calls.
- Neither engine books on its own: it prepares a draft and the customer presses
  «Баталгаажуулах».

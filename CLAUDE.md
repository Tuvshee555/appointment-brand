@AGENTS.md

# Сувд salon platform

Ursgal Digital portfolio demo: a real booking and salon-management app for a fictional salon.
Read `README.md` and `docs/` before changing booking, payments, security or demo behaviour.

## Commands

- `npm run db:dev`: local PostgreSQL for development (data in `.dev-db/`); leave it running.
- `npm run dev`: http://localhost:3210/portfolio/appointments (base path is required).
- `npm run check`: lint, typecheck, Vitest and the production build. Run it before pushing.
- `npm run test:e2e`: Playwright with installed Chrome; set `E2E_BASE_URL` to test a deployment.
- `npm run db:migrate` / `db:seed:demo` / `db:reset-demo` / `db:inspect`.

## Conventions

- UI copy is Mongolian (Cyrillic); code, comments and docs are English.
- Money is integer tögrög. Instants are stored in UTC; local times go through
  `src/lib/datetime.ts` (Asia/Ulaanbaatar, UTC+8).
- Services in `src/server/services` take a `ServiceContext` and never import Next.js. Use
  `parallel(db, [() => …])` from `src/server/db/client.ts` instead of `Promise.all` in code
  that may run inside a transaction (one connection, no overlapping queries).
- Every admin mutation goes through `runAdminAction()`: server-side permission check, plus a
  rolled-back dry run for demo visitors.
- A payment becomes paid only via `verifyPayment()` (provider check) or a staff record.
- Demo data is flagged `is_demo`; resets delete only those rows and only for a demo salon.
- Migrations are additive and live in the `salon` schema. Review generated SQL: qualify
  enum types as `"salon"."…"`.
- Admin segments each need a `loading.tsx`, and URL-reading client hooks need a `<Suspense>`
  boundary (Cache Components validation).

## Gotchas

- `src/lib/cn.ts` joins classes without merging; pass replacement classes instead of
  overriding (see `Card`'s `bodyClassName`).
- On Windows, embedded Postgres must be initialised with `--encoding=UTF8 --locale=C`
  (done in `tests/integration/global-setup.ts`).
- Development uses only the local database from `npm run db:dev`; the production URL is set
  only in Vercel. An older `.env.local` that still points at Neon writes to the live demo.
- Never commit `.env.local` or any credential.

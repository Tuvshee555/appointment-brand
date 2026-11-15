# Сувд appointment assistant: implementation report (2 November 2026)

Branch `chatbot-intelligence`, local only — nothing pushed, merged or deployed, no production
environment variable changed, no migration run against production. Reference: Lorentz V1
(`C:\Dev\github-v1\eyebrow`, branch `chatbot-intelligence`, commit `69e4110`), read only.

## 1. Architecture changes

The assistant follows the Lorentz split: a business-agnostic engine plus a business adapter.

- **Engine** (`src/server/assistant/engine/`): Mongolian normalisation (Latin-script aliases,
  glued words, phonetic typo-tolerant matching), date/time understanding against business hours,
  short-answer signals, intents and topics, vocabulary matching, verified-FAQ matching, a fact
  check for model text, presentation rules, model adapters (OpenAI over `fetch` with default
  `gpt-4.1-mini`; the existing Anthropic SDK as an alternative).
- **Dialogue** (`turn.ts`): one turn → one reply, in layers (safety, pending confirmations,
  existing bookings, booking, information, knowledge, model answer, honest fallback); slot memory
  across messages; one question at a time.
- **Adapter** (`salon/`): the `SalonPort` contract and Сувд's implementation over the existing
  availability engine, `createBooking()`, `transitionAppointment()` and `rescheduleAppointment()`.
- **Persistence** (`handler.ts`): sessions, repeated-send deduplication, a per-conversation lease,
  staff takeover with automatic hand-back, model budget, read timeouts, events, staff alerts.
- **Admin**: «AI туслах» with Overview, Conversations, Knowledge, Settings, Analytics, Activity,
  Try it and Problems.

Replaced: the previous rule engine (`rules.ts`), tool set (`tools.ts`), Claude tool loop
(`llm.ts`) and session engine (`engine.ts`). Details: [ARCHITECTURE.md](ARCHITECTURE.md).

## 2. Files changed

86 files against `main`. New: `src/server/assistant/**` (engine, dialogue, adapter, handler,
models, settings, usage), `src/app/admin/(dash)/assistant/**` (8 pages), `src/components/admin/assistant/**`,
`src/server/actions/admin-assistant.ts`, `src/server/queries/admin-assistant.ts`,
`src/server/services/customer-changes.ts`, `src/lib/assistant/{schema,redact}.ts`,
`src/server/seed/knowledge-data.ts`, `drizzle/0002_assistant_intelligence.sql`, tests and docs.
Changed: chat route, Messenger webhook, chat widget, booking service (two opt-in options),
customer-booking actions (shared rules), permissions, admin action runner, notifications (staff
alert), seeds, demo reset, cron, schema, docs, `package.json`, `vitest.config.mts`.

## 3. Features completed

- Understands Mongolian Cyrillic, Latin-script Mongolian, English and mixed messages, typos and
  short answers ("15 tsag", "2", "Za bolno"); keeps service, specialist, day, time, name and phone
  across the conversation.
- Services, prices, durations, combinations (up to 3), specialists and their services, hours,
  special days, address, policies, deposit, payment, preparation — from the database or verified
  knowledge; services the salon does not offer are said so.
- Real availability only; explains closed days, opening/closing limits, taken times and breaks;
  offers the nearest free times.
- Booking after an explicit "yes" to a summary; failure messages with alternatives; a phone may
  not hold two overlapping chat bookings.
- Status, cancellation (with the deposit consequence) and rescheduling, only for a booking this
  chat created or proved with reference + phone.
- Hand-over (request, complaint, repeated unknowns) with a logged staff alert; staff takeover,
  reply in the website chat, hand-back, automatic hand-back after the owner's limit.
- Model (optional): reads unclear messages into a grounded reading; writes open answers behind
  the fact check; daily budget; rules when the model is absent, failing or over budget.
- Admin: the eight areas above; contacts redacted for staff without contact access and for demo
  visitors; all changes through `runAdminAction()` with audit entries.

## 4. Tests executed (exact results)

| Command                                                                 | Result                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run check` (lint, typecheck, unit + integration, production build) | exit 0                                                                                             |
| `vitest --project unit`                                                 | 67/67                                                                                              |
| `vitest --project integration`                                          | 108/108 (19 existing, 68 gate conversations, 21 assistant scenarios)                               |
| `npm run eval:assistant` (held-out, rules only)                         | run 1: 91/95 turns (58/62 conversations), hard rules 95/95; run 2: 95/95 (62/62), hard rules 95/95 |
| Gate set (same harness)                                                 | 117/117 turns (68/68 conversations)                                                                |
| `playwright test` against the local dev server (desktop + Pixel 7)      | 16/16                                                                                              |
| `prettier --check .`                                                    | clean                                                                                              |

The assistant scenarios cover: two customers confirming one slot at once (one booking), the same
phone booking twice, repeated and parallel identical sends, a slot taken between summary and
"yes", duration and break conflicts, a specialist's day off, wrong-phone attempts on another
customer's booking, authorised cancellation, model down, a grounded model reading, an invented
model price rejected, a verified model answer used, budget exhausted, a database error during
booking, a backend timeout, malformed requests, hand-over alert, staff takeover and hand-back,
simulated test-chat bookings, and that manage links and contact details are not stored.
Evaluation method and the retired held-out cases: [EVALUATION.md](EVALUATION.md).

## 5. Database safety verification

- Production: Neon `DATABASE_URL` exists only in Vercel (Production scope); preview deployments
  have no database URL. Not used in this task.
- Main checkout `.env.local` → `127.0.0.1:54329` (local). This work's checkout
  (`C:\Dev\github-v2\appointment-brand-chatbot`) → its own local database on `127.0.0.1:54339`.
- Integration and evaluation tests → throwaway embedded PostgreSQL per run; each evaluation case
  is rolled back. End-to-end tests → the local dev server on port 3211 only.
- Migration 0002 is additive (new tables, nullable or defaulted columns, indexes); no drops, no
  rewrites, no enum changes. Applied only to the local and test databases.
- No production data was read, changed or deleted.

## 6. Remaining limitations

- No live model evaluation: no `OPENAI_API_KEY` was available. The `gpt-4.1-mini` path is tested
  with fake responses only; a live held-out run costs money and needs approval.
- Add-ons are not offered in the chat (the booking page and staff handle them).
- Rescheduling keeps the original specialist rule (as the «Миний захиалга» page does).
- Staff replies reach the website chat (polling every 6 s); they are not sent to Messenger.
- English replies cover the flows, but catalogue names and policy texts stay in Mongolian.
- Automatic hand-back happens when the customer writes again (no background job).
- Messenger stays inactive; SMS is not integrated; staff alerts are only logged in demo mode.
- The evaluation sets are small and developer-written; the numbers are not real-world accuracy.
- The sample knowledge entry about parking is fictional demo content.

## 7. Environment variables

| Variable                                 | Needed for                                                                        | Default                     |
| ---------------------------------------- | --------------------------------------------------------------------------------- | --------------------------- |
| `OPENAI_API_KEY`                         | Model readings and answers (optional)                                             | unset → rules only          |
| `ANTHROPIC_API_KEY`                      | Alternative provider (optional)                                                   | unset                       |
| `AI_MODEL`                               | Allow-listed model override when the admin setting names another provider's model | unset                       |
| `AI_DAILY_BUDGET_USD`                    | Budget before the owner saves one in the admin                                    | 2                           |
| `AI_USAGE_ENVIRONMENT`                   | Label of this environment in the spend ledger                                     | `VERCEL_ENV` / `local`      |
| `OPENAI_BASE_URL`                        | Proxy for the OpenAI API (optional)                                               | `https://api.openai.com/v1` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Staff alerts in a real salon (existing)                                           | unset                       |

## 8. Before production deployment

1. Review and merge `chatbot-intelligence`.
2. Back up the database (Neon branch), then `npm run db:migrate` with the production
   `DATABASE_URL` **before** the new code is live (the assistant reads the new tables).
3. `npm run db:seed` once (idempotent): new role permissions (`assistant.reply`,
   `assistant.manage`) and the sample knowledge.
4. Decide on a model: set `OPENAI_API_KEY` in Vercel (or leave the assistant on rules), and the
   daily budget in Admin → AI туслах → Тохиргоо. Run the held-out set with the model first if a
   key is added (`EVAL_MODEL=1 npm run eval:assistant`).
5. Review the knowledge entries in Admin → AI туслах → Мэдлэг.
6. Deploy, then check `/api/health`, the chat on the home page, and Admin → AI туслах → Туршиж үзэх.
   Prefer running the end-to-end suite against a preview with a database branch, since it creates
   (and cancels) bookings.

## 9. Next: the cleaning-service project

The engine, dialogue, handler, admin and evaluation harness carry over; a new `SalonPort`
implementation, vocabulary and copy are needed, plus an address step in the booking memory. Steps:
[ARCHITECTURE.md → Porting](ARCHITECTURE.md#porting-to-the-cleaning-service-project).

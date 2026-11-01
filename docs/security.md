# Security and the public demo

## Secrets

All credentials are environment variables (`.env.local` locally, Vercel Secrets in
production) and are never committed or sent to the browser. `SESSION_SECRET` and
`CRON_SECRET` are long random values; in production the app refuses to start a signed
operation without a proper `SESSION_SECRET`.

## Admin access

- Sessions: random token in an HttpOnly, Secure, SameSite=Lax cookie (`sv_admin`, path
  `/portfolio/appointments`); only its SHA-256 is stored. Staff sessions last 12 hours, demo
  sessions 60 minutes. Expiry is checked with the database clock.
- Passwords: scrypt hashes. Login is rate-limited and compares against a dummy hash for
  unknown emails, so timing does not reveal which accounts exist.
- Authorisation happens on the server for every page (`requireAdminPage`) and every action
  (`runAdminAction`). Permissions come from `salon.admin_roles`. Hidden buttons are a
  convenience, not the security boundary.

| Role                     | Access                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| Эзэмшигч (owner)         | Everything, including demo reset and the audit log                 |
| Менежер (manager)        | Bookings, catalogue, staff, customers, payments, reports, settings |
| Ресепшн (reception)      | Bookings, customers, payments                                      |
| Мастер (specialist)      | Own schedule and own appointments only                             |
| Демо зочин (demo viewer) | Read access to the sample salon                                    |

## The public admin demo

«Админ самбар үзэх» signs a visitor in as a demo viewer (or «Мастерын эрхээр» as a
specialist), only when `DEMO_MODE=true` and only for a salon flagged as a demo.

- Every change a demo visitor makes runs through the real server code inside a transaction
  that is then **rolled back**, and the visitor is told so. Validation, permission checks and
  conflicts behave exactly as for real staff, but nothing is saved.
- The exception is bookings the visitor created themselves on the public site (matched by
  a hashed visitor cookie): those they can really confirm, move or cancel, so the full
  flow can be tried.
- Demo visitors never see real contact data: phone numbers are masked (`99****33`) and
  emails hidden. They cannot reset the data or upload images.
- Limits: 12 demo sign-ins per hour per IP and 60 demo changes per hour per visitor.
- The sample data is replaced every night.

## Customers

- A booking is managed through a private link containing a random token; only its hash is
  stored. Looking a booking up by reference and phone is rate-limited and grants a
  short-lived signed cookie.
- Inputs are validated with Zod on the server, and error messages are in Mongolian.
- IP addresses are never stored: rate limits use an HMAC of the IP.

## Payments

- A deposit becomes paid only when the provider confirms it (`checkInvoice`) or staff record
  money received. The QPay callback URL is HMAC-signed and still re-checks the invoice with
  QPay before changing anything.
- `QPAY_MODE=production` is refused while `DEMO_MODE=true`, so the public portfolio can
  never take real money. The simulated QR is deliberately not payable.
- Refunds of real QPay payments go through the provider first.

## Messaging

- Demo mode never sends messages: notifications are written to the database as `logged`.
- The Messenger webhook verifies Meta's `X-Hub-Signature-256` and is inactive without
  `MESSENGER_APP_SECRET` and the page token.
- The assistant cannot book on its own: it prepares a draft that the customer confirms. Its
  replies are checked so that every price and time comes from the database, and model calls
  stop at the daily budget.

## Rate limits

Stored in `salon.rate_limits` (works across serverless instances): login 8 per 15 min, booking
8 per hour, lookup 20 per 15 min, chat 30 per 10 min and 120 per day, payment checks 30 per
10 min, availability 240 per minute, among others. See `server/security/rate-limit.ts`.

## HTTP headers

HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
a strict referrer policy, and Server Actions limited to this origin plus `ALLOWED_ORIGINS`.

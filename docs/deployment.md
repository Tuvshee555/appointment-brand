# Deployment and going live

## Current deployment

- Vercel project `appointment-brand` (team `tuvshinsaihans-projects`), connected to
  `github.com/Tuvshee555/appointment-brand`: every push to `main` deploys to production.
- Production URL: https://appointment-brand.vercel.app/portfolio/appointments (the root
  redirects there).
- Functions run in `cle1` (Cleveland), close to the Neon database in us-east-2 (Ohio).
- Cron: `vercel.json` calls `/portfolio/appointments/api/cron/maintenance` daily at 19:00 UTC
  (03:00 in Ulaanbaatar). Vercel sends `Authorization: Bearer $CRON_SECRET`.
- Health check: `/portfolio/appointments/api/health` returns the database status.

## Environment variables (production)

| Variable                                                               | Value                               |
| ---------------------------------------------------------------------- | ----------------------------------- |
| `DATABASE_URL`                                                         | Neon connection string (secret)     |
| `SESSION_SECRET`, `CRON_SECRET`                                        | Random 48-character values (secret) |
| `DEMO_MODE`                                                            | `true` for the portfolio demo       |
| `QPAY_MODE`                                                            | `mock` for the portfolio demo       |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Image uploads for the owner account |

Not set on purpose: the QPay merchant credentials (the demo never takes payments),
`ANTHROPIC_API_KEY` (the assistant runs its rule engine), Telegram and Messenger tokens.
See `.env.example` for every supported variable.

Database changes are not run by the build: apply migrations with `npm run db:migrate`
against the production `DATABASE_URL` before deploying code that needs them.

## Serving it from the Ursgal site

The app is built with `basePath: '/portfolio/appointments'`, so the Ursgal website can serve
it on its own domain as a [multi-zone](https://nextjs.org/docs/app/guides/multi-zones). In
`ursgal-web`:

1. Remove the static mock under `app/portfolio/appointments/` and
   `components/portfolio/appointments/`, or keep it out of the route tree.
2. Add rewrites to `next.config.ts`:

   ```ts
   async rewrites() {
     return {
       beforeFiles: [
         {
           source: '/portfolio/appointments',
           destination: 'https://appointment-brand.vercel.app/portfolio/appointments',
         },
         {
           source: '/portfolio/appointments/:path*',
           destination: 'https://appointment-brand.vercel.app/portfolio/appointments/:path*',
         },
       ],
     }
   },
   ```

3. Update the `appointments` entry in `lib/portfolio.ts`: brand «Сувд», a database-backed
   product, and an assistant that reads the real catalogue and availability (the current text
   describes the old browser-only simulation).
4. Link to `/portfolio/appointments` with a plain `<a>` (a different zone, so not
   `next/link`).

Server Actions already accept the `ursgal-digital.vercel.app` origin (`ALLOWED_ORIGINS`).
Cookies are scoped to `/portfolio/appointments`, so they work on either domain.

Alternatively, follow the pattern used for the MANAN store: a presentation page on the Ursgal
site that links to https://appointment-brand.vercel.app/portfolio/appointments.

## Going live for a real salon

1. **Data:** a separate database or Neon branch. Run `db:migrate` and `db:seed` (without
   demo data), with `DEMO_MODE=false` and the salon's own owner email and password. Replace
   the demo catalogue, staff, photos, hours and policies in the admin.
2. **QPay:** the salon's own merchant account (`QPAY_USERNAME`, `QPAY_PASSWORD`,
   `QPAY_INVOICE_CODE`). Test with `QPAY_MODE=sandbox` and the sandbox URL first, then switch
   to `production`. Set a dedicated `QPAY_CALLBACK_SECRET`. QPay's own transaction fees are
   separate from Ursgal Digital's integration fee.
3. **Assistant:** `ANTHROPIC_API_KEY`, with `AI_DAILY_BUDGET_USD` set to the agreed limit.
4. **Notifications:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for staff alerts. SMS needs a
   Mongolian SMS gateway contract (not integrated yet).
5. **Messenger:** a Meta app with `pages_messaging` approval, the page token,
   `MESSENGER_APP_SECRET` and `MESSENGER_VERIFY_TOKEN`; then subscribe the webhook
   `/portfolio/appointments/api/messenger/webhook`.
6. **Holidays:** Tsagaan Sar follows the lunar calendar. Add its dates each year under
   Settings → Баяр, онцгой өдөр.
7. **Domain and legal:** custom domain, privacy and cancellation policies reviewed by the
   salon, and real staff photos with the staff's consent.

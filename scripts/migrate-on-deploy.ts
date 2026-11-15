// Runs before `next build`. On a Vercel production build it applies pending
// migrations and the idempotent base seed (role permissions, sample assistant
// knowledge; never overwrites, no demo bookings), so new tables exist before the
// new code goes live. A failure fails the build and the previous deployment keeps
// serving. Everywhere else (local builds, previews) it does nothing.
import { runMigrations, seed } from './lib/tasks'

async function main() {
  if (process.env.VERCEL_ENV !== 'production') {
    console.log('[db] Not a production deploy — migrations skipped.')
    return
  }
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set for the production build')
  await runMigrations(url)
  console.log('[db] Migrations applied.')
  await seed(url, { demo: false })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

// Idempotent seed. `npm run db:seed` — salon, roles, catalogue, staff, owner
// account (from ADMIN_EMAIL/ADMIN_PASSWORD). `npm run db:seed:demo` — also the
// fictional customers and appointments (skipped when they already exist).
import { loadEnv, seed } from './lib/tasks'

async function main() {
  const url = loadEnv()
  await seed(url, { demo: process.argv.includes('--demo') })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

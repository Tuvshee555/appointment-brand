// Applies pending migrations (additive; never drops data). Usage: npm run db:migrate
import { loadEnv, runMigrations } from './lib/tasks'

async function main() {
  const url = loadEnv()
  await runMigrations(url)
  console.log('[migrate] Database schema is up to date.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

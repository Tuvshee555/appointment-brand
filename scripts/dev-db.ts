// Local development database: a PostgreSQL server on this machine (embedded-postgres,
// the binaries the integration tests already use). `npm run dev` and the E2E tests
// then never touch the live demonstration database, whose URL lives only in Vercel.
//
//   npm run db:dev     # keep it running in its own terminal; Ctrl+C stops it
//
// The first run creates the database in .dev-db/ (git-ignored), applies the
// migrations and seeds the demo data. Point .env.local at it:
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/salon_dev
import EmbeddedPostgres from 'embedded-postgres'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.DEV_DB_PORT || 54329)
const NAME = 'salon_dev'
const DIR = path.join(process.cwd(), '.dev-db')
const READY = path.join(DIR, 'SETUP_DONE')
const URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/${NAME}`

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DIR,
    port: PORT,
    user: 'postgres',
    password: 'postgres',
    persistent: true,
    // UTF-8 rather than the Windows code page, so the Mongolian seed data fits.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  })
  if (!existsSync(path.join(DIR, 'PG_VERSION'))) await pg.initialise()
  await pg.start()
  const stop = async () => {
    await pg.stop()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  if (!existsSync(READY)) {
    await pg.createDatabase(NAME).catch((error: Error) => {
      if (!/already exists/.test(error.message)) throw error
    })
    // The project's own scripts, aimed at this database only.
    for (const script of ['db:migrate', 'db:seed:demo']) {
      const run = spawnSync(`npm run ${script}`, {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, DATABASE_URL: URL },
      })
      if (run.status !== 0) {
        await pg.stop()
        process.exit(run.status ?? 1)
      }
    }
    writeFileSync(READY, new Date().toISOString())
  }
  console.log(`\nLocal development database is running.\n  DATABASE_URL=${URL}\nCtrl+C stops it.`)
  setInterval(() => {}, 60_000)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

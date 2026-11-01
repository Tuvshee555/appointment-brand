// Safe demo reset: deletes rows flagged is_demo for the demo salon only and
// regenerates them relative to today. Refuses to run against a salon that is
// not marked as a demo salon, so real salon data can never be reset.
import { and, eq } from 'drizzle-orm'
import * as t from '../src/server/db/schema'
import { deleteDemoData, seedDemo } from '../src/server/seed/demo'
import { loadEnv, withDb } from './lib/tasks'

async function main() {
  const url = loadEnv()
  await withDb(url, async (db) => {
    const slug = process.env.SALON_SLUG ?? 'suvd'
    const [salon] = await db
      .select()
      .from(t.salons)
      .where(and(eq(t.salons.slug, slug), eq(t.salons.isDemo, true)))
    if (!salon) {
      console.error(`[reset-demo] Salon "${slug}" is not a demo salon — nothing was changed.`)
      process.exit(1)
    }
    await deleteDemoData(db, salon.id)
    console.log(`[reset-demo] ${await seedDemo(db, { salonId: salon.id, force: true })}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

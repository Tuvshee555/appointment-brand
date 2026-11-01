// Read-only overview of the salon schema: row counts and appointment status mix.
import { sql } from 'drizzle-orm'
import { loadEnv, withDb } from './lib/tasks'

async function main() {
  const url = loadEnv()
  await withDb(url, async (db) => {
    const tables = await db.execute<{ table: string; rows: number }>(sql`
      select c.relname as table, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from salon.%I', c.relname), false, true, '')))[1]::text::int as rows
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'salon' and c.relkind = 'r' order by c.relname`)
    console.table(tables.rows)
    const statuses = await db.execute(sql`select status, count(*)::int as n from salon.appointments group by status order by n desc`)
    console.table(statuses.rows)
    const overlap = await db.execute(sql`
      select count(*)::int as overlaps from salon.appointments a join salon.appointments b
        on a.staff_id = b.staff_id and a.id < b.id
       and tstzrange(a.starts_at, a.occupied_until) && tstzrange(b.starts_at, b.occupied_until)
      where a.status in ('awaiting_deposit','pending','confirmed','completed','no_show')
        and b.status in ('awaiting_deposit','pending','confirmed','completed','no_show')`)
    console.log('Overlapping slot-holding appointments (must be 0):', overlap.rows[0])
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

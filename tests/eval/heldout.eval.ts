// Held-out run (not part of `npm test`): `npm run eval:assistant`. Prints the report and, with
// EVAL_REPORT=<file>, writes it as Markdown. Rules only unless EVAL_MODEL=1 and a model key is set
// (that run spends real money and is refused against a production database URL).
import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createModelCaller } from '@/server/assistant/engine/model'
import { freshDatabase, type TestDb } from '../integration/db'
import { gateCases } from './gate'
import { createWorld, markdownReport, runCase, summarize, type CaseResult, type World } from './harness'
import { heldoutCases } from './heldout'

let env: TestDb
let world: World

beforeAll(async () => {
  env = await freshDatabase()
  world = await createWorld(env.db, env.salonId)
})
afterAll(() => env.close())

const useModel = process.env.EVAL_MODEL === '1'

it('runs the held-out and gate sets and reports the results', async () => {
  if (useModel && /neon\.tech/.test(process.env.DATABASE_URL ?? ''))
    throw new Error('refusing a model run with a production DATABASE_URL')
  const caller = useModel ? createModelCaller() : null
  const run = async (cases: typeof heldoutCases) => {
    const out: CaseResult[] = []
    for (const c of cases) out.push(await runCase(env.db, env.salonId, world, c, { caller }))
    return out
  }
  const heldout = await run(heldoutCases)
  const gate = await run(gateCases)
  const label = useModel ? `model (${process.env.AI_MODEL || 'default'})` : 'rules only'
  const report = [
    markdownReport(`Held-out set — ${label}`, heldout),
    '',
    markdownReport(`Gate set — ${label}`, gate),
  ].join('\n')
  console.log(report)
  if (process.env.EVAL_REPORT) writeFileSync(process.env.EVAL_REPORT, `${report}\n`)
  const s = summarize(heldout)
  expect(s.turns).toBeGreaterThan(0)
})

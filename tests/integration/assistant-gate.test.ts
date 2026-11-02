// The gate conversations (tests/eval/gate.ts) through the real assistant and database: every
// turn must hold the hard rules and its own expectations. Rules only — no model.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gateCases } from '../eval/gate'
import { createWorld, runCase, type World } from '../eval/harness'
import { freshDatabase, type TestDb } from './db'

let env: TestDb
let world: World

beforeAll(async () => {
  env = await freshDatabase()
  world = await createWorld(env.db, env.salonId)
})
afterAll(() => env.close())

describe('assistant gate conversations', () => {
  for (const c of gateCases) {
    it(`${c.id} (${c.category}, ${c.script})`, async () => {
      const result = await runCase(env.db, env.salonId, world, c)
      const problems = result.rows
        .filter((r) => r.hard.length || r.failures.length)
        .map(
          (r) => `«${r.text}» → ${[...r.hard, ...r.failures].join('; ')}\n    reply: ${r.reply.replace(/\n/g, ' / ')}`,
        )
      expect(problems, problems.join('\n')).toEqual([])
    })
  }
})

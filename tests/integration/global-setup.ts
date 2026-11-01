// Starts a throwaway PostgreSQL (embedded-postgres), applies the real
// migrations and the base seed to a template database. Each test file clones
// the template into its own database (see ./db.ts), so files stay isolated.
import EmbeddedPostgres from 'embedded-postgres'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'
import { runMigrations, withDb } from '../../scripts/lib/tasks'
import { seedBase } from '../../src/server/seed/base'
import { SEED_NOW, TEMPLATE_DB } from './constants'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

export default async function setup(project: TestProject) {
  const dir = await mkdtemp(path.join(tmpdir(), 'salon-pg-'))
  const port = await freePort()
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    // On Windows initdb would otherwise pick the system code page (e.g. WIN1252),
    // which cannot store the Mongolian text in the migrations and seed.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase(TEMPLATE_DB)

  const server = `postgres://postgres:postgres@127.0.0.1:${port}`
  const templateUrl = `${server}/${TEMPLATE_DB}`
  await runMigrations(templateUrl)
  await withDb(templateUrl, (db) => seedBase(db, { now: SEED_NOW }))

  project.provide('pgServer', server)
  project.provide('templateDb', TEMPLATE_DB)

  return async () => {
    await pg.stop()
    await rm(dir, { recursive: true, force: true })
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgServer: string
    templateDb: string
  }
}

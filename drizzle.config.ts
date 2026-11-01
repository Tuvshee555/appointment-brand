import { loadEnvConfig } from '@next/env'
import { defineConfig } from 'drizzle-kit'

loadEnvConfig(process.cwd())

// Every salon table lives in the dedicated `salon` schema so the database can
// be shared with other applications without name clashes.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  schemaFilter: ['salon'],
  migrations: { schema: 'salon', table: '__migrations' },
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
})

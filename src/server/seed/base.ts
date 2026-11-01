// Base seed: salon, settings, hours, holidays, roles, catalogue, staff and the
// demo access accounts. Idempotent — natural keys (slugs, keys, emails) are
// upserted with ON CONFLICT DO NOTHING, so re-running never duplicates rows
// and never overwrites what the owner has edited since.
import { eq, sql } from 'drizzle-orm'
import { ROLE_DEFINITIONS, type RoleKey } from '@/lib/auth/permissions'
import { DEMO_SALON } from '@/lib/brand'
import { dateKeyOf } from '@/lib/datetime'
import { PHOTOS } from '@/lib/photo-manifest'
import { hashPassword } from '@/server/auth/password'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { ADDONS, CATEGORIES, OPENING_HOURS, SERVICES, SETTINGS_DEFAULTS, SKILLS, STAFF, fixedHolidays } from './catalog-data'

export const DEMO_VIEWER_EMAIL = 'demo-owner@suvd.example'
export const DEMO_SPECIALIST_EMAIL = 'demo-specialist@suvd.example'

export interface BaseSeedResult {
  salonId: string
  created: { services: number; staff: number; addons: number }
}

export async function seedRoles(db: Database) {
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS) as [RoleKey, (typeof ROLE_DEFINITIONS)[RoleKey]][]) {
    await db
      .insert(t.adminRoles)
      .values({ key, name: def.name, description: def.description, permissions: def.permissions })
      .onConflictDoUpdate({
        target: t.adminRoles.key,
        set: { name: def.name, description: def.description, permissions: def.permissions },
      })
  }
}

export async function seedBase(db: Database, { now = new Date() }: { now?: Date } = {}): Promise<BaseSeedResult> {
  await seedRoles(db)

  await db
    .insert(t.salons)
    .values({ slug: DEMO_SALON.slug, name: DEMO_SALON.name, isDemo: true })
    .onConflictDoNothing({ target: t.salons.slug })
  const [salon] = await db.select({ id: t.salons.id }).from(t.salons).where(eq(t.salons.slug, DEMO_SALON.slug))
  const salonId = salon.id

  await db
    .insert(t.businessSettings)
    .values({
      salonId,
      tagline: DEMO_SALON.tagline,
      about: DEMO_SALON.about,
      announcement: DEMO_SALON.announcement,
      phone: DEMO_SALON.phone,
      email: DEMO_SALON.email,
      addressLine: DEMO_SALON.addressLine,
      addressNote: DEMO_SALON.addressNote,
      instagram: DEMO_SALON.instagram,
      facebook: DEMO_SALON.facebook,
      ...SETTINGS_DEFAULTS,
    })
    .onConflictDoNothing({ target: t.businessSettings.salonId })

  await db
    .insert(t.openingHours)
    .values(OPENING_HOURS.map((o) => ({ salonId, ...o })))
    .onConflictDoNothing()

  const year = Number(dateKeyOf(now).slice(0, 4))
  const holidays = [...fixedHolidays(year), ...fixedHolidays(year + 1)].map((d) => ({
    salonId,
    date: d.date,
    kind: d.kind,
    opensAt: 'opensAt' in d ? d.opensAt : null,
    closesAt: 'closesAt' in d ? d.closesAt : null,
    label: d.label,
  }))
  await db.insert(t.specialDays).values(holidays).onConflictDoNothing()

  // ---- Catalogue
  await db
    .insert(t.skills)
    .values(SKILLS.map((s, i) => ({ salonId, key: s.key, name: s.name, description: s.description, sortOrder: i })))
    .onConflictDoNothing()
  const skillRows = await db.select({ id: t.skills.id, key: t.skills.key }).from(t.skills).where(eq(t.skills.salonId, salonId))
  const skillId = new Map(skillRows.map((r) => [r.key, r.id]))

  await db
    .insert(t.serviceCategories)
    .values(
      CATEGORIES.map((c, i) => ({
        salonId,
        slug: c.slug,
        name: c.name,
        description: c.description,
        imageUrl: PHOTOS[c.image].src,
        sortOrder: i,
      })),
    )
    .onConflictDoNothing()
  const categoryRows = await db
    .select({ id: t.serviceCategories.id, slug: t.serviceCategories.slug })
    .from(t.serviceCategories)
    .where(eq(t.serviceCategories.salonId, salonId))
  const categoryId = new Map(categoryRows.map((r) => [r.slug, r.id]))

  const insertedAddons = await db
    .insert(t.serviceAddons)
    .values(ADDONS.map((a, i) => ({ salonId, ...a, sortOrder: i })))
    .onConflictDoNothing()
    .returning({ id: t.serviceAddons.id })
  const addonRows = await db
    .select({ id: t.serviceAddons.id, slug: t.serviceAddons.slug })
    .from(t.serviceAddons)
    .where(eq(t.serviceAddons.salonId, salonId))
  const addonId = new Map(addonRows.map((r) => [r.slug, r.id]))

  const insertedServices = await db
    .insert(t.services)
    .values(
      SERVICES.map((s, i) => ({
        salonId,
        categoryId: categoryId.get(s.category)!,
        slug: s.slug,
        name: s.name,
        shortDescription: s.shortDescription,
        description: s.description,
        durationMinutes: s.durationMinutes,
        price: s.price,
        priceType: s.priceType,
        bufferMinutes: s.bufferMinutes ?? null,
        imageUrl: PHOTOS[s.image].src,
        imageAlt: PHOTOS[s.image].alt,
        isFeatured: Boolean(s.featured),
        sortOrder: i,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: t.services.id, slug: t.services.slug })
  // Links are written only for services created in this run, so later edits by the owner survive re-seeding.
  for (const row of insertedServices) {
    const def = SERVICES.find((s) => s.slug === row.slug)!
    if (def.addons.length) {
      await db
        .insert(t.serviceAddonLinks)
        .values(def.addons.map((slug) => ({ serviceId: row.id, addonId: addonId.get(slug)! })))
        .onConflictDoNothing()
    }
    await db
      .insert(t.serviceSkills)
      .values(def.skills.map((key) => ({ serviceId: row.id, skillId: skillId.get(key)! })))
      .onConflictDoNothing()
  }
  const serviceRows = await db.select({ id: t.services.id, slug: t.services.slug }).from(t.services).where(eq(t.services.salonId, salonId))
  const serviceId = new Map(serviceRows.map((r) => [r.slug, r.id]))

  // ---- Staff
  const insertedStaff = await db
    .insert(t.staff)
    .values(
      STAFF.map((s, i) => ({
        salonId,
        slug: s.slug,
        name: s.name,
        displayName: s.displayName,
        title: s.title,
        bio: s.bio,
        experienceYears: s.experienceYears,
        experienceText: s.experienceText,
        specialties: s.specialties,
        photoUrl: `/images/staff/${s.photo}.webp`,
        photoAlt: `${s.displayName} — зохиомол мастерын AI-аар бүтээсэн хөрөг`,
        coverUrl: PHOTOS[s.cover].src,
        calendarColor: s.color,
        sortOrder: i,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: t.staff.id, slug: t.staff.slug })
  for (const row of insertedStaff) {
    const def = STAFF.find((s) => s.slug === row.slug)!
    await db
      .insert(t.staffSkills)
      .values(def.skills.map((s) => ({ staffId: row.id, skillId: skillId.get(s.key)!, level: s.level })))
      .onConflictDoNothing()
    await db
      .insert(t.staffServices)
      .values(def.services.map((slug) => ({ staffId: row.id, serviceId: serviceId.get(slug)! })))
      .onConflictDoNothing()
    await db
      .insert(t.staffSchedules)
      .values(
        [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
          const shift = def.schedule[weekday as 1]
          return {
            staffId: row.id,
            weekday,
            isWorking: Boolean(shift),
            startsAt: shift?.[0] ?? 600,
            endsAt: shift?.[1] ?? 1200,
          }
        }),
      )
      .onConflictDoNothing()
    if (def.breaks.length) await db.insert(t.staffBreaks).values(def.breaks.map((b) => ({ staffId: row.id, ...b })))
  }

  // ---- Access accounts
  const anuId = (await db.select({ id: t.staff.id }).from(t.staff).where(sql`${t.staff.salonId} = ${salonId} and ${t.staff.slug} = 'anu'`))[0]?.id
  await db
    .insert(t.adminUsers)
    .values([
      { salonId, email: DEMO_VIEWER_EMAIL, name: 'Демо зочин', roleKey: 'demo_viewer', passwordHash: null },
      { salonId, email: DEMO_SPECIALIST_EMAIL, name: 'Демо мастер (Ану)', roleKey: 'specialist', passwordHash: null, staffId: anuId ?? null },
    ])
    .onConflictDoNothing({ target: t.adminUsers.email })

  return {
    salonId,
    created: { services: insertedServices.length, staff: insertedStaff.length, addons: insertedAddons.length },
  }
}

/** Creates the owner account from ADMIN_EMAIL / ADMIN_PASSWORD (never overwrites an existing password). */
export async function ensureOwner(db: Database, salonId: string, input: { email: string; password: string; name: string }) {
  const email = input.email.trim().toLowerCase()
  const existing = await db.select({ id: t.adminUsers.id }).from(t.adminUsers).where(eq(t.adminUsers.email, email))
  if (existing.length) return 'exists' as const
  await db.insert(t.adminUsers).values({
    salonId,
    email,
    name: input.name,
    roleKey: 'owner',
    passwordHash: await hashPassword(input.password),
  })
  return 'created' as const
}

import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'

/** Everything the service editor and list need, including inactive rows. */
export async function loadCatalogAdmin(salonId: string) {
  const [categories, services, addons, skills, staff] = await Promise.all([
    db
      .select()
      .from(t.serviceCategories)
      .where(eq(t.serviceCategories.salonId, salonId))
      .orderBy(asc(t.serviceCategories.sortOrder)),
    db.select().from(t.services).where(eq(t.services.salonId, salonId)).orderBy(asc(t.services.sortOrder)),
    db
      .select()
      .from(t.serviceAddons)
      .where(eq(t.serviceAddons.salonId, salonId))
      .orderBy(asc(t.serviceAddons.sortOrder)),
    db.select().from(t.skills).where(eq(t.skills.salonId, salonId)).orderBy(asc(t.skills.sortOrder)),
    db
      .select({ id: t.staff.id, name: t.staff.displayName, isActive: t.staff.isActive })
      .from(t.staff)
      .where(eq(t.staff.salonId, salonId))
      .orderBy(asc(t.staff.sortOrder)),
  ])
  const serviceIds = services.map((s) => s.id)
  const staffIds = staff.map((s) => s.id)
  const [addonLinks, serviceSkills, staffServices, staffSkills] = await Promise.all([
    serviceIds.length
      ? db.select().from(t.serviceAddonLinks).where(inArray(t.serviceAddonLinks.serviceId, serviceIds))
      : [],
    serviceIds.length ? db.select().from(t.serviceSkills).where(inArray(t.serviceSkills.serviceId, serviceIds)) : [],
    serviceIds.length ? db.select().from(t.staffServices).where(inArray(t.staffServices.serviceId, serviceIds)) : [],
    staffIds.length
      ? db
          .select()
          .from(t.staffSkills)
          .where(and(inArray(t.staffSkills.staffId, staffIds)))
      : [],
  ])
  return {
    categories,
    addons,
    skills,
    staff: staff.map((s) => ({ ...s, skillIds: staffSkills.filter((k) => k.staffId === s.id).map((k) => k.skillId) })),
    services: services.map((s) => ({
      ...s,
      addonIds: addonLinks.filter((l) => l.serviceId === s.id).map((l) => l.addonId),
      skillIds: serviceSkills.filter((l) => l.serviceId === s.id).map((l) => l.skillId),
      staffIds: staffServices.filter((l) => l.serviceId === s.id).map((l) => l.staffId),
    })),
  }
}

export type CatalogAdmin = Awaited<ReturnType<typeof loadCatalogAdmin>>

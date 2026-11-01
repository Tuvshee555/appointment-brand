// Booking catalogue: active services, add-ons and which specialists may
// perform them. Always loaded fresh for pricing and booking decisions.
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { CatalogAddon, CatalogService, SelectionItem } from '@/lib/booking/pricing'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'

export interface StaffSummary {
  id: string
  slug: string
  name: string
  displayName: string
  title: string
  photoUrl: string | null
  isActive: boolean
  acceptsOnlineBookings: boolean
  sortOrder: number
  serviceIds: string[]
}

export interface BookingCatalog {
  services: Map<string, CatalogService & { slug: string; categoryId: string; onlineBookable: boolean }>
  addons: Map<string, CatalogAddon>
  staff: StaffSummary[]
}

export async function loadBookingCatalog(db: Database, salonId: string): Promise<BookingCatalog> {
  const [serviceRows, categoryRows, addonRows, linkRows, staffRows, staffServiceRows] = await Promise.all([
    db
      .select()
      .from(t.services)
      .where(and(eq(t.services.salonId, salonId), eq(t.services.isActive, true))),
    db.select().from(t.serviceCategories).where(eq(t.serviceCategories.salonId, salonId)),
    db
      .select()
      .from(t.serviceAddons)
      .where(and(eq(t.serviceAddons.salonId, salonId), eq(t.serviceAddons.isActive, true))),
    db
      .select({ serviceId: t.serviceAddonLinks.serviceId, addonId: t.serviceAddonLinks.addonId })
      .from(t.serviceAddonLinks)
      .innerJoin(t.services, eq(t.services.id, t.serviceAddonLinks.serviceId))
      .where(eq(t.services.salonId, salonId)),
    db.select().from(t.staff).where(eq(t.staff.salonId, salonId)).orderBy(asc(t.staff.sortOrder)),
    db
      .select({ staffId: t.staffServices.staffId, serviceId: t.staffServices.serviceId })
      .from(t.staffServices)
      .innerJoin(t.staff, eq(t.staff.id, t.staffServices.staffId))
      .where(eq(t.staff.salonId, salonId)),
  ])
  const categoryName = new Map(categoryRows.map((c) => [c.id, c.name]))
  const activeCategory = new Set(categoryRows.filter((c) => c.isActive).map((c) => c.id))
  const addonIds = new Set(addonRows.map((a) => a.id))

  const services = new Map<string, CatalogService & { slug: string; categoryId: string; onlineBookable: boolean }>()
  for (const s of serviceRows) {
    if (!activeCategory.has(s.categoryId)) continue
    services.set(s.id, {
      id: s.id,
      slug: s.slug,
      name: s.name,
      categoryId: s.categoryId,
      categoryName: categoryName.get(s.categoryId) ?? '',
      durationMinutes: s.durationMinutes,
      price: s.price,
      priceType: s.priceType,
      bufferMinutes: s.bufferMinutes,
      onlineBookable: s.onlineBookable,
      addonIds: linkRows.filter((l) => l.serviceId === s.id && addonIds.has(l.addonId)).map((l) => l.addonId),
    })
  }
  const addons = new Map<string, CatalogAddon>(
    addonRows.map((a) => [a.id, { id: a.id, name: a.name, durationMinutes: a.durationMinutes, price: a.price, priceType: a.priceType }]),
  )
  const staff: StaffSummary[] = staffRows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    displayName: s.displayName,
    title: s.title,
    photoUrl: s.photoUrl,
    isActive: s.isActive,
    acceptsOnlineBookings: s.acceptsOnlineBookings,
    sortOrder: s.sortOrder,
    serviceIds: staffServiceRows.filter((r) => r.staffId === s.id && services.has(r.serviceId)).map((r) => r.serviceId),
  }))
  return { services, addons, staff }
}

/**
 * Specialists who can perform every selected service. Public bookings only
 * see active specialists who accept online bookings; staff may assign any
 * active specialist.
 */
export function eligibleStaff(catalog: BookingCatalog, items: SelectionItem[], { publicOnly }: { publicOnly: boolean }): StaffSummary[] {
  return catalog.staff.filter(
    (s) => s.isActive && (!publicOnly || s.acceptsOnlineBookings) && items.every((i) => s.serviceIds.includes(i.serviceId)),
  )
}

/** Resolves the requested specialist (or all eligible for "any") or throws a clear Mongolian error. */
export function candidateStaff(
  catalog: BookingCatalog,
  items: SelectionItem[],
  staffId: string | null,
  options: { publicOnly: boolean },
): StaffSummary[] {
  if (options.publicOnly && items.some((i) => !catalog.services.get(i.serviceId)?.onlineBookable)) {
    throw new ServiceError('not_bookable', 'Энэ үйлчилгээг утсаар захиална уу.')
  }
  const eligible = eligibleStaff(catalog, items, options)
  if (staffId) {
    const chosen = eligible.find((s) => s.id === staffId)
    if (!chosen) {
      throw new ServiceError('staff_not_eligible', 'Сонгосон мастер эдгээр үйлчилгээг бүгдийг нь хийдэггүй. Өөр мастер эсвэл «Аль ч мастер» сонгоно уу.')
    }
    return [chosen]
  }
  if (eligible.length === 0) {
    throw new ServiceError(
      'no_eligible_staff',
      'Эдгээр үйлчилгээг нэг мастер хамт хийх боломжгүй байна. Үйлчилгээгээ тусад нь захиална уу.',
    )
  }
  return eligible
}

export async function staffNames(db: Database, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>()
  const rows = await db.select({ id: t.staff.id, displayName: t.staff.displayName }).from(t.staff).where(inArray(t.staff.id, ids))
  return new Map(rows.map((r) => [r.id, r.displayName]))
}

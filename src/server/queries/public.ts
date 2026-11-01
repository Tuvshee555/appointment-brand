// Cached read models for public pages, invalidated with updateTag() from
// admin actions. Booking, pricing and availability decisions never use these
// caches — the server reloads fresh rows before writing anything.
import 'server-only'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { cacheLife, cacheTag } from 'next/cache'
import { addDays, dateKeyOf } from '@/lib/datetime'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { resolveSalonId } from '@/server/services/salon'

export const TAGS = { salon: 'salon', catalog: 'catalog' } as const

export interface PublicSalon {
  id: string
  name: string
  isDemo: boolean
  tagline: string
  about: string
  announcement: string | null
  phone: string
  email: string | null
  addressLine: string
  addressNote: string | null
  mapUrl: string | null
  instagram: string | null
  facebook: string | null
  hours: { weekday: number; isClosed: boolean; opensAt: number; closesAt: number }[]
  specialDays: {
    date: string
    kind: 'closed' | 'special_hours'
    opensAt: number | null
    closesAt: number | null
    label: string
  }[]
  rules: {
    slotIntervalMinutes: number
    minAdvanceMinutes: number
    maxAdvanceDays: number
    cancellationNoticeHours: number
    rescheduleNoticeHours: number
    confirmationMode: 'auto' | 'manual'
    depositMode: 'none' | 'fixed' | 'percent'
    depositFixedAmount: number
    depositPercentBps: number
    depositMinTotal: number
    holdMinutes: number
    lateArrivalMinutes: number
    maxServicesPerBooking: number
    defaultBufferMinutes: number
  }
  cancellationPolicy: string
  depositPolicy: string
}

export async function getPublicSalon(): Promise<PublicSalon> {
  'use cache'
  cacheTag(TAGS.salon)
  cacheLife('hours')
  const salonId = await resolveSalonId(db)
  const today = dateKeyOf(new Date())
  const [[salon], [s], hours, specialDays] = await Promise.all([
    db.select().from(t.salons).where(eq(t.salons.id, salonId)),
    db.select().from(t.businessSettings).where(eq(t.businessSettings.salonId, salonId)),
    db.select().from(t.openingHours).where(eq(t.openingHours.salonId, salonId)).orderBy(asc(t.openingHours.weekday)),
    db
      .select()
      .from(t.specialDays)
      .where(
        and(
          eq(t.specialDays.salonId, salonId),
          gte(t.specialDays.date, today),
          lte(t.specialDays.date, addDays(today, 75)),
        ),
      )
      .orderBy(asc(t.specialDays.date)),
  ])
  return {
    id: salon.id,
    name: salon.name,
    isDemo: salon.isDemo,
    tagline: s.tagline,
    about: s.about,
    announcement: s.announcement,
    phone: s.phone,
    email: s.email,
    addressLine: s.addressLine,
    addressNote: s.addressNote,
    mapUrl: s.mapUrl,
    instagram: s.instagram,
    facebook: s.facebook,
    hours: hours.map((h) => ({ weekday: h.weekday, isClosed: h.isClosed, opensAt: h.opensAt, closesAt: h.closesAt })),
    specialDays: specialDays.map((d) => ({
      date: d.date,
      kind: d.kind,
      opensAt: d.opensAt,
      closesAt: d.closesAt,
      label: d.label,
    })),
    rules: {
      slotIntervalMinutes: s.slotIntervalMinutes,
      minAdvanceMinutes: s.minAdvanceMinutes,
      maxAdvanceDays: s.maxAdvanceDays,
      cancellationNoticeHours: s.cancellationNoticeHours,
      rescheduleNoticeHours: s.rescheduleNoticeHours,
      confirmationMode: s.confirmationMode,
      depositMode: s.depositMode,
      depositFixedAmount: s.depositFixedAmount,
      depositPercentBps: s.depositPercentBps,
      depositMinTotal: s.depositMinTotal,
      holdMinutes: s.holdMinutes,
      lateArrivalMinutes: s.lateArrivalMinutes,
      maxServicesPerBooking: s.maxServicesPerBooking,
      defaultBufferMinutes: s.defaultBufferMinutes,
    },
    cancellationPolicy: s.cancellationPolicy,
    depositPolicy: s.depositPolicy,
  }
}

export interface PublicCategory {
  id: string
  slug: string
  name: string
  description: string
  imageUrl: string | null
  serviceCount: number
  minPrice: number
}

export interface PublicService {
  id: string
  slug: string
  name: string
  categoryId: string
  categorySlug: string
  categoryName: string
  shortDescription: string
  description: string
  durationMinutes: number
  price: number
  priceType: 'fixed' | 'from'
  bufferMinutes: number | null
  imageUrl: string | null
  imageAlt: string | null
  isFeatured: boolean
  onlineBookable: boolean
  addonIds: string[]
  staffIds: string[]
}

export interface PublicAddon {
  id: string
  slug: string
  name: string
  description: string
  price: number
  priceType: 'fixed' | 'from'
  durationMinutes: number
}

export interface PublicStaff {
  id: string
  slug: string
  name: string
  displayName: string
  title: string
  bio: string
  experienceYears: number
  experienceText: string
  specialties: string[]
  photoUrl: string | null
  photoAlt: string | null
  coverUrl: string | null
  acceptsOnlineBookings: boolean
  serviceIds: string[]
  workDays: { weekday: number; startsAt: number; endsAt: number }[]
}

export interface PublicCatalog {
  categories: PublicCategory[]
  services: PublicService[]
  addons: PublicAddon[]
  staff: PublicStaff[]
}

/** Active catalogue and specialists (no internal fields). */
export async function getPublicCatalog(): Promise<PublicCatalog> {
  'use cache'
  cacheTag(TAGS.catalog)
  cacheLife('hours')
  const salonId = await resolveSalonId(db)
  const [categories, services, addons, links, staff, staffServices, schedules] = await Promise.all([
    db
      .select()
      .from(t.serviceCategories)
      .where(and(eq(t.serviceCategories.salonId, salonId), eq(t.serviceCategories.isActive, true)))
      .orderBy(asc(t.serviceCategories.sortOrder)),
    db
      .select()
      .from(t.services)
      .where(and(eq(t.services.salonId, salonId), eq(t.services.isActive, true)))
      .orderBy(asc(t.services.sortOrder)),
    db
      .select()
      .from(t.serviceAddons)
      .where(and(eq(t.serviceAddons.salonId, salonId), eq(t.serviceAddons.isActive, true)))
      .orderBy(asc(t.serviceAddons.sortOrder)),
    db
      .select({ serviceId: t.serviceAddonLinks.serviceId, addonId: t.serviceAddonLinks.addonId })
      .from(t.serviceAddonLinks)
      .innerJoin(t.services, eq(t.services.id, t.serviceAddonLinks.serviceId))
      .where(eq(t.services.salonId, salonId)),
    db
      .select()
      .from(t.staff)
      .where(and(eq(t.staff.salonId, salonId), eq(t.staff.isActive, true)))
      .orderBy(asc(t.staff.sortOrder)),
    db
      .select({ staffId: t.staffServices.staffId, serviceId: t.staffServices.serviceId })
      .from(t.staffServices)
      .innerJoin(t.staff, eq(t.staff.id, t.staffServices.staffId))
      .where(eq(t.staff.salonId, salonId)),
    db
      .select({
        staffId: t.staffSchedules.staffId,
        weekday: t.staffSchedules.weekday,
        isWorking: t.staffSchedules.isWorking,
        startsAt: t.staffSchedules.startsAt,
        endsAt: t.staffSchedules.endsAt,
      })
      .from(t.staffSchedules)
      .innerJoin(t.staff, eq(t.staff.id, t.staffSchedules.staffId))
      .where(eq(t.staff.salonId, salonId)),
  ])
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const addonIds = new Set(addons.map((a) => a.id))
  const activeStaff = new Set(staff.map((s) => s.id))
  const publicServices: PublicService[] = services
    .filter((s) => categoryById.has(s.categoryId))
    .map((s) => {
      const c = categoryById.get(s.categoryId)!
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        categoryId: c.id,
        categorySlug: c.slug,
        categoryName: c.name,
        shortDescription: s.shortDescription,
        description: s.description,
        durationMinutes: s.durationMinutes,
        price: s.price,
        priceType: s.priceType,
        bufferMinutes: s.bufferMinutes,
        imageUrl: s.imageUrl,
        imageAlt: s.imageAlt,
        isFeatured: s.isFeatured,
        onlineBookable: s.onlineBookable,
        addonIds: links.filter((l) => l.serviceId === s.id && addonIds.has(l.addonId)).map((l) => l.addonId),
        staffIds: staffServices.filter((r) => r.serviceId === s.id && activeStaff.has(r.staffId)).map((r) => r.staffId),
      }
    })
  const serviceIds = new Set(publicServices.map((s) => s.id))
  return {
    categories: categories.map((c) => {
      const own = publicServices.filter((s) => s.categoryId === c.id)
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        imageUrl: c.imageUrl,
        serviceCount: own.length,
        minPrice: own.length ? Math.min(...own.map((s) => s.price)) : 0,
      }
    }),
    services: publicServices,
    addons: addons.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      description: a.description,
      price: a.price,
      priceType: a.priceType,
      durationMinutes: a.durationMinutes,
    })),
    staff: staff.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      displayName: s.displayName,
      title: s.title,
      bio: s.bio,
      experienceYears: s.experienceYears,
      experienceText: s.experienceText,
      specialties: s.specialties,
      photoUrl: s.photoUrl,
      photoAlt: s.photoAlt,
      coverUrl: s.coverUrl,
      acceptsOnlineBookings: s.acceptsOnlineBookings,
      serviceIds: staffServices
        .filter((r) => r.staffId === s.id && serviceIds.has(r.serviceId))
        .map((r) => r.serviceId),
      workDays: schedules
        .filter((r) => r.staffId === s.id && r.isWorking)
        .map((r) => ({ weekday: r.weekday, startsAt: r.startsAt, endsAt: r.endsAt }))
        .sort((a, b) => a.weekday - b.weekday),
    })),
  }
}

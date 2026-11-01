'use server'

import { and, eq, gt, inArray, lt } from 'drizzle-orm'
import { z } from 'zod'
import { SLOT_HOLDING_STATUSES } from '@/lib/booking/status'
import { dayBounds, formatDateTime, minutesToTime } from '@/lib/datetime'
import { dateKey, id, minuteOfDay, optionalText } from '@/lib/validation/common'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'
import { TAGS } from '@/server/queries/public'
import { cloudinaryConfigured, uploadImage } from '@/server/storage/cloudinary'
import { audit, runAdminAction, safeParse } from './admin-run'

async function ownStaff(ctx: { db: typeof import('@/server/db').db; salonId: string }, staffId: string) {
  const [row] = await ctx.db
    .select()
    .from(t.staff)
    .where(and(eq(t.staff.id, staffId), eq(t.staff.salonId, ctx.salonId)))
  if (!row) throw new ServiceError('not_found', 'Ажилтан олдсонгүй.')
  return row
}

const profileSchema = z.object({
  id: id.nullable(),
  name: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(60),
  title: z.string().trim().min(2).max(100),
  bio: z.string().trim().max(1500).default(''),
  experienceYears: z.number().int().min(0).max(60),
  experienceText: z.string().trim().max(300).default(''),
  specialties: z.array(z.string().trim().min(1).max(40)).max(8),
  calendarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: 'Өнгө #RRGGBB хэлбэртэй.' }),
  isActive: z.boolean(),
  acceptsOnlineBookings: z.boolean(),
})

export async function saveStaffProfileAction(input: unknown) {
  const p = safeParse(profileSchema, input)
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'staff.manage',
    async (ctx) => {
      const values = {
        name: v.name,
        displayName: v.displayName,
        title: v.title,
        bio: v.bio,
        experienceYears: v.experienceYears,
        experienceText: v.experienceText,
        specialties: v.specialties,
        calendarColor: v.calendarColor,
        isActive: v.isActive,
        acceptsOnlineBookings: v.acceptsOnlineBookings,
        updatedAt: ctx.now,
      }
      if (v.id) {
        const before = await ownStaff(ctx, v.id)
        if (before.isActive && !v.isActive) {
          const upcoming = await ctx.db.$count(
            t.appointments,
            and(
              eq(t.appointments.staffId, v.id),
              gt(t.appointments.startsAt, ctx.now),
              inArray(t.appointments.status, ['pending', 'confirmed', 'awaiting_deposit']),
            ),
          )
          if (upcoming)
            throw new ServiceError(
              'has_bookings',
              `${before.displayName} ирэх ${upcoming} захиалгатай. Эхлээд тэдгээрийг шилжүүлэх эсвэл цуцална уу.`,
            )
        }
        await ctx.db.update(t.staff).set(values).where(eq(t.staff.id, v.id))
        await audit(ctx, {
          action: 'staff.update',
          entity: 'staff',
          entityId: v.id,
          summary: `${v.displayName} мастерын мэдээлэл шинэчлэв${before.isActive !== v.isActive ? (v.isActive ? ' (идэвхжүүлэв)' : ' (идэвхгүй болгов)') : ''}`,
        })
        return { id: v.id }
      }
      const slug = `${v.displayName.toLowerCase().replace(/[^a-zа-яөү0-9]+/gi, '-')}-${Math.floor(Math.random() * 900 + 100)}`
      const [row] = await ctx.db
        .insert(t.staff)
        .values({ ...values, salonId: ctx.salonId, slug, sortOrder: 99 })
        .returning({ id: t.staff.id })
      await ctx.db.insert(t.staffSchedules).values(
        [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          staffId: row.id,
          weekday,
          isWorking: weekday !== 1,
          startsAt: 600,
          endsAt: 1140,
        })),
      )
      await audit(ctx, {
        action: 'staff.create',
        entity: 'staff',
        entityId: row.id,
        summary: `Шинэ ажилтан: ${v.displayName}`,
      })
      return { id: row.id }
    },
    { tags: [TAGS.catalog] },
  )
}

const skillsSchema = z.object({
  staffId: id,
  skills: z.array(z.object({ skillId: id, level: z.enum(['standard', 'senior']) })).max(20),
  serviceIds: z.array(id).max(60),
})

export async function saveStaffSkillsAction(input: unknown) {
  const p = safeParse(skillsSchema, input)
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'staff.manage',
    async (ctx) => {
      const staff = await ownStaff(ctx, v.staffId)
      const required = v.serviceIds.length
        ? await ctx.db.select().from(t.serviceSkills).where(inArray(t.serviceSkills.serviceId, v.serviceIds))
        : []
      const held = new Set(v.skills.map((s) => s.skillId))
      const missing = [...new Set(required.filter((r) => !held.has(r.skillId)).map((r) => r.serviceId))]
      if (missing.length) {
        const names = await ctx.db
          .select({ name: t.services.name })
          .from(t.services)
          .where(inArray(t.services.id, missing))
        throw new ServiceError(
          'skills',
          `Ур чадвар дутуу тул дараах үйлчилгээг оноох боломжгүй: ${names.map((n) => n.name).join(', ')}.`,
        )
      }
      await ctx.db.delete(t.staffSkills).where(eq(t.staffSkills.staffId, v.staffId))
      if (v.skills.length)
        await ctx.db
          .insert(t.staffSkills)
          .values(v.skills.map((s) => ({ staffId: v.staffId, skillId: s.skillId, level: s.level })))
      await ctx.db.delete(t.staffServices).where(eq(t.staffServices.staffId, v.staffId))
      if (v.serviceIds.length)
        await ctx.db
          .insert(t.staffServices)
          .values(v.serviceIds.map((serviceId) => ({ staffId: v.staffId, serviceId })))
      await audit(ctx, {
        action: 'staff.services',
        entity: 'staff',
        entityId: v.staffId,
        summary: `${staff.displayName}: ${v.skills.length} ур чадвар, ${v.serviceIds.length} үйлчилгээ`,
      })
      return null
    },
    { tags: [TAGS.catalog] },
  )
}

const scheduleSchema = z.object({
  staffId: id,
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        isWorking: z.boolean(),
        startsAt: minuteOfDay,
        endsAt: minuteOfDay,
      }),
    )
    .length(7),
})

export async function saveScheduleAction(input: unknown) {
  const p = safeParse(scheduleSchema, input)
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'staff.manage',
    async (ctx) => {
      const staff = await ownStaff(ctx, v.staffId)
      for (const d of v.days) {
        if (d.isWorking && d.startsAt >= d.endsAt)
          throw new ServiceError('invalid', 'Ажил эхлэх цаг дуусах цагаас өмнө байх ёстой.')
      }
      for (const d of v.days) {
        await ctx.db
          .insert(t.staffSchedules)
          .values({ staffId: v.staffId, ...d })
          .onConflictDoUpdate({
            target: [t.staffSchedules.staffId, t.staffSchedules.weekday],
            set: { isWorking: d.isWorking, startsAt: d.startsAt, endsAt: d.endsAt },
          })
      }
      await audit(ctx, {
        action: 'staff.schedule',
        entity: 'staff',
        entityId: v.staffId,
        summary: `${staff.displayName} мастерын долоо хоногийн хуваарь шинэчлэв (${v.days.filter((d) => d.isWorking).length} ажлын өдөр)`,
      })
      return null
    },
    { tags: [TAGS.catalog] },
  )
}

export async function addBreakAction(input: unknown) {
  const p = safeParse(
    z.object({
      staffId: id,
      weekday: z.number().int().min(1).max(7).nullable(),
      startsAt: minuteOfDay,
      endsAt: minuteOfDay,
      label: z.string().trim().min(1).max(60),
    }),
    input,
  )
  if (!p.ok) return p
  const v = p.data
  return runAdminAction('staff.manage', async (ctx) => {
    await ownStaff(ctx, v.staffId)
    if (v.startsAt >= v.endsAt) throw new ServiceError('invalid', 'Завсарлагын эхлэх цаг дуусахаас өмнө байна.')
    const [row] = await ctx.db.insert(t.staffBreaks).values(v).returning({ id: t.staffBreaks.id })
    return { id: row.id }
  })
}

export async function removeBreakAction(input: unknown) {
  const p = safeParse(z.object({ breakId: id }), input)
  if (!p.ok) return p
  return runAdminAction('staff.manage', async (ctx) => {
    const [row] = await ctx.db
      .select({ staffId: t.staffBreaks.staffId })
      .from(t.staffBreaks)
      .where(eq(t.staffBreaks.id, p.data.breakId))
    if (!row) throw new ServiceError('not_found', 'Завсарлага олдсонгүй.')
    await ownStaff(ctx, row.staffId)
    await ctx.db.delete(t.staffBreaks).where(eq(t.staffBreaks.id, p.data.breakId))
    return null
  })
}

export async function addTimeOffAction(input: unknown) {
  const p = safeParse(
    z.object({
      staffId: id,
      from: dateKey,
      to: dateKey,
      startTime: minuteOfDay.nullable(),
      endTime: minuteOfDay.nullable(),
      kind: z.enum(['day_off', 'vacation', 'sick', 'training', 'other']),
      note: optionalText(200),
    }),
    input,
  )
  if (!p.ok) return p
  const v = p.data
  return runAdminAction('staff.manage', async (ctx) => {
    const staff = await ownStaff(ctx, v.staffId)
    if (v.to < v.from) throw new ServiceError('invalid', 'Дуусах өдөр эхлэхээс өмнө байна.')
    const startsAt =
      v.startTime !== null
        ? new Date(dayBounds(v.from).start.getTime() + v.startTime * 60_000)
        : dayBounds(v.from).start
    const endsAt =
      v.endTime !== null ? new Date(dayBounds(v.to).start.getTime() + v.endTime * 60_000) : dayBounds(v.to).end
    if (startsAt >= endsAt) throw new ServiceError('invalid', 'Хугацаа буруу байна.')
    await ctx.db
      .insert(t.staffTimeOff)
      .values({ staffId: v.staffId, startsAt, endsAt, kind: v.kind, note: v.note, createdAt: ctx.now })
    const clashes = await ctx.db
      .select({ reference: t.appointments.reference, startsAt: t.appointments.startsAt })
      .from(t.appointments)
      .where(
        and(
          eq(t.appointments.staffId, v.staffId),
          lt(t.appointments.startsAt, endsAt),
          gt(t.appointments.endsAt, startsAt),
          inArray(t.appointments.status, [...SLOT_HOLDING_STATUSES]),
        ),
      )
    await audit(ctx, {
      action: 'staff.time_off',
      entity: 'staff',
      entityId: v.staffId,
      summary: `${staff.displayName}: чөлөө ${v.from}${v.to !== v.from ? ` – ${v.to}` : ''}${v.startTime !== null ? ` ${minutesToTime(v.startTime)}-аас` : ''}`,
    })
    return {
      clashes: clashes.map((c) => `${c.reference} (${formatDateTime(c.startsAt)})`),
    }
  })
}

export async function removeTimeOffAction(input: unknown) {
  const p = safeParse(z.object({ timeOffId: id }), input)
  if (!p.ok) return p
  return runAdminAction('staff.manage', async (ctx) => {
    const [row] = await ctx.db
      .select({ staffId: t.staffTimeOff.staffId })
      .from(t.staffTimeOff)
      .where(eq(t.staffTimeOff.id, p.data.timeOffId))
    if (!row) throw new ServiceError('not_found', 'Чөлөө олдсонгүй.')
    await ownStaff(ctx, row.staffId)
    await ctx.db.delete(t.staffTimeOff).where(eq(t.staffTimeOff.id, p.data.timeOffId))
    return null
  })
}

export async function uploadStaffPhotoAction(input: unknown) {
  const p = safeParse(
    z.object({ staffId: id, dataUrl: z.string().max(6_000_000), kind: z.enum(['photo', 'cover']) }),
    input,
  )
  if (!p.ok) return p
  return runAdminAction(
    'staff.manage',
    async (ctx) => {
      await ownStaff(ctx, p.data.staffId)
      if (ctx.actor.isDemo)
        return { url: null as string | null, note: 'Демо горимд зураг Cloudinary руу илгээгдэхгүй.' }
      if (!cloudinaryConfigured()) throw new ServiceError('storage', 'Зургийн сан (Cloudinary) тохируулагдаагүй.')
      const { url } = await uploadImage(p.data.dataUrl, 'suvd-salon/staff')
      await ctx.db
        .update(t.staff)
        .set(p.data.kind === 'photo' ? { photoUrl: url, updatedAt: ctx.now } : { coverUrl: url, updatedAt: ctx.now })
        .where(eq(t.staff.id, p.data.staffId))
      return { url, note: null }
    },
    { tags: [TAGS.catalog] },
  )
}

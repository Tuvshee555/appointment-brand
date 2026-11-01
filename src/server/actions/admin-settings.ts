'use server'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { formatMoney } from '@/lib/money'
import { dateKey, id, minuteOfDay, optionalEmail, optionalText } from '@/lib/validation/common'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'
import { TAGS } from '@/server/queries/public'
import { deleteDemoData, seedDemo } from '@/server/seed/demo'
import { audit, runAdminAction, safeParse } from './admin-run'

const infoSchema = z.object({
  name: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(160),
  about: z.string().trim().max(3000),
  announcement: optionalText(200),
  phone: z.string().trim().min(6).max(32),
  email: optionalEmail,
  addressLine: z.string().trim().min(3).max(200),
  addressNote: optionalText(200),
  mapUrl: optionalText(500),
  instagram: optionalText(100),
  facebook: optionalText(100),
})

export async function saveSalonInfoAction(input: unknown) {
  const p = safeParse(infoSchema, input)
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'settings.manage',
    async (ctx) => {
      await ctx.db.update(t.salons).set({ name: v.name, updatedAt: ctx.now }).where(eq(t.salons.id, ctx.salonId))
      await ctx.db
        .update(t.businessSettings)
        .set({
          tagline: v.tagline,
          about: v.about,
          announcement: v.announcement,
          phone: v.phone.replace(/\s/g, ''),
          email: v.email,
          addressLine: v.addressLine,
          addressNote: v.addressNote,
          mapUrl: v.mapUrl,
          instagram: v.instagram,
          facebook: v.facebook,
          updatedAt: ctx.now,
        })
        .where(eq(t.businessSettings.salonId, ctx.salonId))
      await audit(ctx, { action: 'settings.info', entity: 'settings', summary: 'Салоны мэдээлэл шинэчлэв' })
      return null
    },
    { tags: [TAGS.salon, TAGS.catalog] },
  )
}

const hoursSchema = z.object({
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        isClosed: z.boolean(),
        opensAt: minuteOfDay,
        closesAt: minuteOfDay,
      }),
    )
    .length(7),
})

export async function saveHoursAction(input: unknown) {
  const p = safeParse(hoursSchema, input)
  if (!p.ok) return p
  return runAdminAction(
    'settings.manage',
    async (ctx) => {
      for (const d of p.data.days) {
        if (!d.isClosed && d.opensAt >= d.closesAt)
          throw new ServiceError('invalid', 'Нээх цаг хаах цагаас өмнө байх ёстой.')
        await ctx.db
          .insert(t.openingHours)
          .values({ salonId: ctx.salonId, ...d })
          .onConflictDoUpdate({
            target: [t.openingHours.salonId, t.openingHours.weekday],
            set: { isClosed: d.isClosed, opensAt: d.opensAt, closesAt: d.closesAt },
          })
      }
      await audit(ctx, { action: 'settings.hours', entity: 'settings', summary: 'Салоны ажлын цаг шинэчлэв' })
      return null
    },
    { tags: [TAGS.salon] },
  )
}

export async function addSpecialDayAction(input: unknown) {
  const p = safeParse(
    z.object({
      date: dateKey,
      kind: z.enum(['closed', 'special_hours']),
      opensAt: minuteOfDay.nullable(),
      closesAt: minuteOfDay.nullable(),
      label: z.string().trim().min(2).max(120),
    }),
    input,
  )
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'settings.manage',
    async (ctx) => {
      if (v.kind === 'special_hours' && (v.opensAt === null || v.closesAt === null || v.opensAt >= v.closesAt)) {
        throw new ServiceError('invalid', 'Онцгой цагийн нээх, хаах цагийг зөв оруулна уу.')
      }
      await ctx.db
        .insert(t.specialDays)
        .values({
          salonId: ctx.salonId,
          date: v.date,
          kind: v.kind,
          opensAt: v.kind === 'closed' ? null : v.opensAt,
          closesAt: v.kind === 'closed' ? null : v.closesAt,
          label: v.label,
        })
        .onConflictDoUpdate({
          target: [t.specialDays.salonId, t.specialDays.date],
          set: {
            kind: v.kind,
            opensAt: v.kind === 'closed' ? null : v.opensAt,
            closesAt: v.kind === 'closed' ? null : v.closesAt,
            label: v.label,
          },
        })
      await audit(ctx, {
        action: 'settings.special_day',
        entity: 'settings',
        summary: `Онцгой өдөр ${v.date}: ${v.label}`,
      })
      return null
    },
    { tags: [TAGS.salon] },
  )
}

export async function removeSpecialDayAction(input: unknown) {
  const p = safeParse(z.object({ id }), input)
  if (!p.ok) return p
  return runAdminAction(
    'settings.manage',
    async (ctx) => {
      await ctx.db
        .delete(t.specialDays)
        .where(and(eq(t.specialDays.id, p.data.id), eq(t.specialDays.salonId, ctx.salonId)))
      return null
    },
    { tags: [TAGS.salon] },
  )
}

const rulesSchema = z.object({
  slotIntervalMinutes: z.union([
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(30),
    z.literal(60),
  ]),
  minAdvanceMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60),
  maxAdvanceDays: z.number().int().min(1).max(365),
  defaultBufferMinutes: z.number().int().min(0).max(120),
  maxServicesPerBooking: z.number().int().min(1).max(4),
  cancellationNoticeHours: z.number().int().min(0).max(168),
  rescheduleNoticeHours: z.number().int().min(0).max(168),
  confirmationMode: z.enum(['auto', 'manual']),
  depositMode: z.enum(['none', 'fixed', 'percent']),
  depositFixedAmount: z.number().int().min(0).max(5_000_000),
  depositPercentBps: z.number().int().min(0).max(10_000),
  depositMinTotal: z.number().int().min(0).max(50_000_000),
  holdMinutes: z.number().int().min(5).max(240),
  lateArrivalMinutes: z.number().int().min(0).max(120),
  reminderHoursBefore: z.number().int().min(1).max(72),
  cancellationPolicy: z.string().trim().max(3000),
  depositPolicy: z.string().trim().max(3000),
})

export async function saveRulesAction(input: unknown) {
  const p = safeParse(rulesSchema, input)
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'settings.manage',
    async (ctx) => {
      const [before] = await ctx.db.select().from(t.businessSettings).where(eq(t.businessSettings.salonId, ctx.salonId))
      await ctx.db
        .update(t.businessSettings)
        .set({ ...v, updatedAt: ctx.now })
        .where(eq(t.businessSettings.salonId, ctx.salonId))
      const changes: string[] = []
      if (
        before.depositMode !== v.depositMode ||
        before.depositFixedAmount !== v.depositFixedAmount ||
        before.depositMinTotal !== v.depositMinTotal
      ) {
        changes.push(
          `урьдчилгаа: ${v.depositMode === 'none' ? 'авахгүй' : v.depositMode === 'fixed' ? formatMoney(v.depositFixedAmount) : `${v.depositPercentBps / 100}%`} (${formatMoney(v.depositMinTotal)}-өөс дээш)`,
        )
      }
      if (before.confirmationMode !== v.confirmationMode)
        changes.push(v.confirmationMode === 'auto' ? 'шууд баталгаажна' : 'салон баталгаажуулна')
      await audit(ctx, {
        action: 'settings.rules',
        entity: 'settings',
        summary: `Захиалгын дүрэм шинэчлэв${changes.length ? `: ${changes.join('; ')}` : ''}`,
      })
      return null
    },
    { tags: [TAGS.salon] },
  )
}

/** Deletes and regenerates sample data (demo salon only, is_demo rows only). */
export async function resetDemoAction() {
  return runAdminAction('demo.reset', async (ctx) => {
    const [salon] = await ctx.db.select().from(t.salons).where(eq(t.salons.id, ctx.salonId))
    if (!salon?.isDemo || process.env.DEMO_MODE !== 'true')
      throw new ServiceError('not_demo', 'Энэ салон демо биш тул өгөгдлийг шинэчлэх боломжгүй.')
    await deleteDemoData(ctx.db, ctx.salonId)
    const summary = await seedDemo(ctx.db, { salonId: ctx.salonId, now: ctx.now, force: true })
    await audit(ctx, {
      action: 'demo.reset',
      entity: 'salon',
      summary: 'Демо өгөгдлийг өнөөдрөөр шинэчлэв',
      detail: { demo: false },
    })
    return { summary }
  })
}

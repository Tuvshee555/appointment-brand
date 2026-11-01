'use server'

import { and, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { formatMoney } from '@/lib/money'
import { id, optionalText } from '@/lib/validation/common'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'
import { TAGS } from '@/server/queries/public'
import { cloudinaryConfigured, uploadImage } from '@/server/storage/cloudinary'
import { audit, runAdminAction, safeParse } from './admin-run'

function slugify(name: string) {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'j',
    з: 'z',
    и: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    ө: 'u',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ү: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sh',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }
  return (
    name
      .toLowerCase()
      .split('')
      .map((c) => map[c] ?? c)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'service'
  )
}

const serviceSchema = z.object({
  id: id.nullable(),
  name: z.string().trim().min(2, { error: 'Нэр оруулна уу.' }).max(120),
  categoryId: id,
  shortDescription: z.string().trim().max(220).default(''),
  description: z.string().trim().max(2000).default(''),
  durationMinutes: z
    .number()
    .int()
    .min(5, { error: 'Хамгийн багадаа 5 минут.' })
    .max(600, { error: 'Хамгийн ихдээ 600 минут.' }),
  price: z.number().int().min(0, { error: 'Үнэ сөрөг байж болохгүй.' }).max(10_000_000),
  priceType: z.enum(['fixed', 'from']),
  bufferMinutes: z.number().int().min(0).max(120).nullable(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  onlineBookable: z.boolean(),
  addonIds: z.array(id).max(20),
  skillIds: z.array(id).max(10),
  staffIds: z.array(id).max(30),
})

export async function saveServiceAction(input: unknown) {
  const p = safeParse(serviceSchema, input)
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'services.manage',
    async (ctx) => {
      const [category] = await ctx.db
        .select()
        .from(t.serviceCategories)
        .where(and(eq(t.serviceCategories.id, v.categoryId), eq(t.serviceCategories.salonId, ctx.salonId)))
      if (!category) throw new ServiceError('invalid', 'Ангилал олдсонгүй.')
      // Specialists must hold every required skill.
      if (v.staffIds.length && v.skillIds.length) {
        const held = await ctx.db.select().from(t.staffSkills).where(inArray(t.staffSkills.staffId, v.staffIds))
        const staffRows = await ctx.db
          .select({ id: t.staff.id, name: t.staff.displayName })
          .from(t.staff)
          .where(inArray(t.staff.id, v.staffIds))
        const missing = staffRows.filter((s) =>
          v.skillIds.some((sk) => !held.some((h) => h.staffId === s.id && h.skillId === sk)),
        )
        if (missing.length) {
          throw new ServiceError(
            'skills',
            `${missing.map((m) => m.name).join(', ')} шаардлагатай ур чадваргүй тул энэ үйлчилгээг хуваарилах боломжгүй.`,
          )
        }
      }
      let serviceId = v.id
      const values = {
        name: v.name,
        categoryId: v.categoryId,
        shortDescription: v.shortDescription,
        description: v.description,
        durationMinutes: v.durationMinutes,
        price: v.price,
        priceType: v.priceType,
        bufferMinutes: v.bufferMinutes,
        isActive: v.isActive,
        isFeatured: v.isFeatured,
        onlineBookable: v.onlineBookable,
        updatedAt: ctx.now,
      }
      if (serviceId) {
        const [before] = await ctx.db
          .select()
          .from(t.services)
          .where(and(eq(t.services.id, serviceId), eq(t.services.salonId, ctx.salonId)))
        if (!before) throw new ServiceError('not_found', 'Үйлчилгээ олдсонгүй.')
        await ctx.db.update(t.services).set(values).where(eq(t.services.id, serviceId))
        if (before.price !== v.price || before.durationMinutes !== v.durationMinutes) {
          await audit(ctx, {
            action: 'service.price',
            entity: 'service',
            entityId: serviceId,
            summary: `${v.name}: ${formatMoney(before.price)} → ${formatMoney(v.price)}, ${before.durationMinutes} → ${v.durationMinutes} мин. Өмнөх захиалгууд хуучин үнээрээ хадгалагдана.`,
            detail: {
              before: { price: before.price, duration: before.durationMinutes },
              after: { price: v.price, duration: v.durationMinutes },
            },
          })
        }
      } else {
        let slug = slugify(v.name)
        const taken = await ctx.db
          .select({ slug: t.services.slug })
          .from(t.services)
          .where(eq(t.services.salonId, ctx.salonId))
        while (taken.some((s) => s.slug === slug)) slug = `${slug}-${Math.floor(Math.random() * 90 + 10)}`
        const [row] = await ctx.db
          .insert(t.services)
          .values({ ...values, salonId: ctx.salonId, slug, sortOrder: 99 })
          .returning({ id: t.services.id })
        serviceId = row.id
        await audit(ctx, {
          action: 'service.create',
          entity: 'service',
          entityId: serviceId,
          summary: `Шинэ үйлчилгээ: ${v.name} (${formatMoney(v.price)})`,
        })
      }
      await ctx.db.delete(t.serviceAddonLinks).where(eq(t.serviceAddonLinks.serviceId, serviceId))
      if (v.addonIds.length)
        await ctx.db
          .insert(t.serviceAddonLinks)
          .values(v.addonIds.map((addonId) => ({ serviceId: serviceId!, addonId })))
      await ctx.db.delete(t.serviceSkills).where(eq(t.serviceSkills.serviceId, serviceId))
      if (v.skillIds.length)
        await ctx.db.insert(t.serviceSkills).values(v.skillIds.map((skillId) => ({ serviceId: serviceId!, skillId })))
      await ctx.db.delete(t.staffServices).where(eq(t.staffServices.serviceId, serviceId))
      if (v.staffIds.length)
        await ctx.db.insert(t.staffServices).values(v.staffIds.map((staffId) => ({ staffId, serviceId: serviceId! })))
      return { id: serviceId }
    },
    { tags: [TAGS.catalog] },
  )
}

export async function toggleServiceAction(input: unknown) {
  const p = safeParse(z.object({ id, field: z.enum(['isActive', 'isFeatured']), value: z.boolean() }), input)
  if (!p.ok) return p
  return runAdminAction(
    'services.manage',
    async (ctx) => {
      const rows = await ctx.db
        .update(t.services)
        .set({ [p.data.field]: p.data.value, updatedAt: ctx.now })
        .where(and(eq(t.services.id, p.data.id), eq(t.services.salonId, ctx.salonId)))
        .returning({ name: t.services.name })
      if (!rows.length) throw new ServiceError('not_found', 'Үйлчилгээ олдсонгүй.')
      await audit(ctx, {
        action: 'service.toggle',
        entity: 'service',
        entityId: p.data.id,
        summary: `${rows[0].name}: ${p.data.field === 'isActive' ? (p.data.value ? 'идэвхжүүлэв' : 'идэвхгүй болгов') : p.data.value ? 'онцолсон' : 'онцлохоо болив'}`,
      })
      return null
    },
    { tags: [TAGS.catalog] },
  )
}

export async function uploadServiceImageAction(input: unknown) {
  const p = safeParse(z.object({ id, dataUrl: z.string().max(6_000_000), alt: optionalText(200) }), input)
  if (!p.ok) return p
  return runAdminAction(
    'services.manage',
    async (ctx) => {
      if (ctx.actor.isDemo)
        return { url: null as string | null, note: 'Демо горимд зураг Cloudinary руу илгээгдэхгүй.' }
      if (!cloudinaryConfigured()) throw new ServiceError('storage', 'Зургийн сан (Cloudinary) тохируулагдаагүй.')
      const { url } = await uploadImage(p.data.dataUrl, 'suvd-salon/services')
      await ctx.db
        .update(t.services)
        .set({ imageUrl: url, imageAlt: p.data.alt, updatedAt: ctx.now })
        .where(and(eq(t.services.id, p.data.id), eq(t.services.salonId, ctx.salonId)))
      return { url, note: null }
    },
    { tags: [TAGS.catalog] },
  )
}

const addonSchema = z.object({
  id: id.nullable(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).default(''),
  price: z.number().int().min(0).max(5_000_000),
  priceType: z.enum(['fixed', 'from']),
  durationMinutes: z.number().int().min(0).max(240),
  isActive: z.boolean(),
})

export async function saveAddonAction(input: unknown) {
  const p = safeParse(addonSchema, input)
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'services.manage',
    async (ctx) => {
      if (v.id) {
        const rows = await ctx.db
          .update(t.serviceAddons)
          .set({
            name: v.name,
            description: v.description,
            price: v.price,
            priceType: v.priceType,
            durationMinutes: v.durationMinutes,
            isActive: v.isActive,
            updatedAt: ctx.now,
          })
          .where(and(eq(t.serviceAddons.id, v.id), eq(t.serviceAddons.salonId, ctx.salonId)))
          .returning({ id: t.serviceAddons.id })
        if (!rows.length) throw new ServiceError('not_found', 'Нэмэлт олдсонгүй.')
        await audit(ctx, {
          action: 'addon.update',
          entity: 'addon',
          entityId: v.id,
          summary: `Нэмэлт «${v.name}»: ${formatMoney(v.price)}, ${v.durationMinutes} мин`,
        })
        return { id: v.id }
      }
      let slug = slugify(v.name)
      const taken = await ctx.db
        .select({ slug: t.serviceAddons.slug })
        .from(t.serviceAddons)
        .where(eq(t.serviceAddons.salonId, ctx.salonId))
      while (taken.some((s) => s.slug === slug)) slug = `${slug}-${Math.floor(Math.random() * 90 + 10)}`
      const [row] = await ctx.db
        .insert(t.serviceAddons)
        .values({
          salonId: ctx.salonId,
          slug,
          name: v.name,
          description: v.description,
          price: v.price,
          priceType: v.priceType,
          durationMinutes: v.durationMinutes,
          isActive: v.isActive,
          sortOrder: 99,
        })
        .returning({ id: t.serviceAddons.id })
      return { id: row.id }
    },
    { tags: [TAGS.catalog] },
  )
}

export async function saveCategoryAction(input: unknown) {
  const p = safeParse(
    z.object({
      id: id.nullable(),
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(300).default(''),
      isActive: z.boolean(),
    }),
    input,
  )
  if (!p.ok) return p
  const v = p.data
  return runAdminAction(
    'services.manage',
    async (ctx) => {
      if (v.id) {
        if (!v.isActive) {
          const active = await ctx.db.$count(
            t.services,
            and(eq(t.services.categoryId, v.id), eq(t.services.isActive, true)),
          )
          if (active)
            throw new ServiceError(
              'in_use',
              `Энэ ангилалд ${active} идэвхтэй үйлчилгээ байна. Эхлээд тэдгээрийг идэвхгүй болгох эсвэл шилжүүлнэ үү.`,
            )
        }
        await ctx.db
          .update(t.serviceCategories)
          .set({ name: v.name, description: v.description, isActive: v.isActive, updatedAt: ctx.now })
          .where(and(eq(t.serviceCategories.id, v.id), eq(t.serviceCategories.salonId, ctx.salonId)))
        return { id: v.id }
      }
      let slug = slugify(v.name)
      const taken = await ctx.db
        .select({ slug: t.serviceCategories.slug })
        .from(t.serviceCategories)
        .where(and(eq(t.serviceCategories.salonId, ctx.salonId), ne(t.serviceCategories.slug, '')))
      while (taken.some((s) => s.slug === slug)) slug = `${slug}-${Math.floor(Math.random() * 90 + 10)}`
      const [row] = await ctx.db
        .insert(t.serviceCategories)
        .values({
          salonId: ctx.salonId,
          slug,
          name: v.name,
          description: v.description,
          isActive: v.isActive,
          sortOrder: 99,
        })
        .returning({ id: t.serviceCategories.id })
      return { id: row.id }
    },
    { tags: [TAGS.catalog] },
  )
}

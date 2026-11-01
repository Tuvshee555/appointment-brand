import { z } from 'zod'
import { dateKey, id, minuteOfDay, optionalEmail, optionalText, personName, phone } from './common'

export const selectionItems = z
  .array(z.object({ serviceId: id, addonIds: z.array(id).max(6).default([]) }), { error: 'Үйлчилгээ сонгоно уу.' })
  .min(1, { error: 'Дор хаяж нэг үйлчилгээ сонгоно уу.' })
  .max(4, { error: 'Нэг захиалгад хамгийн ихдээ 4 үйлчилгээ сонгоно.' })

/** Staff id, or null for "any available specialist". */
export const staffChoice = id.nullable()

export const availabilityMonthSchema = z.object({
  items: selectionItems,
  staffId: staffChoice,
  month: z.string().regex(/^\d{4}-\d{2}$/, { error: 'Сар буруу байна.' }),
})

export const availabilityDaySchema = z.object({
  items: selectionItems,
  staffId: staffChoice,
  date: dateKey,
})

export const customerDetailsSchema = z.object({
  name: personName,
  phone,
  email: optionalEmail,
  note: optionalText(500),
  preferences: optionalText(300),
})

export const createBookingSchema = z.object({
  items: selectionItems,
  staffId: staffChoice,
  date: dateKey,
  start: minuteOfDay,
  customer: customerDetailsSchema,
})

export type CreateBookingInput = z.input<typeof createBookingSchema>

export const bookingLookupSchema = z.object({
  reference: z
    .string({ error: 'Захиалгын дугаараа оруулна уу.' })
    .trim()
    .toUpperCase()
    .regex(/^SV-[A-Z0-9]{6}$/, { error: 'Захиалгын дугаар SV-XXXXXX хэлбэртэй.' }),
  phone,
})

export const customerCancelSchema = z.object({
  reason: optionalText(300),
})

export const rescheduleSchema = z.object({
  date: dateKey,
  start: minuteOfDay,
  staffId: staffChoice,
})

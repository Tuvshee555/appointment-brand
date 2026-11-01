import { z } from 'zod'
import './mn-errors'
import { isDateKey } from '@/lib/datetime'
import { normalizePhone } from '@/lib/phone'

export const id = z.guid({ error: 'Буруу дугаар.' })

export const phone = z
  .string({ error: 'Утасны дугаараа оруулна уу.' })
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v)
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Утасны дугаар 8 оронтой байх ёстой. Жишээ: 9911 2233' })
      return z.NEVER
    }
    return n
  })

export const personName = z
  .string({ error: 'Нэрээ оруулна уу.' })
  .trim()
  .min(2, { error: 'Нэрээ бүтэн оруулна уу.' })
  .max(80, { error: 'Нэр хэт урт байна.' })

const emailFormat = z.email()
export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: 'И-мэйл хаяг хэт урт байна.' })
  .refine((v) => v === '' || emailFormat.safeParse(v).success, { error: 'И-мэйл хаяг буруу байна.' })
  .nullish()
  .transform((v) => (v ? v : null))

export const password = z
  .string({ error: 'Нууц үгээ оруулна уу.' })
  .min(8, { error: 'Нууц үг хамгийн багадаа 8 тэмдэгт байна.' })
  .max(128, { error: 'Нууц үг хэт урт байна.' })

export const dateKey = z.string({ error: 'Өдөр сонгоно уу.' }).refine(isDateKey, { error: 'Огноо буруу байна.' })

/** Minutes from local midnight. */
export const minuteOfDay = z.number({ error: 'Цаг сонгоно уу.' }).int().min(0).max(1440)

export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: `Хамгийн ихдээ ${max} тэмдэгт.` })
    .nullish()
    .transform((v) => (v ? v : null))
}

export const money = z.number({ error: 'Дүн оруулна уу.' }).int({ error: 'Бүхэл тоо оруулна уу.' })
export const nonNegativeMoney = money.min(0, { error: 'Дүн сөрөг байж болохгүй.' }).max(100_000_000)

/** Reads a FormData field as a trimmed string ('' when missing). */
export function formString(fd: FormData, key: string): string {
  const v = fd.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

export function formBool(fd: FormData, key: string): boolean {
  const v = fd.get(key)
  return v === 'on' || v === 'true' || v === '1'
}

export function formInt(fd: FormData, key: string): number | null {
  const v = formString(fd, key).replace(/[\s,₮]/g, '')
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** "10:30" form field -> 630, or null. */
export function formTime(fd: FormData, key: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(formString(fd, key))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 24 && min < 60 ? h * 60 + min : null
}

/** First error message per field, for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

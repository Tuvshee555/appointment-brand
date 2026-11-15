// Validation of chat requests (website route and the admin «Try it» chat).
import { z } from 'zod'

const id = z.guid()
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const chatActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello') }),
  z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('human') }),
  z.object({ type: z.literal('pick_service'), serviceId: id }),
  z.object({ type: z.literal('pick_staff'), staffId: id.nullable() }),
  z.object({ type: z.literal('pick_date'), date: dateKey }),
  z.object({ type: z.literal('choose_slot'), date: dateKey, start: z.number().int().min(0).max(1440) }),
  z.object({ type: z.literal('confirm_draft'), draftId: id }),
  z.object({ type: z.literal('cancel_draft'), draftId: id }),
  z.object({ type: z.literal('confirm_change'), draftId: id }),
  z.object({ type: z.literal('cancel_change'), draftId: id }),
  z.object({ type: z.literal('pick_booking'), reference: z.string().regex(/^SV-[A-Z0-9]{6}$/) }),
])

const clientMessageId = z
  .string()
  .regex(/^[\w:.-]{1,80}$/)
  .optional()

export const chatRequestSchema = z.union([
  z.object({ message: z.string().trim().min(1).max(500), clientMessageId }),
  z.object({ action: chatActionSchema }),
])

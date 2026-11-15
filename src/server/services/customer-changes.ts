// What a customer may change on their own booking, shared by the «Миний захиалга» page and the
// assistant so both apply exactly the same rules.
import { and, asc, eq } from 'drizzle-orm'
import { hoursUntil } from '@/lib/datetime'
import * as t from '@/server/db/schema'
import { ERR, ServiceError, type ServiceContext } from '@/server/context'
import { loadSalonConfig } from './salon'

export async function loadSalonAppointment(ctx: ServiceContext, id: string) {
  const [appt] = await ctx.db
    .select()
    .from(t.appointments)
    .where(and(eq(t.appointments.id, id), eq(t.appointments.salonId, ctx.salonId)))
  if (!appt) throw ERR.notFound('Захиалга')
  return appt
}

/** Online cancellation stops once the appointment has started. */
export function assertCustomerCancellable(appt: { startsAt: Date }, now: Date) {
  if (appt.startsAt <= now)
    throw new ServiceError('started', 'Эхэлсэн эсвэл өнгөрсөн цагийг онлайнаар цуцлах боломжгүй. Салон руу залгана уу.')
}

/** The services and specialist of a booking the customer may move online, or a ServiceError. */
export async function customerRescheduleSelection(ctx: ServiceContext, appointmentId: string) {
  const appt = await loadSalonAppointment(ctx, appointmentId)
  const config = await loadSalonConfig(ctx.db, ctx.salonId)
  if (appt.status !== 'pending' && appt.status !== 'confirmed') {
    throw new ServiceError('not_reschedulable', 'Энэ захиалгын цагийг өөрчлөх боломжгүй.')
  }
  if (hoursUntil(appt.startsAt, ctx.now) < config.settings.rescheduleNoticeHours) {
    throw new ServiceError(
      'too_late',
      `Цаг эхлэхээс ${config.settings.rescheduleNoticeHours} цагийн дотор онлайнаар өөрчлөх боломжгүй. Салон руу залгана уу.`,
    )
  }
  const lines = await ctx.db
    .select()
    .from(t.appointmentServices)
    .where(eq(t.appointmentServices.appointmentId, appt.id))
    .orderBy(asc(t.appointmentServices.sortOrder))
  const addons = await ctx.db.select().from(t.appointmentAddons).where(eq(t.appointmentAddons.appointmentId, appt.id))
  const items = lines
    .filter((l) => l.serviceId)
    .map((l) => ({
      serviceId: l.serviceId!,
      addonIds: addons.filter((a) => a.appointmentServiceId === l.id && a.addonId).map((a) => a.addonId!),
    }))
  if (items.length !== lines.length)
    throw new ServiceError('service_removed', 'Үйлчилгээ шинэчлэгдсэн тул салон руу залгаж цагаа өөрчилнө үү.')
  // A customer who chose a specialist keeps them; "any" stays "any".
  const staffId = appt.staffRequested ? appt.staffId : null
  return { appt, items, staffId }
}

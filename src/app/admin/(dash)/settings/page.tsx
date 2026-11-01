import { and, asc, eq, gte } from 'drizzle-orm'
import { connection } from 'next/server'
import { ActionButton } from '@/components/admin/action-button'
import {
  HoursForm,
  RulesForm,
  SalonInfoForm,
  SpecialDaysForm,
  type SettingsData,
} from '@/components/admin/settings-forms'
import { Card, PageHeader } from '@/components/admin/ui'
import { dateKeyOf } from '@/lib/datetime'
import { resetDemoAction } from '@/server/actions/admin-settings'
import { requireAdminPage } from '@/server/auth/current'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { paymentMode } from '@/server/payments'

export const metadata = { title: 'Тохиргоо' }

export default async function SettingsPage() {
  const session = await requireAdminPage('settings.view')
  await connection()
  const today = dateKeyOf(new Date())
  const [[salon], [s], hours, specialDays] = await Promise.all([
    db.select().from(t.salons).where(eq(t.salons.id, session.salonId)),
    db.select().from(t.businessSettings).where(eq(t.businessSettings.salonId, session.salonId)),
    db
      .select()
      .from(t.openingHours)
      .where(eq(t.openingHours.salonId, session.salonId))
      .orderBy(asc(t.openingHours.weekday)),
    db
      .select()
      .from(t.specialDays)
      .where(and(eq(t.specialDays.salonId, session.salonId), gte(t.specialDays.date, today)))
      .orderBy(asc(t.specialDays.date)),
  ])
  const data: SettingsData = {
    name: salon.name,
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
      id: d.id,
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
      defaultBufferMinutes: s.defaultBufferMinutes,
      maxServicesPerBooking: s.maxServicesPerBooking,
      cancellationNoticeHours: s.cancellationNoticeHours,
      rescheduleNoticeHours: s.rescheduleNoticeHours,
      confirmationMode: s.confirmationMode,
      depositMode: s.depositMode,
      depositFixedAmount: s.depositFixedAmount,
      depositPercentBps: s.depositPercentBps,
      depositMinTotal: s.depositMinTotal,
      holdMinutes: s.holdMinutes,
      lateArrivalMinutes: s.lateArrivalMinutes,
      reminderHoursBefore: s.reminderHoursBefore,
      cancellationPolicy: s.cancellationPolicy,
      depositPolicy: s.depositPolicy,
    },
  }
  const qpay = paymentMode()
  return (
    <>
      <PageHeader
        title="Тохиргоо"
        description="Салоны мэдээлэл, ажлын цаг, баярын өдөр, захиалгын дүрэм. Өөрчлөлт вэбсайт, онлайн захиалга, AI туслахад шууд хэрэгжинэ."
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card title="Салоны мэдээлэл">
          <SalonInfoForm data={data} />
        </Card>
        <div className="space-y-6">
          <Card title="Ажлын цаг">
            <HoursForm data={data} />
          </Card>
          <Card title="Баяр, онцгой өдөр">
            <SpecialDaysForm data={data} today={today} />
          </Card>
          <Card title="Цагийн бүс, холболт">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">Цагийн бүс</dt>
              <dd>{salon.timezone} (UTC+8, зуны цаггүй). Бүх цагийг UTC-ээр хадгалж, Улаанбаатарын цагаар харуулна.</dd>
              <dt className="text-ink-3">Валют</dt>
              <dd>MNT, бүхэл төгрөг</dd>
              <dt className="text-ink-3">QPay</dt>
              <dd>
                {qpay === 'mock'
                  ? 'Симуляц (демо) — бодит төлбөр авахгүй'
                  : qpay === 'sandbox'
                    ? 'QPay sandbox (туршилт)'
                    : 'QPay production'}
              </dd>
              <dt className="text-ink-3">Мэдэгдэл</dt>
              <dd>
                {process.env.DEMO_MODE === 'true'
                  ? 'Демо: зөвхөн бүртгэлд хадгална, гадагш илгээхгүй'
                  : process.env.TELEGRAM_BOT_TOKEN
                    ? 'Telegram (ажилтан)'
                    : 'Суваг тохируулаагүй'}
              </dd>
            </dl>
          </Card>
        </div>
      </div>
      <Card title="Захиалгын дүрэм, бодлого" className="mt-6">
        <RulesForm data={data} />
      </Card>
      {session.permissions.includes('demo.reset') && salon.isDemo && process.env.DEMO_MODE === 'true' ? (
        <Card title="Демо өгөгдөл" className="mt-6">
          <p className="mb-4 max-w-2xl text-sm text-ink-2">
            Жишээ харилцагч, захиалга, төлбөр, мэдэгдлийг устгаж, өнөөдрийн огноонд тааруулан шинээр үүсгэнэ. Зөвхөн
            «жишээ» гэж тэмдэглэсэн мөрүүдэд нөлөөлнө; үйлчилгээ, үнэ, ажилтны тохиргоо хэвээр үлдэнэ.
          </p>
          <ActionButton
            action={resetDemoAction}
            variant="danger"
            size="md"
            confirm="Демо өгөгдлийг устгаад шинээр үүсгэх үү?"
            okText="Демо өгөгдөл шинэчлэгдлээ."
          >
            Демо өгөгдлийг шинэчлэх
          </ActionButton>
        </Card>
      ) : null}
    </>
  )
}

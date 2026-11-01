// Database schema. Every table lives in the dedicated `salon` Postgres schema
// so the database can be shared with other applications.
//
// Invariants worth knowing before editing (see docs/DATABASE.md):
// - Money is integer tögrög; durations are minutes; times of day are minutes
//   from local midnight (Asia/Ulaanbaatar); instants are timestamptz (UTC).
// - Appointments snapshot service/add-on names, prices and durations, so a
//   later price change never rewrites history.
// - No two slot-holding appointments of one staff member may overlap. This is
//   enforced by the exclusion constraint `appointments_no_overlap` (custom
//   migration 0001), on top of the transactional check in the booking service.
// - Records are never deleted when an appointment is cancelled; status changes
//   append to appointment_events.
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const salonSchema = pgSchema('salon')

// ---- Enums -------------------------------------------------------------------

export const appointmentStatus = salonSchema.enum('appointment_status', [
  'awaiting_deposit', // slot held until hold_expires_at while the deposit is paid
  'pending', // request recorded, waiting for the salon to approve
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
  'rejected',
  'expired', // deposit not paid in time, or a request never handled
  'rescheduled', // replaced by a new appointment (rescheduled_from_id points back here)
])
export const appointmentSource = salonSchema.enum('appointment_source', [
  'website',
  'admin',
  'assistant',
  'messenger',
  'phone',
  'walk_in',
])
export const actorType = salonSchema.enum('actor_type', ['customer', 'staff', 'system', 'assistant'])
export const priceType = salonSchema.enum('price_type', ['fixed', 'from'])
export const confirmationMode = salonSchema.enum('confirmation_mode', ['auto', 'manual'])
export const depositMode = salonSchema.enum('deposit_mode', ['none', 'fixed', 'percent'])
export const specialDayKind = salonSchema.enum('special_day_kind', ['closed', 'special_hours'])
export const timeOffKind = salonSchema.enum('time_off_kind', ['day_off', 'vacation', 'sick', 'training', 'other'])
export const paymentKind = salonSchema.enum('payment_kind', ['deposit', 'balance', 'full', 'refund'])
export const paymentMethod = salonSchema.enum('payment_method', ['qpay', 'cash', 'card', 'bank_transfer'])
export const paymentStatus = salonSchema.enum('payment_status', [
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refunded',
])
export const depositOutcome = salonSchema.enum('deposit_outcome', ['none', 'refund', 'forfeit', 'transfer'])
export const notificationChannel = salonSchema.enum('notification_channel', [
  'web',
  'email',
  'sms',
  'messenger',
  'telegram',
])
export const notificationAudience = salonSchema.enum('notification_audience', ['customer', 'staff'])
export const notificationStatus = salonSchema.enum('notification_status', ['logged', 'sent', 'failed', 'skipped'])

// ---- Helpers -------------------------------------------------------------------

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

// ---- Salon and settings ------------------------------------------------------------

export const salons = salonSchema
  .table('salons', {
    id: uuid().primaryKey().defaultRandom(),
    slug: varchar({ length: 60 }).notNull().unique(),
    name: varchar({ length: 120 }).notNull(),
    timezone: varchar({ length: 64 }).notNull().default('Asia/Ulaanbaatar'),
    currency: varchar({ length: 3 }).notNull().default('MNT'),
    /** Fictional portfolio salon: everything under it is sample data. */
    isDemo: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  })
  .enableRLS()

export const businessSettings = salonSchema
  .table(
    'business_settings',
    {
      salonId: uuid()
        .primaryKey()
        .references(() => salons.id, { onDelete: 'cascade' }),
      tagline: varchar({ length: 160 }).notNull().default(''),
      about: text().notNull().default(''),
      announcement: varchar({ length: 200 }),
      phone: varchar({ length: 32 }).notNull().default(''),
      email: varchar({ length: 254 }),
      addressLine: varchar({ length: 200 }).notNull().default(''),
      addressNote: varchar({ length: 200 }),
      mapUrl: varchar({ length: 500 }),
      instagram: varchar({ length: 100 }),
      facebook: varchar({ length: 100 }),
      // Booking rules
      slotIntervalMinutes: smallint().notNull().default(15),
      minAdvanceMinutes: integer().notNull().default(120),
      maxAdvanceDays: smallint().notNull().default(60),
      defaultBufferMinutes: smallint().notNull().default(10),
      maxServicesPerBooking: smallint().notNull().default(3),
      cancellationNoticeHours: smallint().notNull().default(12),
      rescheduleNoticeHours: smallint().notNull().default(12),
      // Reservation policy (fixed, enforced by the appointments_no_overlap
      // constraint): requests awaiting approval and unpaid deposit holds keep
      // their slot; holds are released when hold_expires_at passes.
      confirmationMode: confirmationMode().notNull().default('manual'),
      depositMode: depositMode().notNull().default('none'),
      depositFixedAmount: integer().notNull().default(0),
      depositPercentBps: integer().notNull().default(0),
      /** Deposit applies only when the appointment total is at least this amount. */
      depositMinTotal: integer().notNull().default(0),
      /** Minutes an unpaid deposit hold keeps the slot. */
      holdMinutes: smallint().notNull().default(20),
      lateArrivalMinutes: smallint().notNull().default(15),
      reminderHoursBefore: smallint().notNull().default(24),
      cancellationPolicy: text().notNull().default(''),
      depositPolicy: text().notNull().default(''),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      check('settings_slot_interval', sql`${t.slotIntervalMinutes} in (5, 10, 15, 20, 30, 60)`),
      check('settings_deposit_bps', sql`${t.depositPercentBps} between 0 and 10000`),
      check(
        'settings_non_negative',
        sql`${t.depositFixedAmount} >= 0 and ${t.depositMinTotal} >= 0 and ${t.minAdvanceMinutes} >= 0`,
      ),
    ],
  )
  .enableRLS()

export const openingHours = salonSchema
  .table(
    'opening_hours',
    {
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      /** ISO weekday: 1 = Monday … 7 = Sunday */
      weekday: smallint().notNull(),
      isClosed: boolean().notNull().default(false),
      opensAt: smallint().notNull().default(600),
      closesAt: smallint().notNull().default(1200),
    },
    (t) => [
      primaryKey({ columns: [t.salonId, t.weekday] }),
      check('opening_weekday', sql`${t.weekday} between 1 and 7`),
      check(
        'opening_range',
        sql`${t.isClosed} or (${t.opensAt} >= 0 and ${t.opensAt} < ${t.closesAt} and ${t.closesAt} <= 1440)`,
      ),
    ],
  )
  .enableRLS()

/** Holidays (closed) and special opening hours for one local date. */
export const specialDays = salonSchema
  .table(
    'special_days',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      date: date({ mode: 'string' }).notNull(),
      kind: specialDayKind().notNull(),
      opensAt: smallint(),
      closesAt: smallint(),
      label: varchar({ length: 120 }).notNull(),
      isDemo: boolean().notNull().default(false),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('special_days_salon_date').on(t.salonId, t.date),
      check(
        'special_days_hours',
        sql`${t.kind} = 'closed' or (${t.opensAt} is not null and ${t.closesAt} is not null and ${t.opensAt} < ${t.closesAt})`,
      ),
    ],
  )
  .enableRLS()

// ---- Catalogue ---------------------------------------------------------------------

export const serviceCategories = salonSchema
  .table(
    'service_categories',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      slug: varchar({ length: 60 }).notNull(),
      name: varchar({ length: 80 }).notNull(),
      description: text().notNull().default(''),
      imageUrl: varchar({ length: 500 }),
      sortOrder: smallint().notNull().default(0),
      isActive: boolean().notNull().default(true),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('service_categories_salon_slug').on(t.salonId, t.slug)],
  )
  .enableRLS()

export const services = salonSchema
  .table(
    'services',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      categoryId: uuid()
        .notNull()
        .references(() => serviceCategories.id),
      slug: varchar({ length: 80 }).notNull(),
      name: varchar({ length: 120 }).notNull(),
      shortDescription: varchar({ length: 220 }).notNull().default(''),
      description: text().notNull().default(''),
      durationMinutes: smallint().notNull(),
      price: integer().notNull(),
      /** 'from' = price shown as "…₮-өөс"; the final amount is agreed in the salon. */
      priceType: priceType().notNull().default('fixed'),
      /** Overrides the salon's default buffer after this service. */
      bufferMinutes: smallint(),
      imageUrl: varchar({ length: 500 }),
      imageAlt: varchar({ length: 200 }),
      isActive: boolean().notNull().default(true),
      isFeatured: boolean().notNull().default(false),
      onlineBookable: boolean().notNull().default(true),
      sortOrder: smallint().notNull().default(0),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('services_salon_slug').on(t.salonId, t.slug),
      index('services_category').on(t.categoryId),
      check('services_duration', sql`${t.durationMinutes} between 5 and 600`),
      check('services_price', sql`${t.price} >= 0`),
      check('services_buffer', sql`${t.bufferMinutes} is null or ${t.bufferMinutes} between 0 and 120`),
    ],
  )
  .enableRLS()

export const serviceAddons = salonSchema
  .table(
    'service_addons',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      slug: varchar({ length: 80 }).notNull(),
      name: varchar({ length: 120 }).notNull(),
      description: varchar({ length: 300 }).notNull().default(''),
      price: integer().notNull(),
      priceType: priceType().notNull().default('fixed'),
      durationMinutes: smallint().notNull().default(0),
      isActive: boolean().notNull().default(true),
      sortOrder: smallint().notNull().default(0),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('service_addons_salon_slug').on(t.salonId, t.slug),
      check('service_addons_values', sql`${t.price} >= 0 and ${t.durationMinutes} between 0 and 240`),
    ],
  )
  .enableRLS()

/** Which add-ons are offered with which service. */
export const serviceAddonLinks = salonSchema
  .table(
    'service_addon_links',
    {
      serviceId: uuid()
        .notNull()
        .references(() => services.id, { onDelete: 'cascade' }),
      addonId: uuid()
        .notNull()
        .references(() => serviceAddons.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.serviceId, t.addonId] })],
  )
  .enableRLS()

export const skills = salonSchema
  .table(
    'skills',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      key: varchar({ length: 40 }).notNull(),
      name: varchar({ length: 80 }).notNull(),
      description: varchar({ length: 200 }).notNull().default(''),
      sortOrder: smallint().notNull().default(0),
    },
    (t) => [uniqueIndex('skills_salon_key').on(t.salonId, t.key)],
  )
  .enableRLS()

/** Skills a specialist needs before the service can be assigned to them. */
export const serviceSkills = salonSchema
  .table(
    'service_skills',
    {
      serviceId: uuid()
        .notNull()
        .references(() => services.id, { onDelete: 'cascade' }),
      skillId: uuid()
        .notNull()
        .references(() => skills.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.serviceId, t.skillId] })],
  )
  .enableRLS()

// ---- Staff ---------------------------------------------------------------------------

export const staff = salonSchema
  .table(
    'staff',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      slug: varchar({ length: 60 }).notNull(),
      /** Full name as used in Mongolia: patronymic initial + given name. */
      name: varchar({ length: 120 }).notNull(),
      displayName: varchar({ length: 60 }).notNull(),
      title: varchar({ length: 100 }).notNull(),
      bio: text().notNull().default(''),
      experienceYears: smallint().notNull().default(0),
      experienceText: varchar({ length: 300 }).notNull().default(''),
      specialties: text()
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      photoUrl: varchar({ length: 500 }),
      photoAlt: varchar({ length: 200 }),
      /** A photograph of the specialist's work, shown large on profile cards. */
      coverUrl: varchar({ length: 500 }),
      calendarColor: varchar({ length: 7 }).notNull().default('#8a6a58'),
      isActive: boolean().notNull().default(true),
      acceptsOnlineBookings: boolean().notNull().default(true),
      sortOrder: smallint().notNull().default(0),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('staff_salon_slug').on(t.salonId, t.slug)],
  )
  .enableRLS()

export const staffSkills = salonSchema
  .table(
    'staff_skills',
    {
      staffId: uuid()
        .notNull()
        .references(() => staff.id, { onDelete: 'cascade' }),
      skillId: uuid()
        .notNull()
        .references(() => skills.id, { onDelete: 'cascade' }),
      level: varchar({ length: 16 }).notNull().default('standard'),
    },
    (t) => [
      primaryKey({ columns: [t.staffId, t.skillId] }),
      check('staff_skills_level', sql`${t.level} in ('standard', 'senior')`),
    ],
  )
  .enableRLS()

/** Services a specialist performs. The booking engine only offers these pairs. */
export const staffServices = salonSchema
  .table(
    'staff_services',
    {
      staffId: uuid()
        .notNull()
        .references(() => staff.id, { onDelete: 'cascade' }),
      serviceId: uuid()
        .notNull()
        .references(() => services.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.staffId, t.serviceId] }), index('staff_services_service').on(t.serviceId)],
  )
  .enableRLS()

/** Weekly working template: one shift per weekday. */
export const staffSchedules = salonSchema
  .table(
    'staff_schedules',
    {
      staffId: uuid()
        .notNull()
        .references(() => staff.id, { onDelete: 'cascade' }),
      weekday: smallint().notNull(),
      isWorking: boolean().notNull().default(true),
      startsAt: smallint().notNull().default(600),
      endsAt: smallint().notNull().default(1200),
    },
    (t) => [
      primaryKey({ columns: [t.staffId, t.weekday] }),
      check('staff_schedules_weekday', sql`${t.weekday} between 1 and 7`),
      check(
        'staff_schedules_range',
        sql`not ${t.isWorking} or (${t.startsAt} >= 0 and ${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= 1440)`,
      ),
    ],
  )
  .enableRLS()

/** Recurring breaks. weekday null = every working day. */
export const staffBreaks = salonSchema
  .table(
    'staff_breaks',
    {
      id: uuid().primaryKey().defaultRandom(),
      staffId: uuid()
        .notNull()
        .references(() => staff.id, { onDelete: 'cascade' }),
      weekday: smallint(),
      startsAt: smallint().notNull(),
      endsAt: smallint().notNull(),
      label: varchar({ length: 60 }).notNull().default('Завсарлага'),
    },
    (t) => [
      index('staff_breaks_staff').on(t.staffId),
      check('staff_breaks_range', sql`${t.startsAt} >= 0 and ${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= 1440`),
      check('staff_breaks_weekday', sql`${t.weekday} is null or ${t.weekday} between 1 and 7`),
    ],
  )
  .enableRLS()

/** Days off, holidays, training: blocks [starts_at, ends_at). */
export const staffTimeOff = salonSchema
  .table(
    'staff_time_off',
    {
      id: uuid().primaryKey().defaultRandom(),
      staffId: uuid()
        .notNull()
        .references(() => staff.id, { onDelete: 'cascade' }),
      startsAt: timestamp({ withTimezone: true }).notNull(),
      endsAt: timestamp({ withTimezone: true }).notNull(),
      kind: timeOffKind().notNull().default('day_off'),
      note: varchar({ length: 200 }),
      isDemo: boolean().notNull().default(false),
      createdAt: createdAt(),
    },
    (t) => [
      index('staff_time_off_staff_range').on(t.staffId, t.startsAt),
      check('staff_time_off_range', sql`${t.startsAt} < ${t.endsAt}`),
    ],
  )
  .enableRLS()

// ---- Customers ----------------------------------------------------------------------

export const customers = salonSchema
  .table(
    'customers',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      name: varchar({ length: 100 }).notNull(),
      /** Normalised 8-digit Mongolian number. */
      phone: varchar({ length: 16 }).notNull(),
      email: varchar({ length: 254 }),
      /** Internal staff notes — never shown to the customer. */
      notes: text(),
      /** Preferences the customer shared (shape, colour, allergies to products…). */
      preferences: text(),
      marketingOptIn: boolean().notNull().default(false),
      isDemo: boolean().notNull().default(false),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('customers_salon_phone').on(t.salonId, t.phone),
      index('customers_salon_name').on(t.salonId, t.name),
    ],
  )
  .enableRLS()

// ---- Appointments -------------------------------------------------------------------

export const appointments = salonSchema
  .table(
    'appointments',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      /** Customer-facing booking reference, e.g. SV-7K3QH9. */
      reference: varchar({ length: 16 }).notNull().unique(),
      customerId: uuid()
        .notNull()
        .references(() => customers.id),
      staffId: uuid()
        .notNull()
        .references(() => staff.id),
      status: appointmentStatus().notNull(),
      source: appointmentSource().notNull().default('website'),
      startsAt: timestamp({ withTimezone: true }).notNull(),
      endsAt: timestamp({ withTimezone: true }).notNull(),
      /** ends_at + buffer: the staff member is unavailable until then. */
      occupiedUntil: timestamp({ withTimezone: true }).notNull(),
      bufferMinutes: smallint().notNull().default(0),
      durationMinutes: smallint().notNull(),
      servicesTotal: integer().notNull(),
      addonsTotal: integer().notNull().default(0),
      totalPrice: integer().notNull(),
      /** True when any line is a "from" price (final amount agreed in the salon). */
      hasFromPrice: boolean().notNull().default(false),
      depositAmount: integer().notNull().default(0),
      /** The customer picked this specialist (false = "any available"). */
      staffRequested: boolean().notNull().default(true),
      customerNote: text(),
      internalNote: text(),
      holdExpiresAt: timestamp({ withTimezone: true }),
      confirmedAt: timestamp({ withTimezone: true }),
      cancelledAt: timestamp({ withTimezone: true }),
      completedAt: timestamp({ withTimezone: true }),
      rescheduledFromId: uuid(),
      /** sha256 of the customer's private manage-link token. */
      manageTokenHash: varchar({ length: 64 }),
      /** Public demo: hash of the visitor cookie that created this booking. */
      demoVisitorHash: varchar({ length: 64 }),
      createdByAdminId: uuid(),
      isDemo: boolean().notNull().default(false),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index('appointments_salon_start').on(t.salonId, t.startsAt),
      index('appointments_staff_start').on(t.staffId, t.startsAt),
      index('appointments_customer').on(t.customerId),
      index('appointments_status').on(t.salonId, t.status),
      index('appointments_rescheduled_from').on(t.rescheduledFromId),
      index('appointments_demo_visitor').on(t.demoVisitorHash),
      check('appointments_times', sql`${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= ${t.occupiedUntil}`),
      check(
        'appointments_money',
        sql`${t.totalPrice} >= 0 and ${t.depositAmount} >= 0 and ${t.depositAmount} <= ${t.totalPrice}`,
      ),
    ],
  )
  .enableRLS()

export const appointmentServices = salonSchema
  .table(
    'appointment_services',
    {
      id: uuid().primaryKey().defaultRandom(),
      appointmentId: uuid()
        .notNull()
        .references(() => appointments.id, { onDelete: 'cascade' }),
      serviceId: uuid().references(() => services.id, { onDelete: 'set null' }),
      serviceName: varchar({ length: 120 }).notNull(),
      categoryName: varchar({ length: 80 }).notNull(),
      durationMinutes: smallint().notNull(),
      price: integer().notNull(),
      priceType: priceType().notNull(),
      sortOrder: smallint().notNull().default(0),
    },
    (t) => [
      index('appointment_services_appointment').on(t.appointmentId),
      index('appointment_services_service').on(t.serviceId),
    ],
  )
  .enableRLS()

export const appointmentAddons = salonSchema
  .table(
    'appointment_addons',
    {
      id: uuid().primaryKey().defaultRandom(),
      appointmentId: uuid()
        .notNull()
        .references(() => appointments.id, { onDelete: 'cascade' }),
      appointmentServiceId: uuid()
        .notNull()
        .references(() => appointmentServices.id, { onDelete: 'cascade' }),
      addonId: uuid().references(() => serviceAddons.id, { onDelete: 'set null' }),
      addonName: varchar({ length: 120 }).notNull(),
      durationMinutes: smallint().notNull(),
      price: integer().notNull(),
      priceType: priceType().notNull(),
    },
    (t) => [index('appointment_addons_appointment').on(t.appointmentId)],
  )
  .enableRLS()

/** Append-only history of everything that happened to an appointment. */
export const appointmentEvents = salonSchema
  .table(
    'appointment_events',
    {
      id: uuid().primaryKey().defaultRandom(),
      appointmentId: uuid()
        .notNull()
        .references(() => appointments.id, { onDelete: 'cascade' }),
      kind: varchar({ length: 40 }).notNull(),
      fromStatus: appointmentStatus(),
      toStatus: appointmentStatus(),
      actorType: actorType().notNull(),
      actorAdminId: uuid(),
      note: text(),
      meta: jsonb().$type<Record<string, unknown>>(),
      createdAt: createdAt(),
    },
    (t) => [
      index('appointment_events_appointment').on(t.appointmentId, t.createdAt),
      index('appointment_events_created').on(t.createdAt),
    ],
  )
  .enableRLS()

export const cancellationRecords = salonSchema
  .table(
    'cancellation_records',
    {
      id: uuid().primaryKey().defaultRandom(),
      appointmentId: uuid()
        .notNull()
        .references(() => appointments.id, { onDelete: 'cascade' }),
      cancelledBy: actorType().notNull(),
      actorAdminId: uuid(),
      reasonCode: varchar({ length: 40 }).notNull(),
      reasonText: text(),
      /** Hours between the cancellation and the appointment start. */
      noticeHours: integer().notNull(),
      withinPolicy: boolean().notNull(),
      depositOutcome: depositOutcome().notNull().default('none'),
      createdAt: createdAt(),
    },
    (t) => [index('cancellation_records_appointment').on(t.appointmentId)],
  )
  .enableRLS()

// ---- Payments -------------------------------------------------------------------------

export const payments = salonSchema
  .table(
    'payments',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      appointmentId: uuid()
        .notNull()
        .references(() => appointments.id, { onDelete: 'cascade' }),
      kind: paymentKind().notNull(),
      method: paymentMethod().notNull(),
      status: paymentStatus().notNull().default('pending'),
      amount: integer().notNull(),
      /** 'qpay' (real API), 'simulated' (portfolio demo) or 'manual' (recorded by staff). */
      provider: varchar({ length: 16 }).notNull(),
      providerInvoiceId: varchar({ length: 120 }),
      providerPaymentId: varchar({ length: 120 }),
      qrText: text(),
      shortUrl: varchar({ length: 500 }),
      expiresAt: timestamp({ withTimezone: true }),
      paidAt: timestamp({ withTimezone: true }),
      /** How the paid state was established: 'provider_check' or 'staff_record'. */
      verifiedBy: varchar({ length: 24 }),
      recordedByAdminId: uuid(),
      note: text(),
      isDemo: boolean().notNull().default(false),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index('payments_appointment').on(t.appointmentId),
      index('payments_salon_created').on(t.salonId, t.createdAt),
      uniqueIndex('payments_provider_invoice').on(t.providerInvoiceId),
      check('payments_amount', sql`${t.amount} > 0`),
      check(
        'payments_paid_is_verified',
        sql`${t.status} <> 'paid' or (${t.paidAt} is not null and ${t.verifiedBy} is not null)`,
      ),
    ],
  )
  .enableRLS()

/** Provider-level log: invoice creation, callbacks, checks, refunds. */
export const paymentRecords = salonSchema
  .table(
    'payment_records',
    {
      id: uuid().primaryKey().defaultRandom(),
      paymentId: uuid()
        .notNull()
        .references(() => payments.id, { onDelete: 'cascade' }),
      event: varchar({ length: 40 }).notNull(),
      detail: jsonb().$type<Record<string, unknown>>(),
      createdAt: createdAt(),
    },
    (t) => [index('payment_records_payment').on(t.paymentId, t.createdAt)],
  )
  .enableRLS()

// ---- Administration ------------------------------------------------------------------

export const adminRoles = salonSchema
  .table('admin_roles', {
    key: varchar({ length: 32 }).primaryKey(),
    name: varchar({ length: 60 }).notNull(),
    description: varchar({ length: 300 }).notNull().default(''),
    permissions: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  })
  .enableRLS()

export const adminUsers = salonSchema
  .table(
    'admin_users',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      email: varchar({ length: 254 }).notNull().unique(),
      name: varchar({ length: 100 }).notNull(),
      passwordHash: varchar({ length: 200 }),
      roleKey: varchar({ length: 32 })
        .notNull()
        .references(() => adminRoles.key),
      /** Specialists see their own calendar. */
      staffId: uuid().references(() => staff.id, { onDelete: 'set null' }),
      isActive: boolean().notNull().default(true),
      lastLoginAt: timestamp({ withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [index('admin_users_salon').on(t.salonId)],
  )
  .enableRLS()

export const adminSessions = salonSchema
  .table(
    'admin_sessions',
    {
      /** sha256 of the cookie token — the token itself is never stored. */
      id: varchar({ length: 64 }).primaryKey(),
      adminUserId: uuid()
        .notNull()
        .references(() => adminUsers.id, { onDelete: 'cascade' }),
      expiresAt: timestamp({ withTimezone: true }).notNull(),
      isDemo: boolean().notNull().default(false),
      /** Public demo: links the session to the visitor's own sample bookings. */
      demoVisitorHash: varchar({ length: 64 }),
      userAgent: varchar({ length: 255 }),
      ipHash: varchar({ length: 64 }),
      createdAt: createdAt(),
    },
    (t) => [index('admin_sessions_user').on(t.adminUserId), index('admin_sessions_expires').on(t.expiresAt)],
  )
  .enableRLS()

export const auditLog = salonSchema
  .table(
    'audit_log',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      adminUserId: uuid(),
      action: varchar({ length: 60 }).notNull(),
      entity: varchar({ length: 40 }).notNull(),
      entityId: uuid(),
      summary: text().notNull(),
      detail: jsonb().$type<Record<string, unknown>>(),
      ipHash: varchar({ length: 64 }),
      createdAt: createdAt(),
    },
    (t) => [index('audit_log_salon_created').on(t.salonId, t.createdAt)],
  )
  .enableRLS()

// ---- Notifications ----------------------------------------------------------------------

export const notifications = salonSchema
  .table(
    'notifications',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      appointmentId: uuid().references(() => appointments.id, { onDelete: 'cascade' }),
      kind: varchar({ length: 40 }).notNull(),
      channel: notificationChannel().notNull(),
      audience: notificationAudience().notNull(),
      /** Masked recipient (e.g. 99****33) — never the full contact. */
      recipient: varchar({ length: 120 }),
      subject: varchar({ length: 200 }).notNull(),
      body: text().notNull(),
      status: notificationStatus().notNull(),
      /** One notification per (appointment, kind, channel, audience, variant). */
      dedupeKey: varchar({ length: 200 }).notNull().unique(),
      error: text(),
      isDemo: boolean().notNull().default(false),
      createdAt: createdAt(),
      sentAt: timestamp({ withTimezone: true }),
    },
    (t) => [
      index('notifications_salon_created').on(t.salonId, t.createdAt),
      index('notifications_appointment').on(t.appointmentId),
    ],
  )
  .enableRLS()

// ---- Assistant --------------------------------------------------------------------------

export const chatSessions = salonSchema
  .table(
    'chat_sessions',
    {
      id: uuid().primaryKey().defaultRandom(),
      salonId: uuid()
        .notNull()
        .references(() => salons.id, { onDelete: 'cascade' }),
      channel: varchar({ length: 16 }).notNull().default('web'),
      /** Hashed visitor cookie or Messenger sender id — never the raw id. */
      visitorHash: varchar({ length: 64 }).notNull(),
      /** Booking draft and conversation state. */
      state: jsonb().$type<Record<string, unknown>>().notNull().default({}),
      messageCount: integer().notNull().default(0),
      handedOff: boolean().notNull().default(false),
      appointmentId: uuid().references(() => appointments.id, { onDelete: 'set null' }),
      isDemo: boolean().notNull().default(false),
      createdAt: createdAt(),
      lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index('chat_sessions_visitor').on(t.salonId, t.visitorHash),
      index('chat_sessions_last').on(t.lastMessageAt),
    ],
  )
  .enableRLS()

export const chatMessages = salonSchema
  .table(
    'chat_messages',
    {
      id: uuid().primaryKey().defaultRandom(),
      sessionId: uuid()
        .notNull()
        .references(() => chatSessions.id, { onDelete: 'cascade' }),
      role: varchar({ length: 16 }).notNull(),
      content: text().notNull(),
      meta: jsonb().$type<Record<string, unknown>>(),
      createdAt: createdAt(),
    },
    (t) => [index('chat_messages_session').on(t.sessionId, t.createdAt)],
  )
  .enableRLS()

/** Model spend per day, for the daily budget guard. */
export const aiUsage = salonSchema
  .table(
    'ai_usage',
    {
      day: date({ mode: 'string' }).notNull(),
      model: varchar({ length: 80 }).notNull(),
      calls: integer().notNull().default(0),
      inputTokens: integer().notNull().default(0),
      outputTokens: integer().notNull().default(0),
    },
    (t) => [primaryKey({ columns: [t.day, t.model] })],
  )
  .enableRLS()

// ---- Infrastructure ---------------------------------------------------------------------

export const rateLimits = salonSchema
  .table('rate_limits', {
    key: varchar({ length: 200 }).primaryKey(),
    count: integer().notNull(),
    windowStartedAt: timestamp({ withTimezone: true }).notNull(),
  })
  .enableRLS()

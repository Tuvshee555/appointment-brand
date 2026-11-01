import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allowedTransitions,
  APPOINTMENT_STATUSES,
  canTransition,
  holdsSlot,
  SLOT_HOLDING_STATUSES,
  TERMINAL_STATUSES,
} from '@/lib/booking/status'

describe('appointment status machine', () => {
  it('only lets staff confirm or reject a request', () => {
    expect(canTransition('pending', 'confirmed', 'staff')).toBe(true)
    expect(canTransition('pending', 'confirmed', 'customer')).toBe(false)
    expect(canTransition('pending', 'rejected', 'customer')).toBe(false)
  })

  it('confirms a held booking only through the system (verified payment)', () => {
    expect(canTransition('awaiting_deposit', 'confirmed', 'system')).toBe(true)
    expect(canTransition('awaiting_deposit', 'confirmed', 'staff')).toBe(false)
    expect(canTransition('awaiting_deposit', 'confirmed', 'customer')).toBe(false)
    expect(canTransition('awaiting_deposit', 'expired', 'system')).toBe(true)
  })

  it('lets customers cancel or reschedule their own active booking', () => {
    expect(allowedTransitions('confirmed', 'customer').sort()).toEqual(['cancelled', 'rescheduled'])
    expect(allowedTransitions('pending', 'customer').sort()).toEqual(['cancelled', 'rescheduled'])
  })

  it('records attendance only from a confirmed booking', () => {
    expect(canTransition('confirmed', 'completed', 'staff')).toBe(true)
    expect(canTransition('confirmed', 'no_show', 'staff')).toBe(true)
    expect(canTransition('pending', 'completed', 'staff')).toBe(false)
    expect(canTransition('no_show', 'completed', 'staff')).toBe(true) // correcting a mistake
  })

  it('keeps finished bookings final, except the no-show correction', () => {
    for (const status of TERMINAL_STATUSES) {
      const outgoing = (['customer', 'staff', 'system'] as const).flatMap((actor) => allowedTransitions(status, actor))
      expect(outgoing).toEqual(status === 'no_show' ? ['completed'] : [])
    }
  })

  it('matches the statuses blocked by the database exclusion constraint', () => {
    const sql = readFileSync(path.join(process.cwd(), 'drizzle/0001_appointments_no_overlap.sql'), 'utf8')
    const list = /status"? in \(([^)]+)\)/i.exec(sql)?.[1]
    expect(list).toBeTruthy()
    const inConstraint = list!
      .match(/'([a-z_]+)'/g)!
      .map((s) => s.replaceAll("'", ''))
      .sort()
    expect(inConstraint).toEqual([...SLOT_HOLDING_STATUSES].sort())
    for (const status of APPOINTMENT_STATUSES) expect(holdsSlot(status)).toBe(inConstraint.includes(status))
  })
})

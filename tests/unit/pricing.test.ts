import { describe, expect, it } from 'vitest'
import {
  buildQuote,
  depositFor,
  QuoteError,
  type CatalogAddon,
  type CatalogService,
  type DepositPolicy,
} from '@/lib/booking/pricing'

const service = (over: Partial<CatalogService> & { id: string }): CatalogService => ({
  name: over.id,
  categoryName: 'Маникюр',
  durationMinutes: 60,
  price: 50_000,
  priceType: 'fixed',
  bufferMinutes: null,
  addonIds: [],
  ...over,
})

const addon = (over: Partial<CatalogAddon> & { id: string }): CatalogAddon => ({
  name: over.id,
  durationMinutes: 15,
  price: 10_000,
  priceType: 'fixed',
  ...over,
})

const catalog = {
  services: new Map(
    [
      service({ id: 'gel', price: 65_000, durationMinutes: 90, addonIds: ['removal', 'art'] }),
      service({ id: 'ext', price: 120_000, durationMinutes: 150, bufferMinutes: 15 }),
      service({ id: 'repair', price: 15_000, durationMinutes: 30, priceType: 'from' }),
    ].map((s) => [s.id, s]),
  ),
  addons: new Map(
    [addon({ id: 'removal' }), addon({ id: 'art', price: 15_000, durationMinutes: 20, priceType: 'from' })].map((a) => [
      a.id,
      a,
    ]),
  ),
}

const fixedDeposit: DepositPolicy = { mode: 'fixed', fixedAmount: 20_000, percentBps: 0, minTotal: 100_000 }
const options = { defaultBufferMinutes: 10, deposit: fixedDeposit, maxServices: 3 }

const quoteError = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    return err instanceof QuoteError ? err.code : 'other'
  }
  return null
}

describe('buildQuote', () => {
  it('adds service and add-on prices and durations', () => {
    const q = buildQuote([{ serviceId: 'gel', addonIds: ['removal'] }], catalog, options)
    expect(q.servicesTotal).toBe(65_000)
    expect(q.addonsTotal).toBe(10_000)
    expect(q.total).toBe(75_000)
    expect(q.durationMinutes).toBe(105)
    expect(q.bufferMinutes).toBe(10) // salon default
    expect(q.hasFromPrice).toBe(false)
    expect(q.deposit).toBe(0) // below the 100,000 threshold
  })

  it('uses the longest service buffer and flags "from" prices', () => {
    const q = buildQuote(
      [
        { serviceId: 'ext', addonIds: [] },
        { serviceId: 'repair', addonIds: [] },
      ],
      catalog,
      options,
    )
    expect(q.bufferMinutes).toBe(15)
    expect(q.hasFromPrice).toBe(true)
    expect(q.total).toBe(135_000)
    expect(q.deposit).toBe(20_000)
  })

  it('counts a repeated add-on once', () => {
    const q = buildQuote([{ serviceId: 'gel', addonIds: ['art', 'art'] }], catalog, options)
    expect(q.addonsTotal).toBe(15_000)
    expect(q.lines[0].addons).toHaveLength(1)
    expect(q.hasFromPrice).toBe(true)
  })

  it('rejects invalid selections', () => {
    expect(quoteError(() => buildQuote([], catalog, options))).toBe('empty')
    expect(
      quoteError(() =>
        buildQuote(
          ['gel', 'ext', 'repair', 'gel'].map((serviceId) => ({ serviceId, addonIds: [] })),
          catalog,
          options,
        ),
      ),
    ).toBe('too_many')
    expect(
      quoteError(() =>
        buildQuote(
          [
            { serviceId: 'gel', addonIds: [] },
            { serviceId: 'gel', addonIds: [] },
          ],
          catalog,
          options,
        ),
      ),
    ).toBe('duplicate_service')
    expect(quoteError(() => buildQuote([{ serviceId: 'nope', addonIds: [] }], catalog, options))).toBe(
      'unknown_service',
    )
    // The add-on exists but the extension service does not offer it.
    expect(quoteError(() => buildQuote([{ serviceId: 'ext', addonIds: ['removal'] }], catalog, options))).toBe(
      'addon_not_offered',
    )
  })
})

describe('depositFor', () => {
  it('applies the threshold and the fixed amount', () => {
    expect(depositFor(99_999, fixedDeposit)).toBe(0)
    expect(depositFor(100_000, fixedDeposit)).toBe(20_000)
    expect(depositFor(0, fixedDeposit)).toBe(0)
  })

  it('never asks for more than the total', () => {
    expect(depositFor(15_000, { ...fixedDeposit, minTotal: 0 })).toBe(15_000)
  })

  it('supports a percentage rounded to 1,000₮ and no deposit at all', () => {
    const percent: DepositPolicy = { mode: 'percent', fixedAmount: 0, percentBps: 3000, minTotal: 0 }
    expect(depositFor(125_000, percent)).toBe(38_000)
    expect(depositFor(125_000, { ...percent, mode: 'none' })).toBe(0)
  })
})

// Appointment price and duration calculation. Pure and isomorphic: the
// browser uses it for instant feedback, the server recalculates from freshly
// loaded catalogue rows and ignores any total sent by the client.
import { percentOf } from '@/lib/money'

export type PriceType = 'fixed' | 'from'

export interface CatalogService {
  id: string
  name: string
  categoryName: string
  durationMinutes: number
  price: number
  priceType: PriceType
  bufferMinutes: number | null
  addonIds: string[]
}

export interface CatalogAddon {
  id: string
  name: string
  durationMinutes: number
  price: number
  priceType: PriceType
}

export interface SelectionItem {
  serviceId: string
  addonIds: string[]
}

export interface DepositPolicy {
  mode: 'none' | 'fixed' | 'percent'
  fixedAmount: number
  percentBps: number
  minTotal: number
}

export interface QuoteLine {
  serviceId: string
  name: string
  categoryName: string
  durationMinutes: number
  price: number
  priceType: PriceType
  addons: { addonId: string; name: string; durationMinutes: number; price: number; priceType: PriceType }[]
}

export interface Quote {
  lines: QuoteLine[]
  servicesTotal: number
  addonsTotal: number
  total: number
  durationMinutes: number
  /** Buffer kept free after the appointment (largest of the services' buffers). */
  bufferMinutes: number
  hasFromPrice: boolean
  deposit: number
}

export class QuoteError extends Error {
  constructor(
    public readonly code: 'empty' | 'unknown_service' | 'duplicate_service' | 'addon_not_offered' | 'too_many',
    message: string,
  ) {
    super(message)
    this.name = 'QuoteError'
  }
}

export function depositFor(total: number, policy: DepositPolicy): number {
  if (policy.mode === 'none' || total <= 0 || total < policy.minTotal) return 0
  const raw = policy.mode === 'fixed' ? policy.fixedAmount : percentOf(total, policy.percentBps, 1000)
  return Math.max(0, Math.min(raw, total))
}

/**
 * Builds the quote for a selection. Each service appears once; an add-on is
 * counted once per service it is attached to and only if that service offers it.
 */
export function buildQuote(
  items: SelectionItem[],
  catalog: { services: Map<string, CatalogService>; addons: Map<string, CatalogAddon> },
  options: { defaultBufferMinutes: number; deposit: DepositPolicy; maxServices?: number },
): Quote {
  if (items.length === 0) throw new QuoteError('empty', 'Дор хаяж нэг үйлчилгээ сонгоно уу.')
  if (options.maxServices && items.length > options.maxServices) {
    throw new QuoteError('too_many', `Нэг захиалгад хамгийн ихдээ ${options.maxServices} үйлчилгээ сонгоно.`)
  }
  const seen = new Set<string>()
  const lines: QuoteLine[] = []
  let servicesTotal = 0
  let addonsTotal = 0
  let durationMinutes = 0
  let bufferMinutes = 0
  let hasFromPrice = false

  for (const item of items) {
    if (seen.has(item.serviceId)) throw new QuoteError('duplicate_service', 'Нэг үйлчилгээг хоёр удаа сонгосон байна.')
    seen.add(item.serviceId)
    const service = catalog.services.get(item.serviceId)
    if (!service) throw new QuoteError('unknown_service', 'Сонгосон үйлчилгээ одоо идэвхгүй байна. Дахин сонгоно уу.')
    const addons: QuoteLine['addons'] = []
    for (const addonId of new Set(item.addonIds)) {
      const addon = catalog.addons.get(addonId)
      if (!addon || !service.addonIds.includes(addonId)) {
        throw new QuoteError('addon_not_offered', `«${service.name}» үйлчилгээнд энэ нэмэлтийг сонгох боломжгүй.`)
      }
      addons.push({ addonId, name: addon.name, durationMinutes: addon.durationMinutes, price: addon.price, priceType: addon.priceType })
      addonsTotal += addon.price
      durationMinutes += addon.durationMinutes
      if (addon.priceType === 'from') hasFromPrice = true
    }
    lines.push({
      serviceId: service.id,
      name: service.name,
      categoryName: service.categoryName,
      durationMinutes: service.durationMinutes,
      price: service.price,
      priceType: service.priceType,
      addons,
    })
    servicesTotal += service.price
    durationMinutes += service.durationMinutes
    bufferMinutes = Math.max(bufferMinutes, service.bufferMinutes ?? options.defaultBufferMinutes)
    if (service.priceType === 'from') hasFromPrice = true
  }

  const total = servicesTotal + addonsTotal
  return {
    lines,
    servicesTotal,
    addonsTotal,
    total,
    durationMinutes,
    bufferMinutes,
    hasFromPrice,
    deposit: depositFor(total, options.deposit),
  }
}

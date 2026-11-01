// Money is always an integer number of tögrög (MNT). Never use floats for
// amounts; percentages are integer basis points (1000 = 10%).

export const CURRENCY = 'MNT' as const
export const CURRENCY_SYMBOL = '₮'

/** Groups digits with commas: 1250000 -> "1,250,000". Keeps one decimal if present. */
export function formatNumber(value: number): string {
  const negative = value < 0
  const abs = Math.abs(value)
  const [intPart, decPart] = (Math.round(abs * 10) / 10).toString().split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${decPart ? `.${decPart}` : ''}`
}

/** 125000 -> "125,000₮", -45800 -> "-45,800₮". */
export function formatMoney(amount: number, options: { showPlus?: boolean } = {}): string {
  const prefix = options.showPlus && amount > 0 ? '+' : ''
  return `${prefix}${formatNumber(Math.round(amount))}${CURRENCY_SYMBOL}`
}

/** Rounds half away from zero to the nearest whole tögrög. */
export function roundMoney(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** Rounds half away from zero to a step (e.g. 100₮). Step <= 1 means whole tögrög. */
export function roundToStep(value: number, step: number): number {
  if (!step || step <= 1) return roundMoney(value)
  const sign = value < 0 ? -1 : 1
  return sign * Math.round(Math.abs(value) / step) * step
}

/** Percentage of an amount, using basis points (2000 = 20%). */
export function percentOf(amount: number, bps: number, step = 1): number {
  return roundToStep((amount * bps) / 10000, step)
}

/**
 * Quantity × unit price without float drift. Quantities may carry one decimal
 * (e.g. 8.5 m²); the result is rounded to whole tögrög.
 */
export function multiplyQuantity(quantity: number, unitPrice: number): number {
  const tenths = Math.round(quantity * 10)
  return roundMoney((tenths * unitPrice) / 10)
}

/** 2000 -> "20%", 1050 -> "10.5%". */
export function formatPercent(bps: number): string {
  const pct = bps / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

/** Parses user input like "125,000₮" or "125 000" into an integer, or null. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s,₮]/g, '')
  if (!/^-?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isSafeInteger(n) ? n : null
}

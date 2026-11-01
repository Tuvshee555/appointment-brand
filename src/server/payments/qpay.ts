// QPay Merchant API v2 adapter.
//
// Verified against developer.qpay.mn (Merchant V2 + eBarimt 3.0 pages, 2026-10):
//   POST   /v2/auth/token            Basic base64(client_id:client_secret)
//   POST   /v2/auth/refresh          Bearer refresh_token
//   POST   /v2/invoice               invoice_code, sender_invoice_no (unique), invoice_receiver_code,
//                                    invoice_description, amount, callback_url
//                                    (+ eBarimt 3.0: calculate_vat, district_code, tax_type, lines[])
//   DELETE /v2/invoice/{invoice_id}
//   POST   /v2/payment/check         { object_type: "INVOICE", object_id, offset: { page_number, page_limit } }
//   DELETE /v2/payment/refund/{payment_id}   { note, callback_url }
//   POST   /v2/ebarimt_v3/create     { payment_id, ebarimt_receiver_type: CITIZEN|COMPANY, ebarimt_receiver }
//   DELETE /v2/ebarimt_v3/{payment_id}       { note }
//
// The official pages do not publish response schemas, so responses are read
// defensively (e.g. invoice_id / qr_text / qr_image / qPay_shortUrl / urls[],
// payment check count / paid_amount / rows[].payment_status) and anything
// unexpected raises PaymentProviderError. Verify against the sandbox before
// going live. A callback is only a hint: payment is confirmed exclusively by
// POST /v2/payment/check (QPay forbids cron polling of that endpoint).

import {
  PaymentProviderError,
  type CreateInvoiceInput,
  type EbarimtInput,
  type EbarimtResult,
  type OnlinePaymentProvider,
  type ProviderCheck,
  type ProviderInvoice,
} from './provider'

type Json = Record<string, unknown>

const BASE_URLS = {
  sandbox: 'https://merchant-sandbox.qpay.mn',
  production: 'https://merchant.qpay.mn',
} as const

interface Token {
  access: string
  refresh: string | null
  expiresAt: number
  refreshExpiresAt: number
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** QPay has returned both relative seconds and absolute epoch seconds for expires_in. */
function expiry(value: unknown, fallbackSeconds: number): number {
  const n = num(value)
  if (n === null) return Date.now() + fallbackSeconds * 1000
  return n > 1_000_000_000 ? n * 1000 : Date.now() + n * 1000
}

export class QPayProvider implements OnlinePaymentProvider {
  readonly name = 'qpay' as const
  private token: Token | null = null
  private readonly base: string

  constructor(
    readonly mode: 'sandbox' | 'production',
    private readonly creds: { clientId: string; clientSecret: string; invoiceCode: string },
    baseUrl?: string,
  ) {
    // Request paths already start with /v2, so a base URL ending in /v2 is trimmed.
    this.base = (baseUrl || BASE_URLS[mode]).replace(/\/+$/, '').replace(/\/v2$/, '')
  }

  private async request(path: string, init: { method: string; body?: unknown; auth?: string }): Promise<Json> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: init.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: init.auth ?? `Bearer ${await this.accessToken()}`,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      })
      const text = await res.text()
      let data: Json = {}
      try {
        data = text ? (JSON.parse(text) as Json) : {}
      } catch {
        data = { raw: text.slice(0, 200) }
      }
      if (!res.ok) {
        const message = str(data.message) ?? str(data.error) ?? `QPay HTTP ${res.status}`
        throw new PaymentProviderError(`QPay: ${message}`, res.status)
      }
      return data
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err
      throw new PaymentProviderError(err instanceof Error ? `QPay холболт: ${err.message}` : 'QPay холболтын алдаа')
    } finally {
      clearTimeout(timer)
    }
  }

  private async accessToken(): Promise<string> {
    const now = Date.now()
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.access
    if (this.token?.refresh && this.token.refreshExpiresAt - 60_000 > now) {
      try {
        const data = await this.request('/v2/auth/refresh', { method: 'POST', auth: `Bearer ${this.token.refresh}` })
        this.storeToken(data)
        return this.token!.access
      } catch {
        this.token = null
      }
    }
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString('base64')
    const data = await this.request('/v2/auth/token', { method: 'POST', auth: `Basic ${basic}` })
    this.storeToken(data)
    return this.token!.access
  }

  private storeToken(data: Json) {
    const access = str(data.access_token)
    if (!access) throw new PaymentProviderError('QPay: access_token ирсэнгүй')
    this.token = {
      access,
      refresh: str(data.refresh_token),
      expiresAt: expiry(data.expires_in, 3000),
      refreshExpiresAt: expiry(data.refresh_expires_in, 6000),
    }
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const body: Json = {
      invoice_code: this.creds.invoiceCode,
      sender_invoice_no: input.reference,
      invoice_receiver_code: input.receiverCode,
      invoice_description: input.description.slice(0, 255),
      amount: input.amount,
      callback_url: input.callbackUrl,
    }
    if (input.ebarimt) {
      body.calculate_vat = input.ebarimt.calculateVat
      body.district_code = input.ebarimt.districtCode
      body.tax_type = input.ebarimt.taxType
      body.lines = input.ebarimt.lines.map((l) => ({
        line_description: l.description.slice(0, 255),
        line_quantity: l.quantity,
        line_unit_price: l.unitPrice,
        classification_code: input.ebarimt!.classificationCode,
      }))
    }
    const data = await this.request('/v2/invoice', { method: 'POST', body })
    const providerInvoiceId = str(data.invoice_id) ?? str(data.id)
    if (!providerInvoiceId) throw new PaymentProviderError('QPay: нэхэмжлэхийн дугаар ирсэнгүй')
    const urls = Array.isArray(data.urls) ? (data.urls as Json[]) : []
    return {
      providerInvoiceId,
      qrText: str(data.qr_text),
      qrImage: str(data.qr_image),
      shortUrl: str(data.qPay_shortUrl) ?? str(data.qpay_short_url) ?? str(data.short_url),
      deeplinks: urls
        .map((u) => ({ name: str(u.name) ?? '', description: str(u.description), logo: str(u.logo), link: str(u.link) ?? '' }))
        .filter((u) => u.link),
    }
  }

  async checkInvoice(providerInvoiceId: string): Promise<ProviderCheck> {
    const data = await this.request('/v2/payment/check', {
      method: 'POST',
      body: { object_type: 'INVOICE', object_id: providerInvoiceId, offset: { page_number: 1, page_limit: 100 } },
    })
    const rows = Array.isArray(data.rows) ? (data.rows as Json[]) : []
    const payments = rows
      .map((r) => ({
        providerPaymentId: str(r.payment_id) ?? '',
        status: (str(r.payment_status) ?? '').toUpperCase(),
        amount: num(r.payment_amount) ?? 0,
      }))
      .filter((p) => p.providerPaymentId)
    const paidRows = payments.filter((p) => p.status === 'PAID')
    const paidAmount = num(data.paid_amount) ?? paidRows.reduce((s, p) => s + p.amount, 0)
    return { paid: paidRows.length > 0 && paidAmount > 0, paidAmount, payments }
  }

  async cancelInvoice(providerInvoiceId: string): Promise<void> {
    await this.request(`/v2/invoice/${encodeURIComponent(providerInvoiceId)}`, { method: 'DELETE' })
  }

  async refundPayment(providerPaymentId: string, note: string, callbackUrl: string): Promise<void> {
    await this.request(`/v2/payment/refund/${encodeURIComponent(providerPaymentId)}`, {
      method: 'DELETE',
      body: { note: note.slice(0, 1000), callback_url: callbackUrl },
    })
  }

  async createEbarimt(input: EbarimtInput): Promise<EbarimtResult> {
    const body: Json = { payment_id: input.providerPaymentId, ebarimt_receiver_type: input.receiverType }
    if (input.receiver) body.ebarimt_receiver = input.receiver
    const data = await this.request('/v2/ebarimt_v3/create', { method: 'POST', body })
    return {
      receiptId: str(data.id) ?? str(data.ebarimt_id) ?? str(data.barimt_id),
      lottery: str(data.ebarimt_lottery) ?? str(data.lottery),
      qrData: str(data.ebarimt_qr_data) ?? str(data.qr_data),
      amount: num(data.amount) ?? num(data.barimt_amount),
      vatAmount: num(data.vat_amount) ?? num(data.barimt_vat),
      raw: Object.fromEntries(Object.keys(data).map((k) => [k, typeof data[k]])),
    }
  }

  async cancelEbarimt(providerPaymentId: string, note: string): Promise<void> {
    await this.request(`/v2/ebarimt_v3/${encodeURIComponent(providerPaymentId)}`, { method: 'DELETE', body: { note } })
  }
}

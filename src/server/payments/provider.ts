// Payment provider abstraction. QPay is the online provider (real API or the
// clearly labelled simulation used by the public demo); cash, card and bank
// transfer are recorded by staff and need no adapter.

export interface InvoiceLine {
  description: string
  quantity: number
  unitPrice: number
}

export interface CreateInvoiceInput {
  /** Our unique reference (QPay sender_invoice_no). */
  reference: string
  amount: number
  description: string
  receiverCode: string
  callbackUrl: string
  /** Present when eBarimt 3.0 data must travel with the invoice. */
  ebarimt?: {
    districtCode: string
    classificationCode: string
    taxType: string
    calculateVat: boolean
    lines: InvoiceLine[]
  } | null
}

export interface ProviderInvoice {
  providerInvoiceId: string
  qrText: string | null
  qrImage: string | null
  shortUrl: string | null
  deeplinks: { name: string; description: string | null; logo: string | null; link: string }[]
}

export interface ProviderPayment {
  providerPaymentId: string
  status: string
  amount: number
}

export interface ProviderCheck {
  paid: boolean
  paidAmount: number
  payments: ProviderPayment[]
}

export interface EbarimtInput {
  providerPaymentId: string
  receiverType: 'CITIZEN' | 'COMPANY'
  receiver: string | null
}

export interface EbarimtResult {
  receiptId: string | null
  lottery: string | null
  qrData: string | null
  amount: number | null
  vatAmount: number | null
  raw: Record<string, unknown>
}

export interface OnlinePaymentProvider {
  readonly name: 'qpay'
  readonly mode: 'mock' | 'sandbox' | 'production'
  createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice>
  checkInvoice(providerInvoiceId: string): Promise<ProviderCheck>
  cancelInvoice(providerInvoiceId: string): Promise<void>
  refundPayment(providerPaymentId: string, note: string, callbackUrl: string): Promise<void>
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'PaymentProviderError'
  }
}

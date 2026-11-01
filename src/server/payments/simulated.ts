// Simulated QPay for the public portfolio demo. It behaves like the real
// provider from the server's point of view: an invoice is created, and the
// paid state lives on the "provider side" (a payment_records row written when
// the visitor presses the test-payment button, standing in for their bank
// app). The payment service only marks a deposit paid after checkInvoice()
// reports it — never because the browser said so. No money moves.
import { and, eq } from 'drizzle-orm'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { randomToken } from '@/server/security/crypto'
import type { CreateInvoiceInput, OnlinePaymentProvider, ProviderCheck, ProviderInvoice } from './provider'

export const SIMULATED_BANK_EVENT = 'simulated_bank_payment'

export class SimulatedQPay implements OnlinePaymentProvider {
  readonly name = 'qpay' as const
  readonly mode = 'mock' as const

  constructor(private readonly db: Database) {}

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    return {
      providerInvoiceId: `SIM-${randomToken(9)}`,
      // Deliberately not a payable QR payload.
      qrText: `SUVD-DEMO|NOT-A-PAYMENT|${input.reference}|${input.amount}`,
      qrImage: null,
      shortUrl: null,
      deeplinks: [],
    }
  }

  async checkInvoice(providerInvoiceId: string): Promise<ProviderCheck> {
    const rows = await this.db
      .select({ amount: t.payments.amount, recordId: t.paymentRecords.id })
      .from(t.paymentRecords)
      .innerJoin(t.payments, eq(t.payments.id, t.paymentRecords.paymentId))
      .where(and(eq(t.payments.providerInvoiceId, providerInvoiceId), eq(t.paymentRecords.event, SIMULATED_BANK_EVENT)))
      .limit(1)
    if (!rows[0]) return { paid: false, paidAmount: 0, payments: [] }
    return {
      paid: true,
      paidAmount: rows[0].amount,
      payments: [{ providerPaymentId: `SIMPAY-${rows[0].recordId.slice(0, 8)}`, status: 'PAID', amount: rows[0].amount }],
    }
  }

  async cancelInvoice(): Promise<void> {}

  async refundPayment(): Promise<void> {}
}

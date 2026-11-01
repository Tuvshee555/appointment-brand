// Chooses the payment provider. QPAY_MODE=mock (default) is the labelled
// simulation; sandbox/production use the real QPay Merchant API v2.
// Safety: production QPay is refused while DEMO_MODE=true, so the public
// portfolio can never take real money.
import type { Database } from '@/server/db/client'
import { isDemoMode } from '@/server/notifications'
import { PaymentProviderError, type OnlinePaymentProvider } from './provider'
import { QPayProvider } from './qpay'
import { SimulatedQPay } from './simulated'

export type PaymentMode = 'mock' | 'sandbox' | 'production'

export function paymentMode(): PaymentMode {
  const mode = process.env.QPAY_MODE
  if (mode === 'production') return isDemoMode() ? 'mock' : 'production'
  if (mode === 'sandbox') return 'sandbox'
  return 'mock'
}

export function qpayCredentials() {
  const clientId = process.env.QPAY_USERNAME || process.env.QPAY_CLIENT_ID
  const clientSecret = process.env.QPAY_PASSWORD || process.env.QPAY_CLIENT_SECRET
  const invoiceCode = process.env.QPAY_INVOICE_CODE
  return clientId && clientSecret && invoiceCode ? { clientId, clientSecret, invoiceCode } : null
}

export function getPaymentProvider(db: Database): OnlinePaymentProvider {
  const mode = paymentMode()
  if (mode === 'mock') return new SimulatedQPay(db)
  const creds = qpayCredentials()
  if (!creds)
    throw new PaymentProviderError('QPay тохиргоо дутуу байна (QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE).')
  // Only use QPAY_BASE_URL when it matches the selected mode.
  const base = process.env.QPAY_BASE_URL
  const matches = base && (mode === 'sandbox' ? base.includes('sandbox') : !base.includes('sandbox'))
  return new QPayProvider(mode, creds, matches ? base : undefined)
}

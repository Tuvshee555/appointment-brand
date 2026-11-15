// The earlier Messenger-only callback URL, kept so a Page subscribed to it keeps
// working. It is the same handler as /api/meta/webhook (signature check,
// stored receipts, no duplicate replies, Instagram, staff takeover).
export { GET, POST } from '../../meta/webhook/route'

export const maxDuration = 60

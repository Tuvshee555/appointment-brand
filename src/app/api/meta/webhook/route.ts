// Meta webhook for the Сувд Page and its linked Instagram account: one callback
// URL for both (the payload's "object" tells them apart). See
// src/server/meta/webhook.ts and docs/meta-integration.md.
//
// Closed (503) until META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_ID and
// META_PAGE_ACCESS_TOKEN are set. Replies are sent only with META_OUTBOUND_ENABLED=true.
import { after } from 'next/server'
import { db } from '@/server/db'
import { suvdMetaAdapter } from '@/server/meta/adapter'
import { receiveWebhook, verifySubscription } from '@/server/meta/webhook'

export const maxDuration = 60

export function GET(req: Request) {
  return verifySubscription(req)
}

export function POST(req: Request) {
  return receiveWebhook(req, db, suvdMetaAdapter, after)
}

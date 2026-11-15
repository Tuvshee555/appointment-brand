# Meta integration (Messenger, Instagram)

Сувд's assistant answers Facebook Messenger and Instagram Direct messages with the Сувд booking assistant (services, prices, specialists, real availability) — the same engine, data, rate limits and takeover rules as the website chat. Nothing about the assistant's intelligence changed; this is the transport.

**State:** code ready and tested with signed, mocked Meta events. Not connected: no Meta credentials are configured, so the webhook answers 503.

## Callback

- Callback URL (Messenger and Instagram, one URL): `https://appointment-brand.vercel.app/portfolio/appointments/api/meta/webhook`
- Facebook Page: https://www.facebook.com/suvd.nail.atelier
- Webhook fields: Page — `messages`, `messaging_postbacks`, `message_echoes`, and `feed` only if comment replies are wanted. Instagram — `messages`, `messaging_postbacks`, and `comments` only if comment replies are wanted.

## Environment (server only — never a NEXT_PUBLIC_ name)

| Variable                       | Kind                                                                                                     | Required      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------- |
| `META_APP_SECRET`              | Meta app: App secret (verifies `X-Hub-Signature-256`)                                                    | yes           |
| `META_VERIFY_TOKEN`            | Webhook verification: your own random string, 16+ characters                                             | yes           |
| `META_PAGE_ID`                 | Page: numeric Page id (routing; other Pages are ignored)                                                 | yes           |
| `META_PAGE_ACCESS_TOKEN`       | Page: Page access token (secret)                                                                         | yes           |
| `META_INSTAGRAM_ACCOUNT_ID`    | Instagram: professional account id linked to the Page                                                    | for Instagram |
| `META_APP_ID`                  | Meta app id (recognises the bot's own echoes)                                                            | optional      |
| `META_GRAPH_API_VERSION`       | Graph version, default `v25.0`                                                                           | optional      |
| `META_OUTBOUND_ENABLED`        | `true` to actually send replies; otherwise replies are logged as `suppressed`                            | optional      |
| `META_COMMENT_REPLIES_ENABLED` | `true` for one private reply to a comment with a trigger word                                            | optional      |
| `META_COMMENT_KEYWORDS`        | comma-separated trigger words; default covers price, availability, order in Cyrillic and Latin Mongolian | optional      |

Use only credentials of the new Meta app and Page. Never reuse any value from the old, compromised Meta account.

## Permissions to request (Meta App Review)

- Messenger: `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`.
- Instagram via the Page (Facebook Login): `instagram_basic`, `instagram_manage_messages`; for comment replies `instagram_manage_comments`.
- Page comment replies: the `feed` webhook field and `pages_messaging`; Meta may also require `pages_read_user_content` for comment content — confirm in App Review.
- The Page token must come from a person with the MESSAGING task on the Page.

## How it behaves

1. `GET` echoes `hub.challenge` only for the right verify token (constant-time compare).
2. `POST` verifies the HMAC-SHA256 signature over the raw body, then accepts only events for `META_PAGE_ID` / `META_INSTAGRAM_ACCOUNT_ID`, stores each one in `meta_webhook_events` (keyed by Meta's message or comment id) and answers 200 at once. A storage failure answers 503, so Meta retries.
3. After the response, each stored event is claimed with a lease and answered. A Meta retry of the same event is recognised and never answered twice; the engine also de-duplicates by message id; delivered reply parts are counted, so a retry after a failed send never repeats a part. A timeout is recorded as `uncertain` and never resent automatically. Up to 5 attempts; a later webhook also picks up events an interrupted run left behind.
4. Replies are `messaging_type: RESPONSE` to what the person just did, only inside Meta's 24-hour window (7 days for a comment's private reply). There is no broadcast, campaign or message-tag code.
5. Human handover: a reply typed in the Page inbox (Meta Business Suite) arrives as an echo; the conversation is taken over, the reply is logged as a staff message and the assistant stays silent until it is handed back (or the owner's auto-resume time passes). Staff answer Messenger/Instagram customers from the Page inbox; the admin's reply box refuses these chats with a message saying so.
6. A booking is made only after the customer taps «Баталгаажуулах» under the summary (a quick reply carrying the draft id), through the same booking services as the website (day lock, re-check, no-overlap constraint). Bookings from Messenger are stored with source "messenger". The private manage link is never sent to Meta. The old URL /api/messenger/webhook stays as an alias.
7. Comments (opt-in): one private reply per matching comment; the Page's own comments, comments without a trigger word and comments older than 7 days are skipped.
8. Logs carry codes and ids only — never message text or tokens. The customer's text is dropped from the receipt once handled; receipts are purged after 30 days by the daily job.

Conversations: AI туслах → Яриа (real Messenger/Instagram chats are hidden from the public demo role).

## Go-live checklist

1. New Meta app (Business type), Messenger and Instagram products; link the Instagram professional account to the Page.
2. Set the variables above in Vercel Production (sensitive), keep `META_OUTBOUND_ENABLED` unset, deploy, run the migration (`meta_webhook_events`).
3. Register the callback URL and verify token; subscribe the fields; subscribe the Page (`/{PAGE_ID}/subscribed_apps`).
4. Send a test message: it must appear in the admin with outcome `suppressed`. Then set `META_OUTBOUND_ENABLED=true`, redeploy and test again.
5. Test a staff reply from the Page inbox (the assistant must go quiet) and the hand-back.
6. Submit App Review for the permissions above before real customers write; until then only app roles (admins, testers) can use it.

Tests: `tests/unit/meta.test.ts`, `tests/integration/meta-webhook.test.ts`.

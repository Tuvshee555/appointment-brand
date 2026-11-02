# Сувд assistant: architecture

The second business chatbot built on the Lorentz V1 conversation pattern (reference: the Lorentz
repository, branch `chatbot-intelligence`, commit `69e4110`, read only). Lorentz is a shop; Сувд
books appointments. The engine is shared in spirit and structure; the business adapter differs.

## Principle

The customer's words are read by code first (rules) and, only when the rules cannot read a
message, by a language model that may propose a structured reading. Everything the assistant
states as a fact — a price, a duration, a free time, a specialist, a booking — comes from the
application's own services and database. Bookings, cancellations and moves happen only after the
customer says "yes" to a summary, through the same services the website uses. The assistant never
says something happened unless the backend did it.

## Layout

| Concern                                                                                          | Module                                         | Reuse for another business                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| Mongolian text: Latin → Cyrillic aliases, glued words, typo-tolerant phonetic matching           | `engine/text.ts`                               | Keep; add the new business's words to the alias table |
| Dates and clock times, read against business hours ("3 tsagt" → 15:00)                           | `engine/when.ts`                               | Keep                                                  |
| Short answers: yes/no, numbered picks, phone, booking reference, name                            | `engine/signals.ts`                            | Keep (change the reference prefix)                    |
| Intents and topics, read from the current message only                                           | `engine/intents.ts`                            | Keep; adjust topic words                              |
| Vocabulary matching (services, categories, staff), longest phrase wins                           | `engine/vocab.ts`                              | Keep                                                  |
| Owner FAQ matching, quoted verbatim                                                              | `engine/knowledge.ts`                          | Keep                                                  |
| Fact check for model text (amounts, times, phones, e-mails, links, action claims)                | `engine/verify.ts`                             | Keep                                                  |
| Presentation rules (plain text, one emoji, no repeated greeting)                                 | `engine/present.ts`                            | Keep                                                  |
| Model adapters: OpenAI over fetch (default `gpt-4.1-mini`), Anthropic SDK; allow-list and prices | `engine/model.ts`                              | Keep                                                  |
| One message → one grounded reading; model proposals grounded to catalogue keys                   | `reading.ts`                                   | Keep                                                  |
| The dialogue: slot memory, one question at a time, booking/cancel/reschedule, hand-over          | `turn.ts`                                      | Keep; it depends only on the port                     |
| Model prompts (interpretation, open answers) and evidence for the fact check                     | `models.ts`                                    | Keep; change the business description                 |
| Persistence: session, lease, repeated sends, takeover, budget, events, staff alert               | `handler.ts`                                   | Keep                                                  |
| Settings, usage ledger and budget                                                                | `settings.ts`, `usage.ts`                      | Keep                                                  |
| **Business adapter**: catalogue, staff, hours, availability, booking, cancel, reschedule         | `salon/port.ts` (contract), `salon/adapter.ts` | **Replace**                                           |
| **Business vocabulary**: service aliases, generic words, services not offered                    | `salon/vocabulary.ts`                          | **Replace**                                           |

All paths are under `src/server/assistant/`.

## One turn (`turn.ts`)

0. **Safety**: a request for a person or a complaint hands over (`human`, `complaint`); questions
   about other customers or staff's private lives are refused; "I paid" is never confirmed
   (deposits are confirmed only by `verifyPayment()`); a beauty service the salon does not offer
   is said so, never substituted.
1. **A summary waiting for an answer**: "yes" books / cancels / moves; "no" drops it; a new time or
   service changes the summary.
2. **Existing bookings** (status, cancel, reschedule): the booking must be one this chat created,
   or proved with **reference + the phone on that booking** (rate-limited, one answer for "no such
   booking" and "wrong phone", three attempts). Phone alone is never enough.
3. **Booking**: remembers service, specialist, day, time, name and phone across messages; asks
   one question at a time; offers only times from the availability engine; explains why a time is
   not possible (closed, before opening, would end after closing, taken, break).
4. **Information**: prices, durations, services, specialists, hours, address, policies, deposit,
   payment — from the catalogue and settings; the owner's verified FAQ verbatim.
5. **Open questions**: the model's answer from the facts given, only if it passes the fact check.
6. **Unknown**: an honest "I don't have a reliable answer", the phone number and a button to reach
   a person; a second unknown in a row hands over.

Short answers are read in the context of the last question (`state.awaiting`): "15 tsag" after a
list of times is 15:00, "2" after a numbered list is the second item, "Za bolno" after an offer is
agreement, a name is only read as a name when the assistant asked for it.

## The model

- Default `gpt-4.1-mini` (the Lorentz V1 held-out comparison: same accuracy as `gpt-4.1` at about
  a fifth of the cost). Allow-list in the admin: GPT-4.1 mini, GPT-4.1, GPT-4o mini, Claude Haiku
  5.5, Sonnet 5.5, Opus 5.5. "Auto" uses OpenAI when `OPENAI_API_KEY` is set, otherwise Anthropic.
- **Interpretation** (`useModelForUnderstanding`): only for messages the rules cannot read. The
  model returns JSON with catalogue keys (`S1`, `T2`); `groundProposal()` keeps only real keys,
  real dates inside the booking window and valid times.
- **Open answers** (`useModelForAnswers`): from a facts block (catalogue, staff, hours, policies,
  verified FAQ); `REFER` when the facts lack the answer; `verifyReply()` rejects any unknown amount,
  time, phone, e-mail or link and any claim of a booking, change or payment.
- No key, a provider error, a timeout or a spent daily budget: the rules answer. A model is never
  switched to a cheaper one silently.
- Spend: `salon.assistant_usage` per day, environment, model and purpose (test chat counted as
  `test-*`), estimated from the price table. Budget `dailyBudgetUsd` (0 = no limit).

## Data

Migration `drizzle/0002_assistant_intelligence.sql` (additive, `salon` schema):

- `assistant_settings` (one row per salon; defaults apply without it)
- `assistant_knowledge` (owner FAQ; quoted only when active **and** verified; editing clears the
  tick; answers with prices are refused)
- `assistant_events` (what the assistant did: bookings, changes, verification, hand-over,
  unanswered questions, model and system errors; no message text, no contact details)
- `assistant_usage` (model spend ledger)
- `chat_sessions`: `status` (bot / handoff / staff / closed), hand-over reason and time, assigned
  staff, `lease_until/lease_owner`, `locale`, `is_test`
- `chat_messages`: `client_message_id` (unique per session: a repeated send returns the stored
  reply), `author_admin_id` (staff replies)

Booking links with the private manage token are shown once in the live reply and are never stored
with the message. Customer messages that answer a contact question or contain a phone number are
marked `sensitive` and hidden in the admin from staff without contact access and from demo visitors.

## Admin («AI туслах», `/admin/assistant`)

Overview · Conversations (take over, reply, hand back, resolve; contacts redacted) · Knowledge ·
Settings · Analytics (conversations, bookings, conversion, hand-overs, intents, AI share, response
time, model cost) · Activity (assistant events and staff changes) · Try it (the real engine; its
bookings, cancellations and moves are validated and rolled back) · Problems.

Permissions: `assistant.view` (owner, manager, reception, demo visitor), `assistant.reply`
(owner, manager, reception), `assistant.manage` (owner, manager). Every change goes through
`runAdminAction()`, so demo visitors get a rolled-back dry run.

## Porting to the cleaning-service project

Keep everything in the table above except the two adapter rows, then:

1. Implement `SalonPort` (`salon/port.ts`) over the cleaning business's services: catalogue
   (cleaning types, prices, durations), "staff" (cleaners or teams), hours, availability (the
   same `day()` / `openDays()` shape), `book()`, `findBooking()` (reference + phone), `cancel()`,
   `reschedule()`.
2. Write its `vocabulary.ts`: service aliases (Latin and English spellings), generic words with a
   usual meaning, services not offered.
3. Extend the booking memory if the business needs more slots (a cleaning visit needs an
   address): add the slot to `BookingMemory`, one `askAddress()` step before the summary, and the
   field to the summary card. The rest of the dialogue is unchanged.
4. Change the business description in `models.ts` prompts and the copy in `turn.ts`.
5. Copy the evaluation harness and write that business's gate and held-out sets.

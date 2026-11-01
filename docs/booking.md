# Booking engine

## Customer flow

1. **Service.** Up to 3 services, each with optional add-ons (extra price and time).
2. **Specialist.** A named specialist, or «Аль ч мастер» (any available).
3. **Date.** The month calendar shows only days with real availability.
4. **Time.** Start times grouped by morning, afternoon and evening.
5. **Details.** Name and phone (8-digit Mongolian number), optional email and note.
6. **Review.** Services, specialist, time, total, deposit and policy.
7. **Done.** Reference `SV-XXXXXX`, status, deposit payment if required, and a private
   manage link for cancelling or rescheduling.

The browser computes a preview quote, but the server rebuilds the quote from fresh catalogue
rows and ignores any price sent by the client.

## Availability

`lib/availability/engine.ts` is pure: times of day are minutes from Ulaanbaatar midnight and
instants are UTC. A start time is offered for a specialist only if all of these hold:

- the salon is open that day (weekly hours, overridden by special days and holidays);
- the appointment fits inside both the salon hours and the specialist's shift;
- it does not touch a break;
- it starts after `now + minimum notice` (default 120 min) and within the booking window
  (default 60 days);
- it does not overlap the specialist's time off;
- `[start, end + buffer)` does not overlap any slot-holding appointment, which itself
  occupies `[start, end + its buffer)`.

The buffer is the largest of the chosen services' buffers, or the salon default (10 min).
Starts step by the slot interval (15 min). Only specialists who can perform every chosen
service (staff–service eligibility, which follows their skills) are candidates. "Any
specialist" picks the one with the least booked time that day, then the display order.

## Creating a booking

`createBooking()` inside one transaction:

1. `pg_advisory_xact_lock` for the salon day, which serialises bookings for that date;
2. expire lapsed deposit holds;
3. reload hours, special days, shifts, breaks, time off and appointments, and run the
   engine again for the requested start;
4. insert the customer (upsert by phone), appointment, price snapshot, event, payment
   request and notifications.

If anything raced past this, the exclusion constraint rejects the insert. A conflict returns
«Энэ цаг дөнгөж сая захиалагдсан…» with up to four alternative times.

## Statuses

| Status             | Meaning                                                  | Holds the slot |
| ------------------ | -------------------------------------------------------- | -------------- |
| `awaiting_deposit` | Waiting for the deposit (hold of 20 min)                 | yes            |
| `pending`          | Request waiting for the salon (manual confirmation mode) | yes            |
| `confirmed`        | Confirmed                                                | yes            |
| `completed`        | Service done                                             | yes            |
| `no_show`          | Customer did not come                                    | yes            |
| `cancelled`        | Cancelled by customer or staff                           | no             |
| `rejected`         | Declined by the salon                                    | no             |
| `expired`          | Deposit not paid in time, or request never answered      | no             |
| `rescheduled`      | Replaced by a new appointment                            | no             |

Transitions are enforced by `lib/booking/status.ts`:

- only staff confirm, reject, complete or mark a no-show;
- only the system (a verified payment) confirms a held booking;
- customers may cancel or reschedule their own active booking;
- attendance can only be recorded once the appointment has started;
- finished states are final, except that staff can correct a no-show to completed.

## Deposits

Demo policy: a fixed 20,000₮ deposit for bookings of 100,000₮ or more, payable within
20 minutes. Paying it confirms the booking. A deposit is marked paid only after the provider
reports the payment (`verifyPayment()`), or when staff record money received in the salon.
A browser message alone never changes a payment. Cancelling at least 12 hours ahead refunds
it; a later cancellation or a no-show forfeits it. The policy is editable in Settings.

## Cancel and reschedule

- Customers use the private manage link. Online rescheduling closes 12 hours before the start
  (configurable); cancelling stays open, but a late cancellation forfeits a paid deposit.
- A reschedule is atomic: the new slot is checked like a new booking, a new appointment with
  a new reference and the same price snapshot is created, payments move to it, and the
  original becomes `rescheduled`. If the new slot is gone, nothing changes.
- Every cancellation writes a `cancellation_records` row.

## Background jobs

`/api/cron/maintenance` (daily, Vercel Cron, `Bearer CRON_SECRET`): expires lapsed holds and
unanswered past requests, queues reminders, prunes rate limits, sessions and old demo chats.
In demo mode it refreshes the sample data instead. Holds also expire whenever a booking is
made, so a lapsed hold never blocks a slot.

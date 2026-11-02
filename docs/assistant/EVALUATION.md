# Assistant evaluation

Conversations are run through the real assistant (`handleChat` → `runTurn` → the Сувд adapter)
on a throwaway PostgreSQL with the seeded catalogue, at a fixed clock (Tuesday 2026-11-10 09:00
Ulaanbaatar). Two bookings exist before every case: the customer's own and somebody else's. Each
case runs in a transaction that is rolled back.

## Hard rules (every turn)

The reply is never empty and never contains a control token; every amount is a real catalogue
price (or a sum of up to three); every offered time is re-checked against the availability engine
and must be free; a booking, cancellation or move is claimed only when the database shows it; no
booking is created without a summary the customer confirmed; another customer's name, phone or
booking never appears.

## Sets

- **Gate** (`tests/eval/gate.ts`, in `npm test`): the task's own examples and variations the
  engine was tuned against, plus the held-out cases retired after a fix.
- **Held-out** (`tests/eval/heldout.ts`, `npm run eval:assistant`): written and committed
  (`8e3f7b1`) before the engine existed; not part of `npm test`. A case fixed after a held-out run
  moves to the gate and is replaced by a new case written before it is run.

## Results (rules only — no model key was available)

| Run                           | Set                             | Conversations | Turns correct | Hard rules held |
| ----------------------------- | ------------------------------- | ------------- | ------------- | --------------- |
| 1 (first contact, 2026-11-02) | Held-out                        | 58/62         | 91/95 (95.8%) | 95/95           |
| 2 (after the run-1 fixes)     | Held-out (58 unchanged + 4 new) | 62/62         | 95/95 (100%)  | 95/95           |
| 2                             | Gate                            | 68/68         | 117/117       | 117/117         |

Run 1's misses (fixed, moved to the gate as `r1-*`): an English duration rendered as "1 h";
"eyelash extensions" answered with nail extensions; "gift card" read as a payment card; a privacy
request in Latin letters not recognised. Reports: `EVAL_HELDOUT_RUN1.md`, `EVAL_HELDOUT_RUN2.md`.

These are internal numbers on an invented catalogue with conversations written by the developer;
they are not real-world accuracy. The model path (`gpt-4.1-mini`) was tested with recorded fake
responses only (grounding, rejection of invented facts, failure fallback, budget). A live model
evaluation needs `OPENAI_API_KEY` and approval for its cost: `EVAL_MODEL=1 npm run eval:assistant`
(refused against a Neon `DATABASE_URL`).

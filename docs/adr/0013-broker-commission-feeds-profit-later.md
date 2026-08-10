# 0013 - Broker commission feeds profit later, not now

## Status

Accepted

## Context

Prompt 21 item 4 adds a broker ("D" party) to Purchase: a `broker_id`
reference plus a `broker_commission` amount captured on the purchase
header. The task is explicit that this commission is a real cost input to
eventual landed cost / gross profit once Sales exists, but that no
profit-wiring code should be built now - Sales, landed cost, and gross
profit calculations don't exist yet in the 16-week prototype scope.

This ADR exists so a future session building Sales/profit doesn't have to
rediscover, by reading `purchase_commission` values that go nowhere, that
the field was deliberately captured ahead of its consumer.

## Decisions

- **`broker_commission` is captured and stored now, consumed later.**
  `purchases.broker_commission` (`numeric(18,2)`, nullable) is populated
  at purchase create/update time exactly like every other money field
  (rule 1: parsed via `decimal.js`'s `parseMoney`/`roundAmount` at the
  repository boundary in `purchase.service.ts`, never a raw client
  string). Nothing downstream reads it yet - there is no landed-cost or
  gross-profit calculation in this codebase to feed.

- **`broker_commission_type` exists as a column, not an API field.** A
  nullable `broker_commission_type` enum (`percentage` | `flat`) was
  added to the schema for forward compatibility - so that whichever shape
  a future commission model needs doesn't require a migration to
  retrofit - but is deliberately NOT exposed through
  `createPurchaseSchema`/`updatePurchaseSchema`. Exposing an API field
  with no consumer and no enforced meaning would be confusing dead
  surface; the column can be wired into the validator the same session
  its first real consumer is built.

- **No profit-wiring code exists yet, on purpose.** Landed cost / gross
  profit belongs to a future Sales-adjacent module. When that module is
  built, it should read `purchases.broker_commission` (and
  `broker_commission_type`, once given real meaning) as one of several
  cost inputs alongside freight/insurance/customs/other charges
  (`purchase.additionalCosts`, already established). Until then, broker
  commission is inert data - present in the schema and the purchase
  detail screen for the user to record, absent from every calculation.

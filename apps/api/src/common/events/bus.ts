import type { TenantTx } from "../../database/get-db.js";
import type { EventMap } from "./types.js";

type Handler<K extends keyof EventMap> = (tx: TenantTx, payload: EventMap[K]) => Promise<void>;

/**
 * Synchronous, transaction-scoped - NOT a queue (BullMQ is for durable,
 * out-of-process work; this is neither). `emit` awaits every handler
 * inline, passing the SAME `tx` the publisher is already inside, because
 * rule 6 ("audit writes happen inside the business transaction") and this
 * task's own requirement ("Approve -> stock_movements written, in the
 * same transaction") both demand it: if a subscriber throws, the whole
 * transaction - the publisher's own write included - rolls back. A queued
 * job would run later, on a different connection, after the publisher's
 * transaction has already committed; that can never give this guarantee,
 * only an eventually-consistent one.
 *
 * Subscribers register once, at process boot (modules/inventory's
 * subscriber file, imported for its side effect by app.ts) - never
 * lazily, never per-request.
 *
 * Untyped internally, exactly like core/masters/repository.ts's `raw` - TS
 * can't carry a mapped-type's per-key handler type through a plain `Map`;
 * type safety is enforced at the PUBLIC `on`/`emit` boundary (both fully
 * generic over `keyof EventMap`) instead, which is the only place callers
 * ever touch this class.
 */
class EventBus {
  private readonly handlers = new Map<string, Handler<never>[]>();

  on<K extends keyof EventMap>(event: K, handler: Handler<K>): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  async emit<K extends keyof EventMap>(tx: TenantTx, event: K, payload: EventMap[K]): Promise<void> {
    const handlers = (this.handlers.get(event) ?? []) as Handler<K>[];
    for (const handler of handlers) {
      await handler(tx, payload);
    }
  }
}

export const eventBus = new EventBus();

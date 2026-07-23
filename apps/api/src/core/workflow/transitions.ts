/**
 * The workflow engine's declarative half (FR-107/108: Draft -> Approved ->
 * Posted, each transition its own permission). Table-agnostic on purpose -
 * a `WorkflowTransition` just names an edge in a status graph; it does NOT
 * touch SQL. The actual atomicity guarantee ("two concurrent approvals ->
 * exactly one succeeds") lives in the caller's own repository, as a single
 * conditional `UPDATE ... WHERE status = $from` (purchase.repository.ts's
 * `transitionPurchaseStatus` is the concrete instance) - a plain
 * SELECT-then-UPDATE, even with a FOR UPDATE lock, still leaves a gap a
 * concurrent transaction's own SELECT FOR UPDATE could land in; a
 * conditional UPDATE has none, because the WHERE clause and the row lock
 * are the same atomic operation.
 */
export interface WorkflowTransition<TStatus extends string> {
  name: string;
  from: TStatus;
  to: TStatus;
  /** Documentation only - the route itself is what actually enforces this (common/middleware/rbac.ts), same "one real enforcement point" discipline as everywhere else in this build. */
  permission: string;
}

export function findTransition<TStatus extends string>(
  transitions: WorkflowTransition<TStatus>[],
  name: string,
): WorkflowTransition<TStatus> {
  const transition = transitions.find((t) => t.name === name);
  if (!transition) {
    throw new Error(`Unknown workflow transition "${name}"`);
  }
  return transition;
}

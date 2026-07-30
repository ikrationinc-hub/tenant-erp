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
/**
 * A precondition on a transition beyond the from/to status match - e.g.
 * "the entity must have at least one valid line". Throws (any AppError
 * subclass - ConflictError is the convention every guard in this build
 * uses, see core/workflow/guards.ts) to reject; returns normally to
 * allow. Synchronous and pure over caller-supplied `context` on purpose:
 * this engine never touches SQL (see this file's own doc comment below),
 * so a guard can only see what the caller already fetched and handed it.
 */
export type TransitionGuard<TContext> = (context: TContext) => void;

export interface WorkflowTransition<TStatus extends string, TContext = never> {
  name: string;
  from: TStatus;
  to: TStatus;
  /** Documentation only - the route itself is what actually enforces this (common/middleware/rbac.ts), same "one real enforcement point" discipline as everywhere else in this build. */
  permission: string;
  /** Run in declaration order by runGuards, before the caller is allowed to persist the status change. Optional: most transitions (e.g. Approved -> Posted) have none. */
  guards?: TransitionGuard<TContext>[];
}

export function findTransition<TStatus extends string, TContext = never>(
  transitions: WorkflowTransition<TStatus, TContext>[],
  name: string,
): WorkflowTransition<TStatus, TContext> {
  const transition = transitions.find((t) => t.name === name);
  if (!transition) {
    throw new Error(`Unknown workflow transition "${name}"`);
  }
  return transition;
}

/**
 * The engine's enforcement point for guards (task: "enforced in the
 * WORKFLOW ENGINE, not the UI, not only the DB"): a caller declares
 * guards ON the transition definition itself (PURCHASE_WORKFLOW's
 * "approve" entry is the first example) rather than writing an ad-hoc
 * `if` in the service body, and this is the one place that actually
 * invokes them - always BEFORE the caller attempts
 * transitionPurchaseStatus's UPDATE, so a rejected guard leaves nothing
 * partially written. Stops at (and lets the caller's error handler
 * surface) the FIRST violated guard, not a batch - one clear, specific
 * reason per rejected request.
 */
export function runGuards<TStatus extends string, TContext>(
  transition: WorkflowTransition<TStatus, TContext>,
  context: TContext,
): void {
  for (const guard of transition.guards ?? []) {
    guard(context);
  }
}

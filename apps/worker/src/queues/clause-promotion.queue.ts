export const CLAUSE_PROMOTION_QUEUE_NAME = "clause-promotion";
/** Fixed jobId (BullMQ repeat convention) so re-registering the repeat option on every worker boot doesn't accumulate duplicate repeatable jobs. */
export const CLAUSE_PROMOTION_REPEAT_JOB_ID = "clause-promotion-repeat";

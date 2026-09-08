export const SALES_DASHBOARD_REFRESH_QUEUE_NAME = "sales-dashboard-refresh";
/** Fixed jobId (BullMQ repeat convention) so re-registering the repeat option on every worker boot doesn't accumulate duplicate repeatable jobs. */
export const SALES_DASHBOARD_REFRESH_REPEAT_JOB_ID = "sales-dashboard-refresh-repeat";

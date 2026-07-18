import type { VisibilityCondition } from "@hyperion/contracts";

export function evaluateVisibility(watchedValue: unknown, condition: VisibilityCondition): boolean {
  const { operator, value } = condition;

  if (operator === "eq") {
    return watchedValue === value;
  }
  if (operator === "neq") {
    return watchedValue !== value;
  }

  const list = Array.isArray(value) ? value : [];
  const isMember = typeof watchedValue === "string" && list.includes(watchedValue);
  return operator === "in" ? isMember : !isMember;
}

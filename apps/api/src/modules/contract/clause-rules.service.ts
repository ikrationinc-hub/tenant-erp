import { Engine, type RuleProperties, type TopLevelCondition } from "json-rules-engine";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import { findClauseById } from "./clauses.repository.js";
import {
  findClauseRuleById,
  insertClauseRule,
  listActiveClauseRulesForDivision,
  listClauseRules,
  updateClauseRuleFields,
  type ClauseRuleRow,
} from "./clause-rules.repository.js";
import { addClauseFromRule } from "./contract-assembly.service.js";
import { findContractById } from "./contracts.repository.js";
import type { CreateClauseRuleInput, UpdateClauseRuleInput } from "./clause-rules.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export async function list(ctx: RequestContext): Promise<ClauseRuleRow[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listClauseRules(tx, scope.companyId));
}

/**
 * C-4 item 1: data-driven rule engine, json-rules-engine, NOT a hand-rolled
 * DSL - `conditionJson` is stored and reconstructed VERBATIM as the
 * library's own `TopLevelCondition` shape, never parsed by any code this
 * module writes. `targetClauseId`/`actionIsMandatory` ARE the "action" the
 * spec asks for (item 1: "condition -> action: add clause X as default/
 * mandatory") - modeled as plain columns, not encoded into the rule's own
 * `event.params`, so the action is queryable/joinable without parsing
 * event JSON.
 */
export async function create(ctx: RequestContext, input: CreateClauseRuleInput): Promise<ClauseRuleRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const targetClause = await findClauseById(tx, scope.companyId, input.targetClauseId);
    if (!targetClause) {
      throw new NotFoundError("Target clause not found");
    }

    const row = await insertClauseRule(tx, {
      companyId: scope.companyId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.divisionId ? { divisionId: input.divisionId } : {}),
      name: input.name,
      conditionJson: input.conditionJson,
      targetClauseId: input.targetClauseId,
      actionIsMandatory: input.actionIsMandatory ?? false,
      // isExample is NEVER accepted from the request body (see clause-
      // rules.validator.ts's own .strict() schema) - every rule created
      // through this build's own UI/API today is, by construction, one of
      // the seeded examples or a copy of one; a genuinely client-confirmed
      // rule needs this column flipped by hand (or a future, deliberate
      // "confirm this rule" action) once the client actually provides one,
      // never silently by a generic create call.
      isExample: true,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "clause_rule",
      entityId: row.id,
      action: "clause_rule.created",
      after: { name: row.name, targetClauseId: row.targetClauseId, actionIsMandatory: row.actionIsMandatory },
    });

    return row;
  });
}

export async function update(ctx: RequestContext, id: string, input: UpdateClauseRuleInput): Promise<ClauseRuleRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findClauseRuleById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Clause rule not found");
    }

    const row = await updateClauseRuleFields(tx, scope.companyId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.conditionJson !== undefined ? { conditionJson: input.conditionJson } : {}),
      ...(input.actionIsMandatory !== undefined ? { actionIsMandatory: input.actionIsMandatory } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!row) {
      throw new NotFoundError("Clause rule not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "clause_rule",
      entityId: id,
      action: "clause_rule.updated",
      before: { isActive: existing.isActive },
      after: { isActive: row.isActive },
    });

    return row;
  });
}

/**
 * The contract-data "facts" a condition can reference - deliberately a
 * SMALL, real set backed by actual columns on `contracts` (never invented
 * fields with no data behind them). `deliveryTerms` is what C-3b's own
 * purchase-link prefill actually populates with an incoterm's NAME (e.g.
 * "Cost, Insurance and Freight") - there is no dedicated incotermId/code
 * column on `contracts` yet, so the CIF example rule below matches on
 * this text field, not a clean enum. This is exactly the kind of
 * structural gap the ADR flags as a question for the client's real rules:
 * a proper incoterm CODE field is a natural addition once real rules
 * arrive, not invented ahead of them.
 */
export interface ContractRuleFacts {
  divisionId: string | null;
  materialType: string | null;
  weightKg: string | null;
  rateUsd: string | null;
  deliveryTerms: string | null;
  sourceType: string | null;
}

export function buildContractRuleFacts(contract: {
  divisionId: string | null;
  materialType: string | null;
  weightKg: string | null;
  rateUsd: string | null;
  deliveryTerms: string | null;
  sourceType: string | null;
}): ContractRuleFacts {
  return {
    divisionId: contract.divisionId,
    materialType: contract.materialType,
    weightKg: contract.weightKg,
    rateUsd: contract.rateUsd,
    deliveryTerms: contract.deliveryTerms,
    sourceType: contract.sourceType,
  };
}

export interface RuleEvaluationMatch {
  ruleId: string;
  ruleName: string;
  targetClauseId: string;
  actionIsMandatory: boolean;
}

/** Runs every ACTIVE rule for this division against `facts`, returning one match per rule whose condition succeeded - a fresh json-rules-engine Engine per evaluation (this library's own documented usage; it has no meaningful state to keep warm across calls for a handful of rules). */
export async function evaluateRules(tx: TenantTx, companyId: string, divisionId: string | null, facts: ContractRuleFacts): Promise<RuleEvaluationMatch[]> {
  const activeRules = await listActiveClauseRulesForDivision(tx, companyId, divisionId);
  if (activeRules.length === 0) {
    return [];
  }

  const engine = new Engine([], { allowUndefinedFacts: true });
  const ruleById = new Map(activeRules.map((r) => [r.id, r]));

  for (const rule of activeRules) {
    const ruleProperties: RuleProperties = {
      name: rule.id,
      conditions: rule.conditionJson as TopLevelCondition,
      event: { type: "add-clause", params: { ruleId: rule.id } },
    };
    engine.addRule(ruleProperties);
  }

  const { events } = await engine.run({ ...facts });

  return events
    .map((event): RuleEvaluationMatch | undefined => {
      const ruleId = typeof event.params?.ruleId === "string" ? event.params.ruleId : undefined;
      const rule = ruleId ? ruleById.get(ruleId) : undefined;
      if (!rule) {
        return undefined;
      }
      return { ruleId: rule.id, ruleName: rule.name, targetClauseId: rule.targetClauseId, actionIsMandatory: rule.actionIsMandatory };
    })
    .filter((match): match is RuleEvaluationMatch => match !== undefined);
}

export interface RunRulesResult {
  matched: RuleEvaluationMatch[];
  added: RuleEvaluationMatch[];
  alreadyPresent: RuleEvaluationMatch[];
}

/**
 * item 2's "run rules" action - Draft only (the same lock every other
 * assembly mutation already enforces, via addClauseFromRule's own
 * requireDraft call). Never re-adds a clause already on the contract
 * (regardless of how it originally got there) - a rule match for a clause
 * the contract already has is reported back as `alreadyPresent`, not
 * silently duplicated or silently skipped without telling the caller.
 */
export async function runRules(ctx: RequestContext, contractId: string): Promise<RunRulesResult> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, contractId);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    if (contract.status !== "draft") {
      throw new ConflictError(`Contract ${contract.contractNumber} is ${contract.status} - rules can only run on a Draft contract`);
    }

    const facts = buildContractRuleFacts(contract);
    const matched = await evaluateRules(tx, scope.companyId, contract.divisionId, facts);

    const added: RuleEvaluationMatch[] = [];
    const alreadyPresent: RuleEvaluationMatch[] = [];
    for (const match of matched) {
      const outcome = await addClauseFromRule(tx, {
        companyId: scope.companyId,
        contractId,
        userId: scope.userId,
        clauseId: match.targetClauseId,
        isMandatory: match.actionIsMandatory,
      });
      if (outcome === "added") {
        added.push(match);
      } else {
        alreadyPresent.push(match);
      }
    }

    if (added.length > 0) {
      await insertAuditLog(tx, {
        companyId: scope.companyId,
        changedBy: scope.userId,
        entity: "contract",
        entityId: contractId,
        action: "contract.rules_run",
        after: { addedClauseIds: added.map((a) => a.targetClauseId) },
      });
    }

    return { matched, added, alreadyPresent };
  });
}

import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";
import commonPasswordsTop10k from "./common-passwords-top10k.json" with { type: "json" };
import { ValidationError } from "../../common/errors/index.js";

const MIN_LENGTH = 12;
/** 0-4 scale; 3 ("safely unguessable" per zxcvbn's own scoring guidance) is the accepted floor. */
const MIN_ZXCVBN_SCORE = 3;

const zxcvbn = new ZxcvbnFactory({
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  translations: zxcvbnEnPackage.translations,
});

const COMMON_PASSWORDS = new Set(commonPasswordsTop10k.map((p) => p.toLowerCase()));

/**
 * Throws ValidationError (422, matching every other input-validation
 * failure in this codebase) naming every rule the password fails, not just
 * the first - a caller fixing one issue at a time against a live form
 * shouldn't have to resubmit repeatedly to discover the next one.
 */
export function assertPasswordMeetsPolicy(password: string): void {
  const failures: string[] = [];

  if (password.length < MIN_LENGTH) {
    failures.push(`must be at least ${MIN_LENGTH} characters`);
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    failures.push("must not be one of the 10,000 most common passwords");
  }

  const strength = zxcvbn.check(password);
  if (strength.score < MIN_ZXCVBN_SCORE) {
    failures.push("is too weak (too easy to guess)");
  }

  if (failures.length > 0) {
    throw new ValidationError("Password does not meet the required policy", { failures });
  }
}

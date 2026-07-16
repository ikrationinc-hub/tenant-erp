import argon2 from "argon2";

const ARGON2_OPTIONS = { type: argon2.argon2id } as const;

/**
 * A real argon2id hash, computed once at import time, of a fixed dummy value.
 * verifyPassword always runs a real argon2 verify against SOME hash - this
 * one when there's no real hash to compare against (unknown email, or an
 * invited user who hasn't set a password yet) - so that path costs the same
 * as a genuine wrong-password check. Never short-circuit this.
 */
const DUMMY_HASH = argon2.hash(
  "dummy-password-for-constant-time-comparison",
  ARGON2_OPTIONS,
);

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  const target = hash ?? (await DUMMY_HASH);
  const matches = await argon2.verify(target, password);
  return hash !== null && matches;
}

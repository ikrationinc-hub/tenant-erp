/**
 * UX-only heuristic for the live strength meter - NOT the source of truth.
 * The server's zxcvbn + top-10k-common-password check (core/auth/password-policy.ts)
 * is authoritative; a 422 from there always wins over what this shows.
 */
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Very weak" | "Weak" | "Fair" | "Good" | "Strong";
  feedback: string[];
}

const MIN_LENGTH = 12;

export function estimatePasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];

  if (password.length < MIN_LENGTH) {
    feedback.push(`Use at least ${MIN_LENGTH} characters`);
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    feedback.push("Mix upper, lower, numbers, and symbols");
  }

  const hasLongRun = /(.)\1{2,}/.test(password);
  if (hasLongRun) {
    feedback.push("Avoid repeating the same character");
  }

  let score: PasswordStrength["score"] = 0;
  if (password.length > 0) {
    score = 1;
  }
  if (password.length >= MIN_LENGTH && classes >= 2) {
    score = 2;
  }
  if (password.length >= MIN_LENGTH && classes >= 3 && !hasLongRun) {
    score = 3;
  }
  if (password.length >= MIN_LENGTH + 4 && classes === 4 && !hasLongRun) {
    score = 4;
  }

  const label = (["Very weak", "Weak", "Fair", "Good", "Strong"] as const)[score];

  return { score, label, feedback };
}

import { UnauthorizedError } from "../../common/errors/index.js";
import { verifyPassword } from "../../core/auth/password.js";
import { signPlatformAdminToken } from "../../core/platform-auth/jwt.js";
import { findPlatformAdminByEmail } from "./platform.repository.js";

export interface PlatformLoginInput {
  email: string;
  password: string;
}

/** Same shared verifyPassword (always runs a real argon2 verify, even against no real hash) as core/auth's tenant login - no separate timing-safety story needed for a second copy of the same logic. */
export async function platformAdminLogin(input: PlatformLoginInput): Promise<{ accessToken: string }> {
  const admin = await findPlatformAdminByEmail(input.email);
  const passwordOk = await verifyPassword(admin?.passwordHash ?? null, input.password);

  if (!admin || !passwordOk) {
    throw new UnauthorizedError("Invalid email or password");
  }
  if (admin.status !== "active") {
    throw new UnauthorizedError("Account is suspended");
  }

  const accessToken = await signPlatformAdminToken(admin.id);
  return { accessToken };
}

import type { Readable } from "node:stream";
import { createScanner, isCleanReply } from "clamdjs";
import { env } from "../../config/env.js";

export interface ScanResult {
  clean: boolean;
  /** The raw clamd reply, e.g. "stream: OK" or "stream: Eicar-Test-Signature FOUND". */
  reply: string;
}

export interface Scanner {
  scan(stream: Readable): Promise<ScanResult>;
}

const clamd = createScanner(env.CLAMAV_HOST, env.CLAMAV_PORT);

export const clamAvScanner: Scanner = {
  async scan(stream: Readable): Promise<ScanResult> {
    const reply = await clamd.scanStream(stream);
    return { clean: isCleanReply(reply), reply };
  },
};

let activeScanner: Scanner = clamAvScanner;

export function getScanner(): Scanner {
  return activeScanner;
}

/**
 * Test-only seam: lets tests inject a fake Scanner that returns a
 * deterministic clean/infected result in-process instead of hitting a
 * real clamd daemon - mirrors core/notification/mailer.ts's setMailer/
 * resetMailer exactly, for the same reason (an external network service
 * this codebase doesn't own or control the uptime of).
 */
export function setScanner(scanner: Scanner): void {
  activeScanner = scanner;
}

export function resetScanner(): void {
  activeScanner = clamAvScanner;
}

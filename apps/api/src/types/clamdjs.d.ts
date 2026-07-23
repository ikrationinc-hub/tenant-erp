/**
 * clamdjs ships no TypeScript types (plain CommonJS, no `types` field, no
 * @types/clamdjs on DefinitelyTyped) - this declares only the surface
 * core/storage/scanner.ts actually calls, verified against its README
 * (https://github.com/NingLin-P/clamdjs) at the version pinned in
 * package.json.
 */
declare module "clamdjs" {
  import type { Readable } from "node:stream";

  export interface ClamdScanner {
    scanStream(stream: Readable, timeout?: number): Promise<string>;
  }

  export function createScanner(host: string, port: number): ClamdScanner;
  export function ping(host: string, port: number, timeout?: number): Promise<boolean>;
  export function isCleanReply(reply: string): boolean;
}

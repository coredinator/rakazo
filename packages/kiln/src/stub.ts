import { randomBytes } from "node:crypto";
import { cloneGrant, unrestrictedGrant } from "./model-path.js";
import type {
  CredMintInput,
  CredMintResult,
  Kiln,
  KilnEvent,
  KilnLogger,
  RunStartInput,
  SpawnCheckInput,
  SpawnCheckResult,
} from "./types.js";

/** Day-1 permits are short-lived and are not secret material. */
export const STUB_TOKEN_TTL_MS = 60_000;

export type StubKilnOptions = {
  log?: KilnLogger;
  now?: () => Date;
  tokenTtlMs?: number;
};

/**
 * Allows every call and logs the input and output.
 * run.start returns an unrestricted grant. spawn.check returns the proposed grant unchanged.
 * cred.mint returns an opaque token. event acknowledges without a receipt.
 */
export function createStubKiln(options: StubKilnOptions = {}): Kiln {
  const log = options.log ?? defaultLog;
  const now = options.now ?? (() => new Date());
  const tokenTtlMs = options.tokenTtlMs ?? STUB_TOKEN_TTL_MS;

  const record = (hook: Parameters<KilnLogger>[0]["hook"], input: unknown, output: unknown) => {
    log({ hook, input, output, at: now().toISOString() });
  };

  return {
    async "run.start"(input: RunStartInput) {
      const output = { grant: unrestrictedGrant() };
      record("run.start", input, output);
      return output;
    },
    async "spawn.check"(input: SpawnCheckInput): Promise<SpawnCheckResult> {
      const output: SpawnCheckResult = {
        decision: "allow",
        grant: cloneGrant(input.proposed_grant),
      };
      record("spawn.check", input, output);
      return output;
    },
    async "cred.mint"(input: CredMintInput): Promise<CredMintResult> {
      const issuedAt = now().getTime();
      const output: CredMintResult = {
        decision: "allow",
        token: `kiln_${randomBytes(16).toString("base64url")}`,
        expires_at: new Date(issuedAt + tokenTtlMs).toISOString(),
      };
      record("cred.mint", input, output);
      return output;
    },
    async event(input: KilnEvent) {
      const output = { ack: true } as const;
      record("event", input, output);
      return output;
    },
  };
}

function defaultLog(record: Parameters<KilnLogger>[0]): void {
  console.info(
    JSON.stringify({
      kiln: record.hook,
      input: record.input,
      output: record.output,
      at: record.at,
    }),
  );
}

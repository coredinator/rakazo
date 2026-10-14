/**
 * Host-neutral kiln contract.
 *
 * The host calls kiln. Kiln does not call the host, sign payloads, or choose a model vendor.
 * This module has no host imports so it can move to the kiln repo unchanged.
 *
 * `*` in a grant list, mount, model path, or mark means unrestricted. A concrete value is
 * the only access the host may use for that field.
 */

export const KILN_UNRESTRICTED = "*";

export type KilnEngagement = {
  id: string;
};

export type KilnAgent = {
  id: string;
};

export type KilnMount = {
  source: string;
  target: string;
  mode: "ro" | "rw";
};

/** `provider/modelId`, split on the first slash. `*` means the host's current model. */
export type KilnModelPath = string;

export type KilnGrant = {
  tools: readonly string[];
  credential_names: readonly string[];
  mounts: readonly KilnMount[];
  model_path: KilnModelPath;
  mark: string;
  allowed_actions: readonly string[];
};

export type RunStartInput = {
  engagement: KilnEngagement;
  agent: KilnAgent;
  parent_run_id?: string;
};

export type RunStartResult = {
  grant: KilnGrant;
};

export type SpawnCheckInput = {
  parent_run_id: string;
  child_task: string;
  proposed_grant: KilnGrant;
};

export type SpawnCheckResult =
  | { decision: "allow"; grant: KilnGrant }
  | { decision: "deny"; reason: string };

export type CredMintInput = {
  run_id: string;
  credential_name: string;
};

export type CredMintResult =
  | { decision: "allow"; token: string; expires_at: string }
  | { decision: "deny"; reason: string };

export type KilnEvent =
  | { kind: "mount"; run_id: string; mount: KilnMount }
  | { kind: "refuse"; run_id: string; detail?: Readonly<Record<string, string>> }
  | { kind: "mark"; run_id: string; detail?: Readonly<Record<string, string>> }
  | { kind: "promote"; run_id: string; detail?: Readonly<Record<string, string>> }
  | { kind: "release"; run_id: string; detail?: Readonly<Record<string, string>> };

/** Acknowledgement. A later kiln writes a checksummed receipt here. */
export type KilnAck = {
  ack: true;
};

export type KilnHook = "run.start" | "spawn.check" | "cred.mint" | "event";

export type KilnLogRecord = {
  hook: KilnHook;
  input: unknown;
  output: unknown;
  at: string;
};

export type KilnLogger = (record: KilnLogRecord) => void;

export interface Kiln {
  "run.start"(input: RunStartInput): Promise<RunStartResult>;
  "spawn.check"(input: SpawnCheckInput): Promise<SpawnCheckResult>;
  "cred.mint"(input: CredMintInput): Promise<CredMintResult>;
  event(input: KilnEvent): Promise<KilnAck>;
}

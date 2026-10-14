import type { ComputerMode } from "@rakazo/contracts";
import type { Kiln, KilnGrant, KilnLogRecord, KilnMount } from "@rakazo/kiln";
import {
  createStubKiln,
  formatModelPath,
  isUnrestricted,
  listAllows,
  parseModelPath,
  unrestrictedGrant,
} from "@rakazo/kiln";
import { getLogger } from "@rakazo/logging";
import { teamBotWorkspaceDirectory } from "./computer-support.js";

/** Name passed to cred.mint for the one-time secret stored on a run. */
export const RUN_SECRET_CREDENTIAL_NAME = "run-secret";

let shared: Kiln | undefined;

function hostLog(record: KilnLogRecord): void {
  getLogger().info("kiln", {
    hook: record.hook,
    at: record.at,
    kilnInput: record.input,
    kilnOutput: record.output,
  });
}

/** Process-wide allow-all kiln. A host may pass its own instance instead. */
export function hostKiln(): Kiln {
  shared ??= createStubKiln({ log: hostLog });
  return shared;
}

export async function beginKilnRun(
  kiln: Kiln,
  input: { engagementId: string; agentId: string; parentRunId?: string },
): Promise<KilnGrant> {
  const started = await kiln["run.start"]({
    engagement: { id: input.engagementId },
    agent: { id: input.agentId },
    ...(input.parentRunId ? { parent_run_id: input.parentRunId } : {}),
  });
  return started.grant;
}

export function runWorkspaceMount(mode: ComputerMode, botId: string): KilnMount {
  if (mode === "team") {
    const path = teamBotWorkspaceDirectory(botId);
    return { source: path, target: path, mode: "rw" };
  }
  return { source: ".", target: ".", mode: "rw" };
}

export async function emitKilnMount(kiln: Kiln, runId: string, mount: KilnMount): Promise<void> {
  await kiln.event({ kind: "mount", run_id: runId, mount });
}

/**
 * Ask kiln for a short-lived permit, then honor the run grant.
 * The token is not secret material and is not exchanged for the stored value yet.
 */
export async function authorizeCredential(
  kiln: Kiln,
  grant: KilnGrant,
  runId: string,
  credentialName: string,
): Promise<boolean> {
  const minted = await kiln["cred.mint"]({
    run_id: runId,
    credential_name: credentialName,
  });
  return minted.decision === "allow" && listAllows(grant.credential_names, credentialName);
}

export function proposeChildGrant(input: {
  parent: KilnGrant | undefined;
  toolNames: readonly string[];
  provider: string;
  modelId: string;
}): KilnGrant {
  const parent = input.parent ?? unrestrictedGrant();
  return {
    tools: [...input.toolNames],
    credential_names: [...parent.credential_names],
    mounts: parent.mounts.map((mount) => ({ ...mount })),
    model_path: formatModelPath(input.provider, input.modelId),
    mark: parent.mark,
    allowed_actions: [...parent.allowed_actions],
  };
}

export function filterToolsByGrant<T extends { name: string }>(
  tools: readonly T[],
  grant: KilnGrant,
): T[] {
  if (grant.tools.some((name) => isUnrestricted(name))) return [...tools];
  const allowed = new Set(grant.tools);
  return tools.filter((tool) => allowed.has(tool.name));
}

export async function resolveGrantedModel<T extends { provider: string; id: string }>(
  grant: KilnGrant,
  current: T,
  resolveModel: ((provider: string, modelId: string) => Promise<T>) | undefined,
): Promise<T> {
  if (isUnrestricted(grant.model_path)) return current;
  const currentPath = formatModelPath(current.provider, current.id);
  if (grant.model_path === currentPath) return current;
  const granted = parseModelPath(grant.model_path);
  if (!resolveModel) {
    throw new Error("Per-call subagent model selection is unavailable");
  }
  return resolveModel(granted.provider, granted.modelId);
}

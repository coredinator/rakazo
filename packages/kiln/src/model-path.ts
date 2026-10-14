import type { KilnGrant, KilnModelPath } from "./types.js";
import { KILN_UNRESTRICTED } from "./types.js";

export function isUnrestricted(value: string): boolean {
  return value === KILN_UNRESTRICTED;
}

export function formatModelPath(provider: string, modelId: string): KilnModelPath {
  const trimmedProvider = provider.trim();
  const trimmedModel = modelId.trim();
  if (!trimmedProvider || !trimmedModel || trimmedProvider.includes("/")) {
    throw new Error("Model path requires a provider and a model id");
  }
  return `${trimmedProvider}/${trimmedModel}`;
}

export function parseModelPath(path: string): { provider: string; modelId: string } {
  if (isUnrestricted(path)) {
    throw new Error("Unrestricted model path has no provider");
  }
  const slash = path.indexOf("/");
  if (slash <= 0 || slash === path.length - 1) {
    throw new Error("Model path must be provider/modelId");
  }
  return { provider: path.slice(0, slash), modelId: path.slice(slash + 1) };
}

export function unrestrictedGrant(): KilnGrant {
  return {
    tools: [KILN_UNRESTRICTED],
    credential_names: [KILN_UNRESTRICTED],
    mounts: [{ source: KILN_UNRESTRICTED, target: KILN_UNRESTRICTED, mode: "rw" }],
    model_path: KILN_UNRESTRICTED,
    mark: KILN_UNRESTRICTED,
    allowed_actions: [KILN_UNRESTRICTED],
  };
}

export function cloneGrant(grant: KilnGrant): KilnGrant {
  return {
    tools: [...grant.tools],
    credential_names: [...grant.credential_names],
    mounts: grant.mounts.map((mount) => ({ ...mount })),
    model_path: grant.model_path,
    mark: grant.mark,
    allowed_actions: [...grant.allowed_actions],
  };
}

export function listAllows(entries: readonly string[], value: string): boolean {
  return entries.some((entry) => entry === KILN_UNRESTRICTED || entry === value);
}

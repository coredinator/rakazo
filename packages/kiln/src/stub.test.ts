import { describe, expect, it } from "vitest";
import { formatModelPath, parseModelPath } from "./model-path.js";
import { createStubKiln, STUB_TOKEN_TTL_MS } from "./stub.js";
import type { KilnGrant, KilnLogRecord } from "./types.js";
import { KILN_UNRESTRICTED } from "./types.js";

const proposed: KilnGrant = {
  tools: ["shell", "web_search"],
  credential_names: ["API_TOKEN"],
  mounts: [{ source: "bots/bot-1", target: "bots/bot-1", mode: "rw" }],
  model_path: "openrouter/child-model",
  mark: "parent",
  allowed_actions: ["shell"],
};

describe("kiln stub", () => {
  it("allows every hook and logs the input and output", async () => {
    const records: KilnLogRecord[] = [];
    const now = new Date("2026-10-14T00:00:00.000Z");
    const kiln = createStubKiln({
      log: (record) => records.push(record),
      now: () => now,
    });

    const started = await kiln["run.start"]({
      engagement: { id: "thread-1" },
      agent: { id: "bot-1" },
    });
    const spawned = await kiln["spawn.check"]({
      parent_run_id: "run-1",
      child_task: "inspect the ledger",
      proposed_grant: proposed,
    });
    const minted = await kiln["cred.mint"]({
      run_id: "run-1",
      credential_name: "API_TOKEN",
    });
    const acked = await kiln.event({
      kind: "mount",
      run_id: "run-1",
      mount: { source: ".", target: ".", mode: "rw" },
    });

    expect(started.grant.tools).toEqual([KILN_UNRESTRICTED]);
    expect(started.grant.credential_names).toEqual([KILN_UNRESTRICTED]);
    expect(started.grant.model_path).toBe(KILN_UNRESTRICTED);
    expect(spawned).toEqual({ decision: "allow", grant: proposed });
    expect(spawned.decision === "allow" && spawned.grant).not.toBe(proposed);
    expect(minted.decision).toBe("allow");
    if (minted.decision !== "allow") return;
    expect(minted.token.startsWith("kiln_")).toBe(true);
    expect(minted.token).not.toContain("API_TOKEN");
    expect(minted.expires_at).toBe(new Date(now.getTime() + STUB_TOKEN_TTL_MS).toISOString());
    expect(acked).toEqual({ ack: true });
    expect(records.map((record) => record.hook)).toEqual([
      "run.start",
      "spawn.check",
      "cred.mint",
      "event",
    ]);
    expect(records[1]).toMatchObject({
      input: { parent_run_id: "run-1", child_task: "inspect the ledger" },
      output: { decision: "allow", grant: proposed },
    });
    expect(records[2]).toMatchObject({
      input: { run_id: "run-1", credential_name: "API_TOKEN" },
      output: { decision: "allow", token: minted.token },
    });
  });
});

describe("model path", () => {
  it("keeps a model id that contains slashes", () => {
    expect(formatModelPath("openrouter", "google/gemini")).toBe("openrouter/google/gemini");
    expect(parseModelPath("openrouter/google/gemini")).toEqual({
      provider: "openrouter",
      modelId: "google/gemini",
    });
  });
});

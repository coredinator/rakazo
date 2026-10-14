import type { Kiln, KilnLogRecord } from "@rakazo/kiln";
import { createStubKiln } from "@rakazo/kiln";
import { describe, expect, it, vi } from "vitest";
import { decryptAgentEnvironment } from "./agent-environment.js";
import { loadBotCommandEnvironment } from "./bot-secrets.js";
import {
  authorizeCredential,
  beginKilnRun,
  emitKilnMount,
  RUN_SECRET_CREDENTIAL_NAME,
} from "./kiln-host.js";
import { PiAgentRuntime } from "./pi-runtime.js";

const constructed = vi.hoisted(
  () =>
    [] as Array<{
      modelId: string;
      toolNames: string[];
    }>,
);

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = {
      errorMessage: undefined as string | undefined,
      messages: [] as Array<{ role: string; content: unknown }>,
      model: undefined as unknown,
      thinkingLevel: undefined as unknown,
    };
    private readonly tools: Array<{
      name: string;
      execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
    }>;

    constructor(options: {
      initialState: {
        model: { id: string };
        tools: Array<{
          name: string;
          execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
        }>;
      };
    }) {
      this.tools = options.initialState.tools;
      constructed.push({
        modelId: options.initialState.model.id,
        toolNames: this.tools.map((tool) => tool.name),
      });
    }

    subscribe() {}

    abort() {}

    followUp() {}

    steer() {}

    async waitForIdle() {}

    async prompt() {
      const delegate = this.tools.find((tool) => tool.name === "run_subagent");
      if (!delegate) {
        this.state.messages = [
          { role: "assistant", content: [{ type: "text", text: "child done" }] },
        ];
        return;
      }
      await delegate.execute("call-1", {
        name: "helper",
        task: "inspect the ledger",
        model_provider: "openrouter",
        model_id: "child-requested",
      });
      this.state.messages = [
        { role: "assistant", content: [{ type: "text", text: "parent done" }] },
      ];
    }
  },
}));

function tool(name: string) {
  return { name, description: name, inputSchema: { type: "object", properties: {} } };
}

describe("kiln host", () => {
  it("does not read a secret when cred.mint denies it", async () => {
    const records: KilnLogRecord[] = [];
    const kiln = createStubKiln({ log: (record) => records.push(record) });
    const denying: Kiln = {
      ...kiln,
      "cred.mint": async (input) => {
        const output = { decision: "deny" as const, reason: "not granted" };
        records.push({
          hook: "cred.mint",
          input,
          output,
          at: "2026-10-14T00:00:00.000Z",
        });
        return output;
      },
    };
    const grant = await beginKilnRun(denying, { engagementId: "thread-1", agentId: "bot-1" });
    const load = vi.fn(async () => "plaintext-secret");
    await expect(authorizeCredential(denying, grant, "run-1", "SPACE_DB")).resolves.toBe(false);
    const env = await decryptAgentEnvironment(
      [{ name: "SPACE_DB", secret: { id: "sec", ciphertext: "cipher" } }],
      { load },
      () => authorizeCredential(denying, grant, "run-1", "SPACE_DB"),
    );
    const shell = await loadBotCommandEnvironment(
      {
        botSecret: {
          findMany: async () => [
            { id: "row", name: "api-token", auth: { type: "command" }, ciphertext: "cipher" },
          ],
        },
      } as never,
      { load },
      { userId: "user", spaceId: "space", botId: "bot" },
      undefined,
      () => authorizeCredential(denying, grant, "run-1", "api-token"),
    );
    expect(env).toEqual({});
    expect(shell).toEqual({});
    expect(load).not.toHaveBeenCalled();
    expect(JSON.stringify(records)).not.toContain("plaintext-secret");
  });

  it("logs run.start, mount, cred.mint, and spawn.check when a parent starts a child", async () => {
    constructed.length = 0;
    const records: KilnLogRecord[] = [];
    const stub = createStubKiln({ log: (record) => records.push(record) });
    const kiln: Kiln = {
      ...stub,
      "spawn.check": async (input) => {
        const allowed = await stub["spawn.check"](input);
        if (allowed.decision !== "allow") return allowed;
        return {
          decision: "allow",
          grant: {
            ...allowed.grant,
            tools: ["shell"],
            model_path: "openrouter/kiln-granted-model",
          },
        };
      },
    };
    const grant = await beginKilnRun(kiln, { engagementId: "thread-1", agentId: "bot-1" });
    await emitKilnMount(kiln, "run-1", { source: ".", target: ".", mode: "rw" });
    await authorizeCredential(kiln, grant, "run-1", "SPACE_DB");
    await authorizeCredential(kiln, grant, "run-1", "BOT_API");
    await authorizeCredential(kiln, grant, "run-1", RUN_SECRET_CREDENTIAL_NAME);

    const runtime = new PiAgentRuntime();
    const events: unknown[] = [];
    for await (const event of runtime.run({
      botId: "bot-1",
      threadId: "thread-1",
      runId: "run-1",
      kiln,
      kilnGrant: grant,
      prompt: "delegate the ledger check",
      instructions: "Use a helper.",
      history: [],
      tools: [tool("run_subagent"), tool("shell"), tool("web_search")],
      model: {
        provider: "openrouter",
        id: "parent-model",
        contextWindow: 8192,
        apiKey: "test-key",
      },
      resolveModel: async (provider, modelId) => ({
        provider,
        id: modelId,
        contextWindow: 8192,
        apiKey: "test-key",
      }),
      executeTool: vi.fn(async () => ({ ok: true })),
    })) {
      events.push(event);
    }

    expect(records.map((record) => record.hook)).toEqual([
      "run.start",
      "event",
      "cred.mint",
      "cred.mint",
      "cred.mint",
      "spawn.check",
    ]);
    expect(records[0]).toMatchObject({
      input: { engagement: { id: "thread-1" }, agent: { id: "bot-1" } },
      output: { grant: { model_path: "*" } },
    });
    expect(records[0]?.input).not.toHaveProperty("parent_run_id");
    expect(records[1]).toMatchObject({
      input: { kind: "mount", run_id: "run-1", mount: { source: ".", target: ".", mode: "rw" } },
      output: { ack: true },
    });
    expect(records.slice(2, 5).map((record) => record.input)).toEqual([
      { run_id: "run-1", credential_name: "SPACE_DB" },
      { run_id: "run-1", credential_name: "BOT_API" },
      { run_id: "run-1", credential_name: "run-secret" },
    ]);
    for (const record of records.slice(2, 5)) {
      expect(record.output).toMatchObject({ decision: "allow" });
      const token = (record.output as { token?: string }).token ?? "";
      expect(token.startsWith("kiln_")).toBe(true);
      expect(token).not.toContain("SPACE_DB");
    }
    expect(records[5]).toMatchObject({
      input: {
        parent_run_id: "run-1",
        child_task: "inspect the ledger",
        proposed_grant: { model_path: "openrouter/child-requested" },
      },
      output: { decision: "allow" },
    });
    expect(constructed.map((agent) => agent.modelId)).toEqual([
      "parent-model",
      "kiln-granted-model",
    ]);
    expect(constructed[1]?.toolNames).toEqual(["shell"]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "subagent", status: "completed" }),
    );
  });

  it("does not start a child when spawn.check denies", async () => {
    constructed.length = 0;
    const kiln: Kiln = {
      "run.start": async () => {
        throw new Error("unused");
      },
      "spawn.check": async () => ({ decision: "deny", reason: "child cannot widen" }),
      "cred.mint": async () => {
        throw new Error("unused");
      },
      event: async () => ({ ack: true }),
    };
    const runtime = new PiAgentRuntime();
    const events: unknown[] = [];
    for await (const event of runtime.run({
      botId: "bot-1",
      threadId: "thread-1",
      runId: "run-1",
      kiln,
      prompt: "delegate",
      instructions: "Use a helper.",
      history: [],
      tools: [tool("run_subagent"), tool("shell")],
      model: {
        provider: "openrouter",
        id: "parent-model",
        contextWindow: 8192,
        apiKey: "test-key",
      },
      resolveModel: async (provider, modelId) => ({
        provider,
        id: modelId,
        contextWindow: 8192,
        apiKey: "test-key",
      }),
    })) {
      events.push(event);
    }

    expect(constructed).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        status: "failed",
        result: "child cannot widen",
      }),
    );
  });
});

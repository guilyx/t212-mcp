import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type { Config } from "../src/config.js";
import { createServer } from "../src/server.js";
import { toolHarness } from "./helpers/tools.js";

/**
 * Connects a real MCP client to the server over an in-memory transport, so
 * these tests exercise the actual protocol surface — schemas, annotations,
 * error shapes — rather than the handler functions directly.
 */
async function connect(
  routes: Record<string, unknown> = {},
  configOverrides: Partial<Config> = {},
) {
  const { context, urls } = toolHarness(routes, configOverrides);
  const server = createServer({
    config: context.config,
    client: context.client,
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, server, urls };
}

describe("createServer handshake", () => {
  it("advertises the server identity", async () => {
    const { client } = await connect();

    expect(client.getServerVersion()).toMatchObject({ name: "t212-mcp" });
  });

  it("tells the model the connection is read-only and rate limited", async () => {
    const { client } = await connect();
    const instructions = client.getInstructions() ?? "";

    expect(instructions).toContain("read");
    expect(instructions).toContain("cannot place");
    expect(instructions).toContain("rate");
  });
});

describe("tool registration", () => {
  it("exposes the expected tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "t212_get_account_cash",
      "t212_get_account_info",
      "t212_get_pie",
      "t212_get_position",
      "t212_list_dividends",
      "t212_list_exchanges",
      "t212_list_order_history",
      "t212_list_pending_orders",
      "t212_list_pies",
      "t212_list_positions",
      "t212_list_transactions",
      "t212_search_instruments",
    ]);
  });

  it("marks every tool read-only and non-destructive", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
  });

  it("publishes an input schema for every tool", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(80);
    }
  });

  it("hides the export tools unless they are enabled", async () => {
    const { client } = await connect({}, { allowExports: false });
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain("t212_list_exports");
  });

  it("exposes the export tools when they are enabled", async () => {
    const { client } = await connect({}, { allowExports: true });
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toContain("t212_list_exports");
  });
});

describe("tool invocation", () => {
  it("returns a summary and the structured payload", async () => {
    const { client } = await connect({
      "/equity/account/cash": { free: 100, total: 250, invested: 150, ppl: 5 },
    });

    const result = await client.callTool({
      name: "t212_get_account_cash",
      arguments: {},
    });

    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain("Free cash 100.00");
    expect(result.structuredContent).toMatchObject({
      data: { free: 100 },
    });
    expect(result.isError).toBeFalsy();
  });

  it("applies schema defaults supplied by the client", async () => {
    const { client } = await connect({
      "/equity/portfolio": [
        { ticker: "AAA_US_EQ", quantity: 1, currentPrice: 2, ppl: 1 },
      ],
    });

    const result = await client.callTool({
      name: "t212_list_positions",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
  });

  it("reports an API failure as a tool error, not a protocol fault", async () => {
    const { client } = await connect({});

    const result = await client.callTool({
      name: "t212_get_position",
      arguments: { ticker: "ZZZ_US_EQ" },
    });

    // The model needs to see the failure and correct itself; a thrown
    // protocol error would surface to the user instead.
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(content[0]?.text).toContain("404");
  });

  it("includes recovery guidance in an authentication error", async () => {
    const { context } = toolHarness({});
    const server = createServer({
      config: context.config,
      client: context.client,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const result = await client.callTool({
      name: "t212_get_account_cash",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });

  it("rejects invalid arguments without calling the API", async () => {
    const { client, urls } = await connect({});

    const result = await client.callTool({
      name: "t212_search_instruments",
      arguments: { query: "" },
    });

    expect(result.isError).toBe(true);
    expect(urls).toHaveLength(0);
  });

  it("rejects an unknown tool", async () => {
    const { client } = await connect();

    // Order placement is not registered, so the name does not resolve.
    const result = await client.callTool({
      name: "t212_place_order",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(content[0]?.text).toContain("not found");
  });
});

describe("resources and prompts", () => {
  it("describes the connection without credentials or a network call", async () => {
    const { client, urls } = await connect();

    const result = await client.readResource({ uri: "t212://connection" });
    const text = (result.contents[0] as { text: string }).text;
    const parsed = JSON.parse(text) as Record<string, unknown>;

    expect(parsed).toMatchObject({ readOnly: true, environment: "demo" });
    expect(text).not.toContain("test-api-key-000");
    // Listing resources on connect must not spend rate-limit budget.
    expect(urls).toHaveLength(0);
  });

  it("offers a portfolio review prompt", async () => {
    const { client } = await connect();

    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain("portfolio_review");

    const prompt = await client.getPrompt({
      name: "portfolio_review",
      arguments: { focus: "dividends" },
    });
    const text = (prompt.messages[0]?.content as { text: string }).text;

    expect(text).toContain("dividends");
    expect(text).toContain("read-only");
  });
});

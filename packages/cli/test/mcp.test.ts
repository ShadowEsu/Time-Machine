// The MCP server speaks JSON-RPC 2.0 over stdio and calls the same engine.
import { beforeAll, describe, expect, test } from "vitest";
import { setupDemo, type Demo } from "../../../fixtures/demo/setup.ts";
import { handleMcp } from "../src/mcp.ts";

let demo: Demo;
beforeAll(async () => {
  demo = await setupDemo();
});

describe("tm mcp", () => {
  test("initialize, list tools, call find-good", async () => {
    const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } }, demo.ctx);
    expect(init).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "timetm" } } });
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, demo.ctx)).toBeNull();
    const list = (await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, demo.ctx)) as { result: { tools: { name: string }[] } };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["checkpoint", "timeline", "verify", "find_good", "recover", "diff"]));
    const call = (await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_good", arguments: {} } }, demo.ctx)) as { result: { content: { text: string }[]; isError: boolean } };
    expect(call.result.isError).toBe(false);
    expect(JSON.parse(call.result.content[0]!.text)).toMatchObject({ found: "cp-0003" });
  });

  test("responses from the client get no reply, and errors keep the request id", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", id: 10, result: {} }, demo.ctx)).toBeNull();
    expect(await handleMcp({ jsonrpc: "1.0", id: 9, method: "ping" }, demo.ctx)).toMatchObject({ id: 9, error: { code: -32600 } });
  });

  test("bad input gives JSON-RPC errors, not crashes", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", id: 4, method: "nope" }, demo.ctx)).toMatchObject({ error: { code: -32601 } });
    const bad = (await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "verify", arguments: { id: 7 } } }, demo.ctx)) as { result: { isError: boolean } };
    expect(bad.result.isError).toBe(true);
  });
});

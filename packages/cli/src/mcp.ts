// MCP server over stdio (newline delimited JSON-RPC 2.0). Same engine as the CLI.
import { createInterface } from "node:readline";
import { z } from "zod";
import * as tm from "@timetm/core";
import { VERSION } from "./version.js";

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const RequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

interface Tool {
  name: string;
  description: string;
  args: z.ZodType<Record<string, unknown>>;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run: (ctx: tm.Ctx, args: Record<string, unknown>) => Promise<unknown>;
}

const id = z.string().regex(/^cp-\d{4,}$/);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const cpId = { type: "string", pattern: "^cp-\\d{4,}$", description: "Checkpoint ID, like cp-0003" };

const TOOLS: Tool[] = [
  {
    name: "checkpoint",
    description: "Save a checkpoint of the project as it is now: code including uncommitted changes, files not in Git, config key names. Secret values are never stored.",
    args: z.strictObject({ note: z.string().max(500).optional(), if_changed: z.boolean().optional() }),
    inputSchema: obj({ note: { type: "string" }, if_changed: { type: "boolean", description: "Skip if nothing changed since the newest checkpoint" } }),
    readOnly: false,
    run: (ctx, a) => tm.checkpoint(ctx, { note: str(a.note), trigger: "mcp", skipIfUnchanged: a.if_changed === true }),
  },
  { name: "timeline", description: "List checkpoints with their latest verdicts.", args: z.strictObject({}), inputSchema: obj({}), readOnly: true, run: (ctx) => tm.timeline(ctx) },
  {
    name: "diff",
    description: "Compare two checkpoints: code, files, config keys, dependencies, environment.",
    args: z.strictObject({ a: id, b: id }),
    inputSchema: obj({ a: cpId, b: cpId }, ["a", "b"]),
    readOnly: true,
    run: (ctx, a) => tm.diff(ctx, str(a.a), str(a.b)),
  },
  {
    name: "verify",
    description: "Run the project's check on a checkpoint in a separate copy. Returns PASS, FAIL, INCOMPLETE, BLOCKED or ERROR. Never touches the working folder.",
    args: z.strictObject({ id: id.optional() }),
    inputSchema: obj({ id: cpId }),
    readOnly: false,
    run: (ctx, a) => tm.verify(ctx, typeof a.id === "string" ? a.id : undefined),
  },
  {
    name: "find_good",
    description: "Walk back from the newest checkpoint, checking each, until one passes. Never touches the working folder.",
    args: z.strictObject({}),
    inputSchema: obj({}),
    readOnly: false,
    run: (ctx) => tm.findGood(ctx),
  },
  {
    name: "recover",
    description: "Prepare a recovery: save the current state first, create a local branch at the checkpoint and a recovery copy next to the project. Never switches branches, pushes, merges or deletes.",
    args: z.strictObject({ id }),
    inputSchema: obj({ id: cpId }, ["id"]),
    readOnly: false,
    run: (ctx, a) => tm.recover(ctx, str(a.id)),
  },
  { name: "log", description: "Show the append-only audit log.", args: z.strictObject({}), inputSchema: obj({}), readOnly: true, run: (ctx) => tm.log(ctx) },
];

type Response = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (rid: string | number | null, result: unknown): Response => ({ jsonrpc: "2.0", id: rid, result });
const fail = (rid: string | number | null, code: number, message: string): Response => ({ jsonrpc: "2.0", id: rid, error: { code, message } });

/** Handles one JSON-RPC message. Returns null for notifications. */
export async function handleMcp(message: unknown, ctx: tm.Ctx): Promise<Response | null> {
  const req = RequestSchema.safeParse(message);
  if (!req.success) {
    const m = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
    // A response from the client (result or error, no method) needs no reply.
    if (!("method" in m) && ("result" in m || "error" in m)) return null;
    const rid = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
    return fail(rid, -32600, "Invalid request");
  }
  const { method, params } = req.data;
  if (req.data.id === undefined) return null;
  const rid = req.data.id;
  switch (method) {
    case "initialize": {
      const asked = z.object({ protocolVersion: z.string() }).safeParse(params);
      const version = asked.success && SUPPORTED.includes(asked.data.protocolVersion) ? asked.data.protocolVersion : SUPPORTED[0];
      return ok(rid, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: "timetm", version: VERSION },
        instructions: "Time Machine saves checkpoints of this project and checks which ones still work. Save a checkpoint before risky changes. If the project broke, call find_good, then recover. Nothing here pushes, merges or deletes.",
      });
    }
    case "ping":
      return ok(rid, {});
    case "tools/list":
      return ok(rid, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly, destructiveHint: false } })),
      });
    case "tools/call": {
      const call = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }).safeParse(params);
      if (!call.success) return fail(rid, -32602, "Invalid params");
      const tool = TOOLS.find((t) => t.name === call.data.name);
      if (!tool) return fail(rid, -32602, `Unknown tool ${call.data.name}`);
      const args = tool.args.safeParse(call.data.arguments ?? {});
      if (!args.success) return ok(rid, { content: [{ type: "text", text: `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }], isError: true });
      try {
        const result = await tool.run(ctx, args.data);
        return ok(rid, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (e) {
        return ok(rid, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return fail(rid, -32601, `Method not found: ${method}`);
  }
}

/** Serves MCP until stdin closes. Requests are handled one at a time, in order. */
export async function serveMcp(ctx: tm.Ctx, input: NodeJS.ReadableStream, write: (s: string) => void): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      write(JSON.stringify(fail(null, -32700, "Parse error")) + "\n");
      continue;
    }
    const res = await handleMcp(msg, ctx);
    if (res) write(JSON.stringify(res) + "\n");
  }
}

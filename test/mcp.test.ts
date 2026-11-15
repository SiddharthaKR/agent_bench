import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { connectMcp } from "../src/mcp.ts";
import { loadAgent } from "../src/agent.ts";
import { mkdir, writeFile } from "node:fs/promises";
import type { ToolContext } from "../src/types.ts";

const fixture = path.resolve("test/fixtures/mcp-echo-server.mjs");
const config = { name: "docs", command: process.execPath, args: [fixture], enabled: true };
const ctx: ToolContext = { workspace: process.cwd(), commands: { compile: [], simulate: [] }, exec: async () => { throw new Error("Unused"); } };
const connections: Awaited<ReturnType<typeof connectMcp>>[] = [];
afterEach(async () => { await Promise.all(connections.splice(0).map((connection) => connection.close())); });
async function open(args = [fixture]) {
	const connection = await connectMcp([{ ...config, args }]);
	connections.push(connection);
	return connection;
}

it("maps names, summaries and primitive and JSON arguments", async () => {
	const { tools, problems } = await open();
	expect(problems).toEqual([]);
	expect(tools.map((tool) => tool.name)).toEqual(["docs_echo", "docs_add", "docs_search", "docs_fail", "docs_odd_name_"]);
	expect(tools[0]?.summary).toBe("Echo the input.");
	expect(tools[4]?.summary).toHaveLength(120);
	expect(tools[0]?.args).toEqual([{ name: "text", type: "string", required: true, help: "Text to echo" }]);
	expect(tools[1]?.args.map(({ name, type, required }) => ({ name, type, required }))).toEqual([{ name: "a", type: "number", required: true }, { name: "b", type: "number", required: true }]);
	expect(tools[2]?.args[0]).toMatchObject({ type: "string", required: false });
	expect(tools[2]?.args[0]?.help).toMatch(/\(JSON\)$/);
	expect(tools[2]?.args[0]?.help.length).toBeLessThanOrEqual(60);
	expect(tools[4]?.args.every((arg) => arg.type === "string" && arg.help.endsWith("(JSON)"))).toBe(true);
});

it("calls tools, parses JSON, reports errors and cuts output", async () => {
	const { tools } = await open();
	const call = (name: string, args: Record<string, string | number>) => tools.find((tool) => tool.name === name)!.run(args, ctx);
	expect(await call("docs_echo", { text: "hello" })).toEqual({ ok: true, text: "hello\nend" });
	expect(await call("docs_add", { a: 2, b: 3 })).toEqual({ ok: true, text: "5\nend" });
	expect(await call("docs_search", { filter: '{"kind":"docs"}' })).toEqual({ ok: true, text: '{"kind":"docs"}\nend' });
	expect(await call("docs_search", {})).toEqual({ ok: true, text: "{}\nend" });
	expect(await call("docs_search", { filter: "bad" })).toMatchObject({ ok: false, text: expect.stringContaining("filter") });
	expect(await call("docs_fail", {})).toEqual({ ok: false, text: "Fixture failure" });
	const cut = await call("docs_echo", { text: "x".repeat(2100) });
	expect(cut.text.length).toBeLessThanOrEqual(2000);
	expect(cut.text.endsWith("(output cut)")).toBe(true);
});

it("skips disabled and failed servers and caps tools", async () => {
	const failed = await connectMcp([{ ...config, command: "missing-mcp-command-123" }, { ...config, enabled: false }]);
	connections.push(failed);
	expect(failed.tools).toEqual([]);
	expect(failed.problems).toEqual([expect.stringMatching(/^MCP server "docs" could not start: /)]);
	const many = await open([fixture, "--many"]);
	expect(many.tools).toHaveLength(12);
	expect(many.problems).toEqual(['MCP server "docs" has 15 tools; only the first 12 are used to keep the prompt small.']);
});

it("close ends the child process and calls after close return errors", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-close-"));
	try {
		const pidFile = path.join(dir, "pid");
		const connection = await connectMcp([{ ...config, env: { MCP_PID_FILE: pidFile } }]);
		connections.push(connection);
		const pid = Number(await readFile(pidFile, "utf8"));
		expect(() => process.kill(pid, 0)).not.toThrow();
		await connection.close();
		expect(() => process.kill(pid, 0)).toThrow();
		expect(await connection.tools[0]!.run({ text: "hello" }, ctx)).toMatchObject({ ok: false });
		await connection.close();
	} finally { await rm(dir, { recursive: true, force: true }); }
});

it("does not start servers while loading an agent", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-load-"));
	try {
		const agentDir = path.join(dir, "agent");
		await mkdir(agentDir);
		const pidFile = path.join(dir, "pid");
		await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "Test", tools: [], mcp: [{ ...config, env: { MCP_PID_FILE: pidFile } }] }));
		await writeFile(path.join(agentDir, "prompt.md"), "Test.");
		expect((await loadAgent(agentDir)).specs).toEqual([]);
		await expect(readFile(pidFile)).rejects.toThrow();
	} finally { await rm(dir, { recursive: true, force: true }); }
});

it("reports a conflicting tool name without replacing an existing tool", async () => {
	const connection = await connectMcp([config], { reservedNames: ["docs_echo"] });
	connections.push(connection);
	expect(connection.tools).toEqual([]);
	expect(connection.problems).toEqual([expect.stringContaining('Tool name "docs_echo" is already in use.')]);
});

it("times out tool discovery and ends the stalled server", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-timeout-"));
	try {
		const pidFile = path.join(dir, "pid");
		const connection = await connectMcp([{ ...config, args: [fixture, "--hang"], env: { MCP_PID_FILE: pidFile } }]);
		connections.push(connection);
		expect(connection.tools).toEqual([]);
		expect(connection.problems[0]).toMatch(/^MCP server "docs" could not start: .*([Tt]ime|[Tt]imed)/);
		const pid = Number(await readFile(pidFile, "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
	} finally { await rm(dir, { recursive: true, force: true }); }
}, 15_000);

import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createAgent, deleteAgent, listAgentDetails, readAgentDetail, saveAgent } from "../src/agent-store.ts";
import { loadAgent } from "../src/agent.ts";
import type { AgentUpdate } from "../src/shared/agents.ts";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "agents-test-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
function update(): AgentUpdate {
	return { name: "Edited", prompt: "Work carefully.", tools: ["read_file"], skills: [], subagents: [], mcp: [], maxTurns: 25, maxSeconds: null, smallFileLines: 50, trimContext: true };
}
it("round-trips MCP settings while keeping env private and preserving it by name", async () => {
	await createAgent(dir, "one", "One");
	const file = path.join(dir, "one", "agent.json");
	const raw = JSON.parse(await readFile(file, "utf8"));
	await writeFile(file, JSON.stringify({ ...raw, mcp: [{ name: "docs", command: "old", args: [], enabled: true, env: { KEY: "secret" } }] }));
	const mcp = [{ name: "docs", command: "node", args: ["server.js", "two words"], enabled: false }];
	const detail = await saveAgent(dir, "one", { ...update(), mcp });
	expect(detail.mcp).toEqual(mcp);
	expect(JSON.parse(await readFile(file, "utf8")).mcp).toEqual([{ ...mcp[0], env: { KEY: "secret" } }]);
	expect(JSON.stringify(detail)).not.toContain("secret");
	await saveAgent(dir, "one", { ...update(), mcp: [{ ...mcp[0]!, name: "other" }] });
	expect(JSON.parse(await readFile(file, "utf8")).mcp[0]).not.toHaveProperty("env");
});
it.each(["Bad", "a-b", "", "a".repeat(25)])("rejects invalid MCP name %j", async (name) => {
	await createAgent(dir, "one", "One");
	await expect(saveAgent(dir, "one", { ...update(), mcp: [{ name, command: "node", args: [], enabled: true }] })).rejects.toThrow(/MCP/);
});
it("rejects empty commands and duplicate MCP names", async () => {
	await createAgent(dir, "one", "One");
	const server = { name: "docs", command: "node", args: [], enabled: true };
	await expect(saveAgent(dir, "one", { ...update(), mcp: [{ ...server, command: " " }] })).rejects.toThrow(/command/i);
	await expect(saveAgent(dir, "one", { ...update(), mcp: [server, server] })).rejects.toThrow(/MCP/);
});
it("creates file-backed defaults and rejects duplicate and invalid ids", async () => {
	const item = await createAgent(dir, "new-agent", "New agent");
	expect(item.tools.filter((tool) => tool.enabled).map((tool) => tool.name)).toEqual(["read_file", "write_file"]);
	expect(item.skills).toEqual([]);
	expect(item.prompt).toBe("Describe what this agent is for and how it should work.");
	expect(item.promptChars).toBeGreaterThan(item.prompt.length);
	expect(await listAgentDetails(dir)).toEqual([item]);
	await expect(createAgent(dir, "new-agent", "Duplicate")).rejects.toThrow(/exists/);
	for (const id of ["../escape", "A", "a".repeat(33), ""]) await expect(createAgent(dir, id, "Bad")).rejects.toThrow(/id/);
});
it("preserves unknown keys, discovers disabled skills and computes the full prompt", async () => {
	await createAgent(dir, "one", "One");
	await createAgent(dir, "two", "Two");
	await mkdir(path.join(dir, "one", "skills"));
	await writeFile(path.join(dir, "one", "skills", "different-file.md"), "---\nname: practice\ndescription: Useful practice.\nalways: true\n---\nDo the work.");
	const file = path.join(dir, "one", "agent.json");
	const raw = JSON.parse(await readFile(file, "utf8"));
	await writeFile(file, JSON.stringify({ ...raw, custom: { keep: true } }));
	const before = await readAgentDetail(dir, "one");
	expect(before.skills).toEqual([{ name: "practice", description: "Useful practice.", always: true, enabled: false }]);
	const saved = await saveAgent(dir, "one", { ...update(), skills: ["practice"], subagents: ["two"] });
	expect(saved.skills[0]?.enabled).toBe(true);
	expect(saved.subagents).toEqual([{ id: "two", name: "Two", enabled: true }]);
	const text = await readFile(file, "utf8");
	expect(text).toContain('\n\t"name"');
	expect(text.endsWith("\n")).toBe(true);
	expect(JSON.parse(text).custom).toEqual({ keep: true });
	expect(JSON.parse(text)).not.toHaveProperty("maxSeconds");
	expect(saved.promptChars).toBe((await loadAgent(path.join(dir, "one"))).systemPrompt.length);
});
it.each([
	{ name: " " }, { tools: ["missing"] }, { skills: ["missing"] }, { subagents: ["one"] }, { subagents: ["missing"] },
	{ maxTurns: 0 }, { maxTurns: 201 }, { maxTurns: 1.5 }, { maxSeconds: 29 }, { maxSeconds: 7201 },
	{ smallFileLines: -1 }, { smallFileLines: 2001 }, { trimContext: "yes" }, { prompt: null }, { tools: null },
])("rejects invalid updates without changing files: %j", async (invalid) => {
	await createAgent(dir, "one", "One");
	const before = await readAgentDetail(dir, "one");
	await expect(saveAgent(dir, "one", { ...update(), ...invalid } as AgentUpdate)).rejects.toThrow();
	expect(await readAgentDetail(dir, "one")).toEqual(before);
});
it("refuses the last or referenced agent and reports missing agents", async () => {
	await createAgent(dir, "one", "One");
	await expect(deleteAgent(dir, "one")).rejects.toThrow(/last agent/);
	await createAgent(dir, "two", "Two");
	await saveAgent(dir, "two", { ...update(), name: "Two", subagents: ["one"] });
	await expect(deleteAgent(dir, "one")).rejects.toThrow(/Two/);
	await deleteAgent(dir, "two");
	expect((await listAgentDetails(dir)).map((item) => item.id)).toEqual(["one"]);
	await expect(readAgentDetail(dir, "missing")).rejects.toThrow("No such agent.");
});
it("keeps unknown JSON keys even when an update carries extra properties", async () => {
	await createAgent(dir, "one", "One");
	const file = path.join(dir, "one", "agent.json");
	const raw = JSON.parse(await readFile(file, "utf8"));
	await writeFile(file, JSON.stringify({ ...raw, prompt: "Legacy metadata", custom: "Keep" }));
	await saveAgent(dir, "one", { ...update(), custom: "Replace" } as AgentUpdate);
	expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ prompt: "Legacy metadata", custom: "Keep" });
});

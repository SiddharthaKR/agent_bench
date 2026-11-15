import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAgent } from "./agent.ts";
import { loadSkills } from "./skills.ts";
import { ALL_TOOLS } from "./tools/index.ts";
import type { AgentDetail, AgentUpdate } from "./shared/agents.ts";

export class AgentStoreError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}
function invalid(message: string): never { throw new AgentStoreError(400, message); }
function agentPath(dir: string, id: string): string {
	if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) invalid("Agent id must be 1 to 32 lowercase letters, digits, dashes or underscores, starting with a letter or digit.");
	return path.join(dir, id);
}
async function existing(dir: string, id: string): Promise<string> {
	const folder = agentPath(dir, id);
	try {
		const stat = await lstat(folder);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AgentStoreError(404, "No such agent.");
		await readFile(path.join(folder, "agent.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AgentStoreError(404, "No such agent.");
		throw error;
	}
	return folder;
}
async function entries(dir: string): Promise<{ id: string; file: Record<string, unknown> }[]> {
	let names;
	try { names = await readdir(dir, { withFileTypes: true }); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
	const result = [];
	for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(entry.name)) continue;
		try { result.push({ id: entry.name, file: JSON.parse(await readFile(path.join(dir, entry.name, "agent.json"), "utf8")) as Record<string, unknown> }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
	return result;
}
export async function listAgentDetails(agentsDir: string): Promise<AgentDetail[]> {
	return Promise.all((await entries(agentsDir)).map((entry) => readAgentDetail(agentsDir, entry.id)));
}
export async function readAgentDetail(agentsDir: string, id: string): Promise<AgentDetail> {
	const folder = await existing(agentsDir, id);
	const { agentFile: file, systemPrompt } = await loadAgent(folder);
	const raw = JSON.parse(await readFile(path.join(folder, "agent.json"), "utf8")) as Record<string, unknown>;
	return {
		id, name: file.name, prompt: await readFile(path.join(folder, "prompt.md"), "utf8"),
		tools: ALL_TOOLS.map((tool) => ({ name: tool.name, summary: tool.summary, enabled: file.tools.includes(tool.name) })),
		skills: (await loadSkills(folder)).map(({ name, description, always }) => ({ name, description, always, enabled: !file.skills || file.skills.includes(name) })),
		subagents: (await entries(agentsDir)).filter((entry) => entry.id !== id).map((entry) => ({ id: entry.id, name: String(entry.file.name), enabled: Array.isArray(raw.subagents) && raw.subagents.includes(entry.id) })),
		mcp: (file.mcp ?? []).map(({ name, command, args, enabled }) => ({ name, command, args: args ?? [], enabled })),
		maxTurns: file.maxTurns ?? 40, maxSeconds: file.maxSeconds ?? null, smallFileLines: file.smallFileLines ?? 150, trimContext: file.trimContext !== false,
		promptChars: systemPrompt.length,
	};
}
function strings(value: unknown, label: string): asserts value is string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalid(`${label} must be a list of names.`);
}
function integer(value: unknown, min: number, max: number, label: string): void {
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalid(`${label} must be a whole number from ${min} to ${max}.`);
}
function validName(name: unknown): asserts name is string {
	if (typeof name !== "string" || !name.trim()) invalid("Name must be a non-empty string.");
}
export async function saveAgent(agentsDir: string, id: string, update: AgentUpdate): Promise<AgentDetail> {
	const folder = await existing(agentsDir, id);
	if (!update || typeof update !== "object") invalid("Expected an agent update.");
	validName(update.name);
	if (typeof update.prompt !== "string") invalid("Prompt must be text.");
	strings(update.tools, "Tools"); strings(update.skills, "Skills"); strings(update.subagents, "Sub-agents");
	if (update.mcp !== undefined) {
		if (!Array.isArray(update.mcp)) invalid("MCP servers must be a list.");
		const names = new Set<string>();
		for (const server of update.mcp) {
			if (!server || typeof server.name !== "string" || !/^[a-z0-9][a-z0-9_]{0,23}$/.test(server.name)) invalid("MCP server names must be 1 to 24 lowercase letters, digits or underscores, starting with a letter or digit.");
			if (names.has(server.name)) invalid("MCP server names must be unique.");
			names.add(server.name);
			if (typeof server.command !== "string" || !server.command.trim()) invalid("MCP server command must not be empty.");
			strings(server.args, "MCP server arguments");
			if (typeof server.enabled !== "boolean") invalid("MCP server enabled must be a boolean.");
		}
	}
	for (const name of update.tools) if (!ALL_TOOLS.some((tool) => tool.name === name)) invalid(`No such tool: ${name}.`);
	const skills = await loadSkills(folder);
	for (const name of update.skills) if (!skills.some((skill) => skill.name === name)) invalid(`No such skill: ${name}.`);
	const agents = await entries(agentsDir);
	for (const name of update.subagents) {
		if (name === id) invalid("An agent cannot be its own sub-agent.");
		if (!agents.some((agent) => agent.id === name)) invalid(`No such sub-agent: ${name}.`);
	}
	integer(update.maxTurns, 1, 200, "Most tool calls");
	if (update.maxSeconds !== null) integer(update.maxSeconds, 30, 7200, "Time limit");
	integer(update.smallFileLines, 0, 2000, "Whole file line limit");
	if (typeof update.trimContext !== "boolean") invalid("Trim context must be a boolean.");
	const file = JSON.parse(await readFile(path.join(folder, "agent.json"), "utf8")) as Record<string, unknown>;
	if (update.mcp !== undefined) {
		const previous = Array.isArray(file.mcp) ? file.mcp as { name: string; env?: unknown }[] : [];
		file.mcp = update.mcp.map(({ name, command, args, enabled }) => {
			const env = previous.find((server) => server.name === name)?.env;
			return { name, command, args, enabled, ...(env !== undefined ? { env } : {}) };
		});
	}
	Object.assign(file, {
		name: update.name, tools: update.tools, skills: update.skills, subagents: update.subagents,
		maxTurns: update.maxTurns, maxSeconds: update.maxSeconds, smallFileLines: update.smallFileLines, trimContext: update.trimContext,
	});
	if (update.maxSeconds === null) delete file.maxSeconds;
	await writeFile(path.join(folder, "agent.json"), JSON.stringify(file, null, "\t") + "\n");
	await writeFile(path.join(folder, "prompt.md"), update.prompt);
	return readAgentDetail(agentsDir, id);
}
export async function createAgent(agentsDir: string, id: string, name: string): Promise<AgentDetail> {
	const folder = agentPath(agentsDir, id);
	validName(name);
	await mkdir(agentsDir, { recursive: true });
	try { await mkdir(folder); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") invalid("An agent with this id already exists."); throw error; }
	await writeFile(path.join(folder, "agent.json"), JSON.stringify({ name, tools: ["read_file", "write_file"], skills: [] }, null, "\t") + "\n");
	await writeFile(path.join(folder, "prompt.md"), "Describe what this agent is for and how it should work.");
	return readAgentDetail(agentsDir, id);
}
export async function deleteAgent(agentsDir: string, id: string): Promise<void> {
	const folder = await existing(agentsDir, id);
	const agents = await entries(agentsDir);
	if (agents.length <= 1) invalid("Cannot delete the last agent.");
	const parent = agents.find((entry) => entry.id !== id && Array.isArray(entry.file.subagents) && entry.file.subagents.includes(id));
	if (parent) invalid(`Cannot delete this agent because ${String(parent.file.name)} lists it as a sub-agent.`);
	await rm(folder, { recursive: true });
}

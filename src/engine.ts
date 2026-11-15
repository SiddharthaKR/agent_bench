/**
 * The real engine behind the local server: reads config.json, the agents/
 * and workflows/ folders, and creates sessions and workflow runs.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAgent } from "./agent.ts";
import { loadConfig } from "./config.ts";
import type { AgentFile } from "./agent.ts";
import type { ServerConfig } from "./model.ts";
import { createSession } from "./session.ts";
import type { AgentInfo, Workflow } from "./shared/api.ts";
import type { Engine } from "./shared/engine.ts";
import { realExec } from "./tools/index.ts";
import type { CommandConfig, Exec } from "./types.ts";
import { createWorkflowRun, prepareWorkflowSkills } from "./workflow.ts";

export interface EngineOptions {
	/** Folder holding config.json, agents/ and workflows/. */
	root: string;
	/** Project folder offered when the user has not chosen one. */
	defaultFolder: string;
	exec?: Exec;
	fetchFn?: typeof fetch;
	/** Default time limit per workflow agent step, in seconds. */
	maxSeconds?: number;
}

export function createEngine(options: EngineOptions): Engine {
	const agentsDir = path.join(options.root, "agents");
	const workflowsDir = path.join(options.root, "workflows");
	const runsDir = path.join(options.root, "runs");
	const exec = options.exec ?? realExec;

	const readConfig = () => loadConfig(options.root);

	const pickServer = async (id: string, model?: string): Promise<{ server: ServerConfig; commands: CommandConfig }> => {
		const config = await readConfig();
		const server = config.servers[id];
		if (!server) throw new Error(`No model server named "${id}" in config.json.`);
		return { server: model ? { ...server, model } : server, commands: config.commands };
	};

	const checkFolder = async (folder: string): Promise<string> => {
		if (!path.isAbsolute(folder)) throw new Error("The project folder must be a full path.");
		const info = await stat(folder).catch(() => null);
		if (!info?.isDirectory()) throw new Error(`The folder ${folder} does not exist.`);
		return path.resolve(folder);
	};

	const agentDirOf = async (id: string): Promise<string> => {
		if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`"${id}" is not a valid agent name.`);
		const dir = path.join(agentsDir, id);
		const info = await stat(path.join(dir, "agent.json")).catch(() => null);
		if (!info) throw new Error(`There is no agent named "${id}".`);
		return dir;
	};

	return {
		async config() {
			const config = await readConfig();
			const agents: AgentInfo[] = [];
			for (const entry of await readdir(agentsDir, { withFileTypes: true }).catch(() => [])) {
				if (!entry.isDirectory()) continue;
				try {
					const file = JSON.parse(await readFile(path.join(agentsDir, entry.name, "agent.json"), "utf8")) as AgentFile;
					agents.push({ id: entry.name, name: file.name, tools: file.tools });
				} catch {
					// A folder without a readable agent.json is not an agent.
				}
			}
			agents.sort((a, b) => a.name.localeCompare(b.name));
			return {
				agents,
				servers: Object.entries(config.servers).map(([id, server]) => ({ id, baseUrl: server.baseUrl, model: server.model })),
				defaultFolder: options.defaultFolder,
			};
		},

		async createSession(request) {
			const { server, commands } = await pickServer(request.server, request.model);
			return createSession({
				id: randomUUID(),
				agentDir: await agentDirOf(request.agent),
				workspace: await checkFolder(request.folder),
				server,
				commands,
				runsDir,
				askFirst: request.askFirst,
				protect: request.protect,
				exec,
				fetchFn: options.fetchFn,
			});
		},

		async listWorkflows() {
			const out: Workflow[] = [];
			for (const name of await readdir(workflowsDir).catch(() => [])) {
				if (!name.endsWith(".json")) continue;
				try {
					out.push(JSON.parse(await readFile(path.join(workflowsDir, name), "utf8")) as Workflow);
				} catch {
					// An unreadable file is skipped; the others still load.
				}
			}
			return out.sort((a, b) => a.name.localeCompare(b.name));
		},

		async saveWorkflow(workflow) {
			await mkdir(workflowsDir, { recursive: true });
			await writeFile(path.join(workflowsDir, `${workflow.id}.json`), `${JSON.stringify(workflow, null, "\t")}\n`);
		},

		async deleteWorkflow(id) {
			await rm(path.join(workflowsDir, `${id}.json`), { force: true });
		},

		async createWorkflowRun(request) {
			const { server, commands } = await pickServer(request.server, request.model);
			const workspace = await checkFolder(request.folder);
			const workflow = await prepareWorkflowSkills(request.workflow, request.skills, agentDirOf);
			return createWorkflowRun(randomUUID(), workflow, request.task, {
				interactiveQuestions: true,
				workspace,
				exec,
				// Each agent step is a fresh run: its own context, its own trace.
				runAgent: async (step, task, signal, onLine, onQuestion, questionBudget) => {
					const result = await runAgent({
						questionBudget,
						agentDir: await agentDirOf(step.agent),
						skills: step.skills,
						workspace,
						task,
						server: { ...server, model: step.model ?? server.model, temperature: step.temperature ?? server.temperature, extra: { ...server.extra, ...step.extra } },
						maxSeconds: step.maxSeconds ?? options.maxSeconds,
						protect: step.protect,
						overrides: { maxTurns: step.maxTurns, tools: step.tools },
						commands,
						runsDir,
						exec,
						fetchFn: options.fetchFn,
						onStep: onLine,
						onQuestion,
						signal,
					});
					return { ok: result.reason === "done", text: result.finalText || result.error || `The agent ended with: ${result.reason}.`, limit: result.reason === "time" ? "time" : result.reason === "limit" ? "turns" : undefined };
				},
			});
		},
	};
}

/**
 * Command line: run one agent on one task in a project folder.
 *
 *   npm run agent -- --folder <project> --task "<what to do>"
 *
 * Options: --agent fpga | --server local | --model <id> | --task-file <path> | --runs <dir>
 */
import { questionReader } from "./cli-question.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.ts";
import { loadConfig } from "./config.ts";
import type { ServerConfig } from "./model.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		if (!arg.startsWith("--")) throw new Error(`Unexpected argument "${arg}".`);
		if (arg === "--ask") { out.ask = "true"; continue; }
		const value = argv[i + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`Option ${arg} needs a value.`);
		out[arg.slice(2)] = value;
		i++;
	}
	return out;
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const maxSeconds = args["max-seconds"] === undefined ? undefined : Number(args["max-seconds"]);
	if (maxSeconds !== undefined && (!Number.isFinite(maxSeconds) || maxSeconds <= 0)) throw new Error("--max-seconds must be a positive number.");
	if (!args.folder) throw new Error("Give the project folder with --folder <path>.");
	const task = args["task-file"] ? (await readFile(args["task-file"], "utf8")).trim() : args.task;
	if (!task) throw new Error('Give the task with --task "<text>" or --task-file <path>.');

	const config = await loadConfig(ROOT);
	const serverName = args.server ?? "local";
	const server = config.servers[serverName];
	if (!server) throw new Error(`No server named "${serverName}" in config.json. Known: ${Object.keys(config.servers).join(", ")}.`);
	const chosen: ServerConfig = args.model ? { ...server, model: args.model } : server;
	const agentName = args.agent ?? "fpga";

	console.log(`Agent ${agentName} · model ${chosen.model} · ${chosen.baseUrl}`);
	console.log(`Folder ${path.resolve(args.folder)}`);
	console.log("");

	const controller = new AbortController();
	process.once("SIGINT", () => controller.abort());

	const result = await runAgent({
		onQuestion: questionReader(args.ask === "true", undefined, controller.signal, () => controller.abort()),
		agentDir: path.join(ROOT, "agents", agentName),
		workspace: args.folder,
		task,
		server: chosen,
		commands: config.commands,
		runsDir: args.runs ?? path.join(ROOT, "runs"),
		onStep: (line) => console.log(line),
		signal: controller.signal,
		maxSeconds,
		protect: args.protect?.split(",").map((entry) => entry.trim()).filter(Boolean),
		skills: args.skills?.split(",").map((name) => name.trim()).filter(Boolean),
	});

	console.log("");
	if (result.finalText) console.log(result.finalText);
	console.log("");
	const agentFile = JSON.parse(await readFile(path.join(ROOT, "agents", agentName, "agent.json"), "utf8")) as { maxSeconds?: number };
	console.log(`Ended: ${result.reason}${result.reason === "time" ? ` (limit ${maxSeconds ?? agentFile.maxSeconds} s)` : result.error ? ` (${result.error})` : ""}`);
	console.log(
		`Model calls ${result.modelCalls} · tool calls ${result.toolCalls} · tool errors ${result.toolErrors} · unreadable calls ${result.invalidCalls} · blocked ${result.blocked}`,
	);
	console.log(
		`Prompt ${result.promptChars} chars · context first ${result.firstPromptTokens} / last ${result.lastPromptTokens} tokens · output ${result.outputTokens} tokens · ${(result.ms / 1000).toFixed(1)} s`,
	);
	console.log(`Trace ${result.traceDir}`);
	return result.reason === "done" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(
	(code) => process.exit(code),
	(error) => {
		console.error((error as Error).message);
		process.exit(2);
	},
);

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { prepareWorkflowRun } from "./index.ts";

export interface WorkflowArgs {
	workflow: string;
	folder: string;
	task: string;
	server: string;
	model?: string;
	maxSeconds?: number;
	noPause: boolean;
	vars: Record<string, string>;
}

export function parseWorkflowArgs(argv: string[]): WorkflowArgs {
	const values: Record<string, string> = {};
	const vars: Record<string, string> = {};
	let noPause = false;
	for (let i = 0; i < argv.length; i++) {
		const key = argv[i]!;
		if (key === "--no-pause") { noPause = true; continue; }
		if (!["--workflow", "--folder", "--task", "--server", "--model", "--var", "--max-seconds"].includes(key)) throw new Error(`Unknown option ${key}.`);
		const value = argv[++i];
		if (value === undefined || value.startsWith("--")) throw new Error(`Option ${key} needs a value.`);
		if (key === "--var") {
			const equal = value.indexOf("=");
			if (equal < 1) throw new Error("--var needs name=value.");
			vars[value.slice(0, equal)] = value.slice(equal + 1);
		} else values[key.slice(2)] = value;
	}
	for (const key of ["workflow", "folder", "task"]) if (!values[key]) throw new Error(`Give --${key}.`);
	const maxSeconds = values["max-seconds"] === undefined ? undefined : Number(values["max-seconds"]);
	if (maxSeconds !== undefined && (!Number.isFinite(maxSeconds) || maxSeconds <= 0)) throw new Error("--max-seconds must be a positive number.");
	return { workflow: values.workflow!, folder: values.folder!, task: values.task!, server: values.server ?? "local", model: values.model, maxSeconds, noPause, vars };
}

export async function workflowMain(argv: string[]): Promise<number> {
	if (argv.includes("--help")) {
		console.log("Usage: workflow --workflow file.json --folder path --task text [--server name] [--model name] [--var name=value] [--no-pause] [--max-seconds seconds]\n--max-seconds limits each agent step, not the whole workflow.");
		return 0;
	}
	const args = parseWorkflowArgs(argv);
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const { run, workflow } = await prepareWorkflowRun({ ...args, root });
	const stop = () => run.stop();
	process.once("SIGINT", stop);
	try {
		return await new Promise<number>((resolve) => {
			const shown = new Map<string, string>();
			run.subscribe((event) => {
				if (event.type === "line") {
					for (const line of event.text.split(/\r?\n/)) console.log(`  ${line}`);
					return;
				}
				const state = event.state;
				for (const [index, step] of state.steps.entries()) {
					const value = `${step.round}:${step.status}`;
					if (shown.get(step.stepId) === value) continue;
					shown.set(step.stepId, value);
					console.log(`round ${step.round} · step ${index + 1} ${workflow.steps[index]!.name} · ${step.status}`);
				}
				console.log(`round ${state.round} · ${state.status}`);
				if (state.status === "paused") {
					if (args.noPause) queueMicrotask(() => run.resume());
					else if (process.stdin.isTTY) {
						const input = createInterface({ input: process.stdin, output: process.stdout });
						input.question("Paused. Press Enter to continue, or Ctrl+C to stop. ", () => {
							input.close();
							run.resume();
						});
						input.once("SIGINT", () => { input.close(); run.stop(); });
					}
					else {
						console.log("Paused. Run in a terminal to continue with Enter, or rerun with --no-pause to pass pauses automatically.");
						resolve(1);
					}
				} else if (["done", "failed", "stopped"].includes(state.status)) resolve(state.status === "done" ? 0 : 1);
			});
			run.start();
		});
	} finally { process.removeListener("SIGINT", stop); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	workflowMain(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: unknown) => {
		console.error((error as Error).message);
		process.exitCode = 2;
	});
}

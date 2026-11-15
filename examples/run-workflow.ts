import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkflow } from "../src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = path.resolve(process.argv[2] ?? ".");
const task = process.argv[3] ?? "Build the block described in spec.md.";

const result = await runWorkflow({
	root,
	workflow: path.join(root, "workflows", "fpga-block.json"),
	folder,
	task,
	server: "local",
	autoContinue: true,
	onEvent(event) {
		if (event.type === "state") {
			const { status, round, current } = event.state;
			console.log(`Round ${round}: ${status}, step ${current ?? "finished"}.`);
		}
	},
});

console.log(`Workflow ended: ${result.status}.`);
process.exitCode = result.status === "done" ? 0 : 1;

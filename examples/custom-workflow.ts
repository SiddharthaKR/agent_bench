import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkflow } from "../src/index.ts";
import type { Workflow } from "../src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow: Workflow = {
	id: "custom",
	name: "Write and check",
	task: "Implement the design in spec.md.",
	vars: { design: "design.v" },
	steps: [
		{ id: "write", name: "Write design", type: "agent", agent: "fpga", task: "{task} Write {design}.", maxTurns: 20 },
		{ id: "check", name: "Compile design", type: "command", command: ["iverilog", "-g2012", "-o", ".build/design.vvp", "{design}"], onFail: { goTo: "write", maxRounds: 3 } },
	],
};

const result = await runWorkflow({
	root, workflow, folder: path.resolve(process.argv[2] ?? "."), task: workflow.task,
	onEvent(event) { if (event.type === "state") console.log(`Round ${event.state.round}: ${event.state.status}.`); },
});
process.exitCode = result.status === "done" ? 0 : 1;

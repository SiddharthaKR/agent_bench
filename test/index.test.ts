import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEngine, prepareWorkflowRun, runWorkflow, validateWorkflow } from "../src/index.ts";
import type { Exec, Workflow, WorkflowEvent } from "../src/index.ts";

let root: string;
let workflow: Workflow;
const exec: Exec = vi.fn(async () => ({ code: 0, stdout: "PASS check", stderr: "", timedOut: false, notFound: false }));
let requests: { model: string; temperature?: number; messages: { content: string }[] }[];
const fetchFn: typeof fetch = async (_url, init) => {
	requests.push(JSON.parse(String(init?.body)));
	return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done." }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
};

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "code-workflow-"));
	await mkdir(path.join(root, "agents", "writer"), { recursive: true });
	await writeFile(path.join(root, "config.json"), JSON.stringify({ servers: { local: { baseUrl: "http://fake/v1", model: "base", temperature: 0.7 } }, commands: { compile: [], simulate: [] } }));
	await writeFile(path.join(root, "agents", "writer", "agent.json"), JSON.stringify({ name: "Writer", tools: ["read_file", "write_file"] }));
	await writeFile(path.join(root, "agents", "writer", "prompt.md"), "Write files.");
	workflow = { id: "test", name: "Test", task: "", vars: { value: "old" }, steps: [
		{ id: "write", name: "Write", type: "agent", agent: "writer", task: "{task}: {value}", model: "step", temperature: 0, maxTurns: 1, tools: ["read_file"] },
		{ id: "check", name: "Check", type: "command", command: ["checker", "{value}"] },
	] };
	requests = [];
	vi.clearAllMocks();
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("runs a workflow with fake fetch and exec, retaining the caller's workflow", async () => {
	const events: WorkflowEvent[] = [];
	const state = await runWorkflow({ root, folder: root, workflow, task: "Build", vars: { value: "new" }, model: "outer", fetchFn, exec, onEvent: (event) => events.push(event) });
	expect(state.status).toBe("done");
	expect(state.steps.map((step) => step.status)).toEqual(["passed", "passed"]);
	expect(requests[0]).toMatchObject({ model: "step", temperature: 0 });
	expect(requests[0]!.messages[0]!.content).toContain("@tool read_file");
	expect(requests[0]!.messages[0]!.content).not.toContain("@tool write_file");
	expect(requests[0]!.messages[1]!.content).toBe("Build: new");
	expect(exec).toHaveBeenCalledWith("checker", ["new"], expect.objectContaining({ cwd: root }));
	expect(events.at(-1)).toMatchObject({ type: "state", state: { status: "done" } });
	expect(workflow.vars.value).toBe("old");
});

it("reads a JSON workflow and continues past pauses by default", async () => {
	workflow.steps[0]!.pause = true;
	const file = path.join(root, "workflow.json");
	await writeFile(file, JSON.stringify(workflow));
	expect((await runWorkflow({ root, folder: root, workflow: file, task: "Build", fetchFn, exec })).status).toBe("done");
	expect(exec).toHaveBeenCalledTimes(1);
});

it("resolves at a pause without running the next step when autoContinue is false", async () => {
	workflow.steps[0]!.pause = true;
	const state = await runWorkflow({ root, folder: root, workflow, task: "Build", fetchFn, exec, autoContinue: false });
	expect(state).toMatchObject({ status: "paused", current: "check" });
	expect(exec).not.toHaveBeenCalled();
});

it("resolves failed workflows and rejects unknown servers", async () => {
	workflow.steps = [];
	expect((await runWorkflow({ root, folder: root, workflow, task: "Build", fetchFn, exec })).status).toBe("failed");
	await expect(runWorkflow({ root, folder: root, workflow, task: "Build", server: "missing" })).rejects.toThrow('No model server named "missing"');
});

it("continues and resolves when an event listener throws", async () => {
	workflow.steps[0]!.pause = true;
	const state = await runWorkflow({ root, folder: root, workflow, task: "Build", fetchFn, exec, onEvent: () => { throw new Error("Listener failed."); } });
	expect(state.status).toBe("done");
});

it("uses server settings when a step does not override them in shared CLI setup", async () => {
	const step = workflow.steps[0]!;
	if (step.type !== "agent") throw new Error("Expected agent step.");
	delete step.model;
	delete step.temperature;
	const { run } = await prepareWorkflowRun({ root, folder: root, workflow, task: "Build", model: "outer", fetchFn, exec });
	await new Promise<void>((resolve) => {
		run.subscribe((event) => { if (event.type === "state" && event.state.status === "done") resolve(); });
		run.start();
	});
	expect(requests[0]).toMatchObject({ model: "outer", temperature: 0.7 });
});

it("passes step model and temperature through the engine's real request body", async () => {
	const engine = createEngine({ root, defaultFolder: root, exec, fetchFn });
	const run = await engine.createWorkflowRun({ workflow, folder: root, task: "Build", server: "local", model: "outer" });
	await new Promise<void>((resolve) => {
		run.subscribe((event) => { if (event.type === "state" && event.state.status === "done") resolve(); });
		run.start();
	});
	expect(requests[0]).toMatchObject({ model: "step", temperature: 0 });
	expect(requests[0]!.messages[0]!.content).not.toContain("@tool write_file");
});

it("rejects invalid per-step settings and accepts their boundaries", () => {
	const step = workflow.steps[0]!;
	if (step.type !== "agent") throw new Error("Expected agent step.");
	for (const temperature of [-0.1, 2.1, NaN, Infinity]) expect(validateWorkflow({ ...workflow, steps: [{ ...step, temperature }] }).join(" ")).toContain("temperature between 0 and 2");
	for (const maxTurns of [0, -1, NaN, Infinity]) expect(validateWorkflow({ ...workflow, steps: [{ ...step, maxTurns }] }).join(" ")).toContain("at least one turn");
	expect(validateWorkflow({ ...workflow, steps: [{ ...step, tools: [] }] }).join(" ")).toContain("at least one tool");
	for (const temperature of [0, 2]) expect(validateWorkflow({ ...workflow, steps: [{ ...step, temperature, maxTurns: 1 }] })).toEqual([]);
});

it.each([false, true])("resumes a real workflow agent in the same turn with no time charge (app: %s)", async (app) => {
	await writeFile(path.join(root, "agents", "writer", "agent.json"), JSON.stringify({ name: "Writer", tools: ["ask_user"], maxSeconds: 0.2, maxQuestions: 3 }));
	const asking: Workflow = { ...workflow, steps: [1, 2, 3, 4].map((n) => ({ id: `ask${n}`, name: `Ask ${n}`, type: "agent" as const, agent: "writer", task: "Work" })) };
	const bodies: { messages: { content: string }[] }[] = [];
	const fetchQuestions: typeof fetch = async (_url, init) => {
		const body = JSON.parse(String(init?.body));
		bodies.push(body);
		const content = bodies.length % 2 ? `@tool ask_user\nassumption: One cycle.\n---\nLatency ${bodies.length}?\n@end` : "Done.";
		return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
	};
	let answers = 0;
	if (app) {
		const engine = createEngine({ root, defaultFolder: root, fetchFn: fetchQuestions });
		const run = await engine.createWorkflowRun({ workflow: asking, folder: root, server: "local", task: "Work" });
		const done = new Promise<void>((resolve) => run.subscribe((event) => {
			if (event.type === "question" && event.answer === null) {
				answers++;
				expect(run.state.status).toBe("waiting");
				setTimeout(() => run.answer!(event.id, "Two cycles."), 250);
			}
			if (event.type === "state" && ["done", "failed"].includes(event.state.status)) resolve();
		}));
		run.start();
		await done;
		expect(run.state.status).toBe("done");
	} else {
		const state = await runWorkflow({ root, folder: root, workflow: asking, task: "Work", fetchFn: fetchQuestions, onQuestion: async () => { answers++; await new Promise((resolve) => setTimeout(resolve, 250)); return "Two cycles."; } });
		expect(state.status).toBe("done");
	}
	expect(answers).toBe(3);
	expect(bodies).toHaveLength(8);
	expect(bodies[7]!.messages.at(-1)!.content).toContain("No one can answer now.");
});

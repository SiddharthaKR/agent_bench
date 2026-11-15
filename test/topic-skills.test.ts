import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadAgent, runAgent, prepareWorkflowRun, createEngine } from "../src/index.ts";
import type { Workflow } from "../src/shared/api.ts";
import { loadSkills } from "../src/skills.ts";
import { parseWorkflowArgs } from "../src/cli-workflow.ts";

let root: string;
let agentDir: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "preload-"));
	agentDir = path.join(root, "agents", "fpga");
	await mkdir(path.join(agentDir, "skills"), { recursive: true });
	await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "FPGA", tools: ["read_file"] }));
	await writeFile(path.join(agentDir, "prompt.md"), "Work.");
	for (const name of ["math", "retry", "other"]) await writeFile(path.join(agentDir, "skills", `${name}.md`), `---\nname: ${name}\ndescription: Load ${name}\nalways: false\n---\n${name} body.`);
	await writeFile(path.join(root, "config.json"), JSON.stringify({ servers: { local: { baseUrl: "http://fake/v1", model: "fake" } }, commands: {} }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("preloads once and excludes preloaded skills from use_skill", async () => {
	const loaded = await loadAgent(agentDir, { skills: ["math", "math"] });
	expect(loaded.systemPrompt.split("math body.")).toHaveLength(2);
	expect(loaded.systemPrompt).not.toContain("- math:");
	expect(loaded.systemPrompt).toContain("- other:");
	const tool = loaded.specs.find((s) => s.name === "use_skill")!;
	expect((await tool.run({ name: "math" }, {} as never)).ok).toBe(false);
	await expect(loadAgent(agentDir, { skills: ["missing"] })).rejects.toThrow(/missing.*FPGA/);
});

it("records the full preloaded prompt in the trace and result", async () => {
	const result = await runAgent({ agentDir, workspace: root, task: "Work", skills: ["math"], server: { baseUrl: "http://fake/v1", model: "fake" }, commands: { compile: [], simulate: [] }, runsDir: path.join(root, "runs"), fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }] })) });
	const start = JSON.parse((await readFile(path.join(result.traceDir, "trace.jsonl"), "utf8")).split("\n")[0]!);
	expect(start.systemPrompt).toContain("math body.");
	expect(start.promptChars).toBe(start.systemPrompt.length);
	expect(result.promptChars).toBe(start.promptChars);
});

it("keeps preloaded skills scoped to the selected agent when delegating", async () => {
	const child = path.join(root, "agents", "child");
	await mkdir(child);
	await writeFile(path.join(child, "agent.json"), JSON.stringify({ name: "Child", tools: [] }));
	await writeFile(path.join(child, "prompt.md"), "Child prompt.");
	await writeFile(path.join(agentDir, "agent.json"), JSON.stringify({ name: "FPGA", tools: [], subagents: ["child"] }));
	const prompts: string[] = [];
	const result = await runAgent({
		agentDir, workspace: root, task: "Work", skills: ["math"],
		server: { baseUrl: "http://fake/v1", model: "fake" }, commands: { compile: [], simulate: [] }, runsDir: path.join(root, "runs"),
		fetchFn: async (_url, init) => {
			const body = JSON.parse(String(init?.body));
			prompts.push(body.messages[0].content);
			const content = prompts.length === 1 ? "@tool ask_agent\nagent: child\n---\nWork\n@end" : "Done";
			return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }));
		},
	});
	expect(result.toolErrors).toBe(0);
	expect(prompts).toHaveLength(3);
	expect(prompts[1]).toContain("Child prompt.");
	expect(prompts[1]).not.toContain("math body.");
});

const flow = (): Workflow => ({ id: "f", name: "Flow", task: "Work", vars: {}, steps: [
	{ id: "cmd", name: "Command", type: "command", command: ["check"] },
	{ id: "a", name: "Agent", type: "agent", agent: "fpga", task: "Work", skills: ["math"], retry: { skills: ["retry"] } },
	{ id: "check", name: "Check", type: "command", command: ["check"], onFail: { goTo: "a", maxRounds: 2 } },
] });

it.each([false, true])("rejects unknown retry skills before any step starts (engine %s)", async (engine) => {
	const workflow = flow();
	if (workflow.steps[1]!.type === "agent") workflow.steps[1]!.retry = { skills: ["missing"] };
	const options = { root, folder: root, task: "Work", server: "local", workflow };
	if (engine) await expect(createEngine({ root, defaultFolder: root }).createWorkflowRun(options)).rejects.toThrow(/missing.*FPGA/);
	else await expect(prepareWorkflowRun(options)).rejects.toThrow(/missing.*FPGA/);
});

it.each([false, true])("uses retry skills only on the second round and adds run skills (engine %s)", async (engine) => {
	const prompts: string[] = [];
	let checks = 0;
	const exec = async () => ({ code: 0, stdout: ++checks === 2 ? "FAIL check" : "PASS check", stderr: "", timedOut: false, notFound: false });
	const fetchFn: typeof fetch = async (_url, init) => {
		const body = JSON.parse(String(init?.body));
		prompts.push(body.messages[0].content);
		return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }] }));
	};
	const options = { root, folder: root, task: "Work", server: "local", workflow: flow(), skills: ["other"] };
	const run = engine ? await createEngine({ root, defaultFolder: root, exec, fetchFn }).createWorkflowRun(options) : (await prepareWorkflowRun({ ...options, exec, fetchFn })).run;
	await new Promise<void>((resolve) => { run.subscribe((e) => { if (e.type === "state" && ["done", "failed"].includes(e.state.status)) resolve(); }); run.start(); });
	expect(run.state.status).toBe("done");
	expect(prompts).toHaveLength(2);
	expect(prompts[0]).toContain("math body.");
	expect(prompts[0]).not.toContain("retry body.");
	expect(prompts[1]).toContain("retry body.");
	expect(prompts[1]).not.toContain("math body.");
	for (const prompt of prompts) expect(prompt).toContain("other body.");
});

it("parses workflow skill names", () => {
	expect(parseWorkflowArgs(["--workflow", "f", "--folder", "p", "--task", "t", "--skills", "math,other"]).skills).toEqual(["math", "other"]);
});

it("validates front matter and size of every repository skill", async () => {
	for (const agent of await readdir("agents")) {
		const dir = path.join("agents", agent);
		const files = await readdir(path.join(dir, "skills")).catch(() => []);
		for (const file of files.filter((f) => f.endsWith(".md"))) {
			const raw = await readFile(path.join(dir, "skills", file), "utf8");
			expect((await loadSkills(dir)).some((skill) => skill.name === file.slice(0, -3)), `${agent}/${file}`).toBe(true);
			if (!["verilog-rules.md", "fixed-point.md"].includes(file)) expect(raw.length, `${agent}/${file}`).toBeLessThanOrEqual(2600);
		}
	}
});

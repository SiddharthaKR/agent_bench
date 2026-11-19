import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEvalRun, evalProblems } from "../src/eval-run.ts";
import { createWorkflowRun, validateWorkflow } from "../src/workflow.ts";
import type { EvalEvent, EvalRunState, Workflow, WorkflowStep } from "../src/shared/api.ts";
import type { WorkflowRun } from "../src/shared/engine.ts";
import { dataset } from "../scripts/verilog_eval_report.mjs";

const judge: WorkflowStep = { id: "judge", name: "Harness", type: "judge" };
const raw: WorkflowStep = { id: "raw", name: "Raw", type: "raw" };
const workflow = (steps: WorkflowStep[]): Workflow => ({ id: "t", name: "T", task: "", vars: {}, steps });
const benchmark = existsSync(dataset);
const iverilog = existsSync("C:/iverilog/bin/iverilog.exe") || !!process.env.PATH?.split(path.delimiter).some((dir) => existsSync(path.join(dir, "iverilog")) || existsSync(path.join(dir, "iverilog.exe")));

function settle(run: WorkflowRun): Promise<string> {
	return new Promise((resolve) => {
		run.subscribe((event) => { if (event.type === "state" && event.state.status !== "running") resolve(event.state.status); });
		run.start();
	});
}

describe("judge and raw steps", () => {
	it("refuses 'if it fails' on a judge step", () => {
		expect(validateWorkflow(workflow([{ ...raw }, { ...judge, onFail: { goTo: "raw", maxRounds: 2 } }])).join()).toMatch(/never sends its result back/);
		expect(validateWorkflow(workflow([raw, judge]))).toEqual([]);
	});

	it("fails outside a VerilogEval run", async () => {
		const run = createWorkflowRun("r", workflow([judge]), "x", { workspace: process.cwd(), exec: vi.fn(), runAgent: vi.fn() });
		expect(await settle(run)).toBe("failed");
		expect(run.state.steps[0]?.text).toBe("Only in a VerilogEval run.");
	});

	it("carries on past a failing verdict and a failing agent in a VerilogEval run", async () => {
		const runSpecial = vi.fn(async () => ({ ok: false, text: "MISMATCH" }));
		const runAgent = vi.fn(async () => ({ ok: false, text: "ran out of time", limit: "time" as const }));
		const run = createWorkflowRun("r", workflow([{ id: "a", name: "A", type: "agent", agent: "fpga", task: "t" }, judge, raw]), "x", { workspace: process.cwd(), exec: vi.fn(), runAgent, runSpecial });
		expect(await settle(run)).toBe("done");
		expect(runSpecial).toHaveBeenCalledTimes(2);
		expect(run.state.steps.map((step) => step.status)).toEqual(["failed", "failed", "failed"]);
	});
});

describe.skipIf(!benchmark || !iverilog)("VerilogEval run in the app", () => {
	async function runOn(steps: WorkflowStep[], problems: string[], reply: string, before?: (workspace: string) => Promise<void>) {
		const runsDir = await mkdtemp(path.join(tmpdir(), "eval-run-"));
		const seen: string[][] = [];
		const evalRun = createEvalRun("e", workflow(steps), problems, 1, {
			runsDir, serverId: "test", server: { baseUrl: "http://unused", model: "m" }, commands: {} as never,
			askRaw: async () => ({ text: reply }),
			makeRun: async (workspace, wired, task, runSpecial) => {
				seen.push((await readdir(workspace)).sort());
				await before?.(workspace);
				return createWorkflowRun("w", wired, task, { workspace, exec: vi.fn(), runAgent: vi.fn(), runSpecial });
			},
		});
		const state = await new Promise<EvalRunState>((resolve) => {
			evalRun.subscribe((event: EvalEvent) => { if (event.type === "eval" && event.state.status !== "running") resolve(event.state); });
			evalRun.start();
		});
		return { state, runsDir, seen };
	}

	it("judges a reference as PASS, a raw reply, and a missing file as NO_FILE; the folder holds only spec.md", async () => {
		const name = evalProblems().dev[0]!;
		const reference = (await readFile(path.join(dataset, `${name}_ref.sv`), "utf8")).replace(/\bmodule\s+RefModule\b/, "module TopModule");
		const { state, runsDir, seen } = await runOn([raw, { ...judge, id: "j1", name: "Raw" }], [name], `[BEGIN]\n${reference}\n[DONE]`);
		expect(seen[0]).toEqual(["rtl", "spec.md"]);
		expect(state.problems[0]?.verdicts).toEqual({ j1: "PASS" });
		const rows = (await readFile(path.join(runsDir, "results.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		expect(rows[0]).toMatchObject({ suite: "verilog-eval", task: name, verdict: "PASS", pass: true, source: "app", workflow: "t", judge: "Raw" });
		expect(existsSync(path.join(state.folder, "summary.json"))).toBe(true);
		// The judge works beside the agent's folder, never inside it.
		expect(await readdir(path.join(state.folder, name, "work"))).not.toContain("judge-j1");
		await rm(runsDir, { recursive: true, force: true });

		const broken = await runOn([judge], [name], "", async (workspace) => { await writeFile(path.join(workspace, "rtl/TopModule.sv"), reference.replace(/assign\s+(\w+)\s*=\s*/, "assign $1 = ~")); });
		expect(["MISMATCH", "COMPILE_ERROR"]).toContain(broken.state.problems[0]?.verdicts.judge);
		await rm(broken.runsDir, { recursive: true, force: true });

		const missing = await runOn([raw, judge], [name], "I cannot help with that.");
		expect(missing.state.problems[0]?.verdicts.judge).toBe("NO_FILE");
		await rm(missing.runsDir, { recursive: true, force: true });
	}, 60_000);

	it("rejects unknown problems", () => {
		expect(() => createEvalRun("e", workflow([judge]), ["NoSuchProblem"], 1, {} as never)).toThrow(/Unknown problems/);
	});
});

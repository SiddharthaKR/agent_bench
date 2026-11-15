import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflow, createEngine } from "../src/index.ts";
import { describe, expect, it, vi } from "vitest";
import { createWorkflowRun, fillPlaceholders, validateWorkflow } from "../src/workflow.ts";
import type { WorkflowDeps } from "../src/workflow.ts";
import type { Workflow, WorkflowStep } from "../src/shared/api.ts";
import type { WorkflowRun } from "../src/shared/engine.ts";
import type { ExecResult } from "../src/types.ts";

const agent: WorkflowStep = { id: "write", name: "Write", type: "agent", agent: "fpga", task: "{task}: {design}" };
const command: WorkflowStep = { id: "check", name: "Check", type: "command", command: ["tool", "{design}"] };
const workflow = (steps: WorkflowStep[] = [agent, command]): Workflow => ({ id: "test", name: "Test", task: "", vars: { design: "rtl.v" }, steps });
const result = (changes: Partial<ExecResult> = {}): ExecResult => ({ code: 0, stdout: "PASS", stderr: "", notFound: false, timedOut: false, ...changes });
const deps = (changes: Partial<WorkflowDeps> = {}): WorkflowDeps => ({ workspace: process.cwd(), exec: vi.fn(async () => result()), runAgent: vi.fn(async () => ({ ok: true, text: "Wrote it" })), ...changes });

function settle(run: WorkflowRun, action: () => void): Promise<void> {
	return new Promise((resolve) => {
		const unsubscribe = run.subscribe((event) => {
			if (event.type === "state" && event.state.status !== "running") {
				unsubscribe();
				resolve();
			}
		});
		action();
	});
}

describe("workflow", () => {
	it("fills retry task on later attempts and appends the failure report", async () => {
		const tasks: string[] = [];
		const step = { ...agent, retry: { task: "Repair {design} for {task}" } };
		const run = createWorkflowRun("r", workflow([step, { ...command, onFail: { goTo: "write", maxRounds: 2 } }]), "Build", deps({
			runAgent: async (_step, task) => { tasks.push(task); return { ok: true, text: "Attempt" }; },
			exec: vi.fn().mockResolvedValueOnce(result({ stdout: "FAIL arithmetic" })).mockResolvedValueOnce(result()),
		}));
		await settle(run, () => run.start());
		expect(tasks[0]).toBe("Build: rtl.v");
		expect(tasks[1]).toContain("Repair rtl.v for Build\n\nThe check");
		expect(tasks[1]).toContain("FAIL arithmetic");
		expect(tasks[1]).toContain("Earlier attempts:");
		expect(validateWorkflow(workflow([{ ...agent, retry: { task: " " } }]))).toContain('Step "write" needs a retry task.');
	});
	it.each([false, true])("applies time limit precedence through real adapters (engine: %s)", async (engine) => {
		const root = await mkdtemp(join(tmpdir(), "workflow-limits-"));
		vi.useFakeTimers();
		try {
			await mkdir(join(root, "agents", "fpga"), { recursive: true });
			await writeFile(join(root, "agents", "fpga", "agent.json"), JSON.stringify({ name: "Test", tools: ["read_file"], maxSeconds: 0.01 }));
			await writeFile(join(root, "agents", "fpga", "prompt.md"), "Work.");
			await writeFile(join(root, "config.json"), JSON.stringify({ servers: { local: { baseUrl: "http://fake/v1", model: "base", extra: { a: 1, b: 2 } } }, commands: { compile: [], simulate: [] } }));
			const bodies: Record<string, unknown>[] = [];
			const fetchFn: typeof fetch = async (_url, init) => {
				bodies.push(JSON.parse(String(init?.body)));
				await vi.advanceTimersByTimeAsync(40);
				return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }] }));
			};
			for (const [stepSeconds, runSeconds, expected] of [[undefined, undefined, "failed"], [undefined, 1, "done"], [0.01, 1, "failed"], [1, 0.01, "done"]] as const) {
				const w = workflow([{ ...agent, task: "Work", maxSeconds: stepSeconds, extra: { b: 3 } }]);
				let status: string;
				if (engine) {
					const e = createEngine({ root, defaultFolder: root, fetchFn, maxSeconds: runSeconds });
					const run = await e.createWorkflowRun({ workflow: w, folder: root, task: "Work", server: "local" });
					await settle(run, () => run.start());
					status = run.state.status;
				} else status = (await runWorkflow({ root, folder: root, workflow: w, task: "Work", fetchFn, maxSeconds: runSeconds })).status;
				expect(status).toBe(expected);
			}
			expect(bodies.at(-1)).toMatchObject({ a: 1, b: 3 });
		} finally { vi.useRealTimers(); await rm(root, { recursive: true, force: true }); }
	});
	it.each(["time", "turns"] as const)("lets checks decide after the %s limit", async (limit) => {
		const d = deps({ runAgent: async () => ({ ok: false, text: "Stopped", limit }) });
		const run = createWorkflowRun("r", workflow(), "", d);
		await settle(run, () => run.start());
		expect(run.state.status).toBe("done");
		expect(run.state.log).toContain("Stopped at the time limit; the checks decide.");
		const alone = createWorkflowRun("r", workflow([agent]), "", d);
		await settle(alone, () => alone.start());
		expect(alone.state.status).toBe("failed");
	});

	it("uses retry settings only after that agent has already run", async () => {
		const settings: WorkflowStep[] = [];
		const step = { ...agent, model: "first", temperature: 0.8, maxTurns: 4, maxSeconds: 5, extra: { a: 1, b: 2 }, retry: { model: "second", temperature: 0, maxTurns: 8, maxSeconds: 9, extra: { b: 3 } } };
		const run = createWorkflowRun("r", workflow([step, { ...command, onFail: { goTo: "write", maxRounds: 2 } }]), "", deps({
			runAgent: async (s) => { settings.push(s); return { ok: true, text: "Done" }; },
			exec: vi.fn().mockResolvedValueOnce(result({ stdout: "FAIL" })).mockResolvedValueOnce(result()),
		}));
		await settle(run, () => run.start());
		expect(settings[0]).toEqual(step);
		expect(settings[1]).toMatchObject({ model: "second", temperature: 0, maxTurns: 8, maxSeconds: 9, extra: { a: 1, b: 3 } });
		expect(step.extra).toEqual({ a: 1, b: 2 });
	});

	it("validates step and retry limits", () => {
		for (const value of [0, -1, NaN, Infinity]) {
			for (const settings of [{ maxSeconds: value }, { retry: { maxSeconds: value } }, { retry: { maxTurns: value } }]) {
				expect(validateWorkflow(workflow([{ ...agent, ...settings }]))).not.toEqual([]);
			}
		}
		for (const temperature of [-1, 3, NaN]) expect(validateWorkflow(workflow([{ ...agent, retry: { temperature } }]))).not.toEqual([]);
		expect(validateWorkflow(workflow([{ ...agent, maxSeconds: 0.5, retry: { temperature: 0, maxTurns: 1, maxSeconds: 0.1 } }]))).toEqual([]);
	});

	it("includes hints beyond the displayed ten failure lines in retry context", async () => {
		const tasks: string[] = [];
		const lines = [...Array.from({ length: 10 }, () => "FAIL other"), "FAIL a got x wanted 1", "FAIL b got 1 wanted 2", "FAIL c got 2 wanted 3"];
		const run = createWorkflowRun("r", workflow([agent, { ...command, onFail: { goTo: "write", maxRounds: 2 } }]), "", deps({
			runAgent: async (_s, task) => { tasks.push(task); return { ok: true, text: "Done" }; },
			exec: async () => result({ stdout: lines.join("\n") }),
		}));
		await settle(run, () => run.start());
		expect(tasks[1]).toContain("output is late");
		expect(tasks[1]).toContain("Hint: x means");
	});
	it("fills every known placeholder literally and preserves unknown ones", () => {
		expect(fillPlaceholders("{a} {a} {missing} {toString}", { a: "$&" })).toBe("$& $& {missing} {toString}");
	});

	it("reports every validation problem", () => {
		expect(validateWorkflow(workflow([]))).toHaveLength(1);
		const problems = validateWorkflow(workflow([
			{ ...agent, name: " ", agent: "", task: " ", onFail: { goTo: "later", maxRounds: 0 } },
			{ ...command, id: "write", command: [] },
		]));
		expect(problems).toHaveLength(7);
		expect(problems.every((p) => p.endsWith("."))).toBe(true);
		expect(validateWorkflow(workflow([{ ...command, onFail: { goTo: "check", maxRounds: 1 } }]))).toEqual([]);
		expect(validateWorkflow(workflow([{ ...command, command: [" "] }]))).toHaveLength(1);
	});

	it("runs in order with filled arguments, progress and fresh state", async () => {
		const d = deps({ runAgent: vi.fn(async (_step, task, _signal, onLine) => { onLine(task); return { ok: true, text: "x".repeat(700) }; }) });
		const run = createWorkflowRun("run", workflow(), "Build", d);
		expect(run.state).toEqual({ status: "idle", round: 0, current: null, steps: [], log: [] });
		await settle(run, () => run.start());
		expect(run.state.status).toBe("done");
		expect(run.state.steps.map((s) => s.status)).toEqual(["passed", "passed"]);
		expect(run.state.steps[0]?.text).toHaveLength(600);
		expect(d.exec).toHaveBeenCalledWith("tool", ["rtl.v"], expect.objectContaining({ cwd: process.cwd(), timeoutMs: 120000, signal: expect.any(AbortSignal) }));
		expect(run.events).toContainEqual({ type: "line", stepId: "write", text: "Build: rtl.v" });
		expect(run.state.log).toContain("Round 1: all steps passed.");
	});

	it.each([
		[result({ code: 2, stdout: "bad exit" }), "bad exit"],
		[result({ stdout: "PASS\nFAIL: wrong" }), "FAIL: wrong\n(1 more lines not shown)"],
		[result({ notFound: true }), "The program \"tool\" is not installed on this machine."],
		[result({ timedOut: true }), "Timed out after 7 s."],
		[result({ stdout: "FAILED check\nERROR check\nMISMATCH check" }), "FAILED check\nERROR check\nMISMATCH check"],
	])("fails commands from their actual results", async (output, text) => {
		const run = createWorkflowRun("r", workflow([{ ...command, timeoutSec: 7 }]), "", deps({ exec: async () => output }));
		await settle(run, () => run.start());
		expect(run.state.status).toBe("failed");
		expect(run.state.current).toBe("check");
		expect(run.state.steps[0]?.text).toBe(text);
	});

	it("matches whole words and limits output", async () => {
		const d = deps({ exec: vi.fn().mockResolvedValueOnce(result({ stdout: "0 errors\nbypass\n1\n2\n3\n4" })).mockResolvedValueOnce(result({ code: 1, stdout: Array.from({ length: 12 }, (_, i) => `FAIL ${i}`).join("\n"), stderr: "extra" })) });
		const run = createWorkflowRun("r", workflow([command, { ...command, id: "other" }]), "", d);
		await settle(run, () => run.start());
		expect(run.state.steps[0]?.text).toBe("bypass\n1\n2\n3\n4");
		expect(run.state.steps[1]?.text).toBe(Array.from({ length: 10 }, (_, i) => `FAIL ${i}`).join("\n") + "\n(3 more lines not shown)");
	});

	it("retries with failure context and all attempts until maxRounds", async () => {
		const tasks: string[] = [];
		const run = createWorkflowRun("r", workflow([agent, { ...command, onFail: { goTo: "write", maxRounds: 3 } }]), "Build", deps({
			runAgent: async (_s, task) => { tasks.push(task); return { ok: true, text: `Attempt ${tasks.length}\nDetails` }; },
			exec: async () => result({ stdout: "FAIL wrong" }),
		}));
		await settle(run, () => run.start());
		expect(run.state.status).toBe("failed");
		expect(run.state.round).toBe(3);
		expect(tasks[1]).toBe("Build: rtl.v\n\nThe check \"Check\" failed in round 1:\nFAIL wrong\n\nEarlier attempts:\n- round 1: Attempt 1 -> Check failed\nFix the problem.");
		expect(tasks[2]).toContain("- round 1: Attempt 1 -> Check failed\n- round 2: Attempt 2 -> Check failed");
	});

	it("keeps once steps across retries without pausing again", async () => {
		const d = deps({ exec: vi.fn().mockResolvedValueOnce(result({ code: 1 })).mockResolvedValueOnce(result({ code: 1 })).mockResolvedValueOnce(result()) });
		const run = createWorkflowRun("r", workflow([{ ...agent, once: true, pause: true }, { ...command, onFail: { goTo: "write", maxRounds: 3 } }]), "", d);
		await settle(run, () => run.start());
		expect(run.state.status).toBe("paused");
		expect(run.state.current).toBe("check");
		run.start();
		expect(run.state.status).toBe("paused");
		await settle(run, () => run.resume());
		expect(run.state.status).toBe("done");
		expect(d.runAgent).toHaveBeenCalledTimes(1);
		expect(run.state.steps[0]).toMatchObject({ status: "kept", round: 3, text: "Kept from round 1." });
	});

	it("resumes at a chosen step without failure context", async () => {
		const d = deps({ exec: vi.fn().mockResolvedValueOnce(result({ code: 1 })).mockResolvedValueOnce(result()) });
		const run = createWorkflowRun("r", workflow(), "Build", d);
		await settle(run, () => run.start());
		await settle(run, () => run.resume("write"));
		expect(run.state.status).toBe("done");
		expect(run.state.round).toBe(1);
		expect(d.runAgent).toHaveBeenLastCalledWith(agent, "Build: rtl.v", expect.any(AbortSignal), expect.any(Function));
	});

	it("aborts running work and ignores late results and lines", async () => {
		let finish!: (value: { ok: boolean; text: string }) => void;
		let signal!: AbortSignal;
		let line!: (text: string) => void;
		const run = createWorkflowRun("r", workflow(), "", deps({ runAgent: async (_s, _t, s, onLine) => { signal = s; line = onLine; return new Promise((resolve) => { finish = resolve; }); } }));
		run.start();
		run.start();
		run.stop();
		expect(signal.aborted).toBe(true);
		expect(run.state.steps[0]?.status).toBe("waiting");
		const before = run.events.length;
		line("late");
		finish({ ok: true, text: "late" });
		await new Promise((resolve) => setImmediate(resolve));
		expect(run.events).toHaveLength(before);
		expect(run.state.status).toBe("stopped");
	});

	it("reports exceptions and agents that cannot finish as failures", async () => {
		for (const d of [deps({ exec: async () => { throw new Error("Command broke"); } }), deps({ runAgent: async () => { throw new Error("Agent broke"); } }), deps({ runAgent: async () => ({ ok: false, text: "Limit reached" }) })]) {
			const run = createWorkflowRun("r", workflow(), "", d);
			await settle(run, () => run.start());
			expect(run.state.status).toBe("failed");
			expect(run.state.steps.find((s) => s.status === "failed")?.text).toMatch(/broke|Limit reached/);
		}
	});

	it("resumes stopped commands with a fresh signal and ignores the old completion", async () => {
		let finish!: (value: ExecResult) => void;
		const signals: AbortSignal[] = [];
		let began!: () => void;
		const started = new Promise<void>((resolve) => { began = resolve; });
		const run = createWorkflowRun("r", workflow([command]), "", deps({ exec: async (_program, _args, options) => {
			if (options.signal) signals.push(options.signal);
			if (signals.length === 1) {
				began();
				return new Promise((resolve) => { finish = resolve; });
			}
			return result({ stdout: "Recovered" });
		} }));
		run.start();
		await started;
		run.stop();
		await settle(run, () => run.resume("unknown"));
		expect(signals[0]?.aborted).toBe(true);
		expect(signals[1]?.aborted).toBe(false);
		expect(signals[1]).not.toBe(signals[0]);
		finish(result({ code: 1, stdout: "FAIL late" }));
		await new Promise((resolve) => setImmediate(resolve));
		expect(run.state.status).toBe("done");
		expect(run.state.steps[0]?.text).toBe("Recovered");
	});

	it("summarizes empty output and trims long lines", async () => {
		const run = createWorkflowRun("r", workflow([command, { ...command, id: "long", pause: true }]), "", deps({ exec: vi.fn().mockResolvedValueOnce(result({ stdout: "\n \n" })).mockResolvedValueOnce(result({ stdout: "a".repeat(250) })) }));
		await settle(run, () => run.start());
		expect(run.state.status).toBe("done");
		expect(run.state.steps[0]?.text).toBe("Finished with no output.");
		expect(run.state.steps[1]?.text).toBe("a".repeat(200));
	});

	it("logs invalid workflows and isolates state, events and listeners", async () => {
		const invalid = createWorkflowRun("r", workflow([]), "", deps());
		await settle(invalid, () => invalid.start());
		expect(invalid.state.status).toBe("failed");
		expect(invalid.state.log).toEqual(validateWorkflow(workflow([])));
		const run = createWorkflowRun("r", workflow(), "", deps());
		run.subscribe(() => { throw new Error("Listener broke"); });
		run.subscribe((event) => { if (event.type === "state") event.state.log.push("mutated"); });
		const listener = vi.fn();
		const unsubscribe = run.subscribe(listener);
		unsubscribe();
		await settle(run, () => run.start());
		const copy = run.state;
		copy.steps[0]!.text = "mutated";
		copy.log.push("mutated");
		for (const event of run.events) if (event.type === "state") event.state.log.push("mutated");
		expect(run.state.status).toBe("done");
		expect(run.state.steps[0]?.text).toBe("Wrote it");
		expect(run.state.log).not.toContain("mutated");
		expect(listener).not.toHaveBeenCalled();
	});

	it("ships a valid FPGA workflow", async () => {
		const shipped = JSON.parse(await readFile(new URL("../workflows/fpga-block.json", import.meta.url), "utf8")) as Workflow;
		expect(validateWorkflow(shipped)).toEqual([]);
	});
});

it.each(["answer", "stop"])("handles workflow questions and excludes waiting time: %s", async (action) => {
	const run = createWorkflowRun("r", workflow([agent]), "Work", deps({
		interactiveQuestions: true,
		runAgent: async (_step, _task, _signal, _line, ask) => {
			const answer = await ask!({ question: "Latency?", assumption: "One cycle." });
			return { ok: true, text: answer ?? "Stopped" };
		},
	}));
	const done = new Promise<void>((resolve) => run.subscribe((event) => {
		if (event.type === "state" && ["done", "stopped"].includes(event.state.status)) resolve();
	}));
	run.start();
	expect(run.state.status).toBe("waiting");
	const question = run.events.find((event) => event.type === "question");
	if (question?.type !== "question") throw new Error("Missing question");
	const started = Date.now();
	await new Promise((resolve) => setTimeout(resolve, 50));
	if (action === "stop") run.stop();
	else {
		expect(run.answer!("stale", "No")).toBe(false);
		expect(run.answer!(question.id, "Use your assumption.")).toBe(true);
		expect(run.answer!(question.id, "Duplicate")).toBe(false);
	}
	await done;
	if (action === "answer") {
		expect(run.state.steps[0]!.text).toBe("Use your assumption.");
		expect(run.state.steps[0]!.ms).toBeLessThan(Date.now() - started - 20);
	} else expect(run.state.status).toBe("stopped");
});

it("preserves the new question when a waiting workflow is stopped and resumed immediately", async () => {
	let restarted = false;
	let count = 0;
	const run = createWorkflowRun("r", workflow([agent]), "Work", deps({ interactiveQuestions: true,
		runAgent: async (_step, _task, _signal, _line, ask) => ({ ok: true, text: await ask!({ question: `Question ${++count}?` }) ?? "Stopped" }),
	}));
	run.subscribe((event) => {
		if (event.type === "state" && event.state.status === "waiting" && !restarted) {
			restarted = true;
			run.stop();
			run.resume();
		}
	});
	run.start();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const question = run.events.find((event) => event.type === "question" && event.question === "Question 2?");
	if (question?.type !== "question") throw new Error("Missing resumed question");
	expect(run.state.status).toBe("waiting");
	const accepted = run.answer!(question.id, "Answer two.");
	if (!accepted) run.stop();
	expect(accepted).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(run.state.status).toBe("done");
});

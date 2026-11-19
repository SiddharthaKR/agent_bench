import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../../../src/shared/api.ts";
import { commandToText, parseCommand, nextId, removeStep, countRuns, runStatus, stepStatus, applyRunEvent, pickProblems, evalTotals, changeStepType, stepKind, stepDetail } from "./logic.ts";

describe("workflow helpers", () => {
	it("preserves quoted, empty and escaped command arguments", () => {
		const command = ["python", "a file.py", "", "say \"yes\"", "C:\\tools\\check.py"];
		expect(parseCommand(commandToText(command))).toEqual(command);
		expect(parseCommand('  python "a file.py" --flag  ')).toEqual(["python", "a file.py", "--flag"]);
		expect(parseCommand("")).toEqual([]);
	});
	it("fills the smallest unused id", () => {
		expect(nextId("step", ["step-1", "step-3", "other"])).toBe("step-2");
	});
	it("clears references to a removed step without changing other rules", () => {
		const steps: WorkflowStep[] = [
			{ id: "step-1", name: "Build", type: "command", command: ["build"] },
			{ id: "step-2", name: "Check", type: "command", command: ["check"], onFail: { goTo: "step-1", maxRounds: 3 }, pause: true },
		];
		expect(removeStep(steps, "step-1")).toEqual([{ id: "step-2", name: "Check", type: "command", command: ["check"], pause: true }]);
		expect(steps[1]?.onFail?.goTo).toBe("step-1");
	});
	it("counts finished executions and excludes kept, waiting and running steps", () => {
		const steps: WorkflowStep[] = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, type: id === "a" ? "agent" : "command", agent: "coder", task: "", command: [] }));
		expect(countRuns(steps, [
			{ stepId: "a", status: "passed", round: 1, text: "", ms: 1 },
			{ stepId: "b", status: "failed", round: 1, text: "", ms: 1 },
			{ stepId: "c", status: "kept", round: 2, text: "", ms: 1 },
			{ stepId: "d", status: "running", round: 2, text: "", ms: 0 },
			{ stepId: "e", status: "waiting", round: 2, text: "", ms: 0 },
		])).toEqual({ agent: 1, command: 1 });
	});
	it("describes the current position and terminal states", () => {
		expect(runStatus({ status: "running", current: "b", round: 2, steps: [], log: [] }, [{ id: "a" }, { id: "b" }])).toEqual({ text: "Running step 2 of 2, round 2", tone: "warn" });
		expect(runStatus(undefined, [])).toEqual({ text: "Ready", tone: "" });
		expect(stepStatus("kept")).toEqual({ text: "Kept", tone: "tone-ok" });
	});
	it("keeps the last completed command across round resets and clears stale progress", () => {
		const workflow = { id: "w", name: "Test", task: "", vars: {}, steps: [{ id: "a", name: "Check", type: "command" as const, command: ["check"] }] };
		const finished = applyRunEvent({ id: "r", workflow, folder: "project", lines: { a: "old progress" } }, { type: "state", state: { status: "paused", round: 1, current: "a", log: [], steps: [{ stepId: "a", status: "failed", round: 1, text: "FAIL", ms: 1 }] } });
		const running = applyRunEvent(finished, { type: "state", state: { status: "running", round: 2, current: "a", log: [], steps: [{ stepId: "a", status: "running", round: 2, text: "", ms: 0 }] } });
		expect(running.lastCommand?.result.text).toBe("FAIL");
		expect(running.lines).toEqual({});
		const progress = applyRunEvent(running, { type: "line", stepId: "a", text: "new progress" });
		expect(progress.lines).toEqual({ a: "new progress" });
		expect(finished.lines).toEqual({ a: "old progress" });
	});
});

describe("VerilogEval helpers", () => {
	it("picks problems for each choice", () => {
		const problems = { dev: ["b"], heldout: ["c", "a"] };
		expect(pickProblems(problems, "dev", [])).toEqual(["b"]);
		expect(pickProblems(problems, "heldout", [])).toEqual(["c", "a"]);
		expect(pickProblems(problems, "all", [])).toEqual(["a", "b", "c"]);
		expect(pickProblems(problems, "pick", ["c", "b"])).toEqual(["b", "c"]);
	});
	it("totals passes per judge", () => {
		const problem = (verdicts: Record<string, string>) => ({ key: "p", problem: "p", attempt: 1, status: "done" as const, verdicts, seconds: 1 });
		expect(evalTotals({ status: "done", folder: "", judges: [{ id: "h", name: "Harness" }, { id: "r", name: "Raw" }], problems: [problem({ h: "PASS", r: "MISMATCH" }), problem({ h: "PASS" })] }))
			.toEqual([{ id: "h", name: "Harness", pass: 2, judged: 2 }, { id: "r", name: "Raw", pass: 0, judged: 1 }]);
	});
	it("a judge made from another step has no 'if it fails'", () => {
		const step = changeStepType({ id: "s", name: "S", type: "command", command: ["x"], onFail: { goTo: "s", maxRounds: 2 } }, "judge", "fpga");
		expect(step).toEqual({ id: "s", name: "S", pause: undefined, once: undefined, type: "judge" });
		expect(stepKind(step)).toBe("VerilogEval judge");
		expect(stepDetail(step)).toBe("{design}");
	});
});

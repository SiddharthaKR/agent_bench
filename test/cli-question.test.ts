import { it, expect } from "vitest";
import { questionReader } from "../src/cli-question.ts";
import { parseArgs } from "../src/cli.ts";
import { parseWorkflowArgs } from "../src/cli-workflow.ts";
it("reads terminal answers only with --ask", async () => {
	let prompt = "";
	const onQuestion = questionReader(true, async (text) => { prompt = text; return "Two cycles."; });
	expect(await onQuestion!({ question: "Latency?", assumption: "One cycle." })).toBe("Two cycles.");
	expect(prompt).toContain("Latency?");
	expect(prompt).toContain("One cycle.");
	expect(questionReader(false)).toBeUndefined();
	expect(parseArgs(["--ask", "--folder", "."]).ask).toBe("true");
	expect(parseWorkflowArgs(["--ask", "--workflow", "x", "--folder", ".", "--task", "Work"]).ask).toBe(true);
});

it("stops on terminal Ctrl+C", async () => {
	const { PassThrough } = await import("node:stream");
	const { terminalAnswer } = await import("../src/cli-question.ts");
	const input = new PassThrough();
	const output = new PassThrough();
	const controller = new AbortController();
	const pending = terminalAnswer("Latency? ", controller.signal, () => controller.abort(), { input, output, terminal: true });
	input.write("\u0003");
	expect(await pending).toBeUndefined();
	expect(controller.signal.aborted).toBe(true);
	input.destroy(); output.destroy();
});

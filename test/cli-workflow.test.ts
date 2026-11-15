import { expect, it, vi } from "vitest";
import { parseWorkflowArgs, workflowMain } from "../src/cli-workflow.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const required = ["--workflow", "flow.json", "--folder", "project", "--task", "Build it"];
it("parses protected paths", () => {
	expect(parseWorkflowArgs([...required, "--protect", "tb/a.v, spec.md"]).protect).toEqual(["tb/a.v", "spec.md"]);
});
it("parses required arguments and defaults", () => {
	expect(parseWorkflowArgs(required)).toEqual({ workflow: "flow.json", folder: "project", task: "Build it", server: "local", noPause: false, vars: {} });
});
it("parses repeated overrides, optional settings and a time limit", () => {
	expect(parseWorkflowArgs([...required, "--var", "design=old", "--var", "design=rtl/a=b.v", "--var", "empty=", "--server", "lab", "--model", "small", "--no-pause", "--max-seconds", "2.5"])).toMatchObject({ server: "lab", model: "small", noPause: true, maxSeconds: 2.5, vars: { design: "rtl/a=b.v", empty: "" } });
});
it("rejects missing values, malformed variables, unknown options and invalid limits", () => {
	for (const args of [[], [...required, "--model"], [...required, "--var", "bad"], [...required, "--var", "=x"], [...required, "--wrong", "x"], ...["0", "-1", "NaN", "Infinity"].map((value) => [...required, "--max-seconds", value])]) expect(() => parseWorkflowArgs(args)).toThrow();
});

it("runs command steps, applies vars, and automatically continues pauses", async () => {
	const folder = await mkdtemp(path.join(os.tmpdir(), "workflow-cli-"));
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		const file = path.join(folder, "flow.json");
		await writeFile(file, JSON.stringify({ id: "test", name: "Test", task: "Task", vars: { value: "old" }, steps: [
			{ id: "one", name: "Compile", type: "command", command: [process.execPath, "-e", "console.log(process.argv[1])", "{value}"], pause: true },
			{ id: "two", name: "Check", type: "command", command: [process.execPath, "-e", "process.exit(process.argv[1] === 'new' ? 0 : 1)", "{value}"] },
		] }));
		expect(await workflowMain(["--workflow", file, "--folder", folder, "--task", "Task", "--no-pause", "--var", "value=new"])).toBe(0);
		const stdout = log.mock.calls.map((call) => call.join(" ")).join("\n");
		expect(stdout).toContain("round 1 · step 1 Compile · passed");
		expect(stdout).toContain("round 1 · step 2 Check · passed");
		expect(stdout).toContain("round 1 · done");
		expect(await workflowMain(["--workflow", file, "--folder", folder, "--task", "Task"])).toBe(1);
		expect(log.mock.calls.some((call) => String(call[0]).includes("Paused."))).toBe(true);
	} finally { log.mockRestore(); await rm(folder, { recursive: true, force: true }); }
}, 30_000);

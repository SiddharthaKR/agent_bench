import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createEngine, prepareWorkflowRun } from "../src/index.ts";
import { parseArgs } from "../src/cli.ts";
import type { Workflow } from "../src/shared/api.ts";

it("parses protection in the agent command line", () => {
	expect(parseArgs(["--protect", "tb/a.v,spec.md"]).protect).toBe("tb/a.v,spec.md");
});

it.each([false, true])("fills workflow protection for every step (engine: %s)", async (engine) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "protect-workflow-"));
	try {
		const dir = path.join(root, "agents", "fpga");
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "agent.json"), JSON.stringify({ name: "FPGA", tools: ["write_file"] }));
		await writeFile(path.join(dir, "prompt.md"), "Work.");
		await writeFile(path.join(root, "config.json"), JSON.stringify({ servers: { local: { baseUrl: "http://fake/v1", model: "fake" } } }));
		await writeFile(path.join(root, "tb_given.v"), "given\n");
		await writeFile(path.join(root, "spec.md"), "given\n");
		const workflow: Workflow = { id: "protect", name: "Protect", task: "", vars: { tb: "tb_given.v" }, protect: ["{tb}", ...(engine ? ["spec.md"] : [])], steps: ["a", "b"].map((id) => ({ id, name: id, type: "agent", agent: "fpga", task: "Work" })) };
		const replies = ["@tool write_file\npath: tb_given.v\n---\nchanged\n@end", "Done", "@tool write_file\npath: spec.md\n---\nchanged\n@end", "Done"];
		const requests: { messages: { content: string }[] }[] = [];
		const fetchFn: typeof fetch = async (_url, init) => {
			requests.push(JSON.parse(String(init?.body)));
			return new Response(JSON.stringify({ choices: [{ message: { content: replies[requests.length - 1] }, finish_reason: "stop" }] }));
		};
		const run = engine
			? await createEngine({ root, defaultFolder: root, fetchFn }).createWorkflowRun({ workflow, folder: root, task: "Work", server: "local" })
			: (await prepareWorkflowRun({ root, workflow, folder: root, task: "Work", protect: ["spec.md"], fetchFn })).run;
		await new Promise<void>((resolve) => {
			run.subscribe((event) => { if (event.type === "state" && ["done", "failed"].includes(event.state.status)) resolve(); });
			run.start();
		});
		expect(run.state.status).toBe("done");
		expect(requests[1]!.messages.at(-1)!.content).toContain("tb_given.v is given and must not be changed. Fix the design instead, and run run_sim with this file.");
		expect(requests[3]!.messages.at(-1)!.content).toContain("spec.md is given and must not be changed.");
		for (const file of ["tb_given.v", "spec.md"]) expect(await readFile(path.join(root, file), "utf8")).toBe("given\n");
	} finally { await rm(root, { recursive: true, force: true }); }
});

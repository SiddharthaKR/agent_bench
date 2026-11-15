import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/tools/compile.ts";
import { lintVerilog, qualityLint } from "../src/tools/lint.ts";
import type { ToolContext } from "../src/types.ts";

let workspace: string;
beforeEach(async () => { workspace = await mkdtemp(join(tmpdir(), "tb-hints-")); });
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });
async function errors(source: string, stderr: string) {
	await writeFile(join(workspace, "tb.v"), source);
	await writeFile(join(workspace, "rtl.v"), "module rtl(input a, output y); assign y=a; endmodule");
	const ctx: ToolContext = { workspace, commands: { compile: ["compiler"], simulate: [] }, exec: async () => ({ code: 1, stdout: "", stderr, notFound: false, timedOut: false }) };
	return (await compile.run({ files: "rtl.v tb.v" }, ctx)).text;
}
it.each(["task t; begin", "function f; begin", "initial begin", "always begin"])("explains declarations inside %s", async body => {
	const text = await errors(`module tb;\n${body}\ninteger count;\nend\nendmodule`, "tb.v:3: syntax error");
	expect(text).toMatch(/^The design compiled; the errors are in the testbench tb.v\. Fix only the testbench\./);
	expect(text).toContain("Hint: in a testbench declare reg, wire, integer and localparam at module level. Inside a task only input lines come before begin.");
});
it("explains unknown instance ports in a testbench", async () => {
	expect(await errors("module tb;\nrtl dut(.bad(1));\nendmodule", "tb.v:2: error: port bad is not a port of dut.")).toContain("Hint: connect only the ports of the design's module header; read the header again.");
});
it("attributes failures only when all located errors belong to one kind of file", async () => {
	const source = "module tb; initial $finish; endmodule";
	expect(await errors(source, "rtl.v:1: syntax error")).toMatch(/^The testbench compiled; the errors are in the design rtl.v\. Fix only the design\./);
	expect(await errors(source, "rtl.v:1: syntax error\ntb.v:1: syntax error")).toMatch(/^Compile failed/);
});
it("hints about missing termination and check output, ignoring comments", () => {
	const hints = lintVerilog('module tb(); // $finish; $display("PASS");\nendmodule');
	expect(hints).toHaveLength(2);
	expect(hints[0]).toContain("$finish");
	expect(hints[1]).toContain("PASS or FAIL");
	expect(lintVerilog('module tb; initial begin $display("FAIL test"); $finish; end endmodule')).toEqual([]);
	expect(lintVerilog('module tb; initial begin $display("ALL TESTS PASSED"); $finish; end endmodule')).toEqual([]);
	expect(lintVerilog("module tb; endmodule", 1)).toHaveLength(1);
	expect(qualityLint("module tb; endmodule").map(finding => finding.severity)).toEqual(["note", "note"]);
});

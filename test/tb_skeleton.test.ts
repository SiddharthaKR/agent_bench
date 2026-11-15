import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickTools, realExec } from "../src/tools/index.ts";
import type { ToolContext } from "../src/types.ts";

let workspace: string;
let ctx: ToolContext;
beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "skeleton-"));
	ctx = { workspace, exec: realExec, commands: { compile: [], simulate: [] } };
});
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });
const run = (args: Record<string, string> = {}) => pickTools(["tb_skeleton"])[0]!.run({ design: "dut.v", path: "tb.v", ...args }, ctx);

it("creates a parameterized signed clocked skeleton with section line numbers and refuses overwrites", async () => {
	await writeFile(join(workspace, "dut.v"), "module dut #(parameter W=16, parameter N=W-1)(input clk_i, rst_n_i, input signed [N:0] din, output signed [W-1:0] dout); assign dout=din; endmodule");
	const result = await run();
	expect(result.ok).toBe(true);
	const text = await readFile(join(workspace, "tb.v"), "utf8");
	expect(text).toContain("localparam W=16;");
	expect(text).toContain("localparam N=W-1;");
	expect(text).toContain("reg signed [N:0] din;");
	expect(text).toContain("wire signed [W-1:0] dout;");
	expect(text).toContain("rst_n_i = 0;");
	expect(text).toContain("rst_n_i = 1;");
	expect(text).toContain("@(negedge clk_i);");
	const lines = text.split("\n");
	const start = lines.findIndex(line => line.includes("CHECKS BEGIN")) + 2;
	const end = lines.findIndex(line => line.includes("CHECKS END"));
	expect(result.text).toContain(`lines ${start}-${end}`);
	expect(result.text).toContain("tb_checks");
	expect((await run()).text).toContain("edit the existing");
	expect(await readFile(join(workspace, "tb.v"), "utf8")).toBe(text);
});

it("selects a named module and uses a delay for combinational designs", async () => {
	await writeFile(join(workspace, "dut.v"), "module other(input clk); endmodule\nmodule dut(input [7:0] a, output [7:0] y); assign y=a; endmodule");
	expect((await run()).ok).toBe(false);
	expect((await run({ module: "dut" })).ok).toBe(true);
	const text = await readFile(join(workspace, "tb.v"), "utf8");
	expect(text).toContain("dut dut (");
	expect(text).toContain("#10;");
	expect(text).not.toContain("negedge");
	expect(text).toContain("a = 100; tick; tick; check(\"positive\", y, 100);");
});

const icarus = "C:/iverilog/bin/iverilog.exe";
const available = await access(icarus).then(() => true, () => false);
it.skipIf(!available)("runs signed and hex helpers with parameterized ports and a reset", async () => {
	await writeFile(join(workspace, "dut.v"), "module dut #(parameter W=16)(input clock, reset_n, input signed [W-1:0] din, output signed [W-1:0] dout); assign dout=din; endmodule");
	expect((await run()).ok).toBe(true);
	const text = await readFile(join(workspace, "tb.v"), "utf8");
	await writeFile(join(workspace, "tb.v"), text.replace(/\t\t\/\/ example:[^\n]*/, '\t\tdin = -100; tick; check("negative", dout, -100);\n\t\tcheck_hex("wide", 64\'hfedcba9876543210, 64\'hfedcba9876543210);\n\t\tcheck("reset released", reset_n, 1);'));
	const compiled = await realExec(icarus, ["-g2001", "-s", "tb", "-o", "sim.out", "dut.v", "tb.v"], { cwd: workspace, timeoutMs: 10000 });
	expect(compiled.stderr).toBe("");
	expect(compiled.code).toBe(0);
	const sim = await realExec("C:/iverilog/bin/vvp.exe", ["sim.out"], { cwd: workspace, timeoutMs: 10000 });
	expect(sim.stdout).toContain("PASS negative");
	expect(sim.stdout).toContain("PASS wide");
	expect(sim.stdout).toContain("ALL TESTS PASSED");
});

it("uses module body parameter defaults in port ranges", async () => {
	await writeFile(join(workspace, "dut.v"), "module dut(input [W-1:0] a, output [W-1:0] y); parameter W=8; assign y=a; endmodule");
	expect((await run()).ok).toBe(true);
	expect(await readFile(join(workspace, "tb.v"), "utf8")).toContain("localparam W=8;");
});

it("copies only the parameters needed by port ranges and their dependencies", async () => {
	await writeFile(join(workspace, "dut.v"), "module dut #(parameter BASE=8, W=BASE*2)(input [W-1:0] a, output [W-1:0] y); localparam UNUSED=helper(1); function integer helper; input integer v; begin helper=v; end endfunction assign y=a; endmodule");
	expect((await run()).ok).toBe(true);
	const text = await readFile(join(workspace, "tb.v"), "utf8");
	expect(text).toContain("localparam BASE=8;");
	expect(text).toContain("localparam W=BASE*2;");
	expect(text).not.toContain("UNUSED");
});

it("respects protected targets and rejects paths outside the workspace", async () => {
	await writeFile(join(workspace, "dut.v"), "module dut(input a, output y); assign y=a; endmodule");
	const protectedCtx = { ...ctx, protect: ["tb.v"] };
	expect((await pickTools(["tb_skeleton"])[0]!.run({ design: "dut.v", path: "tb.v" }, protectedCtx)).ok).toBe(false);
	expect((await run({ path: "../outside.v" })).ok).toBe(false);
	expect((await run({ design: "../outside.v" })).ok).toBe(false);
});

it.skipIf(!available).each(["accum", "counter", "fifo", "fir4", "gain", "pwm", "regbank", "seqdet", "uart_tx"])("compiles and runs the generated skeleton for reference %s", async name => {
	await writeFile(join(workspace, "dut.v"), await readFile(new URL(`../evals-ref/${name}/${name}.v`, import.meta.url), "utf8"));
	expect((await run()).ok).toBe(true);
	const compiled = await realExec(icarus, ["-g2001", "-s", "tb", "-o", "sim.out", "dut.v", "tb.v"], { cwd: workspace, timeoutMs: 10000 });
	expect(compiled.stderr).toBe("");
	expect(compiled.code).toBe(0);
	const sim = await realExec("C:/iverilog/bin/vvp.exe", ["sim.out"], { cwd: workspace, timeoutMs: 10000 });
	expect(sim.code).toBe(0);
	expect(sim.stdout).toContain("FAIL no checks ran");
	expect(sim.stdout).not.toContain("ALL TESTS PASSED");
});

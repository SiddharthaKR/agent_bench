import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileFiles } from "../src/tools/compile.ts";
import { realExec } from "../src/tools/exec.ts";
import type { ToolContext } from "../src/types.ts";

let workspace: string;
let ctx: ToolContext;
const spec = "```verilog\n" + `module control(input clk, input rst_n, input [7:0] addr,
input wen, ren, input [15:0] wdata, output ack, output [15:0] rdata);
` + "```\n" + `The bus uses ack <= wen|ren; rdata is registered from addr (one cycle of read latency).
| addr | name | access | format |
|---|---|---|---|
| 0x24 | trim | R/W | 5-bit signed; reads back sign-extended |
| 0x28 | mode | R/W | 3-bit unsigned; reads back zero-extended |
| 0x40 | VERSION | R | constant 9 |
Unknown addresses read 0. On reset, all registers are 0.`;
const rtl = (read = "{{11{trim[4]}}, trim}", fallback = "16'd0") => `
module control(input clk, input rst_n, input [7:0] addr,
input wen, ren, input [15:0] wdata, output reg ack, output reg [15:0] rdata);
reg signed [4:0] trim;
reg [2:0] mode;
always @(posedge clk) begin
 if (!rst_n) begin trim <= 0; mode <= 0; ack <= 0; rdata <= 0; end
 else begin
  ack <= wen|ren;
  if(wen) case(addr) 8'h24: trim <= wdata[4:0]; 8'h28: mode <= wdata[2:0]; endcase
  case(addr)
   8'h24: rdata <= ${read};
   8'h28: rdata <= {13'd0, mode};
   8'h40: rdata <= 16'd9;
   default: rdata <= ${fallback};
  endcase
 end
end
endmodule`;

beforeEach(async () => {
	workspace = await mkdtemp(path.join(os.tmpdir(), "register-check-"));
	ctx = { workspace, exec: realExec, commands: { compile: ["iverilog", "-g2012", "-o", "{out}", "{files}"], simulate: ["vvp", "{out}"] }, specTexts: new Map([["spec.md", spec]]) };
});
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

it("rejects zero-extended signed register read-back before completion", async () => {
	await writeFile(path.join(workspace, "design.v"), rtl("{11'd0, trim}"));
	const result = await compileFiles("design.v", ctx);
	expect(result.ok).toBe(false);
	expect(result.text).toContain("Register check FAIL");
	expect(result.text).toContain("fff0");
});

it("rejects unknown bits in the whole read bus", async () => {
	await writeFile(path.join(workspace, "design.v"), rtl("{{11{trim[4]}}, trim}", "16'hxxxx"));
	const result = await compileFiles("design.v", ctx);
	expect(result.ok).toBe(false);
	expect(result.text).toContain("Register check FAIL");
});

it("still checks RTL read-back when a separate testbench has a syntax error", async () => {
	await writeFile(path.join(workspace, "design.v"), rtl("{11'd0, trim}"));
	await writeFile(path.join(workspace, "broken_tb.v"), "module broken; invalid syntax here endmodule");
	const result = await compileFiles("design.v broken_tb.v", ctx);
	expect(result.ok).toBe(false);
	expect(result.text).toContain("Register check FAIL");
});

it("accepts correct signed, unsigned, constant and unknown-address reads", async () => {
	await writeFile(path.join(workspace, "design.v"), rtl());
	const result = await compileFiles("design.v", ctx);
	expect(result.ok).toBe(true);
	expect(result.text).toContain("Register check PASS");
});

it("leaves unsupported bus contracts alone", async () => {
	ctx.specTexts = new Map([["spec.md", spec.replace("ack <= wen|ren", "a variable latency handshake")]]);
	await writeFile(path.join(workspace, "design.v"), rtl("{11'd0, trim}"));
	const result = await compileFiles("design.v", ctx);
	expect(result.ok).toBe(true);
	expect(result.text).not.toContain("Register check");
});

it("reports an out-of-range select as a hint without failing the compile", async () => {
	ctx.specTexts = new Map();
	await writeFile(path.join(workspace, "design.v"), "module m(input [3:0] x, output y); assign y=x[4]; endmodule");
	const result = await compileFiles("design.v", ctx);
	expect(result.ok).toBe(true);
	expect(result.text).toMatch(/Hint: .*outside the declared range/i);
});

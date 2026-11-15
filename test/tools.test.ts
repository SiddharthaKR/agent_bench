import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Exec, ExecResult, ToolContext } from "../src/types.ts";
import { ALL_TOOLS, pickTools, realExec, resolveInWorkspace } from "../src/tools/index.ts";
import { compile, expandCommand } from "../src/tools/compile.ts";
import { readFile } from "../src/tools/read_file.ts";
import { replaceLines } from "../src/tools/replace_lines.ts";
import { runSim } from "../src/tools/run_sim.ts";
import { writeFile } from "../src/tools/write_file.ts";

let ws: string;
beforeEach(async () => {
	ws = await fs.mkdtemp(path.join(os.tmpdir(), "tools-test-"));
});
afterEach(async () => {
	await fs.rm(ws, { recursive: true, force: true });
});

const res = (p: Partial<ExecResult> = {}): ExecResult => ({
	code: 0,
	stdout: "",
	stderr: "",
	timedOut: false,
	notFound: false,
	...p,
});

interface Call {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
}

function fakeCtx(results: ExecResult[]): { ctx: ToolContext; calls: Call[] } {
	const calls: Call[] = [];
	const exec: Exec = async (command, args, o) => {
		calls.push({ command, args, cwd: o.cwd, timeoutMs: o.timeoutMs });
		return results[calls.length - 1] ?? res();
	};
	return {
		calls,
		ctx: {
			workspace: ws,
			exec,
			commands: {
				compile: ["iverilog", "-o", "{out}", "{files}"],
				simulate: ["vvp", "{out}"],
			},
		},
	};
}

const plainCtx = (): ToolContext => fakeCtx([]).ctx;
const put = (rel: string, text: string) => fs.writeFile(path.join(ws, rel), text);
const get = (rel: string) => fs.readFile(path.join(ws, rel), "utf8");
const numbers = (n: number) => Array.from({ length: n }, (_, i) => `line${i + 1}`).join("\n") + "\n";

describe("compile hints", () => {
	it.each(["16'sd-32768", "16'd-2", "16'sh-8000", "16'h-2"])("explains negative sized literal %s", async (literal) => {
		await put("a.v", `module a;\nlocalparam X = ${literal};\nendmodule`);
		const { ctx } = fakeCtx([res({ code: 1, stderr: "a.v:2: syntax error" })]);
		expect((await compile.run({ files: "a.v" }, ctx)).text).toContain("Hint: put the minus sign before the size: -16'sd32768, not 16'sd-32768.");
	});
	it.each(["localparam X = 1;", "parameter X = 1;", "integer x;", "genvar x;"])("explains a block declaration: %s", async (declaration) => {
		await put("a.v", `module a;\nalways @* begin\n  ${declaration}\nend\nendmodule`);
		const { ctx } = fakeCtx([res({ code: 1, stderr: "a.v:3: syntax error" })]);
		expect((await compile.run({ files: "a.v" }, ctx)).text).toContain("Hint: declare localparam, parameter, wire, reg and integer at module level, before the always block.");
	});
	it("adds declaration advice only inside always, including nested blocks", async () => {
		await put("a.v", "module a;\nalways @* begin\nif (1'b1) begin\nreg x;\nend\nend\nwire y;\nendmodule\n");
		const { ctx } = fakeCtx([res({ code: 1, stderr: "a.v:4: syntax error\na.v:7: syntax error" })]);
		const result = await compile.run({ files: "a.v" }, ctx);
		expect(result.text).toContain("4| reg x;\nHint: declare localparam, parameter, wire, reg and integer at module level, before the always block.");
		expect(result.text.match(/Hint:/g)).toHaveLength(1);
	});
	it.each([
		["is not a valid l-value", "only a reg can be assigned in an always block; a wire needs assign."],
		["Unable to bind wire/reg/memory", "this name is not declared in this module."],
		["Syntax in assignment statement l-value", "check the line above for a missing semicolon or end."],
	])("explains %s after the source line", async (message, hint) => {
		await put("a.v", "broken;\n");
		const { ctx } = fakeCtx([res({ code: 1, stderr: `a.v:1: ${message}` })]);
		expect((await compile.run({ files: "a.v" }, ctx)).text).toContain(`1| broken;\nHint: ${hint}`);
	});
	it("limits hints to two per result and ignores comments", async () => {
		await put("a.v", "// always begin\nreg x;\nbad;\nbad;\n");
		const { ctx } = fakeCtx([res({ code: 1, stderr: "a.v:2: syntax error\na.v:2: is not a valid l-value\na.v:3: Unable to bind wire/reg/memory\na.v:4: Syntax in assignment statement l-value" })]);
		const text = (await compile.run({ files: "a.v" }, ctx)).text;
		expect(text).not.toContain("declare wires");
		expect((text.match(/Hint:/g) ?? []).length).toBeLessThanOrEqual(2);
	});
});

describe("resolveInWorkspace", () => {
	it("resolves normal and nested paths", () => {
		expect(resolveInWorkspace(ws, "a.v")).toMatchObject({ ok: true, rel: "a.v", abs: path.join(ws, "a.v") });
		expect(resolveInWorkspace(ws, "src/x/a.v")).toMatchObject({ ok: true, rel: "src/x/a.v" });
	});
	it("accepts backslashes", () => {
		expect(resolveInWorkspace(ws, "src\\x\\a.v")).toMatchObject({ ok: true, rel: "src/x/a.v" });
	});
	it("rejects .. escapes", () => {
		expect(resolveInWorkspace(ws, "../x.v").ok).toBe(false);
		expect(resolveInWorkspace(ws, "a/../../x.v").ok).toBe(false);
		expect(resolveInWorkspace(ws, "a/../b.v")).toMatchObject({ ok: true, rel: "b.v" });
	});
	it("rejects absolute and empty paths", () => {
		expect(resolveInWorkspace(ws, "/etc/passwd").ok).toBe(false);
		expect(resolveInWorkspace(ws, "C:\\x\\a.v").ok).toBe(false);
		expect(resolveInWorkspace(ws, path.join(ws, "a.v")).ok).toBe(false);
		expect(resolveInWorkspace(ws, "  ").ok).toBe(false);
	});
});

describe("read_file", () => {
	it("reads a whole small file", async () => {
		await put("a.v", "one\ntwo\nthree\n");
		const r = await readFile.run({ path: "a.v" }, plainCtx());
		expect(r).toEqual({ ok: true, text: "a.v, lines 1-3 of 3\n1| one\n2| two\n3| three" });
	});
	it("reads a range with right-aligned numbers", async () => {
		await put("a.v", numbers(12));
		const r = await readFile.run({ path: "a.v", from: 8, to: 10 }, plainCtx());
		expect(r.text).toBe("a.v, lines 8-10 of 12\n 8| line8\n 9| line9\n10| line10");
	});
	it("tolerates CRLF files", async () => {
		await put("a.v", "one\r\ntwo\r\n");
		const r = await readFile.run({ path: "a.v" }, plainCtx());
		expect(r.text).toBe("a.v, lines 1-2 of 2\n1| one\n2| two");
	});
	it("caps at 200 lines with a hint", async () => {
		await put("big.v", numbers(250));
		const r = await readFile.run({ path: "big.v" }, plainCtx());
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("big.v, lines 1-200 of 250");
		expect(lines).toHaveLength(202);
		expect(lines.at(-1)).toBe("(50 more lines. Ask again with from: 201.)");
	});
	it("reports not found", async () => {
		expect(await readFile.run({ path: "no.v" }, plainCtx())).toEqual({ ok: false, text: "File not found: no.v" });
	});
	it("reports a folder", async () => {
		await fs.mkdir(path.join(ws, "d"));
		const r = await readFile.run({ path: "d" }, plainCtx());
		expect(r.ok).toBe(false);
		expect(r.text).toContain("folder");
	});
	it("rejects from past the end, bad order and bad numbers", async () => {
		await put("a.v", "x\ny\n");
		const past = await readFile.run({ path: "a.v", from: 5 }, plainCtx());
		expect(past.ok).toBe(false);
		expect(past.text).toContain("2 lines");
		expect((await readFile.run({ path: "a.v", from: 2, to: 1 }, plainCtx())).ok).toBe(false);
		expect((await readFile.run({ path: "a.v", from: 1.5 }, plainCtx())).ok).toBe(false);
		expect((await readFile.run({ path: "a.v", from: 0 }, plainCtx())).ok).toBe(false);
		expect((await readFile.run({ path: "a.v", from: "abc" }, plainCtx())).ok).toBe(false);
		expect((await readFile.run({ path: "a.v", from: "2" }, plainCtx())).ok).toBe(true);
	});
	it("rejects path escapes", async () => {
		expect((await readFile.run({ path: "../x" }, plainCtx())).ok).toBe(false);
	});
});

describe("write_file", () => {
	it.each([writeFile, replaceLines])("protects files and folders with $name", async (tool) => {
		await fs.mkdir(path.join(ws, "tb"));
		await put("tb/tb_gain.v", "given\n");
		await put("spec.md", "given\n");
		const ctx = { ...plainCtx(), protect: ["tb/", "spec.md"] };
		for (const name of ["tb/tb_gain.v", "rtl/../tb/tb_gain.v", "tb\\tb_gain.v", ...(process.platform === "win32" ? ["TB/TB_GAIN.V"] : [])]) {
			const r = await tool.run({ path: name, from: 1, to: 1, content: "changed" }, ctx);
			expect(r.ok).toBe(false);
			expect(r.text).toMatch(/ is given and must not be changed\. Fix the design instead, and run run_sim with this file\.$/);
		}
		expect(await tool.run({ path: "spec.md", from: 1, to: 1, content: "changed" }, ctx)).toEqual({ ok: false, text: "spec.md is given and must not be changed." });
		expect(await get("tb/tb_gain.v")).toBe("given\n");
		expect(await get("spec.md")).toBe("given\n");
		await put("free.v", "old\n");
		expect((await tool.run({ path: "free.v", from: 1, to: 1, content: "changed" }, ctx)).ok).toBe(true);
	});
	it("creates a file with parent folders", async () => {
		const r = await writeFile.run({ path: "rtl/deep/a.v", content: "a\nb\n" }, plainCtx());
		expect(r).toEqual({ ok: true, text: "Created rtl/deep/a.v, 2 lines." });
		expect(await get("rtl/deep/a.v")).toBe("a\nb\n");
	});
	it("overwrites", async () => {
		await put("a.v", "old\nold\nold\n");
		const r = await writeFile.run({ path: "a.v", content: "new" }, plainCtx());
		expect(r.text).toBe("Wrote a.v, 1 lines.");
		expect(await get("a.v")).toBe("new\n");
	});
	it("normalises CRLF and trailing newlines", async () => {
		await writeFile.run({ path: "a.v", content: "a\r\nb\r\n\r\n\r\n" }, plainCtx());
		expect(await get("a.v")).toBe("a\nb\n");
	});
	it("errors on missing content", async () => {
		const r = await writeFile.run({ path: "a.v" }, plainCtx());
		expect(r).toEqual({ ok: false, text: "write_file needs the file contents after a --- line." });
	});
	it("rejects path escape", async () => {
		const r = await writeFile.run({ path: "../evil.v", content: "x" }, plainCtx());
		expect(r.ok).toBe(false);
	});
});

describe("replace_lines", () => {
	it("replaces middle lines and echoes context", async () => {
		await put("a.v", numbers(10));
		const r = await replaceLines.run({ path: "a.v", from: 5, to: 6, content: "X\nY\n" }, plainCtx());
		expect(r.ok).toBe(true);
		expect(r.text).toBe(
			[
				"Replaced lines 5-6 of a.v with 2 lines. File now has 10 lines.",
				"3| line3",
				"4| line4",
				"5| X",
				"6| Y",
				"7| line7",
				"8| line8",
			].join("\n"),
		);
		expect((await get("a.v")).split("\n")[4]).toBe("X");
	});
	it("replaces with more lines", async () => {
		await put("a.v", numbers(3));
		const r = await replaceLines.run({ path: "a.v", from: 2, to: 2, content: "a\nb\nc" }, plainCtx());
		expect(r.text.split("\n")[0]).toBe("Replaced lines 2-2 of a.v with 3 lines. File now has 5 lines.");
		expect(await get("a.v")).toBe("line1\na\nb\nc\nline3\n");
	});
	it("deletes a range with an empty body", async () => {
		await put("a.v", numbers(6));
		const r = await replaceLines.run({ path: "a.v", from: 2, to: 4 }, plainCtx());
		expect(r.text.split("\n")[0]).toBe("Replaced lines 2-4 of a.v with 0 lines. File now has 3 lines.");
		expect(await get("a.v")).toBe("line1\nline5\nline6\n");
		expect(r.text).toContain("2| line5");
		const r2 = await replaceLines.run({ path: "a.v", from: 1, to: 3, content: "" }, plainCtx());
		expect(r2.ok).toBe(true);
		expect(r2.text).toBe("Replaced lines 1-3 of a.v with 0 lines. File now has 0 lines.");
	});
	it("states the real line count on bad ranges", async () => {
		await put("pid.v", numbers(19));
		const past = await replaceLines.run({ path: "pid.v", from: 25, to: 26, content: "x" }, plainCtx());
		expect(past).toEqual({ ok: false, text: "pid.v has 19 lines; from 25 is past the end." });
		const pastTo = await replaceLines.run({ path: "pid.v", from: 5, to: 30, content: "x" }, plainCtx());
		expect(pastTo.text).toContain("19 lines");
		const order = await replaceLines.run({ path: "pid.v", from: 9, to: 3, content: "x" }, plainCtx());
		expect(order.ok).toBe(false);
		expect((await replaceLines.run({ path: "pid.v", from: 0, to: 3 }, plainCtx())).ok).toBe(false);
		expect((await replaceLines.run({ path: "pid.v", from: 1, to: 2.5 }, plainCtx())).ok).toBe(false);
		expect(await get("pid.v")).toBe(numbers(19));
	});
	it("errors on a missing file", async () => {
		const r = await replaceLines.run({ path: "no.v", from: 1, to: 1 }, plainCtx());
		expect(r).toEqual({ ok: false, text: "File not found: no.v" });
	});
	it("normalises CRLF files to LF", async () => {
		await put("a.v", "a\r\nb\r\nc\r\n");
		await replaceLines.run({ path: "a.v", from: 2, to: 2, content: "B\r\n" }, plainCtx());
		expect(await get("a.v")).toBe("a\nB\nc\n");
	});
	it("shortens a long echo", async () => {
		await put("a.v", numbers(5));
		const body = Array.from({ length: 60 }, (_, i) => `n${i + 1}`).join("\n");
		const r = await replaceLines.run({ path: "a.v", from: 1, to: 5, content: body }, plainCtx());
		const lines = r.text.split("\n");
		expect(lines).toHaveLength(1 + 41);
		expect(lines[21]).toBe("...");
	});
});

describe("compile", () => {
	it("silently skips lint when a compiled input can no longer be read", async () => {
		const { ctx } = fakeCtx([]);
		ctx.exec = async () => {
			await fs.unlink(path.join(ws, "a.v"));
			return res();
		};
		expect(await compile.run({ files: "a.v" }, ctx)).toEqual({ ok: true, text: "Compiled, 0 errors." });
	});
	it("keeps compile success and appends lint hints from each input", async () => {
		await put("a.v", "module a(output reg dout); reg dout_reg; always @* dout_reg = 1; endmodule");
		await put("b.v", "module b(output y); endmodule");
		const { ctx } = fakeCtx([res()]);
		const result = await compile.run({ files: "a.v b.v" }, ctx);
		expect(result.ok).toBe(true);
		expect(result.text).toContain("Compiled, 0 errors.\nHint: output dout is never assigned");
		expect(result.text).toContain("You assign dout_reg instead;");
		expect(result.text).toContain("Hint: output y is never assigned");
	});
	beforeEach(async () => {
		await put("a.v", "module a; endmodule\n");
		await fs.mkdir(path.join(ws, "tb"));
		await put("tb/t.v", "module t; endmodule\n");
	});

	it("expands {files} and {out}", async () => {
		const { ctx, calls } = fakeCtx([res()]);
		const r = await compile.run({ files: "a.v  tb\\t.v" }, ctx);
		expect(r).toEqual({ ok: true, text: "Compiled, 0 errors." });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			command: "iverilog",
			args: ["-o", ".build/sim.out", "a.v", "tb/t.v"],
			cwd: ws,
			timeoutMs: 60_000,
		});
		expect((await fs.stat(path.join(ws, ".build"))).isDirectory()).toBe(true);
	});
	it("expandCommand handles {out} inside an entry", () => {
		expect(expandCommand(["c", "--out={out}", "{files}", "-x"], ["a", "b"], "o")).toEqual({
			program: "c",
			args: ["--out=o", "a", "b", "-x"],
		});
	});
	it("reports warnings on success", async () => {
		const { ctx } = fakeCtx([res({ stderr: "a.v:3: warning: x\na.v:4: warning: y\n" })]);
		const r = await compile.run({ files: "a.v" }, ctx);
		expect(r).toEqual({ ok: true, text: "Compiled, 0 errors. 2 warning lines; first: a.v:3: warning: x" });
	});
	it("shows at most 5 failure lines", async () => {
		const err = Array.from({ length: 8 }, (_, i) => `a.v:${i + 1}: error ${i + 1}`).join("\n");
		const { ctx } = fakeCtx([res({ code: 1, stderr: err })]);
		const r = await compile.run({ files: "a.v" }, ctx);
		expect(r.ok).toBe(false);
		expect(r.text).toBe(
			[
				"Compile failed, 8 message lines.",
				"a.v:1: error 1",
				// The source line is shown under the message when the file has that line.
				"    1| module a; endmodule",
				"a.v:2: error 2",
				"a.v:3: error 3",
				"a.v:4: error 4",
				"a.v:5: error 5",
				"(3 more lines not shown)",
			].join("\n"),
		);
	});
	it("trims long lines and puts stderr first", async () => {
		const { ctx } = fakeCtx([res({ code: 1, stdout: "out line", stderr: "x".repeat(300) })]);
		const r = await compile.run({ files: "a.v" }, ctx);
		const lines = r.text.split("\n");
		expect(lines[1]).toHaveLength(200);
		expect(lines[2]).toBe("out line");
	});
	it("reports compiler not found", async () => {
		const { ctx } = fakeCtx([res({ code: null, notFound: true })]);
		const r = await compile.run({ files: "a.v" }, ctx);
		expect(r).toEqual({ ok: false, text: 'The compiler "iverilog" is not installed on this machine.' });
	});
	it("reports timeout", async () => {
		const { ctx } = fakeCtx([res({ code: null, timedOut: true })]);
		expect(await compile.run({ files: "a.v" }, ctx)).toEqual({ ok: false, text: "Compile timed out after 60 s." });
	});
	it("names the first missing input file and does not run", async () => {
		const { ctx, calls } = fakeCtx([res()]);
		const r = await compile.run({ files: "a.v nope.v other.v" }, ctx);
		expect(r).toEqual({ ok: false, text: "File not found: nope.v" });
		expect(calls).toHaveLength(0);
	});
	it("rejects files outside the workspace", async () => {
		const { ctx, calls } = fakeCtx([]);
		expect((await compile.run({ files: "../x.v" }, ctx)).ok).toBe(false);
		expect(calls).toHaveLength(0);
	});
});

describe("run_sim", () => {
	it("prioritizes lint hints and limits combined hints to three", async () => {
		await put("a.v", "module a(output reg dout, other); reg dout_reg; always @* dout_reg = 1; endmodule");
		const { ctx } = fakeCtx([res(), res({ stdout: "FAIL a got x wanted 1\nFAIL b got 1 wanted 2\nFAIL c got 2 wanted 3" })]);
		const result = await runSim.run({ files: "a.v" }, ctx);
		expect(result.ok).toBe(false);
		const hints = result.text.split("\n").filter((line) => line.startsWith("Hint: "));
		expect(hints).toHaveLength(3);
		expect(hints[0]).toContain("output dout is never assigned");
		expect(hints[1]).toContain("output other is never assigned");
		expect(hints[2]).toContain("each result");
		expect(result.text.indexOf("FAIL c")).toBeLessThan(result.text.indexOf("Hint: "));
	});
	it("appends both hints using failures beyond the displayed ten", async () => {
		await put("a.v", "module a; endmodule");
		const failures = [...Array.from({ length: 10 }, () => "FAIL other"), "FAIL a got x wanted 1", "FAIL b got 1 wanted 2", "FAIL c got 2 wanted 3"];
		const { ctx } = fakeCtx([res(), res({ stdout: failures.join("\n") })]);
		const r = await runSim.run({ files: "a.v" }, ctx);
		expect(r.ok).toBe(false);
		expect(r.text).toContain("(3 more lines not shown)\nHint: each result");
		expect(r.text.split("\n").at(-1)).toContain("Hint: x means");
	});
	beforeEach(async () => {
		await put("a.v", "module a; endmodule\n");
		await put("t.v", "module t; endmodule\n");
	});

	it("passes", async () => {
		const { ctx, calls } = fakeCtx([res(), res({ stdout: "start\nPASS: case 1\nPASS: case 2\ndone\n" })]);
		const r = await runSim.run({ files: "a.v t.v" }, ctx);
		expect(r.ok).toBe(true);
		expect(r.text.split("\n")[0]).toBe("Simulation passed: 2 pass lines, 0 failures.");
		expect(r.text).toContain("done");
		expect(calls).toHaveLength(2);
		expect(calls[1]).toEqual({ command: "vvp", args: [".build/sim.out"], cwd: ws, timeoutMs: 120_000 });
	});
	it("fails and caps failure lines at 10", async () => {
		const out = Array.from({ length: 13 }, (_, i) => `FAIL: case ${i}`).join("\n") + "\nPASS: ok\n";
		const { ctx } = fakeCtx([res(), res({ stdout: out })]);
		const r = await runSim.run({ files: "a.v t.v" }, ctx);
		expect(r.ok).toBe(false);
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("Simulation failed: 13 failure lines, 1 pass lines.");
		expect(lines).toHaveLength(1 + 10 + 1);
		expect(lines.at(-1)).toBe("(3 more lines not shown)");
	});
	it("is a failure on a non-zero exit even without FAIL lines", async () => {
		const { ctx } = fakeCtx([res(), res({ code: 2, stdout: "crashed\n" })]);
		const r = await runSim.run({ files: "a.v t.v" }, ctx);
		expect(r.ok).toBe(false);
		expect(r.text).toContain("crashed");
	});
	it("does not match words that merely contain FAIL or PASS", async () => {
		const { ctx } = fakeCtx([res(), res({ stdout: "0 errors, bypass\n" })]);
		const r = await runSim.run({ files: "a.v t.v" }, ctx);
		expect(r.text.split("\n")[0]).toBe("Simulation finished with no PASS or FAIL lines.");
	});
	it("stops at a compile failure without simulating", async () => {
		const { ctx, calls } = fakeCtx([res({ code: 1, stderr: "a.v:1: syntax error" })]);
		const r = await runSim.run({ files: "a.v t.v" }, ctx);
		expect(r.ok).toBe(false);
		expect(r.text).toBe("Compile failed, 1 message lines.\na.v:1: syntax error\n    1| module a; endmodule");
		expect(calls).toHaveLength(1);
	});
	it("reports a timeout", async () => {
		const { ctx } = fakeCtx([res(), res({ code: null, timedOut: true })]);
		expect(await runSim.run({ files: "a.v t.v" }, ctx)).toEqual({
			ok: false,
			text: "Simulation timed out after 120 s.",
		});
	});
	it("reports a missing simulator", async () => {
		const { ctx } = fakeCtx([res(), res({ code: null, notFound: true })]);
		const r = await runSim.run({ files: "a.v t.v" }, ctx);
		expect(r).toEqual({ ok: false, text: 'The simulator "vvp" is not installed on this machine.' });
	});
	it("handles no PASS or FAIL lines", async () => {
		const out = Array.from({ length: 8 }, (_, i) => `msg ${i + 1}`).join("\n");
		const { ctx } = fakeCtx([res(), res({ stdout: out })]);
		const r = await runSim.run({ files: "a.v t.v" }, ctx);
		expect(r.ok).toBe(true);
		const lines = r.text.split("\n");
		expect(lines[0]).toBe("Simulation finished with no PASS or FAIL lines.");
		expect(lines.slice(1, 6)).toEqual(["msg 4", "msg 5", "msg 6", "msg 7", "msg 8"]);
		expect(lines[6]).toBe("(3 more lines not shown)");
	});
});

describe("pickTools", () => {
	it("keeps the given order", () => {
		expect(pickTools(["run_sim", "read_file"]).map((t) => t.name)).toEqual(["run_sim", "read_file"]);
		expect(ALL_TOOLS.map((t) => t.name)).toEqual([
			"read_file",
			"write_file",
			"replace_lines",
			"compile",
			"run_sim",
		]);
	});
	it("throws on an unknown name", () => {
		expect(() => pickTools(["read_file", "nope"])).toThrow("Unknown tool: nope");
	});
});

describe("realExec", () => {
	it("runs a program", async () => {
		const r = await realExec(process.execPath, ["-e", "console.log('hi')"], { cwd: ws, timeoutMs: 20_000 });
		expect(r.code).toBe(0);
		expect(r.stdout.trim()).toBe("hi");
		expect(r.notFound).toBe(false);
	}, 30_000);
	it("reports a missing program", async () => {
		const r = await realExec("definitely-not-a-real-program-xyz", [], { cwd: ws, timeoutMs: 5_000 });
		expect(r.notFound).toBe(true);
		expect(r.code).toBeNull();
	}, 30_000);
	it("kills on timeout", async () => {
		const r = await realExec(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { cwd: ws, timeoutMs: 300 });
		expect(r.timedOut).toBe(true);
	}, 30_000);
});

import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { tbChecks } from "../src/tools/tb_checks.ts";
import type { ToolContext } from "../src/types.ts";

const SKELETON = ["module tb;", "\tinitial begin", "\t\t// ---- CHECKS BEGIN: write here ----", "\t\t// example", "\t\t// ---- CHECKS END ----", "\t\t$finish;", "\tend", "endmodule", ""].join("\n");

async function setup(text = SKELETON) {
	const dir = await mkdtemp(path.join(tmpdir(), "tbchecks-"));
	await writeFile(path.join(dir, "tb.v"), text);
	const ctx = { workspace: dir, protect: [] } as unknown as ToolContext;
	return { dir, ctx };
}

describe("tb_checks", () => {
	it("replaces only the marked section and counts checks", async () => {
		const { dir, ctx } = await setup();
		const result = await tbChecks.run({ path: "tb.v", content: "din = 5; tick;\ncheck(\"five\", dout, 5);\n" }, ctx);
		expect(result.ok).toBe(true);
		expect(result.text).toContain("2 lines with 1 checks");
		const text = await readFile(path.join(dir, "tb.v"), "utf8");
		expect(text).toContain("CHECKS BEGIN: write here ----\n\t\tdin = 5; tick;\n\t\tcheck(\"five\", dout, 5);\n\t\t// ---- CHECKS END");
		expect(text).not.toContain("// example");
		expect(text.startsWith("module tb;")).toBe(true);
		expect(text).toContain("$finish;");
	});

	it("replaces the section again on a second call", async () => {
		const { dir, ctx } = await setup();
		await tbChecks.run({ path: "tb.v", content: "check(\"a\", x, 1);" }, ctx);
		await tbChecks.run({ path: "tb.v", content: "check(\"b\", x, 2);" }, ctx);
		const text = await readFile(path.join(dir, "tb.v"), "utf8");
		expect(text).not.toContain("\"a\"");
		expect(text).toContain("\"b\"");
	});

	it("repairs a minus sign inside a sized constant and says so", async () => {
		const { dir, ctx } = await setup();
		const result = await tbChecks.run({ path: "tb.v", content: "din = 14'sd-100; tick;\ncheck(\"n\", dout, -100);" }, ctx);
		expect(result.text).toContain("Fixed 1 constant");
		expect(await readFile(path.join(dir, "tb.v"), "utf8")).toContain("din = -100; tick;");
	});

	it("refuses module-level lines, an empty body, a file without markers and a missing file", async () => {
		const { ctx } = await setup();
		expect((await tbChecks.run({ path: "tb.v", content: "initial begin\nend" }, ctx)).ok).toBe(false);
		expect((await tbChecks.run({ path: "tb.v", content: "  \n" }, ctx)).ok).toBe(false);
		expect((await tbChecks.run({ path: "none.v", content: "tick;" }, ctx)).text).toContain("tb_skeleton");
		const plain = await setup("module tb;\nendmodule\n");
		expect((await tbChecks.run({ path: "tb.v", content: "tick;" }, plain.ctx)).text).toContain("CHECKS BEGIN");
	});

	it("says when no check was written", async () => {
		const { ctx } = await setup();
		expect((await tbChecks.run({ path: "tb.v", content: "din = 1; tick;" }, ctx)).text).toContain("no check");
	});

	it("does not write a protected file", async () => {
		const { dir } = await setup();
		const ctx = { workspace: dir, protect: ["tb.v"] } as unknown as ToolContext;
		const result = await tbChecks.run({ path: "tb.v", content: "tick;" }, ctx);
		expect(result.ok).toBe(false);
		expect(await readFile(path.join(dir, "tb.v"), "utf8")).toBe(SKELETON);
	});
});

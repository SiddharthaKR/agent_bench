import * as fs from "node:fs/promises";
import type { ToolSpec } from "../types.ts";
import { resolveInWorkspace } from "./paths.ts";
import { protectedRefusal } from "./edit_policy.ts";
import { autofixVerilog } from "./autofix.ts";

const BEGIN = "CHECKS BEGIN";
const END = "CHECKS END";

/** Replaces only the marked section of a testbench made by tb_skeleton, so the generated parts stay intact. */
export const tbChecks: ToolSpec = {
	name: "tb_checks",
	summary: "Put stimulus and checks into a testbench made by tb_skeleton; replaces only the marked section.",
	args: [{ name: "path", type: "string", required: true, help: "testbench file made by tb_skeleton" }],
	body: { help: "the statements for the section: assignments, tick; and check(...) calls" },
	async run(args, ctx) {
		const target = resolveInWorkspace(ctx.workspace, String(args.path ?? ""));
		if (!target.ok) return { ok: false, text: target.text };
		const refusal = protectedRefusal("write_file", args, ctx);
		if (refusal) return { ok: false, text: refusal };
		const body = String(args.content ?? "");
		if (!body.trim()) return { ok: false, text: "Give the statements after the --- line." };
		if (/^\s*(?:module|endmodule|task|endtask|initial|always)\b/m.test(body)) {
			return { ok: false, text: "Give only statements for inside the initial block: assignments, tick; and check(...) calls. No module, task, initial or always lines." };
		}
		let text: string;
		try { text = (await fs.readFile(target.abs, "utf8")).replace(/\r\n/g, "\n"); } catch { return { ok: false, text: `File not found: ${target.rel}. Create it with tb_skeleton first.` }; }
		const lines = text.split("\n");
		const begin = lines.findIndex((line) => line.includes(BEGIN));
		const end = lines.findIndex((line) => line.includes(END));
		if (begin === -1 || end === -1 || end <= begin) return { ok: false, text: `${target.rel} has no CHECKS BEGIN and CHECKS END lines. Create the testbench with tb_skeleton.` };
		const fixed = autofixVerilog(body);
		const section = fixed.text.replace(/\r\n/g, "\n").split("\n").filter((line, index, all) => !(line.trim() === "" && (index === 0 || index === all.length - 1))).map((line) => (line.trim() === "" ? "" : `\t\t${line.trim()}`));
		const next = [...lines.slice(0, begin + 1), ...section, ...lines.slice(end)];
		await fs.writeFile(target.abs, next.join("\n"), "utf8");
		const checks = section.filter((line) => /\bcheck(?:_hex)?\s*\(/.test(line)).length;
		return { ok: true, text: [`Wrote ${section.length} lines with ${checks} checks into ${target.rel}.`, ...fixed.notes, checks === 0 ? "There is no check(...) call yet; add checks." : ""].filter(Boolean).join("\n") };
	},
};

import type { ToolSpec } from "../types.ts";
import { compileFiles, expandCommand, interfaceHints, lintFiles, OUT_PATH, outputLines } from "./compile.ts";
import { simHints } from "./sim_hints.ts";

const TIMEOUT_MS = 120_000;
const FAIL_RE = /\b(FAIL|FAILED|ERROR|MISMATCH)\b/i;
const PASS_RE = /\b(PASS|PASSED)\b/i;

function tail(lines: string[], n: number): string[] {
	const out = lines.slice(-n);
	if (lines.length > n) out.push(`(${lines.length - n} more lines not shown)`);
	return out;
}

export const runSim: ToolSpec = {
	name: "run_sim",
	summary: "Compile the design with its testbench, run the simulation, report pass or fail.",
	args: [
		{ name: "files", type: "string", required: true, help: "design and testbench files, separated by spaces" },
	],
	async run(args, ctx) {
		const built = await compileFiles(args.files, ctx);
		if (!built.ok) return { ok: false, text: built.text };
		const failed = async (text: string) => ({ ok: false, text: [text, ...await interfaceHints(built.files, ctx)].join("\n") });

		const template = ctx.commands.simulate;
		if (template.length === 0) return failed("No simulate command is configured.");
		const { program, args: simArgs } = expandCommand(template, [], OUT_PATH);
		const r = await ctx.exec(program, simArgs, { cwd: ctx.workspace, timeoutMs: TIMEOUT_MS, signal: ctx.signal });
		if (r.notFound) return failed(`The simulator "${program}" is not installed on this machine.`);
		if (r.timedOut) return failed("Simulation timed out after 120 s.");

		const lines = outputLines(r.stdout, r.stderr);
		const failures = lines.filter((l) => FAIL_RE.test(l));
		const passes = lines.filter((l) => !FAIL_RE.test(l) && PASS_RE.test(l));
		const exitOk = r.code === 0;

		if (failures.length > 0 || !exitOk) {
			const head =
				failures.length > 0
					? `Simulation failed: ${failures.length} failure lines, ${passes.length} pass lines.`
					: `Simulation failed: exit code ${r.code ?? "none"}, ${passes.length} pass lines.`;
			const body =
				failures.length > 0
					? [...failures.slice(0, 10), ...(failures.length > 10 ? [`(${failures.length - 10} more lines not shown)`] : [])]
					: tail(lines, 5);
			const hints = [...await interfaceHints(built.files, ctx), ...await lintFiles(built.files, ctx.workspace), ...simHints(failures)].slice(0, 3);
			return { ok: false, text: [head, ...body, ...hints].join("\n") };
		}
		if (passes.length === 0) {
			return { ok: true, text: ["Simulation finished with no PASS or FAIL lines.", ...tail(lines, 5)].join("\n") };
		}
		return {
			ok: true,
			text: [`Simulation passed: ${passes.length} pass lines, 0 failures.`, ...tail(lines, 5)].join("\n"),
		};
	},
};

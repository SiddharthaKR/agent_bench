import type { ToolSpec } from "../types.ts";
import { compile } from "./compile.ts";
import { readFile } from "./read_file.ts";
import { replaceLines } from "./replace_lines.ts";
import { runSim } from "./run_sim.ts";
import { writeFile } from "./write_file.ts";

export { realExec } from "./exec.ts";
export { resolveInWorkspace } from "./paths.ts";

export const ALL_TOOLS: ToolSpec[] = [readFile, writeFile, replaceLines, compile, runSim];

export function pickTools(names: string[]): ToolSpec[] {
	return names.map((name) => {
		const tool = ALL_TOOLS.find((t) => t.name === name);
		if (!tool) throw new Error(`Unknown tool: ${name}`);
		return tool;
	});
}

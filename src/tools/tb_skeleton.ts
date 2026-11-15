import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolSpec } from "../types.ts";
import { designHeaders } from "./interface.ts";
import { resolveInWorkspace } from "./paths.ts";
import { protectedRefusal } from "./edit_policy.ts";

export const tbSkeleton: ToolSpec = {
	name: "tb_skeleton",
	summary: "Create a Verilog testbench with clock, reset and check helpers.",
	args: [
		{ name: "design", type: "string", required: true, help: "design file to read" },
		{ name: "path", type: "string", required: true, help: "new testbench file to create" },
		{ name: "module", type: "string", required: false, help: "module name when the design has several modules" },
	],
	async run(args, ctx) {
		const design = resolveInWorkspace(ctx.workspace, String(args.design ?? ""));
		const target = resolveInWorkspace(ctx.workspace, String(args.path ?? ""));
		if (!design.ok) return { ok: false, text: design.text };
		if (!target.ok) return { ok: false, text: target.text };
		const refusal = protectedRefusal("write_file", args, ctx);
		if (refusal) return { ok: false, text: refusal };
		try {
			try {
				await fs.lstat(target.abs);
				return { ok: false, text: `${target.rel} already exists; edit the existing file instead.` };
			} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
			const modules = designHeaders(await fs.readFile(design.abs, "utf8"));
			const header = args.module ? modules?.find(module => module.name === args.module) : modules?.length === 1 ? modules[0] : undefined;
			if (!header) return { ok: false, text: "Could not select a readable module header. Give module when the design has several modules." };
			if (header.name === "tb") return { ok: false, text: "The design module is named tb; use a different design module name." };
			const inputs = header.ports.filter(port => port.direction === "input");
			const clock = inputs.find(port => /^(?:clk|clock)|(?:clk|clock)$|^(?:clk|clock)_i$/i.test(port.name));
			const reset = inputs.find(port => /^(?:rst|reset)(?:n|_n)?(?:_i)?$/i.test(port.name));
			const low = reset && /^(?:rst|reset)_?n/i.test(reset.name);
			const lines = ["`timescale 1ns/1ps", "module tb;"];
			const needed = new Set(header.ports.flatMap(port => port.range.match(/[a-zA-Z_][\w$]*/g) ?? []));
			const parameters = header.parameters.map(value => ({ value, name: /([a-zA-Z_][\w$]*)\s*=/.exec(value)?.[1] ?? "" }));
			let previous = -1;
			while (previous !== needed.size) {
				previous = needed.size;
				for (const parameter of parameters) if (needed.has(parameter.name)) {
					for (const name of parameter.value.match(/[a-zA-Z_][\w$]*/g) ?? []) needed.add(name);
				}
			}
			for (const parameter of parameters) if (needed.has(parameter.name)) lines.push(`\tlocalparam ${parameter.value};`);
			for (const port of header.ports) lines.push(`\t${[port.direction === "input" ? "reg" : "wire", port.signed ? "signed" : "", port.range, port.name].filter(Boolean).join(" ")};`);
			lines.push("\tinteger errs, checks;", "");
			if (clock) lines.push(`\tinitial ${clock.name} = 0;`, `\talways #5 ${clock.name} = ~${clock.name};`, "");
			lines.push(`\t${header.name} dut (`);
			header.ports.forEach((port, index) => lines.push(`\t\t.${port.name}(${port.name})${index < header.ports.length - 1 ? "," : ""}`));
			lines.push("\t);", "", "\ttask tick;", "\t\tbegin", clock ? `\t\t\t@(negedge ${clock.name});` : "\t\t\t#10;", "\t\tend", "\tendtask", "");
			for (const [name, signed, format] of [["check", " signed", "d"], ["check_hex", "", "h"]]) {
				lines.push(`\ttask ${name};`, "\t\tinput [255:0] name;", `\t\tinput${signed} [63:0] got, wanted;`, "\t\tbegin", "\t\t\tchecks = checks + 1;", "\t\t\tif (got === wanted) $display(\"PASS %0s\", name);", "\t\t\telse begin", "\t\t\t\terrs = errs + 1;", `\t\t\t\t$display("FAIL %0s got %0${format} wanted %0${format}", name, got, wanted);`, "\t\t\tend", "\t\tend", "\tendtask", "");
			}
			lines.push("\tinitial begin", "\t\terrs = 0;", "\t\tchecks = 0;");
			for (const port of inputs) if (port !== clock) lines.push(`\t\t${port.name} = ${port === reset && !low ? 1 : 0};`);
			if (reset) lines.push("\t\trepeat (3) tick;", `\t\t${reset.name} = ${low ? 1 : 0};`);
			lines.push("", "\t\t// ---- CHECKS BEGIN: write stimulus and checks only between these two lines ----");
			const start = lines.length + 1;
			const input = inputs.find(port => port !== clock && port !== reset);
			const output = header.ports.find(port => port.direction === "output");
			if (input && output) {
				const range = /^\[\s*(\d+)\s*:\s*(\d+)\s*\]$/.exec(input.range);
				const value = range && input.signed ? `${Math.abs(Number(range[1]) - Number(range[2])) + 1}'sd100` : "100";
				lines.push(`\t\t// example: ${input.name} = ${value}; tick; tick; check("positive", ${output.name}, 100);`);
			} else lines.push("\t\t// Add stimulus and calls to check or check_hex here.");
			const end = lines.length;
			lines.push("\t\t// ---- CHECKS END ----", "", "\t\tif (checks == 0) $display(\"FAIL no checks ran\");", "\t\tif (errs == 0 && checks > 0) $display(\"ALL TESTS PASSED\");", "\t\telse $display(\"%0d TESTS FAILED\", errs);", "\t\t$finish;", "\tend", "", "\tinitial begin", "\t\t#2000000;", "\t\t$display(\"FAIL timeout\");", "\t\t$finish;", "\tend", "endmodule", "");
			await fs.mkdir(path.dirname(target.abs), { recursive: true });
			await fs.writeFile(target.abs, lines.join("\n"), { encoding: "utf8", flag: "wx" });
			return { ok: true, text: `Created ${target.rel}. Now add stimulus and checks with tb_checks (it fills the section at lines ${start}-${end}). Helpers: tick; waits one clock, check(\"name\", got, wanted); compares signed values, check_hex(\"name\", got, wanted); compares bus values.` };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, text: `${target.rel} already exists; edit the existing file instead.` };
			return { ok: false, text: `Could not create ${target.rel}: ${(error as Error).message}` };
		}
	},
};

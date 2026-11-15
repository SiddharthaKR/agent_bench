import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolOutput } from "../types.ts";
import { designHeaders, specHeaders, type InterfacePort } from "./interface.ts";

interface Register {
	address: number;
	width?: number;
	signed?: boolean;
	constant?: number;
}

function width(port: InterfacePort): number | undefined {
	if (!port.range) return 1;
	const range = /^\[([\d\s+-]+):([\d\s+-]+)\]$/.exec(port.range);
	if (!range) return undefined;
	const value = (text: string) => (text.replace(/\s/g, "").match(/[+-]?\d+/g) ?? []).reduce((sum, n) => sum + Number(n), 0);
	return Math.abs(value(range[1]!) - value(range[2]!)) + 1;
}

function registers(spec: string, busWidth: number, addressWidth: number): Register[] | undefined {
	const rows: Register[] = [];
	for (const line of spec.split(/\r?\n/)) {
		const cells = line.replaceAll("`", "").split("|").map(cell => cell.trim());
		if (!/^0x[\da-f]+$/i.test(cells[1] ?? "")) continue;
		const address = Number(cells[1]);
		if (address >= 2 ** addressWidth || rows.some(row => row.address === address)) return undefined;
		const format = cells[4] ?? "";
		const field = /^(\d+)-bit\s+(signed|unsigned)\b/i.exec(format);
		const constant = /^constant\s+(\d+)\s*$/i.exec(format);
		if (cells[3] === "R/W" && field && Number(field[1]) > 0 && Number(field[1]) <= busWidth
			&& new RegExp(field[2]!.toLowerCase() === "signed" ? "sign-extended" : "zero-extended", "i").test(format)) {
			rows.push({ address, width: Number(field[1]), signed: field[2]!.toLowerCase() === "signed" });
		} else if (cells[3] === "R" && constant && Number(constant[1]) < 2 ** busWidth) {
			rows.push({ address, constant: Number(constant[1]) });
		} else return undefined;
	}
	return rows.length > 0 && rows.length <= 32 && rows.some(row => row.width) ? rows : undefined;
}

/** A smoke test only for an explicitly specified one-cycle register bus. */
export async function checkRegisters(files: string[], ctx: ToolContext): Promise<ToolOutput | undefined> {
	if (!/(?:^|[\\/])iverilog(?:\.exe)?$/i.test(ctx.commands.compile[0] ?? "")) return undefined;
	for (const spec of ctx.specTexts?.values() ?? []) {
		if (!/ack\s*<=\s*wen\s*\|\s*ren/.test(spec) || !/one cycle of read latency/i.test(spec)
			|| !/Unknown addresses read 0/i.test(spec) || !/On reset, all registers are 0/i.test(spec)) continue;
		const expected = specHeaders(spec);
		if (expected.length !== 1) continue;
		const header = expected[0]!;
		const port = (name: string) => header.ports.find(p => p.name === name);
		const addr = port("addr"), data = port("rdata");
		const clock = header.ports.find(p => p.direction === "input" && /^(?:clk|clock)(?:_i)?$/.test(p.name));
		const reset = header.ports.find(p => p.direction === "input" && /^(?:rst|reset)(?:n|_n)?(?:_i)?$/.test(p.name));
		if (!addr || !data || !clock || !reset || width(clock) !== 1 || width(reset) !== 1
			|| !["addr", "wen", "ren", "wdata"].every(name => port(name)?.direction === "input")
			|| !["rdata", "ack"].every(name => port(name)?.direction === "output")
			|| ["wen", "ren", "ack"].some(name => width(port(name)!) !== 1)) continue;
		const busWidth = width(data), addressWidth = width(addr);
		if (!busWidth || busWidth > 32 || !addressWidth || addressWidth > 32 || width(port("wdata")!) !== busWidth) continue;
		if (header.ports.some(p => width(p) === undefined || p.direction === "inout")) continue;
		const rows = registers(spec, busWidth, addressWidth);
		if (!rows) continue;
		for (const file of files) {
			const source = await readFile(path.join(ctx.workspace, file), "utf8");
			if (!designHeaders(source)?.some(h => h.name === header.name)) continue;
			const temporary = await mkdtemp(path.join(ctx.workspace, ".build/register-check-"));
			try {
				const low = /^(?:rst|reset)_?n/.test(reset.name);
				const lines = ["`timescale 1ns/1ps", "module __register_check_tb;"];
				for (const p of header.ports) lines.push(`${p.direction === "input" ? "reg" : "wire"} [${width(p)! - 1}:0] ${p.name};`);
				lines.push("integer errors = 0;", `${header.name} dut (${header.ports.map(p => `.${p.name}(${p.name})`).join(",")});`,
					`always #5 ${clock.name} = ~${clock.name};`,
					`task read_check; input [${addressWidth - 1}:0] address; input [${busWidth - 1}:0] wanted; begin`,
					`@(negedge ${clock.name}); addr=address; wen=0; ren=1;`, `@(posedge ${clock.name}); #1;`,
					'if (ack !== 1\'b1 || rdata !== wanted) begin errors=errors+1; $display("Register check FAIL addr=%h got=%h expected=%h ack=%b", addr, rdata, wanted, ack); end',
					"end endtask", "initial begin");
				for (const p of header.ports.filter(p => p.direction === "input")) lines.push(`${p.name}=0;`);
				lines.push(`${reset.name}=${low ? 0 : 1};`, `repeat(3) @(negedge ${clock.name});`, `${reset.name}=${low ? 1 : 0};`);
				const hex = (n: bigint) => `${busWidth}'h${BigInt.asUintN(busWidth, n).toString(16)}`;
				for (const row of rows) lines.push(`read_check(${addressWidth}'d${row.address}, ${hex(BigInt(row.constant ?? 0))});`);
				for (const row of rows.filter(row => row.width)) {
					const bits = row.width!;
					for (const value of [0n, 1n, 1n << BigInt(bits - 1), (1n << BigInt(bits)) - 1n]) {
						const wanted = row.signed ? BigInt.asIntN(bits, value) : value;
						lines.push(`@(negedge ${clock.name}); addr=${addressWidth}'d${row.address}; wdata=${hex(value)}; wen=1; ren=0;`,
							`@(negedge ${clock.name}); wen=0;`, `read_check(${addressWidth}'d${row.address}, ${hex(wanted)});`);
					}
				}
				let unknown = 0;
				for (const row of rows.filter(row => row.constant !== undefined)) lines.push(`read_check(${addressWidth}'d${row.address}, ${hex(BigInt(row.constant!))});`);
				while (rows.some(row => row.address === unknown)) unknown++;
				if (unknown < 2 ** addressWidth) lines.push(`read_check(${addressWidth}'d${unknown}, ${busWidth}'d0);`);
				lines.push('if (errors == 0) $display("Register check PASS");', "$finish; end endmodule");
				const tb = path.join(temporary, "check.sv"), out = path.join(temporary, "check.out");
				await writeFile(tb, lines.join("\n"));
				const args = ctx.commands.compile.flatMap(part => part === "{files}" ? [file, tb] : [part.replaceAll("{out}", out)]);
				args.splice(1, 0, "-s", "__register_check_tb");
				const compiled = await ctx.exec(args[0]!, args.slice(1), { cwd: ctx.workspace, timeoutMs: 10000, signal: ctx.signal });
				if (compiled.code !== 0 || compiled.timedOut || compiled.notFound) return { ok: false, text: `Register check could not compile:\n${(compiled.stderr || compiled.stdout).slice(0, 1600)}` };
				const sim = ctx.commands.simulate.map(part => part.replaceAll("{out}", out));
				if (!sim.length) return { ok: false, text: "Register check needs a simulate command." };
				const result = await ctx.exec(sim[0]!, sim.slice(1), { cwd: ctx.workspace, timeoutMs: 10000, signal: ctx.signal });
				const output = `${result.stdout}\n${result.stderr}`;
				const failures = output.split(/\r?\n/).filter(line => line.startsWith("Register check FAIL"));
				const ok = result.code === 0 && !result.timedOut && !result.notFound && !failures.length && /^Register check PASS$/m.test(output);
				return { ok, text: ok ? "Register check PASS (visible spec; read-back smoke test only)." : `${failures.slice(0, 5).join("\n") || "Register check failed to finish."}\nHint: compare the whole read bus, sign-extend signed fields, and drive every read-data bit and ack.` };
			} finally { await rm(temporary, { recursive: true, force: true }); }
		}
	}
	return undefined;
}

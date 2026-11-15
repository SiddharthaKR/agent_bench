const IDENTIFIER = /[a-zA-Z_][\w$]*/g;

export interface LintFinding {
	line: number;
	rule: string;
	message: string;
	severity: "error" | "note";
}

function stripRtl(text: string): string {
	return text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, part => part.replace(/[^\n]/g, " "));
}

function assignments(text: string): { name: string; operator: string; index: number }[] {
	let clean = text;
	for (const match of text.matchAll(/\b(?:if|while|repeat|case|casex|casez)\s*\(/g)) {
		const end = closing(text, match.index + match[0].lastIndexOf("("));
		if (end >= 0) clean = clean.slice(0, match.index) + " ".repeat(end + 1 - match.index) + clean.slice(end + 1);
	}
	const found = [...clean.matchAll(/\b([a-zA-Z_][\w$]*)(?:\s*\[[^\]]*\])*\s*(<=|(?<![=!<>])=(?!=))/g)].map(m => ({ name: m[1]!, operator: m[2]!, index: m.index }));
	for (const m of clean.matchAll(/\{([^{}]+)\}\s*(<=|=(?!=))/g)) {
		for (const name of names(m[1]!)) found.push({ name, operator: m[2]!, index: m.index });
	}
	return found;
}

/** Text-only checks. Unrecognized control structures are left to external tools. */
export function qualityLint(text: string): LintFinding[] {
	const clean = stripRtl(text);
	const findings: LintFinding[] = [];
	const add = (rule: string, index: number, message: string, note = false): void => {
		const line = clean.slice(0, index).split("\n").length;
		if (!findings.some(f => f.rule === rule && f.line === line && f.message === message)) findings.push({ rule, line, message, severity: note ? "note" : "error" });
	};
	for (const module of clean.matchAll(/\bmodule\b[\s\S]*?\bendmodule\b/g)) {
		const source = module[0];
		const base = module.index;
		const headerEnd = source.indexOf(";");
		const header = source.slice(0, headerEnd);
		let open = header.indexOf("(");
		if (/#\s*$/.test(header.slice(0, open))) open = header.indexOf("(", closing(header, open) + 1);
		const design = open >= 0 && !!header.slice(open + 1, closing(header, open)).trim();
		const body = source.slice(headerEnd + 1);
		const resetPorts = new Set((header + " " + [...body.matchAll(/\binput\b[^;]*;/g)].map(m => m[0]).join(" ")).match(/\b(?:rst|rst_n|reset|resetn)\b/g) ?? []);
		const integers = new Set<string>();
		for (const decl of source.matchAll(/\b(?:integer|genvar)\s+([^;]+)/g)) for (const part of commaParts(decl[1]!)) {
			const name = /^\s*(\w+)/.exec(part)?.[1];
			if (name) integers.add(name);
		}
		const drivers = new Map<string, number>();
		const blocks = [...source.matchAll(/\balways(?:_comb|_ff|_latch)?\b/g)];
		for (let b = 0; b < blocks.length; b++) {
			const match = blocks[b]!;
			const end = blocks[b + 1]?.index ?? source.length;
			let segment = source.slice(match.index, end);
			const boundary = /\b(?:assign|initial|endmodule|function|task)\b/.exec(segment);
			if (boundary) segment = segment.slice(0, boundary.index);
			const event = /^always(?:_comb|_ff|_latch)?\s*(?:@\s*(?:\*|\([^)]*\)))?/.exec(segment)![0];
			const clocked = /always_ff|\b(?:posedge|negedge)\b/.test(event);
			const comb = /always_comb|@\s*(?:\*|\(\s*\*\s*\))/.test(event);
			if (!clocked && !comb && /@/.test(event)) add("sensitivity", base + match.index, "Use always @* or always_comb.");
			let content = segment.slice(event.length);
			if (/^\s*begin\b/.test(content)) {
				let depth = 0;
				for (const word of content.matchAll(/\bbegin\b|\bend\b/g)) {
					depth += word[0] === "begin" ? 1 : -1;
					if (depth === 0) { content = content.slice(0, word.index + word[0].length); break; }
				}
			} else if (!/^\s*(?:if|case[zx]?|for|while)\b/.test(content)) {
				content = content.slice(0, content.indexOf(";") + 1);
			}
			if (!/^\s*begin\b/.test(content)) {
				const declaration = /\b(?:wire|reg|logic|tri|parameter|localparam|input|output|inout)\b/.exec(content);
				if (declaration) content = content.slice(0, declaration.index);
			}
			const loopVariables = new Set([...content.matchAll(/\bfor\s*\(\s*(?:(?:integer|genvar)\s+)?([a-zA-Z_][\w$]*)\s*=/g)].map(m => m[1]!));
			const assigned = assignments(content).filter(a => !(integers.has(a.name) && loopVariables.has(a.name)));
			const locals = new Set<string>();
			for (const declaration of content.matchAll(/\b(?:reg|logic|integer)\s+([^;]+);/g)) {
				for (const part of commaParts(declaration[1]!)) {
					const name = names(part.split("=")[0]!.replace(/\b(?:signed|unsigned)\b/g, " "))[0];
					if (name) locals.add(name);
				}
			}
			for (const name of new Set(assigned.map(a => a.name))) {
				if (locals.has(name)) continue;
				if (drivers.has(name)) add("multi-driver", base + match.index, `${name} has more than one driver.`);
				drivers.set(name, match.index);
			}
			for (const a of assigned) {
				if (clocked && a.operator === "=") add("blocking-in-clocked", base + match.index + event.length + a.index, `Use <= for ${a.name} in a clocked block.`);
				if (comb && a.operator === "<=") add("nonblocking-in-comb", base + match.index + event.length + a.index, `Use = for ${a.name} in a combinational block.`);
			}
			if (clocked && resetPorts.size && assigned.some(a => /(?:_valid$|^valid|^state|_state$|cnt|count)/i.test(a.name))) {
				const conditions = [...content.matchAll(/\bif\s*\(/g)].map(m => content.slice(m.index, closing(content, m.index + m[0].lastIndexOf("(")) + 1));
				if (!conditions.some(c => [...resetPorts].some(r => new RegExp(`\\b${r}\\b`).test(c)))) add("no-reset", base + match.index, "Reset control registers in this block.", true);
			}
			if (comb) {
				// Only simple branch bodies are provable without a parser.
				const branch = /\bif\s*\([^()]*\)\s*(begin\b(?:(?!\bbegin\b|\bend\b)[\s\S])*?\bend\b|[^;]+;)(?:\s*else\s*(begin\b(?:(?!\bbegin\b|\bend\b)[\s\S])*?\bend\b|[^;]+;))?|\bcase[zx]?\s*\([^()]*\)(?:(?!\bcase[zx]?\b)[\s\S])*?\bendcase\b/g;
				for (const part of content.matchAll(branch)) {
					const prefix = content.slice(0, part.index).replace(/^\s*begin\b/, "");
					if (/\b(?:if|case|casez|casex|for|while)\b/.test(prefix)) continue;
					const defaults = new Set(assignments(prefix).filter(a => !content.slice(a.index, part.index).match(/\[[^\]]*\]\s*=/)).map(a => a.name));
					const suffix = content.slice(part.index + part[0].length).replace(/\bend\s*$/, "");
					if (!/\b(?:if|else|case[zx]?|for|while|begin|end)\b/.test(suffix)) {
						for (const a of assignments(suffix)) if (!new RegExp(`\\b${a.name}\\s*\\[`).test(suffix)) defaults.add(a.name);
					}
					const first = assignments(part[1] ?? part[0]);
					const second = assignments(part[2] ?? "");
					const otherwise = new Set(second.map(a => a.name));
					if (/^case/.test(part[0]) && /\bdefault\s*:/.test(part[0])) continue;
					for (const a of first) if (!defaults.has(a.name) && !otherwise.has(a.name)) add("latch", base + match.index + event.length + part.index, `${a.name} is missing an assignment on a branch.`);
					for (const a of second) if (!defaults.has(a.name) && !first.some(f => f.name === a.name)) add("latch", base + match.index + event.length + part.index, `${a.name} is missing an assignment on a branch.`);
				}
			}
		}
		for (const m of source.matchAll(/\bassign\s+([^;]+);/g)) for (const a of assignments(m[1]!)) {
			if (drivers.has(a.name)) add("multi-driver", base + m.index, `${a.name} has both continuous and procedural drivers.`);
		}
		if (design) {
			for (const m of source.matchAll(/#\s*\d+(?:\.\d+)?/g)) add("delay-in-design", base + m.index, "Remove delays from synthesizable RTL.");
			for (const m of source.matchAll(/\binitial\b/g)) add("initial-in-design", base + m.index, "Initial values depend on FPGA tool support.", true);
			for (const m of source.matchAll(/(?<![\w'])'[sS]?[hHdDbBoO][0-9a-fA-F_xXzZ?]+/g)) add("width-literal", base + m.index, "Give this based constant an explicit width.", true);
		}
		for (const hint of lintVerilog(source, Infinity)) {
			const rule = hint.startsWith("Hint: output") ? "undriven-output" : "unsigned-limit";
			const name = /^Hint: (?:output )?(\w+)/.exec(hint)?.[1];
			add(rule, base + (name ? source.search(new RegExp(`\\b${name}\\b`)) : 0), hint.replace(/^Hint: /, ""));
		}
	}
	return findings;
}

function closing(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		if (text[i] === "(") depth++;
		if (text[i] === ")" && --depth === 0) return i;
	}
	return -1;
}

function commaParts(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		if ("([{".includes(text[i] ?? " ")) depth++;
		if (")]}".includes(text[i] ?? " ")) depth--;
		if (text[i] === "," && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}

function names(text: string): string[] {
	return text.replace(/\[[^\]]*\]/g, " ").match(IDENTIFIER) ?? [];
}

/** Conservative checks: ambiguous uses count as drivers to avoid false hints. */
export function lintVerilog(text: string, maxHints = 3): string[] {
	const clean = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ");
	const hints: string[] = [];
	const arithmetic: string[] = [];
	for (const module of clean.matchAll(/\bmodule\b([\s\S]*?)\bendmodule\b/g)) {
		const source = module[1] ?? "";
		arithmetic.push(...unsignedLimits(source));
		const headerEnd = source.indexOf(";");
		if (headerEnd < 0) continue;
		const header = source.slice(0, headerEnd);
		let open = header.indexOf("(");
		if (/^[^()]*#\s*$/.test(header.slice(0, open))) {
			open = header.indexOf("(", closing(header, open) + 1);
		}
		if (open < 0) continue;
		const close = closing(header, open);
		if (close < 0 || !header.slice(open + 1, close).trim()) continue;

		const outputs = new Set<string>();
		const driven = new Set<string>();
		const assigned = new Set<string>();
		const collect = (declarations: string, ansi: boolean): void => {
			let output = !ansi;
			for (let part of commaParts(declarations)) {
				const direction = /^\s*(input|output|inout)\b/.exec(part);
				if (direction) output = direction[1] === "output";
				if (!output) continue;
				part = part.replace(/^\s*output\b/, "");
				const declaration = part.replace(/\[[^\]]*\]/g, " ").replace(/\b(?:reg|wire|logic|signed|unsigned|integer|tri|var)\b/g, " ");
				if (/^\s*[a-zA-Z_][\w$]*\s+[a-zA-Z_]/.test(declaration)) continue;
				const name = /^\s*([a-zA-Z_][\w$]*)/.exec(declaration)?.[1];
				if (!name) continue;
				outputs.add(name);
				if (/=(?!=)/.test(part)) assigned.add(name);
			}
		};
		collect(header.slice(open + 1, close), true);
		const body = source.slice(headerEnd + 1);
		for (const instance of body.matchAll(/\b([a-zA-Z_][\w$]*)\s+([a-zA-Z_][\w$]*)\s*\(/g)) {
			if (/^(?:if|else|begin|end|for|while|always|assign|function|task)$/.test(instance[1]!)) continue;
			const start = instance.index + instance[0].lastIndexOf("(");
			const end = closing(body, start);
			if (end < 0) continue;
			const connections = body.slice(start + 1, end);
			if (!connections.includes(".")) for (const name of names(connections)) driven.add(name);
		}
		for (const declaration of body.matchAll(/\boutput\b([^;]*);/g)) collect(declaration[1] ?? "", false);

		for (const connection of body.matchAll(/\.\s*[a-zA-Z_][\w$]*\s*\(/g)) {
			const start = (connection.index ?? 0) + connection[0].lastIndexOf("(");
			const end = closing(body, start);
			if (end >= 0) for (const name of names(body.slice(start + 1, end))) driven.add(name);
		}

		// Conditions contain comparisons, including <=, rather than assignment targets.
		let assignments = body;
		for (const loop of body.matchAll(/\bfor\s*\(/g)) {
			const start = loop.index;
			const open = start + loop[0].lastIndexOf("(");
			const end = closing(body, open);
			if (end < 0) continue;
			const clauses = body.slice(open + 1, end).split(";");
			if (clauses.length !== 3) continue;
			clauses[1] = " ".repeat(clauses[1]?.length ?? 0);
			assignments = assignments.slice(0, start) + " ".repeat(open + 1 - start) + clauses.join(";") + ";" + assignments.slice(end + 1);
		}
		const conditions = /\b(?:if|while|repeat|case|casex|casez)\s*\(/g;
		for (let condition = conditions.exec(assignments); condition; condition = conditions.exec(assignments)) {
			const start = condition.index;
			const end = closing(assignments, start + condition[0].lastIndexOf("("));
			if (end < 0) break;
			assignments = assignments.slice(0, start) + " ".repeat(end + 1 - start) + assignments.slice(end + 1);
		}
		for (const statement of assignments.split(";")) {
			const operator = /<=|(?<![=!<>])=(?!=)/.exec(statement);
			if (!operator) continue;
			const left = statement.slice(0, operator.index).trimEnd();
			if (left.endsWith("}")) {
				let depth = 0;
				for (let i = left.length - 1; i >= 0; i--) {
					if (left[i] === "}") depth++;
					if (left[i] === "{" && --depth === 0) {
						for (const name of names(left.slice(i))) assigned.add(name);
						break;
					}
				}
			} else {
				const name = /([a-zA-Z_][\w$]*)(?:\s*\[[^\]]*\])*\s*$/.exec(left)?.[1];
				if (name) assigned.add(name);
			}
		}
		for (const name of outputs) {
			if (driven.has(name) || assigned.has(name)) continue;
			let hint = `Hint: output ${name} is never assigned, so it reads x. Assign ${name} itself.`;
			const other = [...assigned].find((signal) => signal.startsWith(`${name}_`));
			if (other) hint += ` You assign ${other} instead; an output reg is already a register, so drop ${other} and assign ${name}.`;
			hints.push(hint);
			if (hints.length === maxHints) return hints;
		}
	}
	return [...hints, ...arithmetic].slice(0, maxHints);
}

function unsignedLimits(source: string): string[] {
	const signed = new Set<string>();
	for (const declaration of source.matchAll(/\b(?:input|output|inout|wire|reg)\s+(?:(?:wire|reg)\s+)?signed\s*(?:\[[^\]]*\]\s*)?([\w$]+(?:\s*,\s*[\w$]+)*)/g)) {
		for (const name of declaration[1]!.split(/\s*,\s*/)) signed.add(name);
	}
	const limits = new Set<string>();
	for (const declaration of source.matchAll(/\b(?:localparam|parameter)\b([^;)]*)/g)) {
		const parts = commaParts(declaration[1]!);
		const prefix = parts[0]?.split("=")[0] ?? "";
		if (/\bsigned\b/.test(prefix)) continue;
		for (const part of parts) {
			const match = /([a-zA-Z_][\w$]*)\s*=\s*(.*)/.exec(part);
			if (match && (/\[[^\]]*\]/.test(prefix) || /^\d+\s*'[bodh]/i.test(match[2]!))) limits.add(match[1]!);
		}
	}
	const conditions: string[] = [];
	for (const match of source.matchAll(/\bif\s*\(/g)) {
		const start = match.index + match[0].lastIndexOf("(");
		const end = closing(source, start);
		if (end >= 0) conditions.push(source.slice(start + 1, end));
	}
	for (const match of source.matchAll(/([^;?:]+)\?/g)) conditions.push(match[1]!);
	const found = new Set<string>();
	for (let condition of conditions) {
		let prior: string;
		do {
			prior = condition;
			condition = condition.replace(/(?<![\w$])\(\s*([a-zA-Z_][\w$]*)\s*\)/g, "$1");
		} while (condition !== prior);
		for (const match of condition.matchAll(/(?:^|[=(]|&&|\|\|)\s*([a-zA-Z_][\w$]*)\s*(<=|>=|<(?![<=])|>(?![>=]))\s*([a-zA-Z_][\w$]*)\s*(?=$|[)]|&&|\|\|)/g)) {
			const left = match[1]!;
			const right = match[3]!;
			if (limits.has(left) && signed.has(right)) found.add(left);
			if (limits.has(right) && signed.has(left)) found.add(right);
		}
	}
	return [...found].map((name) => `Hint: ${name} is unsigned, so the comparison with it is unsigned and wrong for negative values. Declare it as localparam signed [..] ${name}.`);
}

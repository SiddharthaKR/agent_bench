const IDENTIFIER = /[a-zA-Z_][\w$]*/g;

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
export function lintVerilog(text: string): string[] {
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
				const name = /^\s*([a-zA-Z_][\w$]*)/.exec(declaration)?.[1];
				if (!name) continue;
				outputs.add(name);
				if (/=(?!=)/.test(part)) assigned.add(name);
			}
		};
		collect(header.slice(open + 1, close), true);
		const body = source.slice(headerEnd + 1);
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
			if (hints.length === 3) return hints;
		}
	}
	return [...hints, ...arithmetic].slice(0, 3);
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

export interface InterfacePort {
	direction: "input" | "output" | "inout";
	name: string;
	signed: boolean;
	range: string;
}

export interface ModuleHeader {
	name: string;
	ports: InterfacePort[];
}

function clean(text: string): string {
	return text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, part => part.replace(/[^\n]/g, " "));
}

function closing(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		if (text[i] === "(") depth++;
		if (text[i] === ")" && --depth === 0) return i;
	}
	return -1;
}

function ports(text: string): InterfacePort[] | undefined {
	if (!text.trim()) return [];
	const result: InterfacePort[] = [];
	let state: Omit<InterfacePort, "name"> | undefined;
	for (const part of text.split(",")) {
		let rest = part.trim();
		const direction = /^(input|output|inout)\b/.exec(rest);
		if (direction) {
			rest = rest.slice(direction[0].length).replace(/\b(?:wire|reg|logic)\b/g, " ").trim();
			const sign = /^(signed|unsigned)\b/.exec(rest);
			if (sign) rest = rest.slice(sign[0].length).trim();
			const range = /^(\[[^\[\]]+:[^\[\]]+\](?:\s*\[[^\[\]]+:[^\[\]]+\])*)/.exec(rest);
			if (range) rest = rest.slice(range[0].length).trim();
			state = { direction: direction[1] as InterfacePort["direction"], signed: sign?.[1] === "signed", range: range?.[0] ?? "" };
		}
		if (!state || !/^[a-zA-Z_][\w$]*$/.test(rest) || result.some(port => port.name === rest)) return undefined;
		result.push({ ...state, name: rest });
	}
	return result;
}

function parameterDefaults(text: string): string[] {
	const declarations = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, part => part.startsWith('"') ? part : " ");
	const parameters: string[] = [];
	let start = 0;
	let depth = 0;
	let quoted = false;
	let type = "";
	for (let i = 0; i <= declarations.length; i++) {
		const char = declarations[i];
		if (char === '"' && declarations[i - 1] !== "\\") quoted = !quoted;
		if (quoted) continue;
		if (char && "([{".includes(char)) depth++;
		if (char && ")]}".includes(char)) depth--;
		if ((char === "," && depth === 0) || i === declarations.length) {
			let part = declarations.slice(start, i).trim();
			if (/^(?:parameter|localparam)\b/.test(part)) { part = part.replace(/^(?:parameter|localparam)\s*/, ""); type = ""; }
			const declaration = /^(.*?)\b([a-zA-Z_][\w$]*)\s*=([\s\S]+)$/.exec(part);
			if (declaration) {
				if (declaration[1]!.trim()) type = declaration[1]!.trim() + " ";
				parameters.push(`${type}${declaration[2]}=${declaration[3]!.trim()}`);
			}
			start = i + 1;
		}
	}
	return parameters;
}

function headers(text: string, bodyParameters = false): { name: string; ports: InterfacePort[] | undefined; parameters: string[] }[] | undefined {
	const source = clean(text);
	if (source.includes("/*") || source.includes("\"")) return undefined;
	const found: { name: string; ports: InterfacePort[] | undefined; parameters: string[] }[] = [];
	for (const match of source.matchAll(/\bmodule\s+(?:(?:automatic|static)\s+)?([a-zA-Z_][\w$]*)\b/g)) {
		let at = match.index + match[0].length;
		let parameters: string[] = [];
		const skip = () => { while (/\s/.test(source[at] ?? "") && at < source.length) at++; };
		skip();
		if (source[at] === "#") {
			at++;
			skip();
			const end = source[at] === "(" ? closing(source, at) : -1;
			if (end < 0) { found.push({ name: match[1]!, ports: undefined, parameters }); continue; }
			parameters = parameterDefaults(text.slice(at + 1, end));
			at = end + 1;
			skip();
		}
		const end = source[at] === "(" ? closing(source, at) : -1;
		const parsed = source[at] === ";" ? [] : end >= 0 && /^\s*;/.test(source.slice(end + 1)) ? ports(source.slice(at + 1, end)) : undefined;
		if (bodyParameters) {
			const bodyStart = source.indexOf(";", end >= 0 ? end : at) + 1;
			const bodyEnd = source.indexOf("endmodule", bodyStart);
			const body = source.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);
			for (const declaration of body.matchAll(/\b(?:parameter|localparam)\b[^;]*;/g)) {
				const start = bodyStart + declaration.index;
				parameters.push(...parameterDefaults(text.slice(start, start + declaration[0].length - 1)));
			}
		}
		found.push({ name: match[1]!, ports: parsed, parameters });
	}
	return found;
}

export function designHeaders(text: string): (ModuleHeader & { parameters: string[] })[] | undefined {
	const result = headers(text, true);
	if (!result || result.some(header => !header.ports)) return undefined;
	return result as (ModuleHeader & { parameters: string[] })[];
}

export function isTestbench(text: string): boolean {
	const modules = designHeaders(text);
	return !!modules?.length && modules.every(module => module.ports.length === 0);
}

/** Only fenced, confidently readable ANSI declarations are contracts. */
export function specHeaders(specText: string): ModuleHeader[] {
	const result: ModuleHeader[] = [];
	let fence: string | undefined;
	let block: string[] = [];
	for (const line of specText.split(/\r?\n/)) {
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (!fence) {
			if (marker) { fence = marker[1]!; block = []; }
		} else if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]!.trim()) {
			for (const header of headers(block.join("\n")) ?? []) if (header.ports) result.push({ name: header.name, ports: header.ports });
			fence = undefined;
		} else block.push(line);
	}
	return result;
}

// Evaluate a small integer grammar without executing source text.
function integer(text: string): bigint | undefined {
	const tokens = text.match(/\d+|<<<?|>>>?|\*\*|[()+\-*/%&|^~]/g) ?? [];
	if (tokens.join("") !== text || !tokens.length) return undefined;
	let at = 0;
	const precedence: Record<string, number> = { "|": 1, "^": 2, "&": 3, "<<": 4, ">>": 4, "<<<": 4, ">>>": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "**": 7 };
	function expression(min = 0): bigint {
		const token = tokens[at++];
		let value: bigint;
		if (token === "(") {
			value = expression();
			if (tokens[at++] !== ")") throw new Error("Unclosed expression");
		} else if (token === "+" || token === "-" || token === "~") {
			const operand = expression(8);
			value = token === "-" ? -operand : token === "~" ? ~operand : operand;
		} else if (token && /^\d+$/.test(token)) value = BigInt(token);
		else throw new Error("Expected integer");
		while (at < tokens.length) {
			const op = tokens[at]!;
			const rank = precedence[op];
			if (rank === undefined || rank < min) break;
			at++;
			const right = expression(rank + (op === "**" ? 0 : 1));
			if ((op === "**" || op.includes("<") || op.includes(">")) && (right < 0n || right > 1024n)) throw new Error("Large expression");
			switch (op) {
				case "+": value += right; break;
				case "-": value -= right; break;
				case "*": value *= right; break;
				case "/": value /= right; break;
				case "%": value %= right; break;
				case "**": value **= right; break;
				case "<<": case "<<<": value <<= right; break;
				case ">>": case ">>>": value >>= right; break;
				case "&": value &= right; break;
				case "|": value |= right; break;
				case "^": value ^= right; break;
			}
			if (value.toString(2).length > 4096) throw new Error("Large expression");
		}
		return value;
	}
	try {
		const value = expression();
		return at === tokens.length ? value : undefined;
	} catch { return undefined; }
}

function normalized(range: string): string {
	return range.replace(/\s/g, "").replace(/\[([^:]+):([^\]]+)\]/g, (_all, left: string, right: string) => `[${integer(left) ?? left}:${integer(right) ?? right}]`);
}

function description(port: InterfacePort): string {
	return [port.direction, port.signed ? "signed" : "", port.range.replace(/\s/g, "")].filter(Boolean).join(" ");
}

export function checkInterface(specText: string, designText: string): string[] {
	const design = headers(designText);
	if (!design || design.some(header => !header.ports) || new Set(design.map(header => header.name)).size !== design.length) return [];
	const hints: string[] = [];
	for (const expected of specHeaders(specText)) {
		const actual = design.find(header => header.name === expected.name);
		if (!actual) {
			hints.push(`Hint: the spec defines module ${expected.name}; this file defines ${design.map(header => header.name).join(", ") || "none"}. Use the name from the spec.`);
		} else {
			const missing = expected.ports.filter(port => !actual.ports!.some(other => other.name === port.name)).map(port => port.name);
			const extra = actual.ports!.filter(port => !expected.ports.some(other => other.name === port.name)).map(port => port.name);
			const different: string[] = [];
			for (const port of expected.ports) {
				const other = actual.ports!.find(other => other.name === port.name);
				if (other && (port.direction !== other.direction || port.signed !== other.signed || normalized(port.range) !== normalized(other.range))) different.push(`${port.name} (spec: ${description(port)}, file: ${description(other)})`);
			}
			const parts = [["Missing", missing], ["Extra", extra], ["Different", different]] as const;
			const details = parts.filter(([, items]) => items.length).map(([label, items]) => `${label}: ${items.join(", ")}.`);
			if (details.length) hints.push(`Hint: module ${expected.name} must keep the ports of the spec exactly. ${details.join(" ")}`);
		}
		if (hints.length === 2) break;
	}
	return hints;
}

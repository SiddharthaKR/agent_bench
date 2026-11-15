import type { ParsedCall, ParsedReply, ToolHelp } from "./types.ts";

/** Name used when a reply cannot be read as a tool call. */
export const INVALID_CALL = "invalid_call";

const FENCE = "```";

function isWord(s: string): boolean {
	if (s.length === 0) return false;
	for (const ch of s) {
		const ok =
			(ch >= "a" && ch <= "z") ||
			(ch >= "A" && ch <= "Z") ||
			(ch >= "0" && ch <= "9") ||
			ch === "_";
		if (!ok) return false;
	}
	return true;
}

/** Three backticks, optionally followed by a language word. */
function isFenceOpener(line: string): boolean {
	const t = line.trim();
	if (!t.startsWith(FENCE)) return false;
	const lang = t.slice(FENCE.length).trim();
	return lang === "" || isWord(lang) || /^[A-Za-z0-9_+#.-]+$/.test(lang);
}

function isFenceCloser(line: string): boolean {
	return line.trim() === FENCE;
}

/** True when the trimmed line is `@tool` followed by nothing, space, tab or colon. */
function isToolLine(line: string): boolean {
	const t = line.trim();
	if (!t.startsWith("@tool")) return false;
	const next = t.charAt(5);
	return next === "" || next === " " || next === "\t" || next === ":";
}

function cleanBody(lines: string[], ended: boolean): string {
	const out = [...lines];
	// Without @end the text usually stops right after a newline; that is the one trailing newline.
	if (!ended && out.length > 0 && out[out.length - 1] === "") out.pop();
	const last = out.length - 1;
	if (out.length >= 2 && isFenceOpener(out[0]!) && isFenceCloser(out[last]!)) {
		// The whole body was wrapped in a fence.
		out.pop();
		out.shift();
	} else if (out.length > 0 && isFenceCloser(out[last]!)) {
		// A stray closing fence left over when @end was cut off.
		out.pop();
	}
	// A --- left at the very end is the model repeating the separator, not file text.
	while (out.length > 0 && out[out.length - 1]!.trim() === "---") out.pop();
	return out.join("\n");
}

export function parseReply(text: string): ParsedReply {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const start = lines.findIndex(isToolLine);
	if (start === -1) return { kind: "final", text: lines.join("\n").trim() };

	const noteLines = lines.slice(0, start);
	while (noteLines.length > 0 && noteLines[noteLines.length - 1]!.trim() === "") noteLines.pop();
	if (noteLines.length > 0 && isFenceOpener(noteLines[noteLines.length - 1]!)) noteLines.pop();
	const notes = noteLines.join("\n").trim();

	let name = lines[start]!.trim().slice("@tool".length).trim();
	if (name.startsWith(":")) name = name.slice(1).trim();
	if (name === "") return { kind: "malformed", notes, problem: "The @tool line has no tool name." };
	if (!isWord(name)) {
		return {
			kind: "malformed",
			notes,
			problem: `"${name}" is not a valid tool name (use letters, digits and _).`,
		};
	}

	const args: Record<string, string> = {};
	let i = start + 1;
	let hasBody = false;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		const t = line.trim();
		if (t === "---") {
			hasBody = true;
			i++;
			break;
		}
		if (t === "@end") break;
		if (t === "") continue;
		const colon = line.indexOf(":");
		if (colon === -1) {
			return { kind: "malformed", notes, problem: `Line "${t}" is not "key: value".` };
		}
		const key = line.slice(0, colon).trim();
		if (!isWord(key)) {
			return { kind: "malformed", notes, problem: `"${key}" is not a valid argument name.` };
		}
		args[key] = line.slice(colon + 1).trim();
	}

	const call: ParsedCall = { name, args };
	if (hasBody) {
		const bodyLines: string[] = [];
		let ended = false;
		for (; i < lines.length; i++) {
			if (lines[i]!.trim() === "@end") {
				ended = true;
				break;
			}
			bodyLines.push(lines[i]!);
		}
		call.body = cleanBody(bodyLines, ended);
	}
	return { kind: "call", notes, call };
}

export function renderCall(call: ParsedCall): string {
	const out = [`@tool ${call.name}`];
	for (const [key, value] of Object.entries(call.args)) out.push(`${key}: ${value}`);
	if (call.body !== undefined) {
		out.push("---");
		out.push(call.body);
	}
	out.push("@end");
	return out.join("\n");
}

export function renderResult(name: string, ok: boolean, text: string): string {
	const head = `@result ${name} ${ok ? "ok" : "error"}`;
	const body = text.trimEnd();
	return body === "" ? head : `${head}\n${body}`;
}

export function renderToolHelp(tools: ToolHelp[]): string {
	// Small models copy the example they are shown, so the examples are real
	// calls built from this agent's own tools: one without text, one with.
	const example = (tool: ToolHelp): string[] => [
		`@tool ${tool.name}`,
		...tool.args.filter((arg) => arg.required).map((arg) => `${arg.name}: ${arg.type === "number" ? "1" : "notes.txt"}`),
	];
	const plain = tools.find((tool) => !tool.body);
	const withText = tools.find((tool) => tool.body);
	const out = ["To use a tool, reply with one block like the examples, then stop and wait for the result. One tool per reply."];
	if (plain) out.push("", ...example(plain), "@end");
	if (withText) {
		out.push("", "Only a tool that takes text has a --- line, with the text after it:");
		out.push(...example(withText), "---", "first line", "second line", "@end");
		out.push("", "The text after --- is saved exactly as written: no code fence, no escaping.");
	}
	out.push("When you are finished, reply with a short summary and no @tool block.", "", "Tools:");
	for (const tool of tools) {
		out.push(`- ${tool.name}: ${tool.summary}`);
		for (const arg of tool.args) {
			const req = arg.required ? "required" : "optional";
			const type = arg.type === "number" ? "number" : "text";
			out.push(`    ${arg.name} (${req}, ${type}): ${arg.help}`);
		}
		// Not written as "name: help", so the model does not mistake it for a key line.
		if (tool.body) out.push(`    then a --- line and ${tool.body.help}`);
	}
	return out.join("\n");
}

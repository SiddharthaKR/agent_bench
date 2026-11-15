import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { TraceDetail, TraceInfo, TraceRow } from "./shared/trace.ts";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";
const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

function inside(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function readTrace(runsDir: string, id: string): Promise<TraceDetail | null> {
	if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
	const root = path.resolve(runsDir);
	const dir = path.resolve(root, id);
	if (!inside(root, dir)) return null;
	let file: string;
	let startedAt: string;
	try {
		const actualRoot = await realpath(root);
		file = await realpath(path.join(dir, "trace.jsonl"));
		if (!inside(actualRoot, file)) return null;
		startedAt = (await stat(file)).mtime.toISOString();
	} catch { return null; }
	let summary: Record<string, unknown> = {};
	let hasSummary = false;
	try {
		const summaryPath = await realpath(path.join(dir, "summary.json"));
		if (inside(await realpath(root), summaryPath)) {
			summary = object(JSON.parse(await readFile(summaryPath, "utf8")));
			hasSummary = true;
		}
	} catch { /* A running trace has no summary. */ }
	const info: TraceInfo = { id, agent: string(summary.agent), model: string(summary.model), task: string(summary.task), startedAt, ended: hasSummary, modelCalls: 0, toolErrors: 0 };
	if (typeof summary.questions === "number") info.questions = number(summary.questions);
	if (typeof summary.unanswered === "number") info.unanswered = number(summary.unanswered);
	if (typeof summary.reason === "string") info.reason = summary.reason;
	const detail: TraceDetail = { info, contextTokens: 0, outputTokens: 0, elapsedMs: 0, rows: [] };
	let firstTime: number | undefined;
	let lastTime: number | undefined;
	let call = 0;
	let lines = 0;
	const input = createReadStream(file, { encoding: "utf8" });
	const reader = createInterface({ input, crlfDelay: Infinity });
	try {
		const iterator = reader[Symbol.asyncIterator]();
		while (lines < 20_000) {
			const next = await iterator.next();
			if (next.done) break;
			const line = next.value;
			lines++;
			let event: Record<string, unknown>;
			try { event = object(JSON.parse(line)); } catch { continue; }
			const time = Date.parse(string(event.t));
			if (Number.isFinite(time)) {
				if (firstTime === undefined) { firstTime = time; info.startedAt = string(event.t); }
				lastTime = time;
			}
			const add = (kind: TraceRow["kind"], direction: TraceRow["direction"], text: string, raw: unknown = event) => {
				let meta = `call #${call} · ${kind} · ${text.length} chars`;
				if (direction === "received") meta += ` · ${number(event.promptTokens)} tokens context`;
				if (typeof event.ms === "number" && Number.isFinite(event.ms)) meta += ` · ${event.ms} ms`;
				detail.rows.push({ id: `${lines}-${detail.rows.length}`, call, direction, kind, title: (text.split(/\r?\n/).find((part) => part.trim()) ?? "").trim().slice(0, 140), text, meta, raw });
				if (kind === "tool error") info.toolErrors++;
			};
			switch (event.type) {
				case "run_start":
					info.agent = string(event.agent) || info.agent;
					info.model = string(event.model) || info.model;
					info.task = string(event.task) || info.task;
					break;
				case "request":
					call = number(event.request);
					info.modelCalls++;
					for (const entry of Array.isArray(event.newMessages) ? event.newMessages : []) {
						const message = object(entry);
						const text = string(message.content);
						if (message.role !== "system" && message.role !== "user") continue;
						const kind = message.role === "system" ? "system" : text.startsWith("@result ") ? ((text.split(/\r?\n/)[0] ?? "").endsWith(" error") ? "tool error" : "tool result") : "user";
						add(kind, "sent", text, { request: call, role: message.role, content: text });
					}
					break;
				case "response":
					call = number(event.request) || call;
					detail.contextTokens = number(event.promptTokens);
					detail.outputTokens += number(event.outputTokens);
					if (string(event.reasoning).trim()) add("thinking", "received", string(event.reasoning));
					add(event.kind === "call" ? "tool call" : ["malformed", "invalid", "empty"].includes(string(event.kind)) ? "bad tool call" : "reply", "received", string(event.text));
					break;
				case "question": add("question", "received", [string(event.question), event.assumption ? `Assumption: ${string(event.assumption)}` : "", event.answer === null ? "Unanswered" : `Answer: ${string(event.answer)}`, `Waited ${number(event.seconds)} s`].filter(Boolean).join("\n")); break;
				case "guard": add("guard", "sent", string(event.reason)); break;
				case "model_error":
					call = number(event.request) || call;
					add("error", "received", string(event.error) || string(event.reason));
					break;
				case "run_end":
					info.ended = true;
					if (typeof event.reason === "string") info.reason = event.reason;
					break;
			}
		}
	} finally { reader.close(); input.destroy(); }
	detail.elapsedMs = Math.max(0, (lastTime ?? 0) - (firstTime ?? 0));
	return detail;
}

export async function listTraces(runsDir: string): Promise<TraceInfo[]> {
	let entries;
	try { entries = await readdir(runsDir, { withFileTypes: true }); } catch { return []; }
	const traces: TraceInfo[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const detail = await readTrace(runsDir, entry.name);
		if (detail) traces.push(detail.info);
	}
	return traces.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id)).slice(0, 200);
}

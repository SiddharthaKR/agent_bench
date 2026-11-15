import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTraces, readTrace } from "../src/traces.ts";
import { createAppServer } from "../src/server/http.ts";
import type { Engine } from "../src/shared/engine.ts";

let root: string;
let server: Server | undefined;

beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "traces-test-")); });
afterEach(async () => {
	if (server) {
		const closing = server;
		await new Promise<void>((resolve, reject) => {
			closing.close((error) => error ? reject(error) : resolve());
			closing.closeAllConnections();
		});
		server = undefined;
	}
	const target = path.resolve(root);
	if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("traces-test-")) throw new Error("Unexpected test directory.");
	await rm(target, { recursive: true, force: true });
});

async function trace(id: string, events: unknown[], base = root) {
	const dir = path.join(base, id);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "trace.jsonl"), events.map((event, n) => JSON.stringify({ n: n + 1, t: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), ...event as object })).join("\n") + "\n");
	return dir;
}

describe("trace reader", () => {
	it("maps all event kinds in order, preserving text and raw data", async () => {
		const request = { type: "request", request: 1, newMessages: [{ role: "system", content: "\nSystem prompt" }, { role: "user", content: "Task" }, { role: "assistant", content: "Already shown" }] };
		await trace("run", [
			{ type: "run_start", agent: "Coder", model: "local", task: "Build", systemPrompt: "Do not duplicate" },
			request,
			{ type: "response", request: 1, kind: "call", text: "@tool read", reasoning: "Think", promptTokens: 1000, outputTokens: 10, ms: 25 },
			{ type: "tool_call", tool: "read" },
			{ type: "tool_result", tool: "read", text: "Do not duplicate" },
			{ type: "guard", reason: "Blocked" },
			{ type: "request", request: 2, newMessages: [{ role: "user", content: "@result read ok\nDone" }, { role: "user", content: "@result write error\r\nDenied" }] },
			{ type: "response", request: 2, kind: "malformed", text: "Bad", promptTokens: 1500, outputTokens: 20 },
			{ type: "response", request: 2, kind: "invalid", text: "Unknown tool" },
			{ type: "response", request: 2, kind: "empty", text: "" },
			{ type: "model_error", request: 3, reason: "error", error: "Offline" },
			{ type: "response", request: 3, kind: "final", text: "x".repeat(150), promptTokens: 2000, outputTokens: 30 },
			{ type: "run_end", reason: "done" },
		]);
		const detail = (await readTrace(root, "run"))!;
		expect(detail.rows.map((row) => row.kind)).toEqual(["system", "user", "thinking", "tool call", "guard", "tool result", "tool error", "bad tool call", "bad tool call", "bad tool call", "error", "reply"]);
		expect(detail.rows.map((row) => row.call)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3]);
		expect(detail.rows.map((row) => row.direction)).toEqual(["sent", "sent", "received", "received", "sent", "sent", "sent", "received", "received", "received", "received", "received"]);
		expect(detail.rows[0]).toMatchObject({ text: "\nSystem prompt", title: "System prompt", raw: { request: 1, role: "system", content: "\nSystem prompt" }, meta: "call #1 · system · 14 chars" });
		expect(detail.rows[2]?.meta).toBe("call #1 · thinking · 5 chars · 1000 tokens context · 25 ms");
		expect(detail.rows[3]?.raw).toMatchObject({ type: "response", kind: "call" });
		expect(detail.rows.at(-1)?.title).toHaveLength(140);
		expect(new Set(detail.rows.map((row) => row.id)).size).toBe(detail.rows.length);
		expect(detail).toMatchObject({ contextTokens: 2000, outputTokens: 60, elapsedMs: 12000, info: { id: "run", agent: "Coder", model: "local", task: "Build", ended: true, reason: "done", modelCalls: 2, toolErrors: 1 } });
	});

	it("tolerates junk lines, unknown types, missing fields and malformed summaries", async () => {
		const dir = await trace("junk", []);
		await writeFile(path.join(dir, "summary.json"), "{bad");
		await writeFile(path.join(dir, "trace.jsonl"), 'junk\nnull\n[]\n42\n{"type":"future"}\n{"type":"request","newMessages":[null,{}, {"role":"user"}]}\n{"type":"response"}\n{"type":"guard"}\n{"type":"model_error"}\n{"type":"request","newMessages":{}}\n{"unfinished":');
		const detail = (await readTrace(root, "junk"))!;
		expect(detail.rows.map((row) => row.kind)).toEqual(["user", "reply", "guard", "error"]);
		expect(detail).toMatchObject({ contextTokens: 0, outputTokens: 0, elapsedMs: 0, info: { ended: false } });
	});

	it("lists newest first, skips folders without traces, and reads summaries", async () => {
		await trace("older", [{ type: "run_start", t: "2025-01-01T00:00:00Z" }]);
		const dir = await trace("newer", [{ type: "run_start", t: "2026-01-01T00:00:00Z" }]);
		await writeFile(path.join(dir, "summary.json"), JSON.stringify({ agent: "Coder", model: "local", task: "Build", reason: "done" }));
		await mkdir(path.join(root, "empty"));
		await writeFile(path.join(root, "file"), "x");
		const list = await listTraces(root);
		expect(list.map((info) => info.id)).toEqual(["newer", "older"]);
		expect(list[0]).toMatchObject({ ended: true, reason: "done", agent: "Coder", task: "Build" });
		expect(await listTraces(path.join(root, "missing"))).toEqual([]);
	});

	it("limits lists to 200 runs and reads only the first 20000 physical lines", async () => {
		for (let i = 0; i < 201; i++) await trace(`run-${i}`, [{ t: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }]);
		const list = await listTraces(root);
		expect(list).toHaveLength(200);
		expect(list[0]?.id).toBe("run-200");
		expect(list.some((info) => info.id === "run-0")).toBe(false);
		const dir = await trace("limit", []);
		await writeFile(path.join(dir, "trace.jsonl"), "junk\n".repeat(19999) + '{"type":"guard","reason":"Visible"}\n{"type":"guard","reason":"Hidden"}\n');
		expect((await readTrace(root, "limit"))?.rows.map((row) => row.text)).toEqual(["Visible"]);
	}, 30_000);

	it("rejects invalid ids, traversal and links outside the runs directory", async () => {
		await trace("valid._-1", []);
		expect(await readTrace(root, "valid._-1")).not.toBeNull();
		for (const id of ["", ".", "..", "../escape", "..\\escape", "/absolute", "a b", "a%2fb", "a:b"]) expect(await readTrace(root, id)).toBeNull();
		const runs = path.join(root, "runs");
		await mkdir(runs);
		await symlink(path.join(root, "valid._-1"), path.join(runs, "link"), "junction");
		expect(await readTrace(runs, "link")).toBeNull();
		expect(await readTrace(root, "missing")).toBeNull();
	});
});

it("serves both trace routes, searches directories in order, and returns JSON errors", async () => {
	const first = path.join(root, "first");
	const second = path.join(root, "second");
	await trace("same", [{ type: "run_start", agent: "First" }], first);
	await trace("same", [{ type: "run_start", agent: "Second" }], second);
	await trace("other", [{ type: "run_start", agent: "Other", t: "2027-01-01T00:00:00Z" }], second);
	server = createAppServer({} as Engine, { runsDirs: [path.join(root, "missing"), first, second] });
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address.");
	const base = `http://127.0.0.1:${address.port}`;
	const list = await fetch(base + "/api/traces");
	expect(list.status).toBe(200);
	expect((await list.json() as { id: string; agent: string }[]).map((info) => [info.id, info.agent])).toEqual([["other", "Other"], ["same", "First"]]);
	expect(await (await fetch(base + "/api/traces/same")).json()).toMatchObject({ info: { agent: "First" }, rows: [] });
	expect(await (await fetch(base + "/api/traces/other")).json()).toMatchObject({ info: { agent: "Other" } });
	for (const id of ["missing", "bad%20id", "%2e%2e%5cescape"]) {
		const response = await fetch(base + `/api/traces/${id}`);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "No such trace." });
	}
	for (const route of ["/api/traces", "/api/traces/same"]) expect((await fetch(base + route, { method: "POST" })).status).toBe(405);
});

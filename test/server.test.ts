import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { request } from "node:http";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Engine, Session, WorkflowRun } from "../src/shared/engine.ts";
import type { SessionEvent, WorkflowEvent, Workflow, TreeNode } from "../src/shared/api.ts";
import { createAppServer } from "../src/server/http.ts";

const workflow: Workflow = { id: "build", name: "Build", task: "Compile", vars: {}, steps: [] };
const sessionRequest = { agent: "coder", folder: "project", server: "local", askFirst: true };
const runRequest = { workflow, folder: "project", server: "local", task: "Compile" };

function fakeEngine() {
	const sessionListeners = new Set<(event: SessionEvent) => void>();
	const runListeners = new Set<(event: WorkflowEvent) => void>();
	const session: Session = {
		id: "session-1", events: [{ type: "status", state: "idle" }],
		subscribe(listener) { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; },
		send: vi.fn(), stop: vi.fn(), resolve: vi.fn(), setAskFirst: vi.fn(),
	};
	const run: WorkflowRun = {
		id: "run-1", events: [{ type: "line", stepId: "compile", text: "Started" }],
		state: { status: "idle", round: 1, current: null, steps: [], log: [] },
		subscribe(listener) { runListeners.add(listener); return () => { runListeners.delete(listener); }; },
		start: vi.fn(), resume: vi.fn(), stop: vi.fn(),
	};
	const engine = {
		config: vi.fn(async () => ({ agents: [], servers: [], defaultFolder: "project" })),
		createSession: vi.fn(async () => session),
		listWorkflows: vi.fn(async () => [workflow]),
		saveWorkflow: vi.fn(async (_value: Workflow) => {}),
		deleteWorkflow: vi.fn(async (_id: string) => {}),
		createWorkflowRun: vi.fn(async () => run),
	} satisfies Engine;
	return { engine, session, run, sessionListeners, runListeners };
}

let server: Server;
let base: string;
let folder: string;
let fake: ReturnType<typeof fakeEngine>;

beforeEach(async () => {
	folder = await fs.mkdtemp(path.join(os.tmpdir(), "server-test-"));
	fake = fakeEngine();
	server = createAppServer(fake.engine, { webDir: path.join(folder, "web"), runsDirs: [folder, path.join(folder, "ignored")], allowedHosts: ["172.20.1.126"] });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address.");
	base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
	vi.useRealTimers();
	await new Promise<void>((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
		server.closeAllConnections();
	});
	await fs.rm(folder, { recursive: true, force: true });
});

function json(url: string, method: string, body?: unknown) {
	return fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

function fileUrl(file: string) {
	return `/api/file?${new URLSearchParams({ folder, path: file })}`;
}

async function expectError(response: Response, status: number, message?: string) {
	expect(response.status).toBe(status);
	const body = await response.json();
	if (message) expect(body).toEqual({ error: message });
	else expect(body).toEqual({ error: expect.any(String) });
}

async function rawGet(url: string, host?: string, endpoint = base) {
	return new Promise<{ status: number; text: string }>((resolve, reject) => {
		const req = request(endpoint, { path: url, headers: host ? { host } : undefined }, (res) => {
			let text = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => { text += chunk; });
			res.on("end", () => resolve({ status: res.statusCode!, text }));
		});
		req.on("error", reject);
		req.end();
	});
}

describe("local HTTP server", () => {
	it("accepts an allowed host but rejects a different Origin", async () => {
		expect((await rawGet("/api/config", "172.20.1.126:4600")).status).toBe(200);
		expect((await fetch(base + "/api/config", { headers: { Origin: "http://172.20.1.126:4600" } })).status).toBe(200);
		expect((await fetch(base + "/api/config", { headers: { Origin: "http://other.example:4600" } })).status).toBe(403);
		for (const host of ["172.20.1.126.evil", "172.20.1.126@evil", "172.20.1.126/path"]) expect((await rawGet("/api/config", host)).status).toBe(403);
	});

	it("keeps default hosts strict", async () => {
		const strict = createAppServer(fake.engine);
		await new Promise<void>((resolve) => strict.listen(0, "127.0.0.1", resolve));
		try {
			const address = strict.address();
			if (!address || typeof address === "string") throw new Error("Missing address.");
			expect((await rawGet("/api/config", "172.20.1.126:4600", `http://127.0.0.1:${address.port}`)).status).toBe(403);
			for (const host of ["127.1", "2130706433", "0x7f000001"]) expect((await rawGet("/api/config", host, `http://127.0.0.1:${address.port}`)).status).toBe(403);
		} finally { await new Promise<void>((resolve) => { strict.close(() => resolve()); strict.closeAllConnections(); }); }
	});

	it("reads scored results only from the first runs folder", async () => {
		expect(await (await fetch(base + "/api/results")).json()).toEqual([]);
		const row = { when: "2026-11-15T00:00:00Z", suite: "H", level: "medium", server: "local", model: "m", setup: "agent", pass: true, verdict: "PASS", toolCalls: 12, seconds: 41, trace: null };
		await fs.mkdir(path.join(folder, "ignored"));
		await fs.writeFile(path.join(folder, "ignored", "results.jsonl"), JSON.stringify({ ...row, model: "ignored" }) + "\n");
		await fs.writeFile(path.join(folder, "results.jsonl"), JSON.stringify(row) + "\nbroken\n");
		expect(await (await fetch(base + "/api/results")).json()).toEqual([row]);
		await expectError(await json("/api/results", "POST"), 405);
	});
	it("returns config and contains unexpected engine exceptions", async () => {
		expect(await (await fetch(base + "/api/config")).json()).toEqual({ agents: [], servers: [], defaultFolder: "project" });
		fake.engine.config.mockRejectedValueOnce(new Error("Config unavailable."));
		await expectError(await fetch(base + "/api/config"), 500, "Config unavailable.");
		expect((await fetch(base + "/api/config")).status).toBe(200);
	});

	it("lists folders first, sorts names, skips excluded entries and nests children", async () => {
		for (const name of ["zDir", "Alpha", ".git", "node_modules", ".build", "runs", "__pycache__", "dist"]) {
			await fs.mkdir(path.join(folder, name));
		}
		await fs.writeFile(path.join(folder, "z.txt"), "z");
		await fs.writeFile(path.join(folder, "A.txt"), "a");
		await fs.writeFile(path.join(folder, "Alpha", "nested.txt"), "nested");
		expect(await (await fetch(base + `/api/tree?${new URLSearchParams({ folder })}`)).json()).toEqual([
			{ name: "Alpha", path: "Alpha", children: [{ name: "nested.txt", path: "Alpha/nested.txt" }] },
			{ name: "zDir", path: "zDir", children: [] },
			{ name: "A.txt", path: "A.txt" }, { name: "z.txt", path: "z.txt" },
		]);
	});

	it("rejects missing, relative, nonexistent and non-directory tree folders", async () => {
		await fs.writeFile(path.join(folder, "file"), "x");
		for (const value of ["", "relative", path.join(folder, "missing"), path.join(folder, "file")]) {
			await expectError(await fetch(base + `/api/tree?${new URLSearchParams({ folder: value })}`), 400);
		}
	});

	it("limits tree depth to eight levels", async () => {
		await fs.mkdir(path.join(folder, ...Array<string>(10).fill("nested")), { recursive: true });
		const tree = await (await fetch(base + `/api/tree?${new URLSearchParams({ folder })}`)).json() as TreeNode[];
		let nodes = tree;
		for (let i = 0; i < 8; i++) { expect(nodes).toHaveLength(1); nodes = nodes[0]!.children!; }
		expect(nodes).toEqual([]);
	});

	it("stops the tree after 5000 entries", async () => {
		for (let offset = 0; offset < 5001; offset += 100) {
			await Promise.all(Array.from({ length: Math.min(100, 5001 - offset) }, (_, i) => fs.writeFile(path.join(folder, `${offset + i}.txt`), "")));
		}
		expect(await (await fetch(base + `/api/tree?${new URLSearchParams({ folder })}`)).json()).toHaveLength(5000);
	});

	it("does not follow symbolic links in trees or outside the static root", async () => {
		const project = path.join(folder, "project");
		const outside = path.join(folder, "outside");
		await fs.mkdir(project);
		await fs.mkdir(outside);
		await fs.mkdir(path.join(folder, "web"));
		await fs.writeFile(path.join(outside, "secret.txt"), "secret");
		await fs.symlink(outside, path.join(project, "link"), "junction");
		await fs.symlink(outside, path.join(folder, "web", "link"), "junction");
		expect(await (await fetch(base + `/api/tree?${new URLSearchParams({ folder: project })}`)).json()).toEqual([]);
		expect((await fetch(base + "/link/secret.txt")).status).toBe(404);
	});

	it("reads text with CRLF normalized and rejects missing, escaping, binary and large files", async () => {
		await fs.writeFile(path.join(folder, "text.txt"), "one\r\ntwo\r\n");
		await fs.writeFile(path.join(folder, "binary"), Buffer.from([65, 0, 66]));
		await fs.writeFile(path.join(folder, "large"), "x".repeat(2 * 1024 * 1024 + 1));
		expect(await (await fetch(base + fileUrl("text.txt"))).json()).toEqual({ text: "one\ntwo\n" });
		await expectError(await fetch(base + fileUrl("missing.txt")), 404, "File not found: missing.txt");
		await expectError(await fetch(base + fileUrl("../escape")), 400);
		for (const name of ["binary", "large"]) {
			await expectError(await fetch(base + fileUrl(name)), 400, `${name} is not a text file the editor can open.`);
		}
	});

	it("writes text unchanged and creates parent folders", async () => {
		expect(await (await json("/api/file", "PUT", { folder, path: "new/deep/file.txt", text: "one\r\ntwo" })).json()).toEqual({ ok: true });
		expect(await fs.readFile(path.join(folder, "new/deep/file.txt"), "utf8")).toBe("one\r\ntwo");
		await expectError(await json("/api/file", "PUT", { folder, path: "../escape", text: "bad" }), 400);
	});

	it("creates sessions and validates required fields before calling the engine", async () => {
		for (const invalid of [null, {}, { ...sessionRequest, agent: " " }, { ...sessionRequest, folder: "" }, { ...sessionRequest, server: 1 }, { ...sessionRequest, askFirst: "yes" }]) {
			await expectError(await json("/api/sessions", "POST", invalid), 400);
		}
		expect(fake.engine.createSession).not.toHaveBeenCalled();
		expect(await (await json("/api/sessions", "POST", sessionRequest)).json()).toEqual({ id: "session-1" });
		expect(fake.engine.createSession).toHaveBeenCalledWith(sessionRequest);
		fake.engine.createSession.mockRejectedValueOnce(new Error("No such agent."));
		await expectError(await json("/api/sessions", "POST", sessionRequest), 400, "No such agent.");
	});

	it("dispatches session actions and rejects unknown session ids", async () => {
		await json("/api/sessions", "POST", sessionRequest);
		for (const [action, body] of [["message", { text: "Hello" }], ["stop", undefined], ["resolve", { proposalId: "proposal", accept: true }], ["ask-first", { askFirst: false }]] as const) {
			expect(await (await json(`/api/sessions/session-1/${action}`, "POST", body)).json()).toEqual({ ok: true });
			await expectError(await json(`/api/sessions/missing/${action}`, "POST", body), 404, "No such session.");
		}
		expect(fake.session.send).toHaveBeenCalledWith("Hello");
		expect(fake.session.stop).toHaveBeenCalledOnce();
		expect(fake.session.resolve).toHaveBeenCalledWith("proposal", true);
		expect(fake.session.setAskFirst).toHaveBeenCalledWith(false);
		await expectError(await fetch(base + "/api/sessions/missing/events"), 404, "No such session.");
	});

	it("lists, saves and deletes workflows and rejects mismatched or invalid ids", async () => {
		expect(await (await fetch(base + "/api/workflows")).json()).toEqual([workflow]);
		expect(await (await json("/api/workflows/build", "PUT", workflow)).json()).toEqual({ ok: true });
		expect(fake.engine.saveWorkflow).toHaveBeenCalledWith(workflow);
		await expectError(await json("/api/workflows/other", "PUT", workflow), 400);
		for (const id of ["Bad", "-bad", "a".repeat(65)]) {
			await expectError(await json(`/api/workflows/${id}`, "PUT", { ...workflow, id }), 400);
			await expectError(await json(`/api/workflows/${id}`, "DELETE"), 400);
		}
		expect(await (await json("/api/workflows/build", "DELETE")).json()).toEqual({ ok: true });
		expect(fake.engine.deleteWorkflow).toHaveBeenCalledWith("build");
	});

	it("creates and starts runs, resumes from a step and stops", async () => {
		expect(await (await json("/api/runs", "POST", runRequest)).json()).toEqual({ id: "run-1" });
		expect(fake.engine.createWorkflowRun).toHaveBeenCalledWith(runRequest);
		expect(fake.run.start).toHaveBeenCalledOnce();
		expect(await (await json("/api/runs/run-1/resume", "POST", { fromStepId: "compile" })).json()).toEqual({ ok: true });
		expect(fake.run.resume).toHaveBeenCalledWith("compile");
		expect(await (await json("/api/runs/run-1/stop", "POST")).json()).toEqual({ ok: true });
		expect(fake.run.stop).toHaveBeenCalledOnce();
		for (const action of ["resume", "stop", "events"]) {
			await expectError(await json(`/api/runs/missing/${action}`, action === "events" ? "GET" : "POST", action === "resume" ? {} : undefined), 404, "No such run.");
		}
	});

	it.each(["sessions", "runs"] as const)("replays %s events, streams new ones and unsubscribes on close", async (kind) => {
		await json(`/api/${kind}`, "POST", kind === "sessions" ? sessionRequest : runRequest);
		const target = kind === "sessions" ? fake.session : fake.run;
		const listeners = kind === "sessions" ? fake.sessionListeners : fake.runListeners;
		const response = await fetch(base + `/api/${kind}/${target.id}/events`);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("connection")).toBe("keep-alive");
		const reader = response.body!.getReader();
		let pending = "";
		async function nextEvent() {
			while (!pending.includes("\n\n")) {
				const chunk = await reader.read();
				if (chunk.done) throw new Error("Event stream closed.");
				pending += new TextDecoder().decode(chunk.value);
			}
			const end = pending.indexOf("\n\n");
			const frame = pending.slice(0, end);
			pending = pending.slice(end + 2);
			return JSON.parse(frame.slice("data: ".length));
		}
		expect(await nextEvent()).toEqual(target.events[0]);
		if (kind === "sessions") {
			const event: SessionEvent = { type: "stream", kind: "text", delta: "Hello" };
			for (const listener of fake.sessionListeners) listener(event);
			expect(await nextEvent()).toEqual(event);
		} else {
			const event: WorkflowEvent = { type: "line", stepId: "compile", text: "Done" };
			for (const listener of fake.runListeners) listener(event);
			expect(await nextEvent()).toEqual(event);
		}
		await reader.cancel();
		await vi.waitFor(() => expect(listeners.size).toBe(0));
	});

	it("blocks foreign origins and hosts and accepts local origins", async () => {
		await expectError(await fetch(base + "/api/config", { headers: { origin: "https://example.com" } }), 403, "Requests from other sites are not allowed.");
		for (const origin of ["null", "broken", "http://localhost.evil.com"]) {
			await expectError(await fetch(base + "/api/config", { headers: { origin } }), 403);
		}
		for (const origin of ["http://localhost:1234", "http://127.0.0.1", "http://[::1]:4567"]) {
			expect((await fetch(base + "/api/config", { headers: { origin } })).status).toBe(200);
		}
		for (const host of ["example.com", "localhost.evil.com", "localhost@evil.com"]) {
			expect((await rawGet("/api/config", host)).status).toBe(403);
		}
		expect((await rawGet("/api/config", "[::1]:1234")).status).toBe(200);
	});

	it("sends an SSE heartbeat every 25 seconds and clears its timer on close", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		await json("/api/sessions", "POST", sessionRequest);
		const response = await fetch(base + "/api/sessions/session-1/events");
		const reader = response.body!.getReader();
		await reader.read();
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(25_000);
		expect(new TextDecoder().decode((await reader.read()).value)).toBe(": ping\n\n");
		await reader.cancel();
		await vi.waitFor(() => expect(fake.sessionListeners.size).toBe(0));
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects oversized bodies and malformed JSON", async () => {
		await expectError(await fetch(base + "/api/sessions", { method: "POST", body: "x".repeat(5 * 1024 * 1024 + 1) }), 413);
		await expectError(await fetch(base + "/api/sessions", { method: "POST", body: "{broken" }), 400);
	});

	it("enforces JSON and size limits on optional action bodies too", async () => {
		await json("/api/sessions", "POST", sessionRequest);
		await json("/api/runs", "POST", runRequest);
		for (const [url, method] of [["/api/sessions/session-1/stop", "POST"], ["/api/runs/run-1/stop", "POST"], ["/api/workflows/build", "DELETE"]]) {
			await expectError(await fetch(base + url, { method, body: "{broken" }), 400);
			await expectError(await fetch(base + url, { method, body: JSON.stringify("x".repeat(5 * 1024 * 1024)) }), 413);
		}
		expect(fake.session.stop).not.toHaveBeenCalled();
		expect(fake.run.stop).not.toHaveBeenCalled();
		expect(fake.engine.deleteWorkflow).not.toHaveBeenCalled();
	});

	it("serves static files and SPA fallback, blocks traversal and returns plain missing responses", async () => {
		await fs.mkdir(path.join(folder, "web"));
		await fs.writeFile(path.join(folder, "web", "index.html"), "<html>App</html>");
		await fs.writeFile(path.join(folder, "web", "app.js"), "console.log(1);");
		await fs.writeFile(path.join(folder, "secret.txt"), "secret");
		const response = await fetch(base + "/app.js");
		expect(response.headers.get("content-type")).toContain("javascript");
		expect(await response.text()).toBe("console.log(1);");
		expect(await (await fetch(base + "/work/deep")).text()).toBe("<html>App</html>");
		const missing = await fetch(base + "/missing.css");
		expect(missing.status).toBe(404);
		expect(missing.headers.get("content-type")).toContain("text/plain");
		for (const url of ["/../secret.txt", "/%2e%2e%2fsecret.txt", "/..%5csecret.txt"]) {
			const escaped = await rawGet(url);
			expect(escaped.status).toBeGreaterThanOrEqual(400);
			expect(escaped.text).not.toContain("secret");
		}
		await fs.rm(path.join(folder, "web"), { recursive: true });
		expect((await fetch(base + "/")).status).toBe(404);
	});

	it("returns 404 for unknown API routes and 405 for wrong methods", async () => {
		await expectError(await fetch(base + "/api/unknown"), 404, "Unknown route.");
		for (const url of ["/api/config", "/api/tree", "/api/file", "/api/sessions", "/api/sessions/id/events", "/api/workflows", "/api/workflows/build", "/api/runs", "/api/runs/id/stop"]) {
			await expectError(await json(url, "PATCH"), 405);
		}
	});
});

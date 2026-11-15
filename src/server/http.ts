import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Engine, Session, WorkflowRun } from "../shared/engine.ts";
import type { CreateSessionRequest, RunWorkflowRequest, Workflow } from "../shared/api.ts";
import { projectFolder, readTree, readText, writeText, serveStatic } from "./files.ts";
import { booleanField, HttpError, readJson, record, sendJson, stringField } from "./responses.ts";
import { streamEvents } from "./sse.ts";
import { listTraces, readTrace } from "../traces.ts";
import type { TraceInfo } from "../shared/trace.ts";

export interface ServerOptions {
	/** Folder holding the built browser app (index.html, assets). Optional. */
	webDir?: string;
	runsDirs?: string[];
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const workflowId = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function localAuthority(authority: string | undefined): boolean {
	if (!authority || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(authority)) return false;
	try { return localHosts.has(new URL(`http://${authority}`).hostname); }
	catch { return false; }
}

function checkSafety(request: IncomingMessage): void {
	if (!localAuthority(request.headers.host)) throw new HttpError(403, "Requests from other hosts are not allowed.");
	const origin = request.headers.origin;
	if (origin !== undefined) {
		try {
			const url = new URL(origin);
			if ((url.protocol === "http:" || url.protocol === "https:") && localAuthority(url.host) && !url.username && !url.password) return;
		} catch { /* Invalid origins are rejected below. */ }
		throw new HttpError(403, "Requests from other sites are not allowed.");
	}
}

function method(request: IncomingMessage, expected: string): void {
	if (request.method !== expected) throw new HttpError(405, "Method not allowed.");
}

function validWorkflowId(id: string): void {
	if (!workflowId.test(id)) throw new HttpError(400, "Invalid workflow id.");
}

export function createAppServer(engine: Engine, options: ServerOptions = {}): Server {
	const sessions = new Map<string, Session>();
	const runs = new Map<string, WorkflowRun>();
	async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
		checkSafety(request);
		const rawUrl = request.url ?? "/";
		let pathname: string;
		try { pathname = decodeURIComponent(rawUrl.split("?")[0] ?? "/"); }
		catch { throw new HttpError(400, "Invalid URL."); }
		const query = new URL(rawUrl, "http://localhost").searchParams;
		if (pathname === "/api/traces") {
			method(request, "GET");
			const traces = new Map<string, TraceInfo>();
			for (const dir of options.runsDirs ?? []) {
				for (const info of await listTraces(dir)) if (!traces.has(info.id)) traces.set(info.id, info);
			}
			return sendJson(response, [...traces.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id)).slice(0, 200));
		}
		const traceRoute = /^\/api\/traces\/([^/]+)$/.exec(pathname);
		if (traceRoute) {
			method(request, "GET");
			for (const dir of options.runsDirs ?? []) {
				const detail = await readTrace(dir, traceRoute[1]!);
				if (detail) return sendJson(response, detail);
			}
			throw new HttpError(404, "No such trace.");
		}
		if (pathname === "/api/config") {
			method(request, "GET");
			return sendJson(response, await engine.config());
		}
		if (pathname === "/api/tree") {
			method(request, "GET");
			return sendJson(response, await readTree(await projectFolder(query.get("folder"))));
		}
		if (pathname === "/api/file") {
			if (request.method === "GET") {
				return sendJson(response, await readText(await projectFolder(query.get("folder")), query.get("path")));
			}
			method(request, "PUT");
			const body = record(await readJson(request));
			await writeText(await projectFolder(body.folder), body.path, body.text);
			return sendJson(response, { ok: true });
		}
		if (pathname === "/api/sessions") {
			method(request, "POST");
			const body = record(await readJson(request));
			stringField(body.agent, "Agent");
			stringField(body.folder, "Folder");
			stringField(body.server, "Server");
			booleanField(body.askFirst, "Ask first");
			let session: Session;
			try { session = await engine.createSession(body as unknown as CreateSessionRequest); }
			catch (error) { throw new HttpError(400, error instanceof Error ? error.message : String(error)); }
			sessions.set(session.id, session);
			return sendJson(response, { id: session.id });
		}
		const sessionRoute = /^\/api\/sessions\/([^/]+)\/(events|message|stop|resolve|ask-first)$/.exec(pathname);
		if (sessionRoute) {
			const [, id, action] = sessionRoute;
			method(request, action === "events" ? "GET" : "POST");
			const session = sessions.get(id!);
			if (!session) throw new HttpError(404, "No such session.");
			if (action === "events") return streamEvents(response, session);
			if (action === "stop") {
				await readJson(request, true);
				session.stop();
			}
			else {
				const body = record(await readJson(request));
				if (action === "message") session.send(stringField(body.text, "Text"));
				if (action === "resolve") session.resolve(stringField(body.proposalId, "Proposal id"), booleanField(body.accept, "Accept"));
				if (action === "ask-first") session.setAskFirst(booleanField(body.askFirst, "Ask first"));
			}
			return sendJson(response, { ok: true });
		}
		if (pathname === "/api/workflows") {
			method(request, "GET");
			return sendJson(response, await engine.listWorkflows());
		}
		const workflowRoute = /^\/api\/workflows\/([^/]+)$/.exec(pathname);
		if (workflowRoute) {
			if (request.method !== "PUT" && request.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
			const id = workflowRoute[1]!;
			validWorkflowId(id);
			if (request.method === "DELETE") {
				await readJson(request, true);
				await engine.deleteWorkflow(id);
			}
			else {
				const body = record(await readJson(request));
				if (body.id !== id) throw new HttpError(400, "Workflow id must match the URL id.");
				await engine.saveWorkflow(body as unknown as Workflow);
			}
			return sendJson(response, { ok: true });
		}
		if (pathname === "/api/runs") {
			method(request, "POST");
			const body = record(await readJson(request));
			let run: WorkflowRun;
			// A wrong folder or server name is the caller's mistake, not a server fault.
			try { run = await engine.createWorkflowRun(body as unknown as RunWorkflowRequest); }
			catch (error) { throw new HttpError(400, error instanceof Error ? error.message : String(error)); }
			runs.set(run.id, run);
			run.start();
			return sendJson(response, { id: run.id });
		}
		const runRoute = /^\/api\/runs\/([^/]+)\/(events|resume|stop)$/.exec(pathname);
		if (runRoute) {
			const [, id, action] = runRoute;
			method(request, action === "events" ? "GET" : "POST");
			const run = runs.get(id!);
			if (!run) throw new HttpError(404, "No such run.");
			if (action === "events") return streamEvents(response, run);
			if (action === "stop") {
				await readJson(request, true);
				run.stop();
			}
			else {
				const body = record(await readJson(request));
				if (body.fromStepId !== undefined) stringField(body.fromStepId, "From step id");
				run.resume(body.fromStepId as string | undefined);
			}
			return sendJson(response, { ok: true });
		}
		if (pathname.startsWith("/api/") || pathname === "/api") throw new HttpError(404, "Unknown route.");
		method(request, "GET");
		return serveStatic(response, pathname, options.webDir);
	}
	return createServer((request, response) => {
		void route(request, response).catch((error: unknown) => {
			if (response.headersSent) { response.destroy(); return; }
			sendJson(response, { error: error instanceof Error ? error.message : String(error) }, error instanceof HttpError ? error.status : 500);
		});
	});
}

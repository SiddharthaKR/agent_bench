import type { AgentDetail, AgentUpdate } from "../../src/shared/agents.ts";
/** Calls to the local server. Every screen goes through these. */
import type {
	AppConfig,
	CreateSessionRequest,
	CreateSessionResponse,
	RunWorkflowRequest,
	RunWorkflowResponse,
	TreeNode,
	Workflow,
} from "../../src/shared/api.ts";
import type { TraceDetail, TraceInfo } from "../../src/shared/trace.ts";
import type { ResultRow } from "../../src/shared/results.ts";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
	const response = await fetch(url, {
		method,
		headers: body === undefined ? undefined : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = (await response.json().catch(() => ({}))) as { error?: string };
	if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
	return data as T;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
	results: () => call<ResultRow[]>("GET", "/api/results"),
	agents: () => call<AgentDetail[]>("GET", "/api/agents"),
	agent: (id: string) => call<AgentDetail>("GET", `/api/agents/${encodeURIComponent(id)}`),
	createAgent: (id: string, name: string) => call<AgentDetail>("POST", "/api/agents", { id, name }),
	saveAgent: (id: string, update: AgentUpdate) => call<AgentDetail>("PUT", `/api/agents/${encodeURIComponent(id)}`, update),
	deleteAgent: (id: string) => call<{ ok: true }>("DELETE", `/api/agents/${encodeURIComponent(id)}`),
	traces: () => call<TraceInfo[]>("GET", "/api/traces"),
	trace: (id: string) => call<TraceDetail>("GET", `/api/traces/${encodeURIComponent(id)}`),
	config: () => call<AppConfig>("GET", "/api/config"),
	tree: (folder: string) => call<TreeNode[]>("GET", `/api/tree?${q({ folder })}`),
	readFile: (folder: string, path: string) => call<{ text: string }>("GET", `/api/file?${q({ folder, path })}`),
	writeFile: (folder: string, path: string, text: string) => call<{ ok: true }>("PUT", "/api/file", { folder, path, text }),

	createSession: (request: CreateSessionRequest) => call<CreateSessionResponse>("POST", "/api/sessions", request),
	sendMessage: (id: string, text: string) => call<{ ok: true }>("POST", `/api/sessions/${id}/message`, { text }),
	stopSession: (id: string) => call<{ ok: true }>("POST", `/api/sessions/${id}/stop`),
	resolveProposal: (id: string, proposalId: string, accept: boolean) =>
		call<{ ok: true }>("POST", `/api/sessions/${id}/resolve`, { proposalId, accept }),
	setAskFirst: (id: string, askFirst: boolean) => call<{ ok: true }>("POST", `/api/sessions/${id}/ask-first`, { askFirst }),

	workflows: () => call<Workflow[]>("GET", "/api/workflows"),
	saveWorkflow: (workflow: Workflow) => call<{ ok: true }>("PUT", `/api/workflows/${workflow.id}`, workflow),
	deleteWorkflow: (id: string) => call<{ ok: true }>("DELETE", `/api/workflows/${id}`),
	startRun: (request: RunWorkflowRequest) => call<RunWorkflowResponse>("POST", "/api/runs", request),
	resumeRun: (id: string, fromStepId?: string) => call<{ ok: true }>("POST", `/api/runs/${id}/resume`, { fromStepId }),
	stopRun: (id: string) => call<{ ok: true }>("POST", `/api/runs/${id}/stop`),
};

/**
 * Listens to a server event stream. The server replays every past event first,
 * so the caller should start from an empty state. Returns a function that stops listening.
 */
export function listen<T>(url: string, onEvent: (event: T) => void): () => void {
	const source = new EventSource(url);
	source.onmessage = (message) => onEvent(JSON.parse(message.data) as T);
	return () => source.close();
}

export const sessionEventsUrl = (id: string) => `/api/sessions/${id}/events`;
export const runEventsUrl = (id: string) => `/api/runs/${id}/events`;

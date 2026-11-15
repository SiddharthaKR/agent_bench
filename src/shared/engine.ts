/**
 * What the local server needs from the engine. The server is written against
 * these interfaces only, so it can be tested with fakes.
 */
import type {
	AppConfig,
	CreateSessionRequest,
	RunWorkflowRequest,
	SessionEvent,
	Workflow,
	WorkflowEvent,
	WorkflowRunState,
} from "./api.ts";

/** One chat with one agent in one project folder. */
export interface Session {
	readonly id: string;
	/** Every event so far, so a browser that connects late can catch up. */
	readonly events: readonly SessionEvent[];
	/** Returns a function that removes the listener. */
	subscribe(listener: (event: SessionEvent) => void): () => void;
	/** A message from the user. Starts the agent, or steers it when it is already working. */
	send(text: string): void;
	stop(): void;
	/** Accept or reject a proposed edit. */
	resolve(proposalId: string, accept: boolean): void;
	setAskFirst(askFirst: boolean): void;
	answer?(questionId: string, text: string): boolean;
}

/** One run of a workflow. */
export interface WorkflowRun {
	readonly id: string;
	readonly events: readonly WorkflowEvent[];
	readonly state: WorkflowRunState;
	answer?(questionId: string, text: string): boolean;
	subscribe(listener: (event: WorkflowEvent) => void): () => void;
	/** Start from the first step. */
	start(): void;
	/** Continue after a pause, or run again from a given step after a failure or stop. */
	resume(fromStepId?: string): void;
	stop(): void;
}

export interface Engine {
	config(): Promise<AppConfig>;
	createSession(request: CreateSessionRequest): Promise<Session>;
	listWorkflows(): Promise<Workflow[]>;
	saveWorkflow(workflow: Workflow): Promise<void>;
	deleteWorkflow(id: string): Promise<void>;
	createWorkflowRun(request: RunWorkflowRequest): Promise<WorkflowRun>;
}

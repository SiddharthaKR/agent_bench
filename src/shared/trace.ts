export interface TraceInfo {
	id: string;
	agent: string;
	model: string;
	task: string;
	startedAt: string;
	ended: boolean;
	reason?: string;
	modelCalls: number;
	toolErrors: number;
}

export interface TraceRow {
	id: string;
	call: number;
	direction: "sent" | "received";
	kind: "system" | "user" | "thinking" | "tool call" | "tool result" | "tool error" | "bad tool call" | "reply" | "guard" | "error";
	title: string;
	text: string;
	meta: string;
	raw: unknown;
}

export interface TraceDetail {
	info: TraceInfo;
	contextTokens: number;
	outputTokens: number;
	elapsedMs: number;
	rows: TraceRow[];
}

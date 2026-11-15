import type { SessionEvent } from "../../../src/shared/api.ts";

export type FeedItem = Extract<SessionEvent, { id: string }>;
export interface WorkState {
	items: FeedItem[];
	status: "idle" | "working" | "waiting";
	stream: string;
	files: string[];
	usage: Extract<SessionEvent, { type: "usage" }> | null;
	output: Extract<SessionEvent, { type: "step" }> | null;
}

export function initialState(): WorkState {
	return { items: [], status: "idle", stream: "", files: [], usage: null, output: null };
}

export function reduce(state: WorkState, event: SessionEvent | { type: "reset" }): WorkState {
	switch (event.type) {
		case "reset": return initialState();
		case "status": return { ...state, status: event.state };
		case "stream": return { ...state, stream: state.stream + event.delta };
		case "file": return { ...state, files: state.files.includes(event.path) ? state.files : [...state.files, event.path] };
		case "usage": return { ...state, usage: event };
		default: {
			// A proposal shares its id with the step it belongs to, so the type is part of the identity.
			const index = state.items.findIndex((item) => item.id === event.id && item.type === event.type);
			const items = [...state.items];
			if (index < 0) items.push(event);
			else items[index] = event;
			const output = event.type === "step" && ["compile", "run_sim"].includes(event.tool)
				&& !["running", "waiting"].includes(event.status) ? event : state.output;
			return { ...state, items, output, stream: ["step", "agent", "user"].includes(event.type) ? "" : state.stream };
		}
	}
}

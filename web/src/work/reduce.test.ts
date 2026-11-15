import { describe, expect, it } from "vitest";
import { initialState, reduce } from "./reduce.ts";

describe("work events", () => {
	it("updates an item without moving it or mutating earlier state", () => {
		const first = reduce(initialState(), { type: "agent", id: "a", text: "First" });
		const second = reduce(first, { type: "user", id: "b", text: "Next" });
		const updated = reduce(second, { type: "agent", id: "a", text: "Updated" });
		expect(updated.items.map((item) => item.id)).toEqual(["a", "b"]);
		expect(updated.items[0]).toMatchObject({ text: "Updated" });
		expect(first.items[0]).toMatchObject({ text: "First" });
	});
	it("keeps a proposal and the step it belongs to as two items, though they share an id", () => {
		const step = { type: "step", id: "call_1", tool: "replace_lines", target: "a.v", status: "running", thinking: "", call: "", result: "" } as const;
		let state = reduce(initialState(), step);
		state = reduce(state, { type: "proposal", id: "call_1", path: "a.v", isNew: false, diff: [], state: "pending" });
		state = reduce(state, { ...step, status: "waiting" });
		expect(state.items.map((item) => item.type)).toEqual(["step", "proposal"]);
		expect(state.items[0]).toMatchObject({ status: "waiting" });
		state = reduce(state, { type: "proposal", id: "call_1", path: "a.v", isNew: false, diff: [], state: "accepted" });
		expect(state.items[1]).toMatchObject({ state: "accepted" });
		expect(state.items).toHaveLength(2);
	});
	it("concatenates both stream kinds and clears them on messages and steps", () => {
		let state = reduce(initialState(), { type: "stream", kind: "thinking", delta: "Think" });
		state = reduce(state, { type: "stream", kind: "text", delta: "\nReply" });
		expect(state.stream).toBe("Think\nReply");
		state = reduce(state, { type: "agent", id: "a", text: "Done" });
		expect(state.stream).toBe("");
	});
	it("keeps status, usage and changed paths outside the feed", () => {
		let state = reduce(initialState(), { type: "status", state: "waiting" });
		state = reduce(state, { type: "usage", modelCalls: 2, contextTokens: 40, outputTokens: 8 });
		state = reduce(state, { type: "file", path: "new.sv" });
		state = reduce(state, { type: "file", path: "new.sv" });
		expect(state.status).toBe("waiting");
		expect(state.usage?.contextTokens).toBe(40);
		expect(state.files).toEqual(["new.sv"]);
		expect(state.items).toEqual([]);
	});
	it("uses completion order for tool output when earlier steps finish later", () => {
		const step = { type: "step", tool: "compile", target: "top.sv", status: "running", thinking: "", call: "", result: "" } as const;
		let state = reduce(initialState(), { ...step, id: "a" });
		state = reduce(state, { ...step, id: "b", status: "ok", result: "PASS" });
		state = reduce(state, { ...step, id: "a", status: "error", result: "FAIL" });
		expect(state.output?.id).toBe("a");
		expect(reduce(state, { type: "reset" })).toEqual(initialState());
	});
});

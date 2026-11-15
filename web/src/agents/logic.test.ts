import { expect, it } from "vitest";
import { agentUpdate, toggleName } from "./logic.ts";
import type { AgentDetail } from "../../../src/shared/agents.ts";
it("sends only editable values and enabled names", () => {
	const detail: AgentDetail = { id: "one", name: "One", prompt: "Work", tools: [{ name: "read_file", summary: "Read", enabled: true }, { name: "write_file", summary: "Write", enabled: false }], skills: [{ name: "practice", description: "Practice", always: true, enabled: false }], subagents: [{ id: "two", name: "Two", enabled: true }], maxTurns: 40, maxSeconds: null, smallFileLines: 150, trimContext: true, promptChars: 200 };
	expect(agentUpdate(detail)).toEqual({ name: "One", prompt: "Work", tools: ["read_file"], skills: [], subagents: ["two"], maxTurns: 40, maxSeconds: null, smallFileLines: 150, trimContext: true });
});
it("toggles names without mutating the prior selection", () => {
	const names = ["read_file"];
	expect(toggleName(names, "write_file")).toEqual(["read_file", "write_file"]);
	expect(toggleName(names, "read_file")).toEqual([]);
	expect(names).toEqual(["read_file"]);
});

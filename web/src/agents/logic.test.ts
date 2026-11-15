import { expect, it } from "vitest";
import { agentUpdate, toggleName, parseMcpArguments, formatMcpArguments } from "./logic.ts";
import type { AgentDetail } from "../../../src/shared/agents.ts";
it("sends only editable values and enabled names", () => {
	const detail: AgentDetail = { id: "one", name: "One", prompt: "Work", tools: [{ name: "read_file", summary: "Read", enabled: true }, { name: "write_file", summary: "Write", enabled: false }], skills: [{ name: "practice", description: "Practice", always: true, enabled: false }], subagents: [{ id: "two", name: "Two", enabled: true }], mcp: [{ name: "docs", command: "node", args: ["server.js"], enabled: true }], maxTurns: 40, maxSeconds: null, smallFileLines: 150, trimContext: true, promptChars: 200 };
	expect(agentUpdate(detail)).toEqual({ name: "One", prompt: "Work", tools: ["read_file"], skills: [], subagents: ["two"], mcp: detail.mcp, maxTurns: 40, maxSeconds: null, smallFileLines: 150, trimContext: true });
});
it("toggles names without mutating the prior selection", () => {
	const names = ["read_file"];
	expect(toggleName(names, "write_file")).toEqual(["read_file", "write_file"]);
	expect(toggleName(names, "read_file")).toEqual([]);
	expect(names).toEqual(["read_file"]);
});
it("parses and formats MCP arguments with spaces, quotes and Windows paths", () => {
	const args = ["server.js", "two words", "", "C:\\tools\\server.js", 'a"b'];
	expect(parseMcpArguments(formatMcpArguments(args))).toEqual(args);
	expect(parseMcpArguments('server.js "two words" --flag')).toEqual(["server.js", "two words", "--flag"]);
	expect(() => parseMcpArguments('"unclosed')).toThrow(/quote/i);
});

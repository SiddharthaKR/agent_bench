import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { expect, it } from "vitest";
import { trimContext } from "../src/context.ts";

function transcript(): AgentMessage[] {
	return [
		{ role: "system", content: "System", timestamp: 1 },
		{ role: "user", content: "Task".repeat(200), timestamp: 2 },
		{ role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "write_file", arguments: { path: "a.v", content: "x".repeat(401) } }], timestamp: 3 },
		{ role: "toolResult", toolCallId: "call-1", toolName: "write_file", content: [{ type: "text", text: "one\ntwo\nthree\n" + "four".repeat(100) }, { type: "text", text: "short" }], isError: false, timestamp: 4 },
		...Array.from({ length: 6 }, (_, index) => ({ role: "user", content: `Recent ${index}`, timestamp: index + 5 })),
	] as AgentMessage[];
}

it("trims old bodies and results without mutation or losing call/result pairs", () => {
	const messages = transcript();
	const before = structuredClone(messages);
	const result = trimContext(messages);
	expect(messages).toEqual(before);
	expect(result).toHaveLength(messages.length);
	expect(result.map((message) => [message.role, message.timestamp])).toEqual(messages.map((message) => [message.role, message.timestamp]));
	expect(result[0]).toBe(messages[0]);
	expect(result[1]).toBe(messages[1]);
	expect(result.slice(-6)).toEqual(messages.slice(-6));
	for (let index = 4; index < 10; index++) expect(result[index]).toBe(messages[index]);
	expect(result[2]).toMatchObject({ role: "assistant", content: [{ id: "call-1", name: "write_file", arguments: { path: "a.v", content: "(file text omitted; the current file is on disk)" } }] });
	expect(result[3]).toMatchObject({ role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "one\ntwo\nthree\n(older output trimmed)" }] });
	expect(result[2]).not.toBe(messages[2]);
	expect(result[3]).not.toBe(messages[3]);
});

it("honors options and exact thresholds, leaving unchanged messages by reference", () => {
	const messages = transcript();
	expect(trimContext(messages, { keepRecent: 100 })).toEqual(messages);
	const result = trimContext(messages, { keepRecent: 0, maxOldResultChars: 1000 });
	expect(result[3]).toBe(messages[3]);
	const assistant = messages[2]!;
	if (assistant.role === "assistant" && assistant.content[0]?.type === "toolCall") assistant.content[0].arguments.content = "x".repeat(400);
	expect(trimContext(messages)[2]).toBe(assistant);
});

it("measures all result text together and preserves older system messages", () => {
	const messages = transcript();
	messages.push({ role: "system", content: "Keep this", timestamp: 99 } as AgentMessage);
	const resultMessage = messages[3]!;
	if (resultMessage.role === "toolResult") resultMessage.content = [{ type: "text", text: "a".repeat(151) }, { type: "text", text: "b".repeat(150) }];
	const result = trimContext(messages, { keepRecent: 0 });
	expect(result[3]).not.toBe(resultMessage);
	expect(result.at(-1)).toBe(messages.at(-1));
});

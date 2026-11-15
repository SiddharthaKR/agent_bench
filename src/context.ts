import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface TrimOptions {
	keepRecent?: number;
	maxOldResultChars?: number;
}

export function trimContext(messages: AgentMessage[], options: TrimOptions = {}): AgentMessage[] {
	const end = messages.length - Math.max(0, options.keepRecent ?? 6);
	const firstUser = messages.findIndex((message) => message.role === "user");
	return messages.map((message, index) => {
		if (index >= end || index === firstUser) return message;
		if (message.role === "toolResult") {
			const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
			if (text.length <= (options.maxOldResultChars ?? 300)) return message;
			const content = [
				{ type: "text" as const, text: `${text.split(/\r?\n/).slice(0, 3).join("\n")}\n(older output trimmed)` },
				...message.content.filter((block) => block.type !== "text"),
			];
			return { ...message, content };
		}
		if (message.role === "assistant") {
			let changed = false;
			const content = message.content.map((block) => {
				if (block.type !== "toolCall" || typeof block.arguments.content !== "string" || block.arguments.content.length <= 400) return block;
				changed = true;
				return { ...block, arguments: { ...block.arguments, content: "(file text omitted; the current file is on disk)" } };
			});
			return changed ? { ...message, content } : message;
		}
		return message;
	});
}

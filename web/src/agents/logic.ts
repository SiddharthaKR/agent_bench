import type { AgentDetail, AgentUpdate } from "../../../src/shared/agents.ts";

export function agentUpdate(agent: AgentDetail): AgentUpdate {
	return {
		name: agent.name, prompt: agent.prompt,
		tools: agent.tools.filter((tool) => tool.enabled).map((tool) => tool.name),
		skills: agent.skills.filter((skill) => skill.enabled).map((skill) => skill.name),
		subagents: agent.subagents.filter((item) => item.enabled).map((item) => item.id),
		mcp: agent.mcp,
		maxTurns: agent.maxTurns, maxSeconds: agent.maxSeconds, smallFileLines: agent.smallFileLines, trimContext: agent.trimContext,
	};
}
export function toggleName(names: readonly string[], name: string): string[] {
	return names.includes(name) ? names.filter((item) => item !== name) : [...names, name];
}

export function parseMcpArguments(text: string): string[] {
	const args: string[] = [];
	let value = "";
	let quoted = false;
	let started = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (quoted && char === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
			value += text[++i];
		} else if (char === '"') {
			quoted = !quoted;
			started = true;
		} else if (/\s/.test(char) && !quoted) {
			if (started) args.push(value);
			value = "";
			started = false;
		} else {
			value += char;
			started = true;
		}
	}
	if (quoted) throw new Error("Close the double quote in Arguments.");
	if (started) args.push(value);
	return args;
}

export function formatMcpArguments(args: readonly string[]): string {
	return args.map((arg) => !arg || /[\s"]/.test(arg) ? JSON.stringify(arg) : arg).join(" ");
}

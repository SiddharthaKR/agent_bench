import type { AgentDetail, AgentUpdate } from "../../../src/shared/agents.ts";

export function agentUpdate(agent: AgentDetail): AgentUpdate {
	return {
		name: agent.name, prompt: agent.prompt,
		tools: agent.tools.filter((tool) => tool.enabled).map((tool) => tool.name),
		skills: agent.skills.filter((skill) => skill.enabled).map((skill) => skill.name),
		subagents: agent.subagents.filter((item) => item.enabled).map((item) => item.id),
		maxTurns: agent.maxTurns, maxSeconds: agent.maxSeconds, smallFileLines: agent.smallFileLines, trimContext: agent.trimContext,
	};
}
export function toggleName(names: readonly string[], name: string): string[] {
	return names.includes(name) ? names.filter((item) => item !== name) : [...names, name];
}

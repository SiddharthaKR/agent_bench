export interface SkillInfo { name: string; description: string; always: boolean; enabled: boolean; }
export interface ToolInfo { name: string; summary: string; enabled: boolean; }
export interface McpServerInfo { name: string; command: string; args: string[]; enabled: boolean; }
export interface AgentDetail {
	id: string;
	name: string;
	prompt: string;
	tools: ToolInfo[];
	skills: SkillInfo[];
	subagents: { id: string; name: string; enabled: boolean }[];
	mcp: McpServerInfo[];
	maxTurns: number;
	maxSeconds: number | null;
	smallFileLines: number;
	trimContext: boolean;
	promptChars: number;
}
export interface AgentUpdate {
	name: string;
	prompt: string;
	tools: string[];
	skills: string[];
	subagents: string[];
	mcp: McpServerInfo[];
	maxTurns: number;
	maxSeconds: number | null;
	smallFileLines: number;
	trimContext: boolean;
}

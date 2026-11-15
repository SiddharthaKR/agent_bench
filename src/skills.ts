import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolSpec } from "./types.ts";

export interface Skill {
	name: string;
	description: string;
	always: boolean;
	text: string;
}

export async function loadSkills(agentDir: string, enabled?: string[]): Promise<Skill[]> {
	const dir = path.join(agentDir, "skills");
	let names: string[];
	try { names = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const skills: Skill[] = [];
	for (const file of names.sort()) {
		if (!file.endsWith(".md")) continue;
		const raw = (await readFile(path.join(dir, file), "utf8")).replace(/\r\n/g, "\n");
		const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(raw);
		if (!match) continue;
		const fields: Record<string, string> = {};
		let valid = true;
		for (const line of match[1]!.split("\n")) {
			const field = /^(name|description|always):\s*(.+)$/.exec(line);
			if (!field || Object.hasOwn(fields, field[1]!)) { valid = false; break; }
			fields[field[1]!] = field[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
		}
		const { name, description, always } = fields;
		if (!valid || !name || !description || !["true", "false"].includes(always ?? "")) continue;
		if (enabled && !enabled.includes(name)) continue;
		skills.push({ name, description, always: always === "true", text: raw.slice(match[0].length).trim() });
	}
	return skills;
}

export function skillTool(skills: Skill[]): ToolSpec {
	return {
		name: "use_skill",
		summary: "Read an engineering skill.",
		args: [{ name: "name", type: "string", required: true, help: "skill name" }],
		async run(args) {
			const skill = skills.find((candidate) => candidate.name === args.name);
			return skill ? { ok: true, text: skill.text } : { ok: false, text: `Unknown skill. Available skills: ${skills.map((s) => s.name).join(", ")}.` };
		},
	};
}

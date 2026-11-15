import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadSkills } from "../src/skills.ts";
import { loadAgent } from "../src/agent.ts";
import type { ToolContext } from "../src/types.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "skills-"));
	await writeFile(path.join(dir, "agent.json"), JSON.stringify({ name: "Test", tools: ["read_file"] }));
	await writeFile(path.join(dir, "prompt.md"), "Agent prompt.");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function fixtures() {
	await mkdir(path.join(dir, "skills"));
	await writeFile(path.join(dir, "skills", "rules.md"), "---\nname: rules\ndescription: Always rules\nalways: true\n---\nAlways body.");
	await writeFile(path.join(dir, "skills", "math.md"), "---\r\nname: math\r\ndescription: Math rules\r\nalways: false\r\n---\r\nMath body.");
	for (const [index, text] of ["no front matter", "---\nname: broken\nalways: true\n---\nx", "---\nname: bad\ndescription: x\nalways: yes\n---\nx"].entries()) {
		await writeFile(path.join(dir, "skills", `invalid${index}.md`), text);
	}
}

it("returns no skills for a missing directory", async () => {
	expect(await loadSkills(dir)).toEqual([]);
	expect((await loadAgent(dir)).specs.map((tool) => tool.name)).toEqual(["read_file"]);
});

it("loads valid front matter, skips invalid files, and filters enabled names", async () => {
	await fixtures();
	expect(await loadSkills(dir)).toEqual([
		{ name: "math", description: "Math rules", always: false, text: "Math body." },
		{ name: "rules", description: "Always rules", always: true, text: "Always body." },
	]);
	expect((await loadSkills(dir, ["math"])).map((skill) => skill.name)).toEqual(["math"]);
	expect(await loadSkills(dir, [])).toEqual([]);
});

it("assembles always text after the prompt and optional listing after help", async () => {
	await fixtures();
	const loaded = await loadAgent(dir);
	expect(loaded.systemPrompt).toMatch(/^Agent prompt\.\n\n## rules\nAlways body\./);
	expect(loaded.systemPrompt).toContain("Skills you can load with use_skill:\n- math: Math rules");
	expect(loaded.systemPrompt.indexOf("Skills you can load")).toBeGreaterThan(loaded.systemPrompt.indexOf("read_file"));
	expect(loaded.systemPrompt).not.toContain("Math body.");
	const tool = loaded.specs.find((spec) => spec.name === "use_skill")!;
	expect(tool.args[0]).toMatchObject({ name: "name", required: true });
	expect(await tool.run({ name: "math" }, {} as ToolContext)).toEqual({ ok: true, text: "Math body." });
	expect(await tool.run({ name: "missing" }, {} as ToolContext)).toEqual({ ok: false, text: "Unknown skill. Available skills: math." });
	await writeFile(path.join(dir, "agent.json"), JSON.stringify({ name: "Test", tools: [], skills: ["rules"] }));
	expect((await loadAgent(dir)).specs).toEqual([]);
});

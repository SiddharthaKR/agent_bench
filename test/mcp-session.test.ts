import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

// Allow the output deadline, process-exit polling and cleanup to finish.
it.each([
	{ name: "docs", tool: "echo", flags: [], text: "session echo\nend" },
	{ name: "write", tool: "file", flags: ["--edit-file"], text: "MCP result" },
	{ name: "replace", tool: "lines", flags: ["--edit-lines"], text: "MCP result" },
])("keeps session MCP $name tools open across messages without approval and ends them on exit", async ({ name, tool, flags, text }) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "mcp-session-"));
	const pidFile = path.join(root, "pid");
	await mkdir(path.join(root, "agent"));
	await writeFile(path.join(root, "small.txt"), "A small file.\n");
	await writeFile(path.join(root, "agent", "agent.json"), JSON.stringify({ name: "Test", tools: [], mcp: [{ name, command: process.execPath, args: [path.resolve("test/fixtures/mcp-echo-server.mjs"), ...flags], env: { MCP_PID_FILE: pidFile }, enabled: true }] }));
	await writeFile(path.join(root, "agent", "prompt.md"), "Echo.");
	const child = spawn(process.execPath, ["--experimental-transform-types", "test/fixtures/mcp-session-runner.mjs", root, `${name}_${tool}`], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	const exited = once(child, "exit");
	let errors = "";
	child.stderr.on("data", (data) => { errors += String(data); });
	let pid: number | undefined;
	try {
		const output = await new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("MCP call did not finish without approval.")), 20_000);
			let text = "";
			child.stdout.on("data", (data) => { text += String(data); if (text.includes("\n")) { clearTimeout(timer); resolve(text); } });
			child.once("error", (error) => { clearTimeout(timer); reject(error); });
			child.once("exit", () => { clearTimeout(timer); reject(new Error(`Session exited early: ${errors}`)); });
		});
		const result = JSON.parse(output);
		expect(result.events.filter((event: { type: string }) => event.type === "proposal")).toEqual([]);
		expect(result.events.filter((event: { type: string; status?: string }) => event.type === "step" && event.status === "ok")).toHaveLength(2);
		expect(result.requests[1].messages.at(-1).content).toContain(text);
		expect(result.requests[3].messages.at(-1).content).toContain(text);
		pid = Number(await readFile(pidFile, "utf8"));
		expect(() => process.kill(pid!, 0)).not.toThrow();
		child.stdin.write("exit\n");
		expect((await exited)[0]).toBe(0);
		await expect.poll(() => { try { process.kill(pid!, 0); return true; } catch { return false; } }, { timeout: 10_000 }).toBe(false);
	} finally {
		child.kill();
		pid ??= await readFile(pidFile, "utf8").then(Number, () => undefined);
		if (pid !== undefined) try { process.kill(pid); } catch { /* Already exited. */ }
		await rm(root, { recursive: true, force: true });
	}
}, 45_000);

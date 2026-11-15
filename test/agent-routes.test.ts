import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createAppServer } from "../src/server/http.ts";
import type { Engine } from "../src/shared/engine.ts";
import { createAgent, listAgentDetails } from "../src/agent-store.ts";

let dir: string;
let server: Server;
let base: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "agent-routes-"));
	await createAgent(dir, "one", "One");
	server = createAppServer({ config: async () => ({ agents: (await listAgentDetails(dir)).map(({ id, name, tools }) => ({ id, name, tools: tools.filter((tool) => tool.enabled).map((tool) => tool.name) })), servers: [], defaultFolder: "" }) } as unknown as Engine, { agentsDir: dir });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address.");
	base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
	await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
	await rm(dir, { recursive: true, force: true });
});
function call(url: string, method = "GET", body?: unknown) {
	return fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
it("lists, reads, creates, updates and deletes disk-backed agents", async () => {
	expect(await (await call("/api/agents")).json()).toMatchObject([{ id: "one", name: "One" }]);
	const created = await (await call("/api/agents", "POST", { id: "two", name: "Two" })).json();
	expect(created).toMatchObject({ id: "two", name: "Two" });
	const update = { name: "Changed", prompt: "Do work.", tools: ["read_file"], skills: [], subagents: ["one"], maxTurns: 10, maxSeconds: null, smallFileLines: 0, trimContext: false };
	expect(await (await call("/api/agents/two", "PUT", update)).json()).toMatchObject({ name: "Changed", trimContext: false });
	expect(await (await call("/api/agents/two")).json()).toMatchObject({ name: "Changed", prompt: "Do work." });
	expect(await (await call("/api/config")).json()).toMatchObject({ agents: [{ id: "one", name: "One" }, { id: "two", name: "Changed", tools: ["read_file"] }] });
	expect(await (await call("/api/agents/two", "DELETE")).json()).toEqual({ ok: true });
});
it("returns sentence errors with 400 or 404 and checks methods", async () => {
	for (const method of ["GET", "PUT", "DELETE"]) {
		const response = await call("/api/agents/absent", method, method === "PUT" ? {} : undefined);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "No such agent." });
	}
	for (const [url, method, body] of [["/api/agents", "POST", { id: "bad.id", name: "Bad" }], ["/api/agents", "POST", { id: "one", name: "Duplicate" }], ["/api/agents/one", "PUT", {}], ["/api/agents/one", "DELETE", undefined]] as const) {
		const response = await call(url, method, body);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: expect.any(String) });
	}
	expect((await call("/api/agents/one", "POST", {})).status).toBe(405);
});

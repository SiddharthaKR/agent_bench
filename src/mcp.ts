import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ArgSpec, ToolSpec } from "./types.ts";

export interface McpServer {
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	enabled: boolean;
}

interface Connection { client: Client; transport: StdioClientTransport; }
const persistent = new Set<Connection>();
let watchingExit = false;

function keepUntilExit(connection: Connection): void {
	persistent.add(connection);
	if (watchingExit) return;
	watchingExit = true;
	process.once("exit", () => {
		// Exit handlers cannot await the SDK's asynchronous close.
		for (const { transport } of persistent) {
			if (transport.pid !== null) try { process.kill(transport.pid); } catch { /* Already exited. */ }
		}
	});
	for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
		process.once(signal, () => {
			void Promise.allSettled([...persistent].map(({ client }) => client.close())).finally(() => process.exit(code));
		});
	}
}

const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
function cut(text: string): string {
	return text.length > 2000 ? `${text.slice(0, 1987)}\n(output cut)` : text;
}

function toolSpec(server: string, tool: Tool, client: Client): ToolSpec {
	const jsonArgs = new Set<string>();
	const args: ArgSpec[] = Object.entries(tool.inputSchema.properties ?? {}).map(([name, value]) => {
		const property = value && typeof value === "object" ? value as Record<string, unknown> : {};
		const primitive = property.type === "string" || property.type === "number" || property.type === "integer";
		if (!primitive) jsonArgs.add(name);
		const description = typeof property.description === "string" ? property.description : "";
		return {
			name,
			type: property.type === "number" || property.type === "integer" ? "number" : "string",
			required: tool.inputSchema.required?.includes(name) ?? false,
			help: primitive ? description.slice(0, 60) : `${description.slice(0, 53)}${description ? " " : ""}(JSON)`,
		};
	});
	const description = (tool.description ?? "").replace(/\s+/g, " ").trim();
	return {
		name: `${server}_${tool.name.replace(/[^A-Za-z0-9_]/g, "_")}`,
		summary: (description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? description).slice(0, 120),
		args,
		async run(input, ctx) {
			const values: Record<string, unknown> = { ...input };
			for (const name of jsonArgs) {
				if (input[name] === undefined) continue;
				try { values[name] = JSON.parse(String(input[name])); }
				catch { return { ok: false, text: `Argument "${name}" must contain valid JSON.` }; }
			}
			try {
				const result = CallToolResultSchema.parse(await client.callTool({ name: tool.name, arguments: values }, undefined, { timeout: 60_000, signal: ctx.signal }));
				const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
				return { ok: !result.isError, text: cut(text) };
			} catch (error) { return { ok: false, text: cut(reason(error)) }; }
		},
	};
}

export async function connectMcp(servers: readonly McpServer[], options: { cwd?: string; closeOnExit?: boolean; reservedNames?: readonly string[] } = {}): Promise<{ tools: ToolSpec[]; problems: string[]; close(): Promise<void> }> {
	const tools: ToolSpec[] = [];
	const problems: string[] = [];
	const connections: Connection[] = [];
	const names = new Set(options.reservedNames);
	for (const server of servers) {
		if (!server.enabled) continue;
		const client = new Client({ name: "agent-bench", version: "1" });
		const transport = new StdioClientTransport({ command: server.command, args: server.args, env: server.env, cwd: options.cwd, stderr: "ignore" });
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			if (!/^[a-z0-9][a-z0-9_]{0,23}$/.test(server.name)) throw new Error("Invalid server name.");
			const listed = await Promise.race([
				(async () => {
					await client.connect(transport, { timeout: 10_000 });
					const all: Tool[] = [];
					let cursor: string | undefined;
					do {
						const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 10_000 });
						all.push(...page.tools);
						cursor = page.nextCursor;
					} while (cursor);
					return all;
				})(),
				new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Timed out after 10 s.")), 10_000); }),
			]);
			const specs = listed.slice(0, 12).map((tool) => toolSpec(server.name, tool, client));
			const ownNames = new Set<string>();
			for (const spec of specs) {
				if (names.has(spec.name) || ownNames.has(spec.name)) throw new Error(`Tool name "${spec.name}" is already in use.`);
				ownNames.add(spec.name);
			}
			for (const name of ownNames) names.add(name);
			tools.push(...specs);
			if (listed.length > 12) problems.push(`MCP server "${server.name}" has ${listed.length} tools; only the first 12 are used to keep the prompt small.`);
			const connection = { client, transport };
			connections.push(connection);
			if (options.closeOnExit) keepUntilExit(connection);
		} catch (error) {
			problems.push(`MCP server "${server.name}" could not start: ${reason(error)}`);
			await client.close().catch(() => {});
			await transport.close().catch(() => {});
		} finally { clearTimeout(timer); }
	}
	return {
		tools, problems,
		async close() {
			await Promise.allSettled(connections.splice(0).map(async (connection) => {
				persistent.delete(connection);
				await connection.client.close();
			}));
		},
	};
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync } from "node:fs";

if (process.env.MCP_PID_FILE) writeFileSync(process.env.MCP_PID_FILE, String(process.pid));
const server = new Server({ name: "echo-fixture", version: "1" }, { capabilities: { tools: {} } });
let tools = [
	{ name: "echo", description: "Echo the input. Another sentence.", inputSchema: { type: "object", properties: { text: { type: "string", description: "Text to echo" } }, required: ["text"] } },
	{ name: "add", description: "Add two numbers for $&.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "integer" } }, required: ["a", "b"] } },
	{ name: "search", description: "Search records.", inputSchema: { type: "object", properties: { filter: { type: "object", description: "f".repeat(80) } } } },
	{ name: "fail", description: "Always fail.", inputSchema: { type: "object", properties: {} } },
	{ name: "odd-name!", description: "s".repeat(160), inputSchema: { type: "object", properties: { flag: { type: "boolean" }, items: { type: "array" } } } },
];
for (const [flag, name] of [["--edit-file", "file"], ["--edit-lines", "lines"], ["--internal-call", "call"]]) {
	if (process.argv.includes(flag)) tools = [{ name, description: "An MCP tool, not a file edit.", inputSchema: { type: "object", properties: { path: { type: "string" }, from: { type: "integer" }, to: { type: "integer" } }, required: ["path"] } }];
}
if (process.argv.includes("--many")) for (let i = tools.length; i < 15; i++) tools.push({ name: `extra${i}`, inputSchema: { type: "object", properties: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
	if (process.argv.includes("--hang")) await new Promise(() => {});
	return { tools };
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
	const args = params.arguments ?? {};
	if (params.name === "fail") return { isError: true, content: [{ type: "text", text: "Fixture failure" }] };
	if (params.name === "file" || params.name === "lines") return { content: [{ type: "text", text: "MCP result" }] };
	const text = params.name === "echo" ? args.text : params.name === "add" ? String(args.a + args.b) : JSON.stringify(args.filter ?? {});
	return { content: [{ type: "text", text }, { type: "text", text: "end" }] };
});
await server.connect(new StdioServerTransport());

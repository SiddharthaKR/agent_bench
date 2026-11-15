import { createSession } from "../../src/session.ts";
import path from "node:path";

const root = process.argv[2];
const tool = process.argv[3] ?? "docs_echo";
const requests = [];
const session = await createSession({
	id: "mcp-session",
	agentDir: path.join(root, "agent"),
	workspace: root,
	runsDir: path.join(root, "runs"),
	server: { baseUrl: "http://fake/v1", model: "fake" },
	commands: { compile: [], simulate: [] },
	askFirst: true,
	fetchFn: async (_url, init) => {
		requests.push(JSON.parse(String(init.body)));
		const call = tool === "docs_echo" ? "@tool docs_echo\ntext: session echo\n@end" : `@tool ${tool}\npath: small.txt\nfrom: 1\nto: 1\n@end`;
		const content = requests.length % 2 ? call : "Done.";
		return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
	},
});
async function send() {
	await new Promise((resolve) => {
		const off = session.subscribe((event) => {
			if (event.type === "status" && event.state === "idle") { off(); resolve(); }
		});
		session.send("Echo.");
	});
}
await send();
session.stop();
await send();
console.log(JSON.stringify({ requests, events: session.events }));
process.stdin.resume();
process.stdin.once("data", () => process.exit(0));

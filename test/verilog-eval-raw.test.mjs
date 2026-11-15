import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import * as raw from "../scripts/verilog_eval_raw.mjs";
import * as report from "../scripts/verilog_eval_report.mjs";

const folders = [];
function temporary() {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "raw-eval-test-"));
	folders.push(folder);
	return folder;
}
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

describe("benchmark extraction", () => {
	it.each([
		["Before\n```verilog\nmodule TopModule;\nendmodule\n```\nAfter", "module TopModule;\nendmodule"],
		["Before\n[BEGIN]\nmodule TopModule;\nendmodule\n[DONE]\nAfter", "module TopModule;\nendmodule"],
		["[BEGIN]module TopModule;\nendmodule[DONE]", "module TopModule;\nendmodule"],
		["Before\nmodule TopModule;\nendmodule\nAfter", "module TopModule;\nendmodule"],
		["No solution available.", ""],
		["[BEGIN]\nmodule TopModule;\nendmodule", ""],
		["[BEGIN]module TopModule; endmodule[DONE]", ""],
	])("extracts upstream code or identifies no code: %s", (reply, expected) => {
		const code = raw.extractCode(reply);
		if (expected) expect(code).toContain(expected);
		else expect(code).toBe("");
		if (expected) { expect(code).not.toContain("Before"); expect(code).not.toContain("After"); }
	});
});

it("normalizes Windows prompt newlines as upstream Python text mode does", () => {
	expect(raw.messagesFor("  first\r\nsecond\rthird\n")[1].content).toBe("\nQuestion:\nfirst\nsecond\nthird\n\nEnclose your code with [BEGIN] and [DONE]. Only output the code snippet\nand do NOT output anything else.\n\nAnswer:\n");
});

it("compares heldout attempts without the failure-report guard and names differences", () => {
	const folder = temporary();
	const harness = path.join(folder, "harness");
	const bare = path.join(folder, "raw");
	function put(root, task, verdict, seconds, server, model, attempt = 1) {
		const dir = path.join(root, task, `run-${attempt}`);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ task, verdict, seconds, server, model, attempt, level: "heldout", pass: verdict === "PASS" }));
	}
	put(harness, "both", "PASS", 2, "local", "model-a");
	put(harness, "assisted", "PASS", 4, "local", "model-a");
	put(harness, "bare", "MISMATCH", 6, "local", "model-a");
	put(harness, "missing", "TIME", 8, "local", "model-a");
	put(bare, "both", "PASS", 1, "office", "model-b");
	put(bare, "assisted", "NO_CODE", 3, "office", "model-b");
	put(bare, "bare", "PASS", 5, "office", "model-b");
	const text = report.compareRuns(harness, bare);
	expect(text).toContain("Problem | Harness verdict | Harness seconds | Raw verdict | Raw seconds");
	expect(text).toContain("both | PASS | 2.0 | PASS | 1.0");
	expect(text).toContain("missing | TIME | 8.0 | — | —");
	expect(text).toContain("Harness: passed 2 of 4 (50.0%). Median 5.0 s.");
	expect(text).toContain("Raw: passed 2 of 3 (66.7%). Median 3.0 s.");
	expect(text).toContain("Passed by both: both");
	expect(text).toContain("Passed only with the harness: assisted");
	expect(text).toContain("Passed only raw: bare");
	expect(text).toMatch(/Note:.*problems.*missing.*model.*model-a.*model-b.*server.*local.*office/);
	put(bare, "both", "MISMATCH", 7, "office", "model-b", 2);
	expect(report.compareRuns(harness, bare)).toContain("both #2 | — | — | MISMATCH | 7.0");
});

it("does not warn for equal coverage, model and server", () => {
	const folder = temporary();
	fs.writeFileSync(path.join(folder, "result.json"), JSON.stringify({ task: "same", verdict: "PASS", pass: true, seconds: 1, model: "m", server: "s" }));
	expect(report.compareRuns(folder, folder)).not.toContain("Note:");
});

it("sends one streamed zero-shot request using server settings and preserves reasoning", async () => {
	const requests = [];
	const server = http.createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.write('data: {"choices":[{"delta":{"reasoning_content":"thought"}}]}\n\n');
		response.end('data: {"choices":[{"delta":{"content":"[BEGIN]\\nmodule TopModule;\\nendmodule\\n[DONE]"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	try {
		const result = await raw.requestReply({ baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, model: "fixture", temperature: 0.2, apiKey: "test", extra: { reasoning_effort: "none" } }, "  spec text\n", 2);
		expect(requests).toEqual([{ url: "/v1/chat/completions", authorization: "Bearer test", body: {
			reasoning_effort: "none", model: "fixture", temperature: 0.2, stream: true, stream_options: { include_usage: true },
			messages: [
				{ role: "system", content: "\nYou are a Verilog RTL designer that only writes code using correct Verilog syntax.\n" },
				{ role: "user", content: "\nQuestion:\nspec text\n\nEnclose your code with [BEGIN] and [DONE]. Only output the code snippet\nand do NOT output anything else.\n\nAnswer:\n" },
			],
		} }]);
		expect(result.reply.reasoning).toBe("thought");
		expect(raw.extractCode(result.reply.text)).toContain("module TopModule;");
		expect(result.timedOut).toBe(false);
	} finally { await new Promise(resolve => server.close(resolve)); }
});

it("times out a stalled stream with no retry and retains its partial reply", async () => {
	let calls = 0;
	const server = http.createServer((_request, response) => {
		calls++;
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	try {
		const result = await raw.requestReply({ baseUrl: `http://127.0.0.1:${server.address().port}`, model: "fixture" }, "spec", 0.1);
		expect(result.timedOut).toBe(true);
		expect(result.reply.text).toBe("partial");
		expect(calls).toBe(1);
	} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

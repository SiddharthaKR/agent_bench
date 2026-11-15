import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";
import { readReply } from "../src/model.ts";
import { root, dataset, read, save, namesIn, problemNames, ensureSplits, runOptions, benchmarkRevision, judge, execute, outputOf } from "./verilog_eval_report.mjs";

export const systemMessage = "\nYou are a Verilog RTL designer that only writes code using correct Verilog syntax.\n";
export const promptSuffix = "\nEnclose your code with [BEGIN] and [DONE]. Only output the code snippet\nand do NOT output anything else.\n";

export function messagesFor(prompt) {
	prompt = prompt.replace(/\r\n?/g, "\n");
	return [
		{ role: "system", content: systemMessage },
		{ role: "user", content: `\nQuestion:\n${prompt.trim()}\n${promptSuffix}\nAnswer:\n` },
	];
}

export function extractCode(text) {
	const lines = text.split(/\r\n|[\n\r\v\f\x85\u2028\u2029]/);
	let started = false;
	let ended = false;
	const marked = [];
	for (const line of lines) {
		if (!started) {
			if (line.trim() === "[BEGIN]") started = true;
			else if (line.trimStart().startsWith("[BEGIN]")) {
				marked.push(line.trimStart().replaceAll("[BEGIN]", ""));
				started = true;
			}
		} else if (!ended) {
			if (line.trim() === "[DONE]") ended = true;
			else if (line.trimEnd().endsWith("[DONE]")) {
				marked.push(line.trimEnd().replaceAll("[DONE]", ""));
				ended = true;
			} else marked.push(line);
		}
	}
	let code = "";
	if (started && ended) code = marked.join("\n");
	else if (!started && !ended) {
		let backticks = 0;
		let moduleExists = false;
		let earlyEnd = false;
		for (const line of lines) {
			if (line.startsWith("```")) backticks++;
			else if (line.startsWith("endmodule")) { if (!moduleExists) earlyEnd = true; }
			else if (line.startsWith("module TopModule")) moduleExists = true;
		}
		if (earlyEnd) moduleExists = false;
		let firstFence = false;
		let secondFence = false;
		let foundModule = false;
		let foundEnd = false;
		const extracted = [];
		for (const line of lines) {
			if (line.trim().startsWith("module TopModule")) foundModule = true;
			let echo = backticks >= 2 ? firstFence && !secondFence : !foundEnd && (!moduleExists || foundModule);
			if (line.startsWith("```")) {
				if (!firstFence) firstFence = true;
				else secondFence = true;
				echo = false;
			} else if (line.trim().startsWith("endmodule")) foundEnd = true;
			if (echo) extracted.push(line);
		}
		code = extracted.join("\n") + "\n\n// VERILOG-EVAL: response did not use <CODE></CODE> correctly\n";
	}
	// Upstream may emit prose even without RTL; distinguish that from a compile error.
	return /\bmodule\b/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")) ? code + "\n" : "";
}

export async function requestReply(server, prompt, seconds, folder) {
	const body = { ...server.extra, model: server.model, messages: messagesFor(prompt), stream: true, stream_options: { include_usage: true } };
	if (server.temperature !== undefined) body.temperature = server.temperature;
	const partial = { text: "", reasoning: "", finish: null };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), seconds * 1000);
	let reply = partial;
	let error;
	if (folder) save(path.join(folder, "request.json"), body);
	try {
		const response = await fetch(`${server.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json", ...(server.apiKey ? { authorization: `Bearer ${server.apiKey}` } : {}) },
			body: JSON.stringify(body), signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Model server answered ${response.status}: ${await response.text()}`);
		reply = await readReply(response, (kind, delta) => { partial[kind === "thinking" ? "reasoning" : "text"] += delta; });
	} catch (caught) { error = caught.message; }
	finally { clearTimeout(timer); }
	const result = { reply, timedOut: controller.signal.aborted, ...(error ? { error } : {}) };
	if (folder) {
		save(path.join(folder, "reply.json"), result);
		fs.writeFileSync(path.join(folder, "reply.txt"), reply.text);
	}
	return result;
}

export async function checkReferences() {
	const cfg = await loadConfig(root);
	const destination = path.join(root, "runs/verilog-eval-raw", `reference-check-${Date.now()}`);
	for (const name of problemNames().slice(0, 3)) {
		const folder = path.join(destination, name);
		fs.mkdirSync(folder, { recursive: true });
		const reference = path.join(dataset, `${name}_ref.sv`);
		const text = read(reference).replace(/\bmodule\s+RefModule\b/, "module TopModule");
		for (const [format, reply] of [["markers", `[BEGIN]\n${text}\n[DONE]`], ["fence", `\`\`\`verilog\n${text}\n\`\`\``], ["plain", text]]) {
			const candidate = path.join(folder, `${format}.sv`);
			fs.writeFileSync(candidate, extractCode(reply));
			const verdict = judge(candidate, path.join(dataset, `${name}_test.sv`), reference, path.join(folder, format), cfg.commands);
			console.log(`${name} ${format}: ${verdict}`);
			if (verdict !== "PASS") throw new Error(`Reference failed: ${name} ${format}. See ${folder}.`);
		}
	}
	console.log(destination);
}

async function run(argv) {
	if (argv[0] === "--check-references" && argv.length === 1) return checkReferences();
	for (let i = 1; i < argv.length; i += 2) if (!["-n", "-s", "-m", "-r", "-t"].includes(argv[i])) throw new Error(`Invalid option ${argv[i]}.`);
	const options = runOptions(argv);
	const names = problemNames();
	const split = ensureSplits(names);
	const selected = (options.selection === "all" ? names : split[options.selection] ?? namesIn(path.resolve(options.selection))).slice(0, options.max);
	if (!selected.length || new Set(selected).size !== selected.length || selected.some(name => !names.includes(name))) throw new Error("Selection contains no problems, duplicate names, or unknown names.");
	const cfg = await loadConfig(root);
	const entry = cfg.servers[options.server];
	if (!entry?.model || !entry.baseUrl) throw new Error(`Unknown server ${options.server}.`);
	const server = { ...entry, model: options.model || entry.model };
	const destination = path.join(root, "runs/verilog-eval-raw", new Date().toISOString().replace(/[:.]/g, "-") + `-${process.pid}`);
	fs.mkdirSync(destination, { recursive: true });
	save(path.join(destination, "manifest.json"), { ...options, max: Number.isFinite(options.max) ? options.max : null, model: server.model, baseUrl: server.baseUrl, temperature: server.temperature, extra: server.extra, setup: "raw", commit: benchmarkRevision(), selected });
	console.log(`Run ${destination}`);
	const rows = [];
	for (const name of selected) for (let attempt = 1; attempt <= options.runs; attempt++) {
		const folder = path.join(destination, name, ...(options.runs > 1 ? [`run-${attempt}`] : []));
		fs.mkdirSync(folder, { recursive: true });
		const start = Date.now();
		const result = await requestReply(server, read(path.join(dataset, `${name}_prompt.txt`)), options.seconds, folder);
		const code = extractCode(result.reply.text);
		const candidate = path.join(folder, "TopModule.sv");
		if (code) fs.writeFileSync(candidate, code);
		let verdict;
		if (result.timedOut || result.error || !code) {
			verdict = result.timedOut ? "TIME" : result.error ? "JUDGE_ERROR" : "NO_CODE";
			fs.mkdirSync(path.join(folder, "judge"));
			fs.writeFileSync(path.join(folder, "judge/judge.log"), `${result.error ?? "No code extracted."}\n`);
		} else verdict = judge(candidate, path.join(dataset, `${name}_test.sv`), path.join(dataset, `${name}_ref.sv`), path.join(folder, "judge"), cfg.commands);
		const row = { when: new Date().toISOString(), suite: "verilog-eval", level: split.dev.includes(name) ? "dev" : "heldout", task: name, server: options.server, model: server.model, setup: "raw", pass: verdict === "PASS", verdict, toolCalls: 0, seconds: (Date.now() - start) / 1000, trace: folder, endedByTime: result.timedOut, attempt };
		save(path.join(folder, "result.json"), row);
		rows.push(row);
		const recorded = execute([process.execPath, "src/cli-result.ts", "--suite", row.suite, "--level", row.level, "--task", name, "--server", row.server, "--model", row.model, "--setup", "raw", "--verdict", verdict, "--tool-calls", "0", "--seconds", String(row.seconds), "--trace", folder], root);
		if (recorded.status !== 0) throw new Error(`Could not record result: ${outputOf(recorded)}. Results saved in ${destination}.`);
		console.log(`${name}${options.runs > 1 ? ` #${attempt}` : ""}: ${verdict}, 0 tool calls, ${row.seconds.toFixed(1)} s`);
	}
	const times = rows.map(row => row.seconds).sort((a, b) => a - b);
	const passed = rows.filter(row => row.pass).length;
	const mid = Math.floor(times.length / 2);
	const median = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
	console.log(`Passed ${passed} of ${rows.length} (${(100 * passed / rows.length).toFixed(1)}%). Median ${median.toFixed(1)} s; mean ${(times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(1)} s.`);
	console.log(["PASS", "MISMATCH", "COMPILE_ERROR", "NO_CODE", "TIME", "JUDGE_ERROR"].map(verdict => `${verdict} ${rows.filter(row => row.verdict === verdict).length}`).join("; "));
	console.log(destination);
	return passed === rows.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	Promise.resolve().then(() => run(process.argv.slice(2))).then(
		code => { process.exitCode = code ?? 0; },
		error => { console.error(error.message); process.exitCode = 2; },
	);
}

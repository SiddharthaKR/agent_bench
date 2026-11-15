import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = path.join(root, "external/verilog-eval/dataset_spec-to-rtl");
const splitDir = path.join(root, "evals-external/verilog-eval");
const task = "Read spec.md and write the module it describes to rtl/TopModule.sv. Compile it and fix every error.";

function read(file) { return fs.readFileSync(file, "utf8"); }
function json(file) { return JSON.parse(read(file)); }
function save(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, "\t") + "\n"); }
function namesIn(file) { return read(file).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")); }
function problemNames() {
	if (!fs.existsSync(dataset)) throw new Error("Benchmark unavailable. Clone NVlabs/verilog-eval into external/verilog-eval; see evals-external/README.md.");
	const names = fs.readdirSync(dataset).filter((name) => name.endsWith("_prompt.txt")).map((name) => name.slice(0, -11)).sort();
	if (!names.length || names.some((name) => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error("Invalid benchmark problem names.");
	for (const name of names) for (const suffix of ["_test.sv", "_ref.sv"]) {
		if (!fs.existsSync(path.join(dataset, name + suffix))) throw new Error(`Missing ${name}${suffix}.`);
	}
	return names;
}

function ensureSplits(names, write = false) {
	const split = splitProblems(names);
	for (const level of ["dev", "heldout"]) {
		const file = path.join(splitDir, `${level}.txt`);
		const existing = fs.existsSync(file) ? namesIn(file) : [];
		if (write || !existing.length) {
			fs.mkdirSync(splitDir, { recursive: true });
			fs.writeFileSync(file, split[level].join("\n") + "\n");
		} else if (JSON.stringify(existing) !== JSON.stringify(split[level])) {
			throw new Error(`Split differs from dataset: ${file}. Review the benchmark revision before using --write-split.`);
		}
	}
	return split;
}

function config() {
	const shared = json(path.join(root, "config.json"));
	const localFile = path.join(root, "config.local.json");
	const local = fs.existsSync(localFile) ? json(localFile) : {};
	return { commands: { ...shared.commands, ...local.commands }, servers: Object.fromEntries(
		[...new Set([...Object.keys(shared.servers ?? {}), ...Object.keys(local.servers ?? {})])]
			.map((key) => [key, { ...shared.servers?.[key], ...local.servers?.[key] }]),
	) };
}

function command(template, files, out) {
	return template.flatMap((part) => part === "{files}" ? files : [part.replaceAll("{out}", out)]);
}

function execute(args, cwd, seconds = 60) {
	return spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", timeout: seconds * 1000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
}

function executeAgent(args, seconds, logfile) {
	return new Promise((resolve) => {
		const fd = fs.openSync(logfile, "w");
		let timedOut = false;
		let error;
		const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", fd, fd], windowsHide: true, detached: process.platform !== "win32" });
		fs.closeSync(fd);
		const timer = setTimeout(() => {
			timedOut = true;
			if (process.platform === "win32") {
				spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
				child.kill("SIGKILL");
			} else {
				try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
			}
		}, seconds * 1000);
		child.on("error", (value) => { error = value; });
		child.on("close", (status) => { clearTimeout(timer); resolve({ status, timedOut, error }); });
	});
}

function outputOf(result) {
	return (result.stdout ?? "") + (result.stderr ?? "") + (result.error ? `${result.error.message}\n` : "");
}

export function judge(candidate, test, reference, folder, commands, timedOut = false) {
	fs.mkdirSync(folder, { recursive: true });
	if (!fs.existsSync(candidate)) {
		fs.writeFileSync(path.join(folder, "judge.log"), "No candidate file saved.\n");
		return parseVerdict({ noFile: true, timedOut });
	}
	// Snapshot the candidate; the judge never runs in the agent's project.
	fs.copyFileSync(candidate, path.join(folder, "TopModule.sv"));
	const out = path.join(folder, "simulation.out");
	const compileArgs = command(commands.compile?.length ? commands.compile : ["iverilog", "-o", "{out}", "{files}"], [path.join(folder, "TopModule.sv"), test, reference], out);
	compileArgs.splice(compileArgs.indexOf(path.join(folder, "TopModule.sv")), 0, "-Wall", "-Winfloop", "-Wno-timescale", "-g2012", "-s", "tb");
	const compile = execute(compileArgs, folder);
	fs.writeFileSync(path.join(folder, "compile.log"), outputOf(compile));
	const simulate = compile.status === 0 && !compile.error
		? execute(command(commands.simulate?.length ? commands.simulate : ["vvp", "{out}"], [], out), folder) : undefined;
	const output = simulate ? outputOf(simulate) : "";
	fs.writeFileSync(path.join(folder, "simulate.log"), output);
	fs.writeFileSync(path.join(folder, "judge.log"), outputOf(compile) + output);
	return parseVerdict({ compile, simulate, output, timedOut });
}

function traceFiles(folder) {
	if (!fs.existsSync(folder)) return [];
	return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(folder, entry.name);
		return entry.isDirectory() ? traceFiles(file) : entry.name === "trace.jsonl" ? [file] : [];
	});
}

function eventsIn(file) {
	return read(file).split(/\r?\n/).filter(Boolean).flatMap((line) => {
		try { return [JSON.parse(line)]; } catch { return []; }
	});
}

function traceMetrics(folder) {
	let calls = 0;
	let endedByTime = false;
	const hints = [];
	for (const file of traceFiles(folder).sort()) for (const event of eventsIn(file)) {
		if (event.type === "tool_call") calls++;
		if (event.type === "run_end" && event.reason === "time") endedByTime = true;
		// Requests contain the exact text actually sent, including tool-result hints.
		if (event.type === "request") for (const message of event.newMessages ?? []) {
			if (message.role === "assistant") continue;
			for (const line of String(message.content).split(/\r?\n/)) {
				if (/hint:|reminder|you must|you should|before (?:you|calling)|save (?:the|your)/i.test(line)) hints.push(line.trim());
			}
		}
	}
	return { calls, endedByTime, hints: [...new Set(hints)].slice(-3) };
}

function collectWorkflowTraces(project, destination) {
	const runs = path.join(root, "runs");
	for (const entry of fs.readdirSync(runs, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === "verilog-eval") continue;
		const source = path.join(runs, entry.name);
		const file = path.join(source, "trace.jsonl");
		if (!fs.existsSync(file)) continue;
		const first = eventsIn(file).find((event) => event.type === "run_start");
		if (first?.workspace && path.resolve(first.workspace) === path.resolve(project)) {
			fs.cpSync(source, path.join(destination, entry.name), { recursive: true });
		}
	}
}

function runOptions(argv) {
	const options = { selection: argv[0], max: Infinity, server: "local", model: "", workflow: "", seconds: 120, skills: "", runs: 1 };
	const keys = { "-n": "max", "-s": "server", "-m": "model", "-w": "workflow", "-t": "seconds", "-k": "skills", "-r": "runs" };
	if (!options.selection) throw new Error("Give dev, heldout, all, or a file with problem names.");
	for (let i = 1; i < argv.length; i += 2) {
		const key = keys[argv[i]];
		if (!key || !argv[i + 1] || argv[i + 1].startsWith("-")) throw new Error(`Invalid option ${argv[i]}.`);
		options[key] = ["max", "seconds", "runs"].includes(key) ? Number(argv[i + 1]) : argv[i + 1];
	}
	for (const key of ["max", "seconds", "runs"]) {
		if (key === "max" && options.max === Infinity) continue;
		if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error(`${key} must be a positive integer.`);
	}
	return options;
}

function benchmarkRevision() {
	const dir = path.join(root, "external/verilog-eval/.git");
	if (!fs.existsSync(path.join(dir, "HEAD"))) return "unknown (no clone metadata)";
	const head = read(path.join(dir, "HEAD")).trim();
	if (!head.startsWith("ref: ")) return head;
	const ref = head.slice(5);
	if (fs.existsSync(path.join(dir, ref))) return read(path.join(dir, ref)).trim();
	const packed = path.join(dir, "packed-refs");
	return fs.existsSync(packed) ? read(packed).split(/\r?\n/).find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "unknown" : "unknown";
}

async function checkQuality(candidate, prompt, commands, print) {
	if (!fs.existsSync(candidate)) return undefined;
	const { specHeaders } = await import("../src/tools/interface.ts");
	const { qualityReport } = await import("../src/tools/quality.ts");
	return qualityReport([candidate], {
		commands,
		...(specHeaders(read(prompt)).length ? { spec: prompt } : {}),
		print,
	});
}

async function run(argv) {
	const options = runOptions(argv);
	const names = problemNames();
	const split = ensureSplits(names);
	const selected = (options.selection === "all" ? names : split[options.selection] ?? namesIn(path.resolve(options.selection))).slice(0, options.max);
	if (!selected.length || new Set(selected).size !== selected.length || selected.some((name) => !names.includes(name))) throw new Error("Selection contains no problems, duplicate names, or unknown names.");
	for (const name of selected) {
		const testText = read(path.join(dataset, `${name}_test.sv`)).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
		if (!/\bTopModule\s+(?:#\s*\([\s\S]*?\)\s*)?\w+\s*\(/.test(testText) || !/\bmodule\s+tb\b/.test(testText)) throw new Error(`Unexpected test interface for ${name}.`);
	}
	const cfg = config();
	if (!cfg.servers[options.server]?.model) throw new Error(`Unknown server ${options.server}.`);
	const model = options.model || cfg.servers[options.server].model;
	const setup = (options.workflow ? `workflow ${path.basename(options.workflow, ".json")}` : "agent") + (options.skills ? ` +${options.skills}` : "");
	const destination = path.join(root, "runs/verilog-eval", new Date().toISOString().replace(/[:.]/g, "-") + `-${process.pid}`);
	fs.mkdirSync(destination, { recursive: true });
	save(path.join(destination, "manifest.json"), { ...options, max: Number.isFinite(options.max) ? options.max : null, model, setup, commit: benchmarkRevision(), selected, splitRule: "Sorted positions 4, 8, 12, ... are dev." });
	console.log(`Run ${destination}`);
	const rows = [];
	for (const name of selected) for (let attempt = 1; attempt <= options.runs; attempt++) {
		const folder = path.join(destination, name, ...(options.runs > 1 ? [`run-${attempt}`] : []));
		const traces = path.join(folder, "traces");
		fs.mkdirSync(traces, { recursive: true });
		const project = fs.mkdtempSync(path.join(os.tmpdir(), "verilog-eval-"));
		const start = Date.now();
		try {
			fs.copyFileSync(path.join(dataset, `${name}_prompt.txt`), path.join(project, "spec.md"));
			fs.mkdirSync(path.join(project, "rtl"));
			const args = [options.workflow ? "src/cli-workflow.ts" : "src/cli.ts", "--folder", project, "--server", options.server, "--max-seconds", String(options.seconds), "--protect", "spec.md", "--task", task];
			if (options.model) args.push("--model", options.model);
			if (options.skills) args.push("--skills", options.skills);
			if (options.workflow) args.push("--workflow", path.resolve(options.workflow), "--no-pause", "--var", "design=rtl/TopModule.sv", "--var", "tb=tb/tb_top.sv");
			else args.push("--runs", traces);
			// The outer deadline covers the entire workflow, including command steps.
			const logfile = path.join(folder, "agent.log");
			const agent = await executeAgent(args, options.seconds, logfile);
			if (agent.error) fs.appendFileSync(logfile, `${agent.error.message}\n`);
			const log = read(logfile);
			if (options.workflow) collectWorkflowTraces(project, traces);
			const metrics = traceMetrics(traces);
			const timedOut = agent.timedOut || /Ended: time/.test(log) || metrics.endedByTime;
			const test = path.join(dataset, `${name}_test.sv`);
			const verdict = judge(path.join(project, "rtl/TopModule.sv"), test, path.join(dataset, `${name}_ref.sv`), path.join(folder, "judge"), cfg.commands, timedOut);
			const candidate = path.join(project, "rtl/TopModule.sv");
			const prompt = path.join(dataset, `${name}_prompt.txt`);
			const quality = await checkQuality(candidate, prompt, cfg.commands, text => fs.writeFileSync(path.join(folder, "quality.log"), text + "\n"));
			const row = { when: new Date().toISOString(), suite: "verilog-eval", level: split.dev.includes(name) ? "dev" : "heldout", task: name, server: options.server, model, setup, pass: verdict === "PASS", verdict, toolCalls: metrics.calls, seconds: (Date.now() - start) / 1000, trace: traces, endedByTime: timedOut, attempt, hints: metrics.hints };
			row.quality = quality ? quality.pass ? "pass" : "fail" : "skipped";
			row.qualityFindings = quality?.findings.length ?? 0;
			save(path.join(folder, "result.json"), row);
			rows.push(row);
			const recorded = execute([process.execPath, "src/cli-result.ts", "--suite", row.suite, "--level", row.level, "--task", name, "--server", row.server, "--model", model, "--setup", setup, "--verdict", verdict, "--tool-calls", String(row.toolCalls), "--seconds", String(row.seconds), "--trace", traces], root);
			if (recorded.status !== 0) throw new Error(`Could not record result: ${outputOf(recorded)}`);
			console.log(`${name}${options.runs > 1 ? ` #${attempt}` : ""}: ${verdict}, ${row.toolCalls} tool calls, ${row.seconds.toFixed(1)} s`);
		} finally { fs.rmSync(project, { recursive: true, force: true }); }
	}
	const times = rows.map((row) => row.seconds).sort((a, b) => a - b);
	const passed = rows.filter((row) => row.pass).length;
	const mid = Math.floor(times.length / 2);
	const median = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
	console.log(`Passed ${passed} of ${rows.length} (${(100 * passed / rows.length).toFixed(1)}%). Median ${median.toFixed(1)} s; mean ${(times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(1)} s.`);
	console.log(["PASS", "MISMATCH", "COMPILE_ERROR", "NO_FILE", "TIME", "JUDGE_ERROR"].map((verdict) => `${verdict} ${rows.filter((row) => row.verdict === verdict).length}`).join("; "));
	return passed === rows.length ? 0 : 1;
}

function resultFiles(folder) {
	return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(folder, entry.name);
		return entry.isDirectory() && !["traces", "judge"].includes(entry.name) ? resultFiles(file) : entry.name === "result.json" ? [file] : [];
	});
}

function report(folder, all) {
	const dev = new Set(namesIn(path.join(splitDir, "dev.txt")));
	const files = resultFiles(path.resolve(folder)).sort();
	const rows = files.map((file) => ({ file, row: json(file) }));
	if (!all && rows.some(({ row }) => row.level !== "dev" || !dev.has(row.task))) throw new Error("Report contains non-dev or unverified problems. Use --all only for an explicit audit; do not tune from heldout failures.");
	const causes = new Map();
	let failures = 0;
	const short = (text) => String(text).replace(/\s+/g, " ").slice(0, 220);
	for (const { file, row } of rows.filter(({ row }) => !row.pass)) {
		const dir = path.dirname(file);
		const log = read(path.join(dir, "judge/judge.log"));
		const metrics = traceMetrics(path.join(dir, "traces"));
		const detail = log.split(/\r?\n/).find((line) => /syntax error|error:|Unknown module|not a port|port .*not|Unable to bind|sorry:|No such file/i.test(line))
			?? log.split(/\r?\n/).find((line) => /^Mismatches:/.test(line)) ?? log.split(/\r?\n/).find(Boolean) ?? "No judge diagnostic.";
		const patterns = [
			["Missing module name", /Unknown module type|Unable to find.*module/i],
			["Wrong port name", /not a port|port .*not|Unable to bind.*(?:wire|reg|memory)/i],
			["Malformed statement", /malformed statement/i],
			["Invalid module item", /invalid module item/i],
			["Syntax error", /syntax error/i],
		];
		const detected = patterns.filter(([, pattern]) => pattern.test(log)).map(([name]) => name);
		if (row.endedByTime || row.verdict === "TIME") detected.push("Time limit");
		if (row.verdict === "NO_FILE" || /No candidate file saved/.test(log)) detected.push("No file saved");
		if (!detected.length) detected.push(row.verdict === "MISMATCH" ? "Functional mismatch" : "Other judge or compile failure");
		for (const cause of detected) causes.set(cause, (causes.get(cause) ?? 0) + 1);
		if (failures++ < 40) {
			console.log(`${row.task}${row.attempt > 1 ? ` #${row.attempt}` : ""}: ${row.verdict}; tools ${row.toolCalls ?? metrics.calls}; ended by time ${row.endedByTime || metrics.endedByTime ? "yes" : "no"}`);
			console.log(`  ${short(detail)}`);
			console.log(`  Last hints: ${(row.hints ?? metrics.hints).map(short).join(" | ") || "None recorded in requests."}`);
		}
	}
	if (failures > 40) console.log(`Omitted detail for ${failures - 40} further failures.`);
	console.log("Cause | Count");
	for (const [cause, count] of [...causes].sort((a, b) => b[1] - a[1])) console.log(`${cause} | ${count}`);
	console.log(`${failures} failed of ${rows.length}. Causes may overlap.`);
}

function checkReferences() {
	const names = problemNames().slice(0, 3);
	const destination = path.join(root, "runs/verilog-eval", `reference-check-${Date.now()}`);
	const cfg = config();
	for (const name of names) {
		const folder = path.join(destination, name);
		fs.mkdirSync(folder, { recursive: true });
		const candidate = path.join(folder, "reference-candidate.sv");
		fs.writeFileSync(candidate, read(path.join(dataset, `${name}_ref.sv`)).replace(/\bmodule\s+RefModule\b/, "module TopModule"));
		const test = path.join(dataset, `${name}_test.sv`);
		const reference = path.join(dataset, `${name}_ref.sv`);
		const verdict = judge(candidate, test, reference, path.join(folder, "reference"), cfg.commands);
		assert.equal(verdict, "PASS", `${name} reference failed; see ${folder}`);
		fs.writeFileSync(candidate, "module TopModule; endmodule\n");
		const empty = judge(candidate, test, reference, path.join(folder, "empty"), cfg.commands);
		assert.ok(["COMPILE_ERROR", "MISMATCH"].includes(empty), `${name}: empty module produced ${empty}`);
		console.log(`${name}: reference PASS; empty module ${empty}`);
	}
}

export function splitProblems(names) {
	const sorted = [...new Set(names)].sort();
	return { dev: sorted.filter((_, i) => (i + 1) % 4 === 0), heldout: sorted.filter((_, i) => (i + 1) % 4 !== 0) };
}

export function parseVerdict({ compile, simulate, output = "", noFile = false, timedOut = false }) {
	let verdict;
	if (noFile) verdict = "NO_FILE";
	else if (!compile || compile.error || compile.signal || compile.status === null) verdict = "JUDGE_ERROR";
	else if (compile.status !== 0) verdict = "COMPILE_ERROR";
	else if (!simulate || simulate.error || simulate.signal || simulate.status !== 0 || /^TIMEOUT\s*$/m.test(output)) verdict = "JUDGE_ERROR";
	else {
		const matches = [...output.matchAll(/^Mismatches:\s*(\d+)\s+in\s+(\d+)\s+samples\s*$/gm)];
		verdict = matches.length === 1 && Number(matches[0][2]) > 0
			? Number(matches[0][1]) === 0 ? "PASS" : "MISMATCH" : "JUDGE_ERROR";
	}
	return timedOut && verdict !== "PASS" ? "TIME" : verdict;
}

async function selfTest() {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "verilog-eval-fixtures-"));
	try {
		for (const name of ["p08", "p02", "p05", "p01", "p07", "p04", "p03", "p06"]) fs.writeFileSync(path.join(temp, `${name}_prompt.txt`), "Synthetic prompt.\n");
		const names = fs.readdirSync(temp).map((name) => name.replace(/_prompt\.txt$/, ""));
		assert.deepEqual(splitProblems(names), { dev: ["p04", "p08"], heldout: ["p01", "p02", "p03", "p05", "p06", "p07"] });
		const ok = { status: 0 };
		const cases = [
			[{ output: "Mismatches: 0 in 20 samples\n" }, "PASS"],
			[{ output: "Mismatches: 2 in 20 samples\n" }, "MISMATCH"],
			[{ output: "Hint: Output 'x' has no mismatches.\n" }, "JUDGE_ERROR"],
			[{ output: "Mismatches: 0 in 0 samples\n" }, "JUDGE_ERROR"],
			[{ output: "Mismatches: 0 in 20 samples\nTIMEOUT\n" }, "JUDGE_ERROR"],
			[{ output: "Mismatches: 0 in 20 samples\n", simulate: { status: 1 } }, "JUDGE_ERROR"],
			[{ compile: { status: 1 } }, "COMPILE_ERROR"],
			[{ compile: { error: { code: "ENOENT" }, status: null } }, "JUDGE_ERROR"],
			[{ noFile: true }, "NO_FILE"],
			[{ noFile: true, timedOut: true }, "TIME"],
			[{ timedOut: true, output: "Mismatches: 1 in 20 samples\n" }, "TIME"],
			[{ timedOut: true, output: "Mismatches: 0 in 20 samples\n" }, "PASS"],
		];
		for (const [input, expected] of cases) {
			fs.writeFileSync(path.join(temp, "judge.log"), input.output ?? "");
			assert.equal(parseVerdict({ compile: ok, simulate: ok, ...input, output: fs.readFileSync(path.join(temp, "judge.log"), "utf8") }), expected);
		}
		assert.throws(() => runOptions(["dev", "-n", "0"]), /positive integer/);
		assert.throws(() => runOptions(["dev", "-r", "1.5"]), /positive integer/);
		assert.throws(() => runOptions(["dev", "-t"]), /Invalid option/);
		const timed = await executeAgent(["-e", "setInterval(() => {}, 1000)"], 0.1, path.join(temp, "agent.log"));
		assert.equal(timed.timedOut, true);
		const cfg = config();
		const candidate = path.join(temp, "candidate.sv");
		const reference = path.join(temp, "reference.sv");
		const test = path.join(temp, "test.sv");
		fs.writeFileSync(candidate, "module TopModule(output q); assign q = 1'b0; endmodule\n");
		fs.writeFileSync(reference, "module RefModule(output q); assign q = 1'b0; endmodule\n");
		fs.writeFileSync(test, 'module tb; wire q,r; TopModule dut(q); RefModule ref1(r); initial begin #1; $display("Mismatches: %0d in 1 samples", q !== r); $finish; end endmodule\n');
		assert.equal(judge(candidate, test, reference, path.join(temp, "pass"), cfg.commands), "PASS");
		fs.writeFileSync(candidate, "module TopModule(output q); assign q = 1'b1; endmodule\n");
		assert.equal(judge(candidate, test, reference, path.join(temp, "mismatch"), cfg.commands), "MISMATCH");
		fs.writeFileSync(candidate, "module TopModule; endmodule\n");
		assert.equal(judge(candidate, test, reference, path.join(temp, "empty"), cfg.commands), "COMPILE_ERROR");
		const prompt = path.join(temp, "spec.md");
		fs.writeFileSync(candidate, "module TopModule(output wrong); assign wrong=1'b0; endmodule\n");
		fs.writeFileSync(prompt, "```verilog\nmodule TopModule(output q);\n```\n");
		const withHeader = await checkQuality(candidate, prompt, cfg.commands, () => {});
		assert.ok(withHeader.findings.some(finding => finding.rule === "interface"));
		fs.writeFileSync(prompt, "Provide an output named q.\n");
		const prose = await checkQuality(candidate, prompt, cfg.commands, () => {});
		assert.ok(!prose.findings.some(finding => finding.rule === "interface"));
		assert.equal(await checkQuality(path.join(temp, "absent.sv"), prompt, cfg.commands, () => {}), undefined);
		const dev = namesIn(path.join(splitDir, "dev.txt"))[0] ?? "synthetic_dev";
		for (let i = 0; i < 40; i++) {
			const folder = path.join(temp, "report", `p${i}`);
			fs.mkdirSync(path.join(folder, "judge"), { recursive: true });
			save(path.join(folder, "result.json"), { task: dev, level: "dev", pass: false, verdict: "COMPILE_ERROR", toolCalls: 2, endedByTime: false });
			fs.writeFileSync(path.join(folder, "judge/judge.log"), "candidate.sv:1: syntax error\n");
		}
		const reportResult = execute([process.execPath, fileURLToPath(import.meta.url), path.join(temp, "report"), "--all"], root);
		assert.equal(reportResult.status, 0, outputOf(reportResult));
		assert.ok(reportResult.stdout.trim().split(/\r?\n/).length < 200);
		assert.match(reportResult.stdout, /Syntax error \| 40/);
		const resultFile = path.join(temp, "report/p0/result.json");
		save(resultFile, { task: "synthetic_heldout", level: "heldout", pass: false });
		const refused = execute([process.execPath, fileURLToPath(import.meta.url), path.join(temp, "report")], root);
		assert.equal(refused.status, 2);
		assert.match(refused.stderr, /non-dev or unverified/);
		const parsed = execute([process.execPath, "--input-type=module", "-e", 'import { parseResultArgs } from "./src/cli-result.ts"; const row = parseResultArgs(["--suite","verilog-eval","--level","dev","--task","synthetic","--server","local","--model","fixture","--setup","agent","--verdict","PASS"]); if (row.task !== "synthetic" || !row.pass) process.exit(1);'], root);
		assert.equal(parsed.status, 0, outputOf(parsed));
		console.log(`Fixture tests passed: split, ${cases.length} verdict cases, options, deadline, real Icarus judge (3 cases), recorder task, and 40-problem report/refusal.`);
	} finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function main(argv) {
	if (argv[0] === "--self-test") return selfTest();
	if (argv[0] === "--write-split") { ensureSplits(problemNames(), true); return; }
	if (argv[0] === "--check-references") return checkReferences();
	if (argv[0] === "--run") return run(argv.slice(1));
	if (!argv[0] || argv.some((arg, i) => i > 0 && arg !== "--all")) throw new Error("Usage: node scripts/verilog_eval_report.mjs <run folder> [--all]");
	return report(argv[0], argv.includes("--all"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	Promise.resolve().then(() => main(process.argv.slice(2))).then(
		(code) => { process.exitCode = code ?? 0; },
		(error) => { console.error(error.message); process.exitCode = 2; },
	);
}

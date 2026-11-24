// Prints the numbers for the deck's results slide: dev and held-out, raw and harness.
// Usage: node scripts/deck_numbers.mjs [harness run folder] [raw run folder]
// With no folders it uses the newest run in runs/verilog-eval and runs/verilog-eval-raw.
import fs from "node:fs";
import path from "node:path";
import { root, dataset, splitProblems } from "./verilog_eval_report.mjs";

function newest(folder) {
	const dir = path.join(root, folder);
	const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^\d{4}-/.test(name)).sort() : [];
	if (!runs.length) throw new Error(`No runs in ${dir}.`);
	return path.join(dir, runs.at(-1));
}

function results(folder) {
	const out = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory() && !["traces", "judge"].includes(entry.name)) walk(file);
			else if (entry.name === "result.json") out.push(JSON.parse(fs.readFileSync(file, "utf8")));
		}
	};
	walk(folder);
	if (!out.length) throw new Error(`No results in ${folder}.`);
	return out;
}

function summary(rows, names) {
	const set = new Set(names);
	const mine = rows.filter((row) => set.has(row.task));
	if (!mine.length) return undefined;
	const runs = new Set(mine.map((row) => row.attempt ?? 1)).size;
	const count = (verdict) => mine.filter((row) => row.verdict === verdict).length / runs;
	const times = mine.map((row) => Number(row.seconds)).sort((a, b) => a - b);
	const median = times[Math.floor(times.length / 2)];
	const problems = new Set(mine.map((row) => row.task)).size;
	return { problems, runs, pass: count("PASS"), compile: count("COMPILE_ERROR"), time: count("TIME"), median, model: mine[0].model ?? "unknown" };
}

const [harnessFolder = newest("runs/verilog-eval"), rawFolder = newest("runs/verilog-eval-raw")] = process.argv.slice(2);
const harness = results(harnessFolder);
const raw = results(rawFolder);
const split = splitProblems([...harness, ...raw].map((row) => row.task).concat(fs.readdirSync(dataset).filter((name) => name.endsWith("_prompt.txt")).map((name) => name.slice(0, -11))));
const fmt = (value) => Number.isInteger(value) ? String(value) : value.toFixed(1);

console.log(`Harness folder: ${harnessFolder}`);
console.log(`Raw folder:     ${rawFolder}`);
console.log(`Model: ${harness[0].model ?? "unknown"}\n`);
console.log("Slide 8 row                      | Passed            | Compile errors | Time-outs | Median s | Runs");
console.log("---------------------------------|-------------------|----------------|-----------|----------|-----");
for (const [label, names, rows] of [
	["VerilogEval held-out, raw", split.heldout, raw],
	["VerilogEval held-out, harness", split.heldout, harness],
	["VerilogEval dev, raw", split.dev, raw],
	["VerilogEval dev, harness", split.dev, harness],
	["All problems run, raw", [...split.dev, ...split.heldout], raw],
	["All problems run, harness", [...split.dev, ...split.heldout], harness],
]) {
	const s = summary(rows, names);
	if (!s) { console.log(`${label.padEnd(33)}| not run`); continue; }
	const passed = `${fmt(s.pass)} of ${s.problems} (${Math.round(100 * s.pass / s.problems)}%)`;
	console.log(`${label.padEnd(33)}| ${passed.padEnd(18)}| ${fmt(s.compile).padEnd(15)}| ${fmt(s.time).padEnd(10)}| ${s.median.toFixed(1).padEnd(9)}| ${s.runs}`);
}
console.log("\nWith more than one run, Passed, Compile errors and Time-outs are averages per run.");

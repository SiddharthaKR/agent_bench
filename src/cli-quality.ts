import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { qualityReport } from "./tools/quality.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
	const config = await loadConfig(root);
	const files: string[] = [];
	let spec: string | undefined;
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--spec") {
			if (spec !== undefined) throw new Error("Give --spec only once.");
			const value = args[++i];
			if (!value || value.startsWith("--")) throw new Error("Give a file after --spec.");
			spec = value;
		} else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
		else files.push(arg);
	}
	const report = await qualityReport(files, { spec, commands: config.commands });
	process.exitCode = report.pass ? 0 : 1;
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 2;
}

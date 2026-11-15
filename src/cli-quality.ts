import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { qualityReport } from "./tools/quality.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
	const config = await loadConfig(root);
	const report = await qualityReport(process.argv.slice(2), { commands: config.commands });
	process.exitCode = report.pass ? 0 : 1;
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 2;
}

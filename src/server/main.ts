/**
 * Starts the app: the local server plus the browser app it serves.
 *
 *   npm run app -- [--port 4600] [--folder <project folder>] [--host 127.0.0.1]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, networkInterfaces } from "node:os";
import { createEngine } from "../engine.ts";
import { createAppServer } from "./http.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function option(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	return value && !value.startsWith("--") ? value : fallback;
}

const port = Number(option("port", process.env.PORT ?? "4600"));
const folder = path.resolve(option("folder", process.cwd()));
const host = option("host", "127.0.0.1");
const allowedHosts = host === "0.0.0.0"
	? [hostname(), ...Object.values(networkInterfaces()).flatMap((addresses) => (addresses ?? []).filter((address) => address.family === "IPv4").map((address) => address.address))]
	: [host];

const engine = createEngine({ root: ROOT, defaultFolder: folder });
const server = createAppServer(engine, { allowedHosts, agentsDir: path.join(ROOT, "agents"), webDir: path.join(ROOT, "web", "dist"), runsDirs: [path.join(ROOT, "runs")] });

server.listen(port, host, () => {
	if (!["127.0.0.1", "localhost", "::1"].includes(host)) console.log(`Warning: anyone who can reach ${host}:${port} can read and change files in the project folders. Use this only on a network you trust.`);
	console.log(`Agent Bench is running at http://${host === "127.0.0.1" ? "localhost" : host}:${port}`);
	console.log(`Project folder: ${folder}`);
});

/**
 * Starts the app: the local server plus the browser app it serves.
 *
 *   npm run app -- [--port 4600] [--folder <project folder>]
 *
 * It listens on this computer only (127.0.0.1): the server can write files.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const engine = createEngine({ root: ROOT, defaultFolder: folder });
const server = createAppServer(engine, { webDir: path.join(ROOT, "web", "dist") });

server.listen(port, "127.0.0.1", () => {
	console.log(`Agent Bench is running at http://localhost:${port}`);
	console.log(`Project folder: ${folder}`);
});

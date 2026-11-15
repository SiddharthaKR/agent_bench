/**
 * Settings: config.json is shared and committed; config.local.json (optional,
 * not committed) holds what differs on one machine, such as model ids or the
 * full path of the simulator. Local values win.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerConfig } from "./model.ts";
import type { CommandConfig } from "./types.ts";
import type { QualityCommands } from "./shared/api.ts";

export interface Config {
	servers: Record<string, ServerConfig>;
	commands: CommandConfig & QualityCommands;
}

export async function loadConfig(root: string): Promise<Config> {
	const shared = JSON.parse(await readFile(path.join(root, "config.json"), "utf8")) as Config;
	let local: Partial<Config> = {};
	try {
		local = JSON.parse(await readFile(path.join(root, "config.local.json"), "utf8")) as Partial<Config>;
	} catch (error) {
		// A missing file is normal. A file that is there but broken should not be ignored silently.
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`config.local.json could not be read: ${(error as Error).message}`);
	}
	const servers: Record<string, ServerConfig> = { ...shared.servers };
	for (const [id, server] of Object.entries(local.servers ?? {})) servers[id] = { ...servers[id], ...server };
	return { servers, commands: { ...shared.commands, ...local.commands } };
}

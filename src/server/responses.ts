import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

export function sendJson(response: ServerResponse, value: unknown, status = 200): void {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(value));
}

export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new HttpError(400, "Expected a JSON object.");
	}
	return value as Record<string, unknown>;
}

export function stringField(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new HttpError(400, `${name} must be a non-empty string.`);
	}
	return value;
}

export function booleanField(value: unknown, name: string): boolean {
	if (typeof value !== "boolean") throw new HttpError(400, `${name} must be a boolean.`);
	return value;
}

export function readJson(request: IncomingMessage, allowEmpty = false): Promise<unknown> {
	const limit = 5 * 1024 * 1024;
	return new Promise((resolve, reject) => {
		let bytes = 0;
		let oversized = false;
		const chunks: Buffer[] = [];
		request.on("error", reject);
		request.on("aborted", () => reject(new HttpError(400, "Request was interrupted.")));
		request.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (oversized) return;
			if (bytes > limit) {
				oversized = true;
				chunks.length = 0;
				reject(new HttpError(413, "Request body is too large."));
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (oversized) return;
			if (bytes === 0 && allowEmpty) { resolve(undefined); return; }
			try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
			catch { reject(new HttpError(400, "Invalid JSON.")); }
		});
	});
}

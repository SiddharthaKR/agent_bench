import type { ServerResponse } from "node:http";

export function streamEvents<T>(response: ServerResponse, source: {
	readonly events: readonly T[];
	subscribe(listener: (event: T) => void): () => void;
}): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const send = (event: T) => { response.write(`data: ${JSON.stringify(event)}\n\n`); };
	for (const event of source.events) send(event);
	const unsubscribe = source.subscribe(send);
	const timer = setInterval(() => { response.write(": ping\n\n"); }, 25_000);
	timer.unref();
	response.once("close", () => {
		clearInterval(timer);
		unsubscribe();
	});
	response.flushHeaders();
}

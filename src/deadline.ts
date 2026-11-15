/** A deadline measured in active time. */
export function createDeadline(seconds: number | undefined, onTimeout: () => void, started = Date.now()) {
	let left = seconds === undefined ? undefined : Math.max(0, seconds * 1000 - (Date.now() - started));
	let since: number | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	const remaining = () => left === undefined ? undefined : Math.max(0, left - (since === undefined ? 0 : Date.now() - since)) / 1000;
	return {
		remaining,
		pause() {
			if (left !== undefined) left = remaining()! * 1000;
			since = undefined;
			clearTimeout(timer);
		},
		resume() {
			if (closed || since !== undefined || left === undefined) return;
			since = Date.now();
			timer = setTimeout(onTimeout, left);
		},
		close() { closed = true; clearTimeout(timer); },
	};
}

import { createHash } from "node:crypto";
import type { GuardCall, GuardVerdict } from "./types.ts";

export interface GuardOptions {
	maxRepeats?: number;
	maxBlocks?: number;
	maxCalls?: number;
}

const LONG_VALUE = 200;
const MAX_CYCLE = 4;

/** A stable string for "the same call": tool name plus sorted args. */
export function signature(call: GuardCall): string {
	const entries = Object.keys(call.args)
		.sort()
		.map((key) => {
			const value = String(call.args[key]);
			const shown = value.length > LONG_VALUE
				? "sha256:" + createHash("sha256").update(value).digest("hex")
				: value;
			return [key, shown];
		});
	return JSON.stringify([call.name, entries]);
}

export class LoopGuard {
	private readonly maxRepeats: number;
	private readonly maxBlocks: number;
	private readonly maxCalls: number;
	private readonly history: string[] = [];
	private blockedCount = 0;

	constructor(options: GuardOptions = {}) {
		this.maxRepeats = options.maxRepeats ?? 2;
		this.maxBlocks = options.maxBlocks ?? 3;
		this.maxCalls = options.maxCalls ?? 40;
	}

	/** Call BEFORE running a tool. Records the call when it is allowed. */
	check(call: GuardCall): GuardVerdict {
		if (this.history.length >= this.maxCalls) {
			return { allow: false, reason: `Stopped: the limit of ${this.maxCalls} tool calls was reached.`, stop: true };
		}

		const sig = signature(call);
		const reason = this.repeatReason(sig);
		if (reason === undefined) {
			this.history.push(sig);
			return { allow: true };
		}

		this.blockedCount++;
		if (this.blockedCount >= this.maxBlocks) {
			return {
				allow: false,
				reason: `Stopped: blocked ${this.maxBlocks} times for repeating the same steps.`,
				stop: true,
			};
		}
		return { allow: false, reason, stop: false };
	}

	/** Number of calls that were allowed so far. */
	get allowed(): number {
		return this.history.length;
	}

	/** Number of calls that were blocked so far. */
	get blocked(): number {
		return this.blockedCount;
	}

	private repeatReason(sig: string): string | undefined {
		const seq = [...this.history, sig];

		// Same call again and again in a row.
		const recent = this.history.slice(-this.maxRepeats);
		if (recent.length === this.maxRepeats && recent.every((s) => s === sig)) {
			return `Blocked: you made this exact call ${this.maxRepeats} times in a row and nothing changed. Do something different.`;
		}

		// A block of L different steps repeated three times in a row.
		for (let len = 2; len <= MAX_CYCLE; len++) {
			const span = 3 * len;
			if (seq.length < span) continue;
			const start = seq.length - span;
			const first = seq.slice(start, start + len);
			const second = seq.slice(start + len, start + 2 * len);
			const third = seq.slice(start + 2 * len);
			if (first.every((s) => s === first[0])) continue; // single repeated call: covered above
			if (sameBlock(first, second) && sameBlock(second, third)) {
				return `Blocked: you are repeating the same ${len} steps in a loop. Do something different.`;
			}
		}
		return undefined;
	}
}

function sameBlock(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((s, i) => s === b[i]);
}

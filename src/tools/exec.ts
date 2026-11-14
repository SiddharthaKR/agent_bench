import { spawn } from "node:child_process";
import type { Exec, ExecResult } from "../types.ts";

const MAX_CHARS = 200_000;

export const realExec: Exec = (command, args, options) =>
	new Promise<ExecResult>((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let done = false;
		let timer: NodeJS.Timeout | undefined;

		const finish = (result: ExecResult) => {
			if (done) return;
			done = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};

		let child;
		try {
			child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true });
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			finish({ code: null, stdout, stderr: String(err), timedOut: false, notFound: code === "ENOENT" });
			return;
		}

		const kill = () => {
			try {
				child.kill();
			} catch {
				// already gone
			}
		};
		function onAbort() {
			kill();
		}

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (d: string) => {
			if (stdout.length < MAX_CHARS) stdout = (stdout + d).slice(0, MAX_CHARS);
		});
		child.stderr.on("data", (d: string) => {
			if (stderr.length < MAX_CHARS) stderr = (stderr + d).slice(0, MAX_CHARS);
		});
		child.on("error", (err: NodeJS.ErrnoException) => {
			finish({ code: null, stdout, stderr: stderr || String(err.message), timedOut, notFound: err.code === "ENOENT" });
		});
		child.on("close", (code) => {
			finish({ code: timedOut ? null : code, stdout, stderr, timedOut, notFound: false });
		});

		timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, options.timeoutMs);
		if (options.signal) {
			if (options.signal.aborted) kill();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}
	});

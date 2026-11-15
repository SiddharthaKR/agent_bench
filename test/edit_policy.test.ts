import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { smallFileRefusal } from "../src/tools/edit_policy.ts";

it("counts lines consistently and honors the boundary and disabling", async () => {
	const workspace = await mkdtemp(path.join(os.tmpdir(), "policy-"));
	try {
		await writeFile(path.join(workspace, "a.v"), "x\r\ny\r\n");
		expect(await smallFileRefusal("replace_lines", { path: "a.v" }, workspace, 2)).toContain("a.v has 2 lines.");
		expect(await smallFileRefusal("replace_lines", { path: "a.v" }, workspace, 1)).toBeUndefined();
		expect(await smallFileRefusal("replace_lines", { path: "a.v" }, workspace, 0)).toBeUndefined();
		expect(await smallFileRefusal("write_file", { path: "a.v" }, workspace)).toBeUndefined();
		expect(await smallFileRefusal("replace_lines", { path: "../outside" }, workspace)).toBeUndefined();
		expect(await smallFileRefusal("replace_lines", { path: "missing" }, workspace)).toBeUndefined();
		await writeFile(path.join(workspace, "a.v"), "");
		expect(await smallFileRefusal("replace_lines", { path: "a.v" }, workspace)).toContain("has 0 lines.");
	} finally { await rm(workspace, { recursive: true, force: true }); }
});

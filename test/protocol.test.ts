import { describe, it, expect } from "vitest";
import {
	INVALID_CALL,
	parseReply,
	renderCall,
	renderResult,
	renderToolHelp,
} from "../src/protocol.ts";
import type { ParsedReply, ToolHelp } from "../src/types.ts";

function callOf(reply: ParsedReply) {
	if (reply.kind !== "call") throw new Error(`expected call, got ${reply.kind}`);
	return reply;
}

describe("parseReply", () => {
	it("returns a final answer when there is no tool", () => {
		expect(parseReply("  All done.\nThe file is saved.  ")).toEqual({
			kind: "final",
			text: "All done.\nThe file is saved.",
		});
	});

	it("parses a call without a body", () => {
		const r = callOf(parseReply("@tool read_file\npath: rtl/gain.v\n@end"));
		expect(r.call).toEqual({ name: "read_file", args: { path: "rtl/gain.v" } });
		expect("body" in r.call).toBe(false);
		expect(r.notes).toBe("");
	});

	it("keeps the body verbatim", () => {
		const text = [
			"@tool write_file",
			"path: a.v",
			"---",
			"module a;",
			"",
			"\tassign x = y; // note: colon",
			"---",
			"  indented",
			"endmodule",
			"@end",
		].join("\n");
		const r = callOf(parseReply(text));
		expect(r.call.args).toEqual({ path: "a.v" });
		expect(r.call.body).toBe(
			"module a;\n\n\tassign x = y; // note: colon\n---\n  indented\nendmodule",
		);
	});

	it("splits header at the first colon and trims", () => {
		const r = callOf(parseReply("@tool t\n  url :  http://x:80/a  \n@end"));
		expect(r.call.args).toEqual({ url: "http://x:80/a" });
	});

	it("last duplicate key wins", () => {
		const r = callOf(parseReply("@tool t\na: 1\na: 2\n@end"));
		expect(r.call.args).toEqual({ a: "2" });
	});

	it("accepts a missing @end", () => {
		const r = callOf(parseReply("@tool write_file\npath: a.txt\n---\nline1\nline2\n"));
		expect(r.call.body).toBe("line1\nline2");
	});

	it("accepts a missing @end with no trailing newline", () => {
		const r = callOf(parseReply("@tool write_file\npath: a.txt\n---\nline1\nline2"));
		expect(r.call.body).toBe("line1\nline2");
	});

	it("handles CRLF input", () => {
		const r = callOf(parseReply("@tool write_file\r\npath: a.txt\r\n---\r\nx\r\ny\r\n@end\r\n"));
		expect(r.call.args).toEqual({ path: "a.txt" });
		expect(r.call.body).toBe("x\ny");
	});

	it("accepts the `@tool: name` variant", () => {
		expect(callOf(parseReply("@tool: list_files\n@end")).call.name).toBe("list_files");
		expect(callOf(parseReply("@tool   list_files")).call.name).toBe("list_files");
	});

	it("returns notes written before the call", () => {
		const r = callOf(parseReply("I will save the file now.\n\n@tool write_file\npath: a\n---\nx\n@end"));
		expect(r.notes).toBe("I will save the file now.");
	});

	it("drops a code fence opener at the end of the notes", () => {
		const r = callOf(parseReply("Saving.\n```text\n@tool read_file\npath: a\n@end\n```"));
		expect(r.notes).toBe("Saving.");
		expect(r.call.name).toBe("read_file");
	});

	it("unwraps a fenced body", () => {
		const r = callOf(parseReply("@tool write_file\npath: a.v\n---\n```verilog\nmodule a;\nendmodule\n```\n@end"));
		expect(r.call.body).toBe("module a;\nendmodule");
	});

	it("unwraps a fenced body when @end is missing", () => {
		const r = callOf(parseReply("@tool write_file\npath: a.v\n---\n```\nmodule a;\n```\n"));
		expect(r.call.body).toBe("module a;");
	});

	it("drops a stray closing fence", () => {
		const r = callOf(parseReply("@tool write_file\npath: a.v\n---\nmodule a;\nendmodule\n```\n"));
		expect(r.call.body).toBe("module a;\nendmodule");
	});

	it("drops a separator line the model repeated at the end of the body", () => {
		const r = callOf(parseReply("@tool write_file\npath: a.v\n---\nmodule a;\nendmodule\n---\n@end"));
		expect(r.call.body).toBe("module a;\nendmodule");
	});

	it("ignores text after @end", () => {
		const r = callOf(parseReply("@tool read_file\npath: a\n@end\nSome chatter\n@tool other\n@end"));
		expect(r.call.name).toBe("read_file");
		expect(r.call.args).toEqual({ path: "a" });
	});

	it("treats a second @tool line in the body as text", () => {
		const r = callOf(parseReply("@tool write_file\npath: a\n---\n@tool x\nmore\n@end"));
		expect(r.call.body).toBe("@tool x\nmore");
	});

	it("keeps an empty body as an empty string", () => {
		const r = callOf(parseReply("@tool write_file\npath: a\n---\n@end"));
		expect(r.call.body).toBe("");
	});

	it("is malformed when the name is missing", () => {
		expect(parseReply("Hmm.\n@tool\npath: a\n@end")).toEqual({
			kind: "malformed",
			notes: "Hmm.",
			problem: "The @tool line has no tool name.",
		});
	});

	it("is malformed when the name is invalid", () => {
		expect(parseReply("@tool read-file\n@end").kind).toBe("malformed");
	});

	it("is malformed when a header line has no colon", () => {
		expect(parseReply("@tool read_file\nnot a pair\n@end")).toEqual({
			kind: "malformed",
			notes: "",
			problem: 'Line "not a pair" is not "key: value".',
		});
	});

	it("is malformed when a key is bad", () => {
		expect(parseReply("@tool t\nbad key: 1\n@end").kind).toBe("malformed");
	});

	it("does not treat @tool in the middle of a sentence as a call", () => {
		const r = parseReply("You can write @tool name to call something.");
		expect(r.kind).toBe("final");
	});

	it("does not treat @tools as a call", () => {
		expect(parseReply("@tools are listed above").kind).toBe("final");
	});
});

describe("renderCall", () => {
	it("round-trips a call without a body", () => {
		const call = { name: "read_file", args: { path: "a/b.v", start: "3" } };
		const text = renderCall(call);
		expect(text).toBe("@tool read_file\npath: a/b.v\nstart: 3\n@end");
		const r = callOf(parseReply(text));
		expect(r.call).toEqual(call);
	});

	it("round-trips a call with a body", () => {
		const call = { name: "write_file", args: { path: "a.v" }, body: "a\n\n  b: c\n---\nd" };
		const r = callOf(parseReply(renderCall(call)));
		expect(r.call).toEqual(call);
	});

	it("round-trips a body that ends in a newline", () => {
		const call = { name: "write_file", args: { path: "a.v" }, body: "a\n" };
		const r = callOf(parseReply(renderCall(call)));
		expect(r.call.body).toBe("a\n");
	});

	it("round-trips an empty body", () => {
		const call = { name: "write_file", args: {}, body: "" };
		const r = callOf(parseReply(renderCall(call)));
		expect(r.call).toEqual(call);
	});
});

describe("renderResult", () => {
	it("renders ok", () => {
		expect(renderResult("read_file", true, "hello\n\n")).toBe("@result read_file ok\nhello");
	});

	it("renders error", () => {
		expect(renderResult("read_file", false, "no such file")).toBe("@result read_file error\nno such file");
	});

	it("renders only the first line for empty text", () => {
		expect(renderResult("write_file", true, "  \n")).toBe("@result write_file ok");
		expect(renderResult("write_file", false, "")).toBe("@result write_file error");
	});
});

describe("renderToolHelp", () => {
	const tools: ToolHelp[] = [
		{
			name: "write_file",
			summary: "Create or overwrite a file.",
			args: [{ name: "path", type: "string", required: true, help: "file path in the project" }],
			body: { help: "the full file content" },
		},
		{
			name: "read_file",
			summary: "Read a file.",
			args: [
				{ name: "path", type: "string", required: true, help: "file path" },
				{ name: "start", type: "number", required: false, help: "first line" },
			],
		},
	];

	it("lists tools, marks required args and mentions the body", () => {
		const help = renderToolHelp(tools);
		expect(help).toContain("- write_file: Create or overwrite a file.");
		expect(help).toContain("- read_file: Read a file.");
		expect(help).toContain("    path (required, text): file path in the project");
		expect(help).toContain("    start (optional, number): first line");
		expect(help).toContain("    then a --- line and the full file content");
		// One example without text and one with, built from the real tools.
		expect(help).toContain("@tool read_file\npath: notes.txt\n@end");
		expect(help).toContain("@tool write_file\npath: notes.txt\n---\nfirst line\nsecond line\n@end");
		expect(help).toContain("Tools:");
	});

	it("keeps the order: instructions, examples, rules, tools", () => {
		const help = renderToolHelp(tools);
		const order = ["One tool per reply", "@tool read_file", "@tool write_file", "no code fence", "no @tool block", "Tools:"];
		const positions = order.map((s) => help.indexOf(s));
		expect(positions.every((p) => p >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it("stays short", () => {
		expect(renderToolHelp(tools).length).toBeLessThan(1200);
	});

	it("exports the invalid call name", () => {
		expect(INVALID_CALL).toBe("invalid_call");
	});
});

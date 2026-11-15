export function autofixVerilog(text: string): { text: string; notes: string[] } {
	let count = 0;
	let first = "";
	let replacement = "";
	const fixed = text.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|(?<![\w$'])\d+'[sS]?[dD][ \t]*-[ \t]*\d+(?![\w$])/g, (token) => {
		if (token.startsWith("/") || token.startsWith('"')) return token;
		const value = `-${token.match(/\d+$/)![0]}`;
		if (count++ === 0) { first = token; replacement = value; }
		return value;
	});
	return { text: fixed, notes: count ? [`Fixed ${count} constant(s): ${first} -> ${replacement} (a sized constant cannot contain a minus sign).`] : [] };
}

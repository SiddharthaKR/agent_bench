export interface ResultRow {
	when: string;
	suite: string;
	level: string;
	server: string;
	model: string;
	setup: string;
	pass: boolean;
	verdict: string;
	toolCalls: number | null;
	seconds: number | null;
	trace: string | null;
}

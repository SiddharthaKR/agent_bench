import { useEffect, useState } from "react";
import type { ResultRow } from "../../../src/shared/results.ts";
import { api } from "../api.ts";
import { filterOptions, filterResults, formatSeconds, summarizeResults } from "./logic.ts";
import type { ResultFilters } from "./logic.ts";
import "./results.css";

export function ResultsScreen() {
	const [rows, setRows] = useState<ResultRow[]>([]);
	const [filters, setFilters] = useState<ResultFilters>({ suite: "", level: "", model: "" });
	const [revision, setRevision] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	useEffect(() => {
		let active = true;
		setLoading(true);
		api.results().then((next) => {
			if (active) { setRows(next); setError(""); }
		}, (reason: unknown) => {
			if (active) setError(reason instanceof Error ? reason.message : "Could not load results.");
		}).finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [revision]);
	const filtered = filterResults(rows, filters);
	const summaries = summarizeResults(filtered);
	return (
		<section className="results-screen">
			<header className="results-header">
				<h1>Results</h1>
				<button type="button" className="btn" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Reload</button>
				{(["suite", "level", "model"] as const).map((key) => (
					<label className="field" key={key}>
						{key === "suite" ? "Suite" : key === "level" ? "Level" : "Model"}
						<select className="input" value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}>
							<option value="">All</option>
							{filterOptions(rows, key).map((value) => <option key={value} value={value}>{value}</option>)}
						</select>
					</label>
				))}
			</header>
			{error && <p className="tone-bad" role="alert">{error}</p>}
			{loading && <p className="muted" role="status">Loading results…</p>}
			{!loading && !error && rows.length === 0 ? <p className="muted">No scored runs yet. Runs of scripts/eval_local.sh and scripts/h_task.sh are listed here.</p> : <>
				<div className="results-summaries">
					{summaries.map((group) => (
						<article className="card results-summary" key={JSON.stringify([group.suite, group.level, group.model, group.setup])}>
							<div className="small muted">{group.suite} {group.level} · {group.setup}</div>
							<div className="small mono results-model">{group.model}</div>
							<div className="results-count">{group.passed} of {group.total} passed</div>
							<div className="results-rate" role="meter" aria-label="Pass rate" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100 * group.passed / group.total}>
								<div style={{ width: `${100 * group.passed / group.total}%` }} />
							</div>
						</article>
					))}
				</div>
				<section className="card results-runs">
					<h2>All runs</h2>
					<div className="results-scroll">
						<div className="results-grid" role="table" aria-label="All runs">
							<div className="results-row results-columns small muted" role="row">
								{["When", "Suite", "Level", "Setup", "Model", "Verdict", "Tool calls", "Time"].map((label) => <div key={label} role="columnheader">{label}</div>)}
							</div>
							{filtered.map((row, index) => (
								<div className="results-row" role="row" key={`${row.when}-${index}`}>
									<div role="cell">{new Date(row.when).toLocaleString()}</div>
									<div role="cell">{row.suite}</div><div role="cell">{row.level}</div><div role="cell">{row.setup}</div>
									<div className="mono" role="cell">{row.model}</div>
									<div className={row.verdict === "PASS" ? "tone-ok" : "tone-bad"} role="cell">{row.verdict}</div>
									<div role="cell">{row.toolCalls ?? "—"}</div><div role="cell">{formatSeconds(row.seconds)}</div>
								</div>
							))}
						</div>
					</div>
					{!loading && rows.length > 0 && filtered.length === 0 && <p className="muted results-no-match">No runs match these filters.</p>}
				</section>
			</>}
		</section>
	);
}

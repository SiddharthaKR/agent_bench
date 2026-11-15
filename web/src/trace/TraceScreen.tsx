import { useEffect, useRef, useState } from "react";
import type { ScreenProps } from "../App.tsx";
import type { TraceDetail, TraceInfo, TraceRow } from "../../../src/shared/trace.ts";
import { api } from "../api.ts";
import { filterRows, formatElapsed, formatTokens, isTraceError } from "./logic.ts";
import "./trace.css";

function TimelineRow({ row }: { row: TraceRow }) {
	const [expanded, setExpanded] = useState(false);
	const [raw, setRaw] = useState(false);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState("");
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	async function copy() {
		try {
			await navigator.clipboard.writeText(row.text);
			setCopied(true);
			setError("");
			clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 1500);
		} catch { setError("Could not copy text."); }
	}
	return (
		<div className={`trace-event card${isTraceError(row.kind) ? " trace-event-error" : ""}`}>
			<button type="button" className="trace-row" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
				<span className="trace-direction small muted">{row.kind === "question" ? "agent / user" : row.direction === "sent" ? "agent → model" : "model → agent"}</span>
				<span className="trace-tag" data-kind={row.kind}>{row.kind}</span>
				<span className="trace-title">{row.title || row.kind}</span>
				<span className="small muted">#{row.call}</span>
			</button>
			{expanded && <div className="trace-expanded">
				<div className="small muted">{row.meta}</div>
				<pre className="trace-text mono">{row.text}</pre>
				<div className="trace-actions">
					<button type="button" className="btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
					<button type="button" className="btn" aria-pressed={raw} onClick={() => setRaw(!raw)}>Raw JSON</button>
				</div>
				{error && <div className="small tone-bad" role="alert">{error}</div>}
				{raw && <pre className="trace-text mono">{JSON.stringify(row.raw, null, 1)}</pre>}
			</div>}
		</div>
	);
}

export function TraceScreen(_props: ScreenProps) {
	const [runs, setRuns] = useState<TraceInfo[]>([]);
	const [selected, setSelected] = useState("");
	const [detail, setDetail] = useState<TraceDetail | null>(null);
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [follow, setFollow] = useState(false);
	const [reload, setReload] = useState(0);
	const [revision, setRevision] = useState(0);
	const [listError, setListError] = useState("");
	const [detailError, setDetailError] = useState("");

	useEffect(() => {
		let active = true;
		let pending = false;
		async function refresh() {
			if (pending) return;
			pending = true;
			try {
				const list = await api.traces();
				if (!active) return;
				setRuns(list);
				setListError("");
				setSelected((previous) => follow ? (list[0]?.id ?? "") : list.some((run) => run.id === previous) ? previous : (list[0]?.id ?? ""));
				setRevision((value) => value + 1);
			} catch (error) {
				if (active) setListError(error instanceof Error ? error.message : "Could not load traces.");
			} finally { pending = false; }
		}
		void refresh();
		const interval = follow ? setInterval(() => void refresh(), 3000) : undefined;
		return () => { active = false; clearInterval(interval); };
	}, [follow, reload]);

	useEffect(() => {
		let active = true;
		setDetailError("");
		if (!selected) { setDetail(null); return; }
		api.trace(selected).then((value) => {
			if (active) setDetail(value);
		}, (error: unknown) => {
			if (active) {
				setDetail(null);
				setDetailError(error instanceof Error ? error.message : "Could not load trace.");
			}
		});
		return () => { active = false; };
	}, [selected, revision]);

	const current = detail?.info.id === selected ? detail : null;
	const info = current?.info ?? runs.find((run) => run.id === selected);
	const rows = filterRows(current?.rows ?? [], errorsOnly);
	return (
		<section className="trace-screen">
			<header className="trace-header">
				<h1>Trace</h1>
				<span className="muted trace-agent">{info && `${info.agent} · ${info.model}`}</span>
				<label className="check"><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />Errors only</label>
				<label className="check"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />Follow the latest run</label>
				<button type="button" className="btn" onClick={() => setReload((value) => value + 1)}>Reload</button>
			</header>
			{(listError || detailError) && <div className="tone-bad" role="alert">{listError || detailError}</div>}
			<div className="trace-columns">
				<aside className="trace-runs card" aria-label="Runs">
					<div className="label">Runs</div>
					{runs.length === 0 && <p className="muted">No runs yet. Every agent run is recorded here.</p>}
					{runs.map((run) => <button type="button" key={run.id} className="trace-run" aria-pressed={selected === run.id} onClick={() => setSelected(run.id)}>
						<span>{run.task.slice(0, 60) || "Chat session"}</span>
						<span className="small muted">{new Date(run.startedAt).toLocaleString()} · {run.modelCalls} model calls · {run.ended ? `ended: ${run.reason ?? "unknown"}` : "running"}</span>
					</button>)}
				</aside>
				<div className="trace-content">
					<div className="trace-stats">
						{[["Questions", current?.info.questions ?? 0], ["Unanswered", current?.info.unanswered ?? 0], ["LLM calls", current?.info.modelCalls ?? 0], ["Context (last)", formatTokens(current?.contextTokens ?? 0)], ["Tool errors", current?.info.toolErrors ?? 0], ["Elapsed", formatElapsed(current?.elapsedMs ?? 0)]].map(([label, value]) => <div className="card trace-stat" key={label}><div className="label">{label}</div><div>{value}</div></div>)}
					</div>
					<div className="trace-timeline">
						{rows.length === 0 ? <p className="muted">Nothing to show.</p> : rows.map((row) => <TimelineRow key={`${selected}:${row.id}`} row={row} />)}
					</div>
				</div>
			</div>
		</section>
	);
}

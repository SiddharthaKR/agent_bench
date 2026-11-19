import { useEffect, useMemo, useRef, useState } from "react";
import type { EvalEvent, EvalProblems, EvalRunState, Workflow, WorkflowEvent } from "../../../src/shared/api.ts";
import { api, evalEventsUrl, listen } from "../api.ts";
import { applyRunEvent, evalTotals, pickProblems } from "./logic.ts";
import type { RunView } from "./logic.ts";

interface Props {
	workflow: Workflow;
	server: string;
	busy: boolean;
	/** Shows one problem's live run in the step cards and graph; undefined gives them back. */
	show: (view: RunView | undefined) => void;
}

type Choice = "dev" | "heldout" | "all" | "pick";

export function EvalPanel({ workflow, server, busy, show }: Props) {
	const [problems, setProblems] = useState<EvalProblems | undefined>();
	const [error, setError] = useState("");
	const [choice, setChoice] = useState<Choice>("dev");
	const [ticked, setTicked] = useState<string[]>([]);
	const [filter, setFilter] = useState("");
	const [repeats, setRepeats] = useState(1);
	const [runId, setRunId] = useState("");
	const [state, setState] = useState<EvalRunState | undefined>();
	const [selected, setSelected] = useState("");
	const events = useRef(new Map<string, WorkflowEvent[]>());
	const [tick, setTick] = useState(0);
	const close = useRef<(() => void) | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		api.evalProblems().then((value) => { if (!cancelled) setProblems(value); }, (caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); });
		return () => { cancelled = true; close.current?.(); };
	}, []);

	// The step cards follow the chosen problem, or the one running now.
	const focus = selected || state?.problems.find((item) => item.status === "running")?.key || "";
	useEffect(() => {
		if (!runId || !focus) return;
		let view: RunView = { id: `${runId}/${focus}`, workflow, folder: state?.folder ?? "", lines: {} };
		for (const event of events.current.get(focus) ?? []) view = applyRunEvent(view, event);
		show(view);
	}, [runId, focus, tick]);

	const all = useMemo(() => problems ? [...problems.dev, ...problems.heldout].sort() : [], [problems]);
	const chosen = problems ? pickProblems(problems, choice, ticked) : [];
	const running = state?.status === "running";
	const totals = state ? evalTotals(state) : [];

	async function start() {
		setError("");
		try {
			close.current?.();
			events.current = new Map();
			setSelected("");
			setState(undefined);
			const { id } = await api.startEval({ workflowId: workflow.id, server, problems: chosen, repeats });
			setRunId(id);
			close.current = listen<EvalEvent>(evalEventsUrl(id), (event) => {
				if (event.type === "eval") setState(event.state);
				else {
					const list = events.current.get(event.key) ?? [];
					list.push(event.event);
					events.current.set(event.key, list);
				}
				setTick((value) => value + 1);
			});
		} catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
	}

	if (!problems) return <section className="card wf-eval"><span className="label">Run on VerilogEval</span><p className="muted">{error || "Loading problems…"}</p></section>;
	const shown = all.filter((name) => name.toLowerCase().includes(filter.toLowerCase()));
	return <section className="card wf-eval">
		<div className="wf-row wf-between"><span className="label">Run on VerilogEval</span>{state && <span className="small muted mono">{state.folder}</span>}</div>
		<div className="wf-row wf-eval-controls">
			{([["dev", `Dev (${problems.dev.length})`], ["heldout", `Held-out (${problems.heldout.length})`], ["all", `All (${all.length})`], ["pick", `Choose (${ticked.length})`]] as const).map(([value, label]) => <button type="button" key={value} className="btn wf-choice" aria-pressed={choice === value} disabled={running} onClick={() => setChoice(value)}>{label}</button>)}
			<label className="wf-eval-repeats">Repeats<input className="input" type="number" min={1} max={10} value={repeats} disabled={running} onChange={(event) => setRepeats(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>
			<button type="button" className={`btn ${running ? "btn-danger" : "btn-primary"}`} disabled={busy || (!running && !chosen.length)} onClick={running ? () => void api.stopEval(runId) : () => void start()}>{running ? "Stop" : `Run ${chosen.length * repeats} problem run${chosen.length * repeats === 1 ? "" : "s"}`}</button>
		</div>
		{choice === "pick" && !running && <div className="wf-eval-pick">
			<div className="wf-row"><input className="input" placeholder="Filter, e.g. fsm" value={filter} onChange={(event) => setFilter(event.target.value)} /><button type="button" className="btn btn-ghost" onClick={() => setTicked([...new Set([...ticked, ...shown])])}>Tick shown</button><button type="button" className="btn btn-ghost" onClick={() => setTicked([])}>Clear</button></div>
			<div className="wf-eval-list">{shown.map((name) => <label className="check" key={name}><input type="checkbox" checked={ticked.includes(name)} onChange={(event) => setTicked(event.target.checked ? [...ticked, name] : ticked.filter((item) => item !== name))} /><span className="mono small">{name}</span>{problems.dev.includes(name) && <span className="pill">dev</span>}</label>)}</div>
		</div>}
		{!workflow.steps.some((step) => step.type === "judge") && <div className="small muted">This workflow has no VerilogEval judge step, so the runs get no verdict. Add one to score them.</div>}
		{error && <div role="alert" className="tone-bad">{error}</div>}
		{state && <>
			<div className="wf-counts">{totals.map((total) => <div className="card wf-stat" key={total.id}><span className="small muted">{total.name}</span><strong>PASS {total.pass} of {total.judged}</strong></div>)}<div className="card wf-stat"><span className="small muted">Problems</span><strong>{state.problems.filter((item) => item.status === "done").length} of {state.problems.length} {state.status === "running" ? "· running" : `· ${state.status}`}</strong></div></div>
			{state.error && <div role="alert" className="tone-bad">{state.error}</div>}
			<div className="wf-eval-table" role="table">
				<div className="wf-eval-row wf-eval-head" role="row"><span role="columnheader">Problem</span>{state.judges.map((judge) => <span role="columnheader" key={judge.id}>{judge.name}</span>)}<span role="columnheader">Seconds</span></div>
				{state.problems.map((item) => <button type="button" role="row" key={item.key} className={`btn btn-ghost wf-eval-row ${focus === item.key ? "wf-eval-focus" : ""}`} aria-pressed={focus === item.key} onClick={() => setSelected(item.key === selected ? "" : item.key)}>
					<span className="mono small">{item.key}</span>
					{state.judges.map((judge) => { const verdict = item.verdicts[judge.id]; return <span key={judge.id} className={verdict === "PASS" ? "tone-ok" : verdict ? "tone-bad" : "muted"}>{verdict ?? (item.status === "running" ? "running…" : item.status === "waiting" ? "waiting" : "—")}</span>; })}
					<span className="small muted">{item.seconds ? item.seconds.toFixed(0) : ""}</span>
				</button>)}
			</div>
			<div className="small muted">Click a problem to see its steps above; click again to follow the running one.</div>
		</>}
	</section>;
}

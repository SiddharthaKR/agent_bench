import { QuestionCard } from "../QuestionCard.tsx";
import { useEffect, useRef, useState } from "react";
import type { ScreenProps } from "../App.tsx";
import type { Workflow, WorkflowEvent } from "../../../src/shared/api.ts";
import { api, listen, runEventsUrl } from "../api.ts";
import { applyRunEvent, countRuns, nextId, removeStep, runStatus } from "./logic.ts";
import type { RunView } from "./logic.ts";
import { StepCard } from "./StepCard.tsx";
import { EvalPanel } from "./EvalPanel.tsx";
import { WorkflowGraph } from "./WorkflowGraph.tsx";
import "./workflows.css";

function sentence(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function WorkflowsScreen(props: ScreenProps) {
	const [workflows, setWorkflows] = useState<Workflow[]>([]);
	const drafts = useRef<Workflow[]>([]);
	const [selected, setSelected] = useState("");
	const [saved, setSaved] = useState<Record<string, string>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [runs, setRuns] = useState<Record<string, RunView>>({});
	const [open, setOpen] = useState<Record<string, boolean>>({});
	const [variableRows, setVariableRows] = useState<Record<string, [string, string][]>>({});
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	const saves = useRef(new Map<string, Promise<void>>());
	const deleting = useRef(new Set<string>());
	const closeStream = useRef<(() => void) | undefined>(undefined);
	const active = useRef<{ workflowId: string; id: string } | undefined>(undefined);
	const cards = useRef(new Map<string, HTMLElement>());
	const mounted = useRef(true);
	const workflow = workflows.find((item) => item.id === selected);
	const run = runs[selected];
	const state = run?.state;
	const status = runStatus(state, run?.workflow.steps ?? workflow?.steps ?? []);
	const report = (id: string, error: unknown) => {
		if (mounted.current) setErrors((previous) => ({ ...previous, [id]: sentence(error) }));
	};
	const clearError = (id: string) => setErrors((previous) => ({ ...previous, [id]: "" }));
	const replaceWorkflows = (next: Workflow[]) => {
		drafts.current = next;
		setWorkflows(next);
	};

	function save(item: Workflow): Promise<void> {
		const previous = saves.current.get(item.id) ?? Promise.resolve();
		const pending = previous.catch(() => {}).then(async () => {
			await api.saveWorkflow(item);
			if (mounted.current) {
				setSaved((old) => ({ ...old, [item.id]: JSON.stringify(item) }));
				setSaveErrors((old) => ({ ...old, [item.id]: "" }));
			}
		});
		saves.current.set(item.id, pending);
		return pending;
	}

	function scheduleSave(next: Workflow) {
		clearTimeout(timers.current.get(next.id));
		timers.current.set(next.id, setTimeout(() => {
			timers.current.delete(next.id);
			void save(next).catch((error: unknown) => {
				if (mounted.current) setSaveErrors((old) => ({ ...old, [next.id]: sentence(error) }));
			});
		}, 800));
	}

	function edit(next: Workflow) {
		if (deleting.current.has(next.id)) return;
		replaceWorkflows(drafts.current.map((item) => item.id === next.id ? next : item));
		scheduleSave(next);
	}

	useEffect(() => {
		mounted.current = true;
		let cancelled = false;
		void api.workflows().then((items) => {
			if (cancelled) return;
			replaceWorkflows(items);
			setSaved(Object.fromEntries(items.map((item) => [item.id, JSON.stringify(item)])));
			setVariableRows(Object.fromEntries(items.map((item) => [item.id, Object.entries(item.vars)])));
			setSelected(items[0]?.id ?? "");
		}, (error: unknown) => { if (!cancelled) report("", error); }).finally(() => {
			if (!cancelled) setLoading(false);
		});
		return () => {
			cancelled = true;
			mounted.current = false;
			closeStream.current?.();
			for (const timer of timers.current.values()) clearTimeout(timer);
		};
	}, []);

	async function action(id: string, operation: () => Promise<unknown>) {
		setBusy(true);
		clearError(id);
		try { await operation(); } catch (error) { report(id, error); }
		finally { if (mounted.current) setBusy(false); }
	}

	function createWorkflow() {
		void action("", async () => {
			const item: Workflow = { id: nextId("workflow", drafts.current.map((item) => item.id)), name: "New workflow", task: "", vars: {}, steps: [] };
			await save(item);
			replaceWorkflows([...drafts.current, item]);
			setSelected(item.id);
			setVariableRows((rows) => ({ ...rows, [item.id]: [] }));
		});
	}

	function deleteWorkflow() {
		if (!workflow || !window.confirm("Delete this workflow?")) return;
		const id = workflow.id;
		deleting.current.add(id);
		clearTimeout(timers.current.get(id));
		timers.current.delete(id);
		void action(id, async () => {
			try {
				await saves.current.get(id)?.catch(() => {});
				await api.deleteWorkflow(id);
				const remaining = drafts.current.filter((item) => item.id !== id);
				replaceWorkflows(remaining);
				setSelected((current) => current === id ? remaining[0]?.id ?? "" : current);
				setRuns((previous) => { const next = { ...previous }; delete next[id]; return next; });
			} catch (error) {
				const draft = drafts.current.find((item) => item.id === id);
				if (draft && mounted.current) scheduleSave(draft);
				throw error;
			} finally { deleting.current.delete(id); }
		});
	}

	function connect(initial: RunView) {
		if (!mounted.current) return;
		closeStream.current?.();
		active.current = { workflowId: initial.workflow.id, id: initial.id };
		setRuns((previous) => ({ ...previous, [initial.workflow.id]: initial }));
		closeStream.current = listen<WorkflowEvent>(runEventsUrl(initial.id), (event) => {
			if (!mounted.current) return;
			setRuns((previous) => {
				const prior = previous[initial.workflow.id];
				if (!prior || prior.id !== initial.id) return previous;
				return { ...previous, [initial.workflow.id]: applyRunEvent(prior, event) };
			});
		});
	}

	async function stopOtherRun(exceptId?: string) {
		const old = active.current;
		if (!old || old.id === exceptId) return;
		const oldRun = runs[old.workflowId];
		if (!oldRun?.state || oldRun.state.status === "running" || oldRun.state.status === "waiting" || oldRun.state.status === "paused") {
			await api.stopRun(old.id);
			if (!mounted.current) return;
			setRuns((previous) => {
				const prior = previous[old.workflowId];
				return prior ? { ...previous, [old.workflowId]: { ...prior, state: { round: 1, current: null, steps: [], log: [], ...prior.state, status: "stopped" } } } : previous;
			});
		}
	}

	function start() {
		if (!workflow) return;
		const currentWorkflow = workflow;
		void action(workflow.id, async () => {
			await stopOtherRun();
			if (!mounted.current) return;
			const { id } = await api.startRun({ workflow: currentWorkflow, folder: props.folder, server: props.server, task: currentWorkflow.task });
			const initial: RunView = { id, workflow: currentWorkflow, folder: props.folder, lines: {} };
			connect(initial);
		});
	}

	function resume(stepId?: string) {
		if (!run || !workflow) return;
		void action(workflow.id, async () => {
			await stopOtherRun(run.id);
			if (!mounted.current) return;
			await api.resumeRun(run.id, stepId);
			if (active.current?.id !== run.id) connect({ id: run.id, workflow: run.workflow, folder: run.folder, lines: {} });
		});
	}
	function stop() {
		if (run && workflow) void action(workflow.id, () => api.stopRun(run.id));
	}
	function showStep(id: string) {
		setOpen((previous) => ({ ...previous, [`${selected}/${id}`]: true }));
		requestAnimationFrame(() => cards.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
	}
	function updateVariables(rows: [string, string][]) {
		if (!workflow) return;
		setVariableRows((previous) => ({ ...previous, [workflow.id]: rows }));
		edit({ ...workflow, vars: Object.fromEntries(rows.filter(([name]) => name !== "")) });
	}

	const counts = countRuns(run?.workflow.steps ?? [], state?.steps ?? []);
	// A VerilogEval problem shown in the cards is driven by the panel below, not by these buttons.
	const evalView = run?.id.includes("/") ?? false;
	const canResume = !evalView && state && ["failed", "stopped", "paused"].includes(state.status);
	const running = !!run && (!state || state.status === "running" || state.status === "waiting");
	const paused = state?.status === "paused";
	const mainText = running ? "Stop" : paused ? "Continue" : state && state.status !== "idle" ? "Run again" : "Run workflow";
	const rows = variableRows[selected] ?? [];

	return <div className="wf-screen">
		<header className="wf-row"><h1>Workflows</h1><span className={`pill ${status.tone}`} role="status">{status.text}</span><span className="muted">Plain code runs the steps in order. The model is used only inside agent steps.</span></header>
		<section className="card wf-workflow">
			<div className="wf-row wf-between"><div className="wf-row wf-choices"><span className="label">Workflow</span>{workflows.map((item) => <button type="button" className="btn wf-choice" key={item.id} aria-label={item.name || "Unnamed workflow"} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.name || "Unnamed workflow"}</button>)}<button type="button" className="btn btn-dashed" disabled={loading || busy} onClick={createWorkflow}>New workflow</button></div>{workflow && <span className={`pill ${saved[selected] === JSON.stringify(workflow) ? "" : "warn"}`}>{saved[selected] === JSON.stringify(workflow) ? "Saved" : "Unsaved"}</span>}</div>
			{!workflow && <p className="muted">{loading ? "Loading workflows…" : "No workflows yet."}</p>}
			{workflow && <>
				<div className="wf-fields"><label>Name<input className="input" disabled={busy} value={workflow.name} onChange={(event) => edit({ ...workflow, name: event.target.value })} /></label><label className="wf-task">Task for this run<input className="input" disabled={busy} value={workflow.task} onChange={(event) => edit({ ...workflow, task: event.target.value })} /></label><div className="wf-actions"><button type="button" className={`btn ${running && !evalView ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={evalView ? () => setRuns((previous) => { const next = { ...previous }; delete next[selected]; return next; }) : running ? stop : paused ? () => resume() : start}>{evalView ? "Clear the VerilogEval view" : mainText}</button>{paused && <button type="button" className="btn btn-danger" disabled={busy} onClick={stop}>Stop</button>}</div></div>
				{[errors[selected], saveErrors[selected], errors[""]].filter(Boolean).map((error, index) => <div key={index} role="alert" className="tone-bad">{error}</div>)}
				<div className="wf-variables"><span className="label">Variables</span>{rows.map(([name, value], index) => <div className="wf-variable" key={index}><label>Name<input className="input" disabled={busy} value={name} onChange={(event) => updateVariables(rows.map((row, n) => n === index ? [event.target.value, value] : row))} /></label><label>Value<input className="input" disabled={busy} value={value} onChange={(event) => updateVariables(rows.map((row, n) => n === index ? [name, event.target.value] : row))} /></label><button type="button" className="btn btn-ghost" disabled={busy} aria-label={`Remove variable ${name || index + 1}`} onClick={() => updateVariables(rows.filter((_, n) => n !== index))}>Remove</button></div>)}<div><button type="button" className="btn" disabled={busy} onClick={() => updateVariables([...rows, ["", ""]])}>Add variable</button></div><div className="small muted">Use {"{name}"} in tasks and commands. {"{task}"} is the task for this run.</div></div>
				<div><button type="button" className="btn btn-ghost" disabled={busy} onClick={deleteWorkflow}>Delete workflow</button></div>
			</>}
			{!workflow && errors[""] && <div role="alert" className="tone-bad">{errors[""]}</div>}
		</section>
		{workflow && <EvalPanel key={workflow.id} workflow={workflow} server={props.server} busy={busy} show={(view) => {
			if (!mounted.current) return;
			setRuns((previous) => {
				const next = { ...previous };
				if (view) next[workflow.id] = view;
				else delete next[workflow.id];
				return next;
			});
		}} />}
		{workflow && <>
			{workflow.steps.length > 0 && <WorkflowGraph steps={workflow.steps} results={state?.steps ?? []} open={showStep} />}
			<div className="wf-columns">
				<div className="wf-steps">
					{workflow.steps.length === 0 && <p className="muted">This workflow has no steps yet. Add a step to begin.</p>}
					{workflow.steps.map((step, index) => <StepCard key={`${workflow.id}/${step.id}`} step={step} index={index} steps={workflow.steps} agents={props.config.agents} result={state?.steps.find((result) => result.stepId === step.id)} line={run?.lines[step.id]} open={open[`${selected}/${step.id}`] ?? false} canResume={!!canResume} busy={busy} register={(element) => { if (element) cards.current.set(step.id, element); else cards.current.delete(step.id); }} toggle={() => setOpen((previous) => ({ ...previous, [`${selected}/${step.id}`]: !previous[`${selected}/${step.id}`] }))} change={(next) => edit({ ...workflow, steps: workflow.steps.map((item) => item.id === next.id ? next : item) })} move={(direction) => {
						const steps = [...workflow.steps];
						const other = steps[index + direction];
						if (!other) return;
						steps[index] = other;
						steps[index + direction] = step;
						edit({ ...workflow, steps: steps.map((item, n) => {
							if (!item.onFail || steps.findIndex((target) => target.id === item.onFail?.goTo) <= n) return item;
							const { onFail: _, ...rest } = item;
							return rest;
						}) });
					}} remove={() => edit({ ...workflow, steps: removeStep(workflow.steps, step.id) })} resume={() => resume(step.id)} />)}
					<button type="button" className="btn btn-dashed wf-add" disabled={busy} onClick={() => {
						const id = nextId("step", workflow.steps.map((step) => step.id));
						edit({ ...workflow, steps: [...workflow.steps, { id, name: "New step", type: "agent", agent: props.agent || props.config.agents[0]?.id || "", task: "" }] });
						setOpen((previous) => ({ ...previous, [`${selected}/${id}`]: true }));
					}}>Add step</button>
				</div>
				<aside className="wf-panel">
					{run?.question && state?.status === "waiting" && <QuestionCard key={run.question.id} question={run.question} answer={(text) => api.answerRun(run.id, run.question!.id, text)} />}
					<div className="wf-counts">{[["Round", state?.round ?? "—"], ["Agent steps run", counts.agent], ["Command steps run", counts.command]].map(([label, value]) => <div className="card wf-stat" key={label}><span className="small muted">{label}</span><strong>{value}</strong></div>)}</div>
					<section className="card wf-panel-card"><span className="label">Result</span>{run?.lastCommand ? <><div>{run.lastCommand.name}</div><pre className="mono wf-output">{run.lastCommand.result.text.split("\n").map((line, index) => <span key={index} className={/FAIL|error/i.test(line) ? "tone-bad" : /PASS/.test(line) ? "tone-ok" : ""}>{line}{"\n"}</span>)}</pre></> : <p className="muted">Nothing yet. The output of the last command step shows up here.</p>}</section>
					<section className="card wf-panel-card"><span className="label">Rounds</span>{state?.log.length ? <div className="wf-log">{state.log.map((line, index) => <div key={index}>{line}</div>)}</div> : <p className="muted">Nothing yet. Each loop back and each finished round is listed here.</p>}</section>
					<div className="small muted wf-folder">{run?.folder ?? props.folder}</div>
				</aside>
			</div>
		</>}
	</div>;
}

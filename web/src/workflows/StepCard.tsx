import { useState } from "react";
import type { AgentInfo, StepRun, WorkflowStep } from "../../../src/shared/api.ts";
import { commandToText, parseCommand, setAgentSetting, setStepTools, stepStatus } from "./logic.ts";

interface Props {
	step: WorkflowStep;
	index: number;
	steps: WorkflowStep[];
	agents: AgentInfo[];
	result?: StepRun;
	line?: string;
	open: boolean;
	canResume: boolean;
	busy: boolean;
	toggle: () => void;
	change: (step: WorkflowStep) => void;
	move: (direction: number) => void;
	remove: () => void;
	resume: () => void;
	register: (element: HTMLElement | null) => void;
}

function CommandField({ command, change }: { command: string[]; change: (command: string[]) => void }) {
	const [text, setText] = useState(() => commandToText(command));
	return <label className="wf-wide">Command
		<input className="input mono" value={text} onChange={(event) => {
			setText(event.target.value);
			change(parseCommand(event.target.value));
		}} onBlur={() => setText(commandToText(command))} />
	</label>;
}

export function StepCard(props: Props) {
	const { step, index, steps, result, change } = props;
	const status = stepStatus(result?.status);
	const target = steps.findIndex((item) => item.id === step.onFail?.goTo);
	const editorId = `wf-editor-${step.id}`;
	return <section ref={props.register} className={`card wf-step wf-step-${result?.status ?? "waiting"}`}>
		<button type="button" className="btn btn-ghost wf-step-header" aria-expanded={props.open} aria-controls={editorId} onClick={props.toggle}>
			<span className="muted">{index + 1}</span>
			<span className="wf-step-heading"><span>{step.name}</span> <span className="pill">{step.type === "agent" ? "Agent" : "Command"}</span>
				<span className="mono muted wf-ellipsis">{step.type === "agent" ? step.agent : commandToText(step.command)}</span>
			</span>
			<span className={status.tone}>{status.text}</span><span aria-hidden="true">{props.open ? "▴" : "▾"}</span>
		</button>
		<div className="wf-step-body">
			<div className="small muted">{step.onFail ? `If it fails: back to step ${target + 1}, at most ${step.onFail.maxRounds} rounds` : "If it fails: stop and ask me"}{step.once ? " · runs only once" : ""}{step.pause ? " · pauses for me after" : ""}</div>
			{result?.text && <pre className={`mono wf-result ${result.status === "failed" ? "wf-result-failed" : ""}`}>{result.text}</pre>}
			{result?.status === "running" && props.line && <div className="small muted wf-live">{props.line}</div>}
			{props.canResume && <button type="button" className="btn" disabled={props.busy} onClick={props.resume}>Run from this step</button>}
			{props.open && <fieldset id={editorId} className="wf-editor" disabled={props.busy} aria-label={`Edit step ${index + 1}`}>
				<label>Step name<input className="input" value={step.name} onChange={(event) => change({ ...step, name: event.target.value })} /></label>
				<label>Type<select className="input" value={step.type} onChange={(event) => {
					const { id, name, onFail, pause, once } = step;
					const base = { id, name, onFail, pause, once };
					change(event.target.value === "agent" ? { ...base, type: "agent", agent: props.agents[0]?.id ?? "", task: "" } : { ...base, type: "command", command: [], timeoutSec: 60 });
				}}><option value="agent">Agent step, uses the model</option><option value="command">Command step, no model</option></select></label>
				{step.type === "agent" ? <>
					<label>Agent<select className="input" value={step.agent} onChange={(event) => change(setStepTools({ ...step, agent: event.target.value }, []))}>
						{!props.agents.some((agent) => agent.id === step.agent) && <option value={step.agent}>{step.agent || "Choose an agent"}</option>}
						{props.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.id})</option>)}
					</select></label>
					<div className="wf-wide label">Settings for this step</div>
					<label>Model<input className="input" placeholder="server default" value={step.model ?? ""} onChange={(event) => change(setAgentSetting(step, "model", event.target.value))} /></label>
					<label>Temperature<input className="input" type="number" step={0.1} placeholder="server default" value={step.temperature ?? ""} onChange={(event) => change(setAgentSetting(step, "temperature", event.target.value))} /></label>
					<label>Most tool calls<input className="input" type="number" min={1} max={200} placeholder="agent default" value={step.maxTurns ?? ""} onChange={(event) => change(setAgentSetting(step, "maxTurns", event.target.value))} /></label>
					<div className="wf-wide"><span className="label">Tools</span>{(props.agents.find((agent) => agent.id === step.agent)?.tools ?? []).map((tool) => <label className="check" key={tool}><input type="checkbox" checked={step.tools?.includes(tool) ?? false} onChange={(event) => change(setStepTools(step, event.target.checked ? [...(step.tools ?? []), tool] : (step.tools ?? []).filter((name) => name !== tool)))} /><span className="mono">{tool}</span></label>)}<div className="small muted">All unchecked uses the agent's own tools.</div></div>
					<label className="wf-wide">Task<textarea className="input" rows={3} value={step.task} onChange={(event) => change({ ...step, task: event.target.value })} /></label>
				</> : <>
					<CommandField command={step.command} change={(command) => change({ ...step, command })} />
					<label>Time limit, seconds<input className="input" type="number" min={1} value={step.timeoutSec ?? ""} onChange={(event) => change({ ...step, timeoutSec: event.target.value ? Number(event.target.value) : undefined })} /></label>
				</>}
				<label>If it fails<select className="input" value={step.onFail?.goTo ?? ""} onChange={(event) => {
					if (event.target.value) change({ ...step, onFail: { goTo: event.target.value, maxRounds: step.onFail?.maxRounds ?? 3 } });
					else { const { onFail: _, ...rest } = step; change(rest); }
				}}><option value="">Stop and ask me</option>{steps.slice(0, index + 1).map((item, n) => <option key={item.id} value={item.id}>Go back to step {n + 1}: {item.name}</option>)}</select></label>
				{step.onFail && <label>Most rounds<select className="input" value={step.onFail.maxRounds} onChange={(event) => change({ ...step, onFail: { goTo: step.onFail!.goTo, maxRounds: Number(event.target.value) } })}>{[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
				<label className="check wf-wide"><input type="checkbox" checked={step.pause ?? false} onChange={(event) => change({ ...step, pause: event.target.checked })} />Pause for me after this step</label>
				<label className="check wf-wide"><input type="checkbox" checked={step.once ?? false} onChange={(event) => change({ ...step, once: event.target.checked })} />Run only once, keep the result in later rounds</label>
				<div className="wf-row wf-wide"><button type="button" className="btn" disabled={index === 0} onClick={() => props.move(-1)}>Move up</button><button type="button" className="btn" disabled={index === steps.length - 1} onClick={() => props.move(1)}>Move down</button><button type="button" className="btn btn-danger" onClick={props.remove}>Remove step</button></div>
			</fieldset>}
		</div>
	</section>;
}

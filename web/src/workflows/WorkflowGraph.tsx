import type { StepRun, WorkflowStep } from "../../../src/shared/api.ts";
import { stepDetail, stepStatus } from "./logic.ts";

export function WorkflowGraph({ steps, results, open }: { steps: WorkflowStep[]; results: StepRun[]; open: (id: string) => void }) {
	const arcs = steps.flatMap((step, index) => {
		const target = steps.findIndex((item) => item.id === step.onFail?.goTo);
		return step.onFail && target >= 0 && target < index ? [{ step, index, target, height: 16 + 14 * (index - target) }] : [];
	});
	const arcSpace = Math.max(16, ...arcs.map((arc) => arc.height)) + 16;
	return <section className="card wf-graph-card">
		<div className="wf-row wf-between"><span className="label">Graph</span><div className="wf-legend small muted"><span><i className="wf-legend-agent" />Agent step</span><span><i className="wf-legend-command" />Command step</span><span><i className="wf-legend-arc" />Goes back if the step fails</span></div></div>
		<div className="wf-graph-scroll">
			<div className="wf-graph" style={{ minWidth: steps.length * 118, paddingTop: arcSpace }}>
				{arcs.map(({ step, index, target, height }) => <div key={step.id} className={`wf-arc ${results.find((result) => result.stepId === step.id)?.status === "failed" ? "wf-arc-failed" : ""}`} style={{ left: `${(target + 0.5) / steps.length * 100}%`, width: `${(index - target) / steps.length * 100}%`, height, top: arcSpace + 14 - height }}><span>on fail · max {step.onFail?.maxRounds}</span></div>)}
				{steps.map((step, index) => {
					const result = results.find((item) => item.stepId === step.id);
					const status = result?.status ?? "waiting";
					const word = stepStatus(status);
					return <button type="button" className="btn btn-ghost wf-node" key={step.id} onClick={() => open(step.id)} aria-label={`Open step ${index + 1}: ${step.name}`}>
						{index < steps.length - 1 && <span className={`wf-connector ${status === "passed" || status === "kept" ? "wf-connector-passed" : ""}`} />}
						<span className={`wf-marker wf-marker-${step.type === "agent" ? "agent" : "command"} wf-marker-${status}`}>{status === "passed" || status === "kept" ? "✓" : status === "failed" ? "!" : index + 1}</span>
						<span className="wf-node-name">{step.name}</span><span className="small muted wf-ellipsis">{stepDetail(step)}</span>
						{status !== "waiting" && <span className={`small wf-node-status ${word.tone}`}>{word.text}</span>}
						{step.pause && <span className="small muted">pauses for me</span>}{step.once && <span className="small muted">runs once</span>}
					</button>;
				})}
			</div>
		</div>
	</section>;
}

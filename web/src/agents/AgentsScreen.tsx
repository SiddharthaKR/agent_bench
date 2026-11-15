import { useEffect, useRef, useState } from "react";
import type { ScreenProps } from "../App.tsx";
import type { AgentDetail } from "../../../src/shared/agents.ts";
import { api } from "../api.ts";
import { agentUpdate } from "./logic.ts";
import "./agents.css";

const snapshot = (agent: AgentDetail) => JSON.stringify(agentUpdate(agent));
const sentence = (error: unknown) => error instanceof Error ? error.message : String(error);

export function AgentsScreen(props: ScreenProps & { onChanged: () => void | Promise<void> }) {
	const [agents, setAgents] = useState<AgentDetail[]>([]);
	const drafts = useRef<AgentDetail[]>([]);
	const [selected, setSelected] = useState(props.agent);
	const [saved, setSaved] = useState<Record<string, string>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [adding, setAdding] = useState(false);
	const [newId, setNewId] = useState("");
	const [newName, setNewName] = useState("");
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	const saves = useRef(new Map<string, Promise<void>>());
	const deleting = useRef(new Set<string>());
	const mounted = useRef(true);
	const changed = useRef(props.onChanged);
	changed.current = props.onChanged;
	const agent = agents.find((item) => item.id === selected);

	function replace(items: AgentDetail[]) {
		drafts.current = items;
		setAgents(items);
	}
	function report(id: string, error: unknown) {
		if (mounted.current) setErrors((old) => ({ ...old, [id]: sentence(error) }));
	}
	function save(item: AgentDetail): Promise<void> {
		const pending = (saves.current.get(item.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
			const result = await api.saveAgent(item.id, agentUpdate(item));
			if (!mounted.current) return;
			setSaved((old) => ({ ...old, [item.id]: snapshot(item) }));
			setErrors((old) => ({ ...old, [item.id]: "" }));
			replace(drafts.current.map((current) => current.id === item.id ? { ...current, promptChars: result.promptChars } : current));
			await changed.current();
		});
		saves.current.set(item.id, pending);
		return pending;
	}
	function schedule(item: AgentDetail) {
		clearTimeout(timers.current.get(item.id));
		timers.current.set(item.id, setTimeout(() => {
			timers.current.delete(item.id);
			void save(item).catch((error: unknown) => report(item.id, error));
		}, 800));
	}
	function edit(next: AgentDetail) {
		if (deleting.current.has(next.id)) return;
		replace(drafts.current.map((item) => item.id === next.id ? next : item));
		schedule(next);
	}

	useEffect(() => {
		mounted.current = true;
		let cancelled = false;
		void api.agents().then((items) => {
			if (cancelled) return;
			replace(items);
			setSaved(Object.fromEntries(items.map((item) => [item.id, snapshot(item)])));
			setSelected((id) => items.some((item) => item.id === id) ? id : items[0]?.id ?? "");
		}, (error: unknown) => { if (!cancelled) report("", error); }).finally(() => { if (!cancelled) setLoading(false); });
		return () => {
			cancelled = true;
			mounted.current = false;
			for (const timer of timers.current.values()) clearTimeout(timer);
		};
	}, []);

	async function create() {
		setBusy(true);
		setErrors((old) => ({ ...old, "": "" }));
		try {
			const item = await api.createAgent(newId, newName);
			if (!mounted.current) return;
			replace([...drafts.current.map((current) => ({ ...current, subagents: [...current.subagents, { id: item.id, name: item.name, enabled: false }] })), item]);
			setSaved((old) => ({ ...old, [item.id]: snapshot(item) }));
			setSelected(item.id);
			setAdding(false); setNewId(""); setNewName("");
			await changed.current();
		} catch (error) { report("", error); }
		finally { if (mounted.current) setBusy(false); }
	}
	async function remove() {
		if (!agent || !window.confirm(`Delete ${agent.name}?`)) return;
		const id = agent.id;
		setBusy(true);
		deleting.current.add(id);
		clearTimeout(timers.current.get(id));
		timers.current.delete(id);
		try {
			await saves.current.get(id)?.catch(() => {});
			await api.deleteAgent(id);
			if (!mounted.current) return;
			const remaining = drafts.current.filter((item) => item.id !== id).map((item) => ({ ...item, subagents: item.subagents.filter((subagent) => subagent.id !== id) }));
			replace(remaining);
			setSelected((current) => current === id ? remaining[0]?.id ?? "" : current);
			await changed.current();
		} catch (error) {
			report(id, error);
			const draft = drafts.current.find((item) => item.id === id);
			if (draft && mounted.current && saved[id] !== snapshot(draft)) schedule(draft);
		} finally { deleting.current.delete(id); if (mounted.current) setBusy(false); }
	}

	return <div className="agents-screen">
		<aside className="card agents-list" aria-label="Agents">
			<span className="label">Agents</span>
			{agents.map((item) => <button type="button" className="btn agents-choice" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span>{item.name || "Unnamed agent"}</span><span className="small muted">{item.tools.filter((tool) => tool.enabled).length} tools · {item.skills.filter((skill) => skill.enabled).length} skills</span></button>)}
			{loading && <span className="muted">Loading agents…</span>}
			<button type="button" className="btn btn-dashed" disabled={loading || busy} onClick={() => setAdding(true)}>Add agent</button>
			{adding && <form className="agents-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
				<label className="field">Id<input className="input mono" required pattern="[a-z0-9][a-z0-9-]{0,31}" maxLength={32} title="Lowercase letters, digits and dashes" value={newId} disabled={busy} onChange={(event) => setNewId(event.target.value)} /></label>
				<label className="field">Name<input className="input" required value={newName} disabled={busy} onChange={(event) => setNewName(event.target.value)} /></label>
				<div className="agents-row"><button className="btn" disabled={busy}>Create</button><button type="button" className="btn" disabled={busy} onClick={() => { setAdding(false); setNewId(""); setNewName(""); }}>Cancel</button></div>
			</form>}
		</aside>
		<div className="agents-main">
			{agent ? <>
				<header className="agents-row agents-header"><h1>Setup: {agent.name}</h1><span className="mono muted">agents/{agent.id}/</span><span className={`pill ${saved[agent.id] === snapshot(agent) && !errors[agent.id] ? "" : "warn"}`} role="status">{saved[agent.id] === snapshot(agent) && !errors[agent.id] ? "Saved" : "Unsaved"}</span><span className="small muted">System prompt: {agent.promptChars} characters</span></header>
				{errors[agent.id] && <div className="tone-bad" role="alert">{errors[agent.id]}</div>}
			</> : !loading && <p className="muted">No agents yet.</p>}
			{errors[""] && <div className="tone-bad" role="alert">{errors[""]}</div>}
			{agent && <>
				<fieldset className="agents-grid" disabled={busy} aria-label={`Setup ${agent.name}`}>
					<section className="card agents-card"><h2>Basics</h2>
						<label className="field">Name<input className="input" value={agent.name} onChange={(event) => edit({ ...agent, name: event.target.value })} /></label>
						<label className="field">Most tool calls per run<input className="input" type="number" min={1} max={200} value={agent.maxTurns} onChange={(event) => edit({ ...agent, maxTurns: Number(event.target.value) })} /></label>
						<label className="field">Time limit, seconds<input className="input" type="number" min={30} max={7200} placeholder="No limit" value={agent.maxSeconds ?? ""} onChange={(event) => edit({ ...agent, maxSeconds: event.target.value === "" ? null : Number(event.target.value) })} /></label>
						<label className="field">Rewrite whole file under this many lines<input className="input" type="number" min={0} max={2000} value={agent.smallFileLines} onChange={(event) => edit({ ...agent, smallFileLines: Number(event.target.value) })} /></label>
						<label className="check"><input type="checkbox" checked={agent.trimContext} onChange={(event) => edit({ ...agent, trimContext: event.target.checked })} />Trim old tool output from the context</label>
					</section>
					<section className="card agents-card"><h2>Tools</h2>{agent.tools.map((tool) => <label className="agents-check" key={tool.name}><input type="checkbox" checked={tool.enabled} onChange={(event) => edit({ ...agent, tools: agent.tools.map((item) => item.name === tool.name ? { ...item, enabled: event.target.checked } : item) })} /><span><span className="mono agents-tool">{tool.name}</span><span className="small muted agents-description">{tool.summary}</span></span></label>)}</section>
					<section className="card agents-card"><h2>Skills</h2>{agent.skills.length ? agent.skills.map((skill) => <label className="agents-check" key={skill.name}><input type="checkbox" checked={skill.enabled} onChange={(event) => edit({ ...agent, skills: agent.skills.map((item) => item.name === skill.name ? { ...item, enabled: event.target.checked } : item) })} /><span>{skill.name}<span className="small muted agents-description">{skill.description}</span><span className="pill">{skill.always ? "always in the prompt" : "loaded on request"}</span></span></label>) : <p className="muted">No skills in this agent's folder. Add a Markdown file under agents/{agent.id}/skills/.</p>}</section>
					<section className="card agents-card"><h2>Sub-agents</h2>{agent.subagents.length ? agent.subagents.map((subagent) => <label className="check" key={subagent.id}><input type="checkbox" checked={subagent.enabled} onChange={(event) => edit({ ...agent, subagents: agent.subagents.map((item) => item.id === subagent.id ? { ...item, enabled: event.target.checked } : item) })} />{agents.find((item) => item.id === subagent.id)?.name ?? subagent.name}</label>) : <p className="muted">No other agents yet.</p>}</section>
					<section className="card agents-card agents-prompt"><h2>System prompt</h2><label className="field">prompt.md<textarea className="input mono" rows={10} value={agent.prompt} onChange={(event) => edit({ ...agent, prompt: event.target.value })} /></label></section>
				</fieldset>
				<div className="agents-delete"><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>Delete agent</button></div>
			</>}
		</div>
	</div>;
}

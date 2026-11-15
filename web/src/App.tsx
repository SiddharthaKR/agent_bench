import { AgentsScreen } from "./agents/AgentsScreen.tsx";
import { useEffect, useState } from "react";
import type { AppConfig } from "../../src/shared/api.ts";
import { api } from "./api.ts";
import { WorkScreen } from "./work/WorkScreen.tsx";
import { WorkflowsScreen } from "./workflows/WorkflowsScreen.tsx";
import { TraceScreen } from "./trace/TraceScreen.tsx";
import { ResultsScreen } from "./results/ResultsScreen.tsx";

/** What every screen is given: the configuration and the user's current choices. */
export interface ScreenProps {
	config: AppConfig;
	/** Agent folder name. */
	agent: string;
	/** Key of the model server in config.json. */
	server: string;
	/** Absolute path of the project folder. */
	folder: string;
	setFolder: (folder: string) => void;
}

type View = "work" | "workflows" | "trace" | "agents" | "results";

function stored(key: string, fallback: string): string {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}

function store(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private windows may refuse storage; the choice then lasts for this visit only.
	}
}

export function App() {
	const [config, setConfig] = useState<AppConfig | null>(null);
	const [error, setError] = useState("");
	const [lab, setLab] = useState(() => stored("ab.lab", "true") !== "false");
	const [view, setView] = useState<View>(() => {
		const saved = stored("ab.view", "work");
		if (saved === "results" && lab) return "results";
		return saved === "workflows" || saved === "trace" || saved === "agents" ? saved : "work";
	});
	const [dark, setDark] = useState(() => stored("ab.theme", "light") === "dark");
	const [agent, setAgent] = useState(() => stored("ab.agent", ""));
	const [server, setServer] = useState(() => stored("ab.server", ""));
	const [folder, setFolderState] = useState(() => stored("ab.folder", ""));

	const reloadConfig = () => api.config().then(setConfig, (e: Error) => setError(e.message));

	useEffect(() => {
		api.config().then(setConfig, (e: Error) => setError(e.message));
	}, []);

	useEffect(() => {
		document.documentElement.dataset.theme = dark ? "dark" : "light";
		store("ab.theme", dark ? "dark" : "light");
	}, [dark]);

	if (error) return <div className="screen tone-bad">Could not reach the local server: {error}</div>;
	if (!config) return <div className="screen muted">Loading…</div>;

	const agentId = config.agents.some((a) => a.id === agent) ? agent : (config.agents[0]?.id ?? "");
	const serverId = config.servers.some((s) => s.id === server) ? server : (config.servers[0]?.id ?? "");
	const projectFolder = folder || config.defaultFolder;
	const current = config.servers.find((s) => s.id === serverId);
	const props: ScreenProps = {
		config,
		agent: agentId,
		server: serverId,
		folder: projectFolder,
		setFolder: (next) => {
			setFolderState(next);
			store("ab.folder", next);
		},
	};
	const go = (next: View) => {
		setView(next);
		store("ab.view", next);
	};

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">Agent Bench</div>
				<nav aria-label="Views" style={{ display: "flex", gap: 4 }}>
					<button type="button" className="btn" aria-pressed={view === "work"} onClick={() => go("work")}>
						Work
					</button>
					<button type="button" className="btn" aria-pressed={view === "workflows"} onClick={() => go("workflows")}>
						Workflows
					</button>
					<button type="button" className="btn" aria-pressed={view === "trace"} onClick={() => go("trace")}>
						Trace
					</button>
					<button type="button" className="btn" aria-pressed={view === "agents"} onClick={() => go("agents")}>Agents</button>
					{lab && <div className="results-lab-tab">
						<span className="small muted">Lab, only you</span>
						<button type="button" className="btn" aria-pressed={view === "results"} onClick={() => go("results")}>Results</button>
					</div>}
				</nav>
				<div className="spacer" />
				<label className="check">
					<input type="checkbox" checked={lab} onChange={(event) => {
						const enabled = event.target.checked;
						setLab(enabled);
						store("ab.lab", String(enabled));
						if (!enabled && view === "results") go("work");
					}} />
					Lab tools
				</label>
				<label className="check">
					Agent
					<select
						className="input"
						value={agentId}
						onChange={(e) => {
							setAgent(e.target.value);
							store("ab.agent", e.target.value);
						}}
					>
						{config.agents.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
				</label>
				<label className="check">
					Model server
					<select
						className="input"
						value={serverId}
						onChange={(e) => {
							setServer(e.target.value);
							store("ab.server", e.target.value);
						}}
					>
						{config.servers.map((s) => (
							<option key={s.id} value={s.id}>
								{s.id}
							</option>
						))}
					</select>
				</label>
				<span className="small muted">{current?.model}</span>
				<button type="button" className="btn" onClick={() => setDark(!dark)}>
					{dark ? "Light theme" : "Dark theme"}
				</button>
			</header>
			<main className="screen">
				{/* Screens stay mounted so a running session or workflow survives a tab switch. */}
				<div hidden={view !== "work"} style={{ height: "100%" }}>
					<WorkScreen {...props} />
				</div>
				<div hidden={view !== "workflows"} style={{ height: "100%" }}>
					<WorkflowsScreen {...props} />
				</div>
				<div hidden={view !== "trace"} style={{ height: "100%" }}>
					<TraceScreen {...props} />
				</div>
				<div hidden={view !== "agents"} style={{ height: "100%" }}>
					<AgentsScreen {...props} onChanged={reloadConfig} />
				</div>
				{lab && view === "results" && <ResultsScreen />}
			</main>
		</div>
	);
}

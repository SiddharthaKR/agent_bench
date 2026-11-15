import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { ScreenProps } from "../App.tsx";
import type { SessionEvent, TreeNode } from "../../../src/shared/api.ts";
import { api, listen, sessionEventsUrl } from "../api.ts";
import { Editor } from "./Editor.tsx";
import { Feed } from "./Feed.tsx";
import { initialState, reduce } from "./reduce.ts";
import { useFile } from "./useFile.ts";
import "./work.css";

type Tab = "File" | "Change" | "Output";
function hasPath(nodes: TreeNode[], path: string): boolean {
	return nodes.some((node) => node.path === path || (node.children && hasPath(node.children, path)));
}

function Tree({ nodes, depth = 0, selected, modified, open }: {
	nodes: TreeNode[]; depth?: number; selected?: string; modified: string[]; open: (path: string) => void;
}) {
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	return <>{nodes.map((node) => {
		const directory = node.children !== undefined;
		const expanded = !(collapsed[node.path] ?? depth > 0);
		return <div key={node.path}>
			<button type="button" className="btn btn-ghost work-tree-row" style={{ paddingLeft: depth * 16 }}
				aria-expanded={directory ? expanded : undefined} aria-current={!directory && selected === node.path ? "true" : undefined}
				title={node.path} onClick={() => directory ? setCollapsed({ ...collapsed, [node.path]: expanded }) : open(node.path)}>
				<span aria-hidden="true">{directory ? expanded ? "▾" : "▸" : ""}</span><span className="work-tree-name">{node.name}</span>
				{modified.includes(node.path) && <strong className="tone-warn" aria-label="Agent changed this file">M</strong>}
			</button>
			{directory && expanded && <Tree nodes={node.children ?? []} depth={depth + 1} selected={selected} modified={modified} open={open} />}
		</div>;
	})}</>;
}

export function WorkScreen(props: ScreenProps) {
	const [state, dispatch] = useReducer(reduce, undefined, initialState);
	const [tab, setTab] = useState<Tab>("File");
	const [folderInput, setFolderInput] = useState(props.folder);
	const [tree, setTree] = useState<TreeNode[]>([]);
	const treeRef = useRef(tree);
	treeRef.current = tree;
	const [treeError, setTreeError] = useState("");
	const [loadingTree, setLoadingTree] = useState(false);
	const [askFirst, setAskFirst] = useState(true);
	const askRef = useRef(askFirst);
	askRef.current = askFirst;
	const [message, setMessage] = useState("");
	const [sending, setSending] = useState(false);
	const [resolving, setResolving] = useState(false);
	const session = useRef<string | null>(null);
	const creating = useRef<Promise<string | null> | null>(null);
	const close = useRef<(() => void) | null>(null);
	const generation = useRef(0);
	const treeRequest = useRef(0);
	const feed = useRef<HTMLDivElement>(null);
	const root = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	const report = useCallback((error: unknown) => {
		dispatch({ type: "note", id: `local-${crypto.randomUUID()}`, text: error instanceof Error ? error.message : String(error), tone: "bad" });
	}, []);
	const file = useFile(props.folder, report);
	const fileRef = useRef(file);
	fileRef.current = file;
	const reset = useCallback(() => {
		++generation.current;
		close.current?.();
		close.current = null;
		session.current = null;
		creating.current = null;
		setSending(false);
		setResolving(false);
		setMessage("");
		pinned.current = true;
		dispatch({ type: "reset" });
	}, []);
	const loadTree = useCallback(async () => {
		const version = ++treeRequest.current;
		setLoadingTree(true);
		try {
			const nodes = await api.tree(props.folder);
			if (version === treeRequest.current) { setTree(nodes); setTreeError(""); }
		} catch (error) {
			if (version === treeRequest.current) { setTreeError(error instanceof Error ? error.message : String(error)); report(error); }
		} finally { if (version === treeRequest.current) setLoadingTree(false); }
	}, [props.folder, report]);
	useEffect(() => {
		reset();
		return () => { ++generation.current; close.current?.(); close.current = null; };
	}, [props.agent, props.folder, props.server, reset]);
	useEffect(() => {
		setFolderInput(props.folder);
		setTree([]);
		void loadTree();
		return () => { ++treeRequest.current; };
	}, [props.folder, loadTree]);
	useEffect(() => {
		const container = root.current?.parentElement;
		if (!container) return;
		const observer = new MutationObserver(() => {
			if (container.hidden) void fileRef.current.save().catch(report);
		});
		observer.observe(container, { attributes: true, attributeFilter: ["hidden"] });
		return () => observer.disconnect();
	}, [report]);
	useEffect(() => {
		const saveShortcut = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !root.current?.closest("[hidden]")) {
				event.preventDefault();
				event.stopPropagation();
				void fileRef.current.save().catch(report);
			}
		};
		window.addEventListener("keydown", saveShortcut, true);
		return () => window.removeEventListener("keydown", saveShortcut, true);
	}, [report]);
	useLayoutEffect(() => {
		if (pinned.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
	}, [state.items, state.stream, state.status]);
	const receive = useCallback((event: SessionEvent) => {
		dispatch(event);
		if (event.type === "proposal" && event.state === "pending") setTab("Change");
		if (event.type === "file") {
			void fileRef.current.changed(event.path);
			if (!hasPath(treeRef.current, event.path)) void loadTree();
		}
	}, [loadTree]);
	const send = async (text: string) => {
		if (!text.trim()) return;
		const version = generation.current;
		setSending(true);
		try {
			let id = session.current;
			if (!id) {
				if (!creating.current) creating.current = (async () => {
					const initialAsk = askRef.current;
					const result = await api.createSession({ agent: props.agent, folder: props.folder, server: props.server, askFirst: initialAsk });
					if (version !== generation.current) return null;
					session.current = result.id;
					close.current = listen<SessionEvent>(sessionEventsUrl(result.id), (event) => { if (version === generation.current) receive(event); });
					if (initialAsk !== askRef.current) await api.setAskFirst(result.id, askRef.current);
					return result.id;
				})();
				id = await creating.current;
			}
			if (!id || version !== generation.current) return;
			await api.sendMessage(id, text);
			if (version === generation.current) setMessage((draft) => draft === text ? "" : draft);
		} catch (error) { if (version === generation.current) { creating.current = null; report(error); } }
		finally { if (version === generation.current) setSending(false); }
	};
	const proposal = state.items.filter((item) => item.type === "proposal").at(-1);
	const output = state.output;
	const resolve = async (accept: boolean) => {
		if (!session.current || !proposal) return;
		setResolving(true);
		try { await api.resolveProposal(session.current, proposal.id, accept); }
		catch (error) { report(error); }
		finally { setResolving(false); }
	};
	const dirty = file.document && file.document.text !== file.document.saved;
	return <div className="work-screen" ref={root}>
		<div className="work-heading">
			<h1>{props.config.agents.find((agent) => agent.id === props.agent)?.name ?? props.agent}</h1>
			<span className="mono muted work-folder" title={props.folder}>{props.folder}</span>
			<span className={`pill ${state.status === "working" ? "warn" : state.status === "waiting" ? "tint" : ""}`}>{state.status === "working" ? "Working" : state.status === "waiting" ? "Waiting for you" : "Idle"}</span>
			{state.usage && <span className="small muted">{state.usage.modelCalls} model calls · context {state.usage.contextTokens} tokens</span>}
			<label className="check work-ask"><input type="checkbox" checked={askFirst} onChange={(event) => {
				const next = event.target.checked;
				setAskFirst(next);
				if (session.current) void api.setAskFirst(session.current, next).catch(report);
			}} />Ask me before edits</label>
		</div>
		<div className="work-panels">
			<section className="card work-files" aria-label="Project files">
				<form className="work-folder-form" onSubmit={(event) => {
					event.preventDefault();
					const next = folderInput.trim();
					if (!next) return;
					void file.flush().then(() => { props.setFolder(next); if (next === props.folder) void loadTree(); }).catch(report);
				}}><label className="field"><span className="label">Folder</span><input className="input" value={folderInput} onChange={(event) => setFolderInput(event.target.value)} /></label><button className="btn" type="submit">Open</button></form>
				<div className="work-tree">{treeError ? <p className="tone-bad">{treeError}</p> : loadingTree && !tree.length ? <p className="muted">Loading…</p> : !tree.length ? <p className="muted">This folder has no files yet.</p> : <Tree nodes={tree} selected={file.document?.path} modified={state.files} open={(path) => { setTab("File"); void file.open(path); }} />}</div>
				<div className="small muted work-padding">M marks files the agent changed.</div>
			</section>
			<section className="card work-code" aria-label="Code and results">
				<div className="work-tabs">{(["File", "Change", "Output"] as const).map((name) => <button key={name} className="btn" type="button" aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}<span className="mono muted work-path" title={file.document?.path}>{file.document?.path}</span></div>
				<div className="work-code-body" hidden={tab !== "File"}>
					{file.document ? <><div className="work-edit-heading"><span className="work-path">Editing {file.document.path}</span><span className={`pill ${dirty ? "warn" : ""}`}>{dirty ? "Unsaved" : "Saved"}</span><span className="small muted work-save-hint">Saves on its own. Ctrl+S saves now.</span></div>
					{file.document.conflict && <div className="work-notice">The agent changed this file.<button className="btn" type="button" onClick={() => void file.reload()}>Reload</button></div>}
					<Editor path={file.document.path} text={file.document.text} onChange={file.edit} onSave={() => void file.save().catch(report)} /></> : <p className="muted work-padding">Open a file from the list.</p>}
				</div>
				{tab === "Change" && <div className="work-result">{proposal ? <><div className="work-result-heading"><span>{proposal.isNew ? "New file" : "Proposed change to"} <span className="mono">{proposal.path}</span></span><span className={`pill ${proposal.state === "pending" ? "tint" : proposal.state === "accepted" ? "ok" : "bad"}`}>{proposal.state === "pending" ? "Waiting for you" : proposal.state === "accepted" ? "Applied" : "Discarded"}</span></div><div className="work-diff mono">{proposal.diff.map((line, index) => <div key={index} className={`work-diff-line ${line.kind}`}><span>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</span><span className="muted">{line.line}</span><span>{line.text || " "}</span></div>)}</div>{proposal.state === "pending" && <div className="work-actions"><button type="button" className="btn btn-primary" disabled={resolving} onClick={() => void resolve(true)}>Accept</button><button type="button" className="btn" disabled={resolving} onClick={() => void resolve(false)}>Reject</button></div>}</> : <p className="muted">No proposed changes yet.</p>}</div>}
				{tab === "Output" && <div className="work-result">{output?.type === "step" ? <><div className="work-result-heading"><span className="mono">{output.tool}</span><span className="mono">{output.target}</span></div><div className="mono work-output">{output.result.split(/\r?\n/).map((line, index) => <div key={index} className={/fail|error/i.test(line) ? "tone-bad" : /pass/i.test(line) ? "tone-ok" : ""}>{line || " "}</div>)}</div></> : <p className="muted">No tool output yet.</p>}</div>}
			</section>
			<section className="card work-conversation" aria-label="Conversation">
				<div className="work-feed" ref={feed} onScroll={() => { const node = feed.current; if (node) pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 28; }}>
					{!state.items.some((item) => item.type !== "proposal") && <p className="muted">Start a session. Type what you want this agent to do in the box below.</p>}
					{state.items.map((item) => <Feed item={item} key={item.id} />)}
					{state.status === "working" && <div role="status">Agent is working…<div className="small muted work-live">{state.stream.split(/\r?\n/).slice(-3).join("\n")}</div></div>}
				</div>
				<div className="work-compose"><div className="work-quick">{["Fix the failing tests", "Run the simulation again"].map((text) => <button type="button" className="btn" key={text} disabled={sending} onClick={() => void send(text)}>{text}</button>)}</div>
					<form className="work-message" onSubmit={(event) => { event.preventDefault(); void send(message); }}><input aria-label="Message to agent" placeholder="Tell the agent what to do" className="input" value={message} onChange={(event) => setMessage(event.target.value)} /><div className="work-actions"><button className="btn btn-primary" type="submit" disabled={!message.trim() || sending}>Send</button><button className="btn btn-danger" type="button" disabled={state.status === "idle"} onClick={() => { if (session.current) void api.stopSession(session.current).catch(report); }}>Stop</button><button className="btn btn-ghost" type="button" onClick={reset}>New session</button></div></form>
				</div>
			</section>
		</div>
	</div>;
}

import { useState } from "react";
import type { FeedItem } from "./reduce.ts";

export function Feed({ item }: { item: FeedItem }) {
	const [expanded, setExpanded] = useState(false);
	if (item.type === "proposal") return null;
	if (item.type === "user") return <div className="work-user">{item.text}</div>;
	if (item.type === "agent") return <div className="work-agent">{item.text}</div>;
	if (item.type === "note") return <div className={`small ${item.tone === "bad" ? "tone-bad" : "muted"}`}>{item.text}</div>;
	const status = item.status === "running" ? "running…" : item.status === "waiting" ? "waiting for you" : item.status;
	const tone = item.status === "ok" ? "tone-ok" : ["running", "waiting"].includes(item.status) ? "tone-warn" : "tone-bad";
	return <div className="work-step">
		<button type="button" className="btn btn-ghost work-step-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
			<span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
			<span className="mono work-tool">{item.tool}</span><span className="work-target">{item.target}</span><span className={tone}>{status}</span>
		</button>
		{["error", "rejected", "blocked"].includes(item.status) && item.result && <div className="small tone-bad">{item.result.split(/\r?\n/)[0]}</div>}
		{expanded && <div className="work-step-detail">
			<div className="label">What the model thought</div><div className="work-block">{item.thinking || "Nothing recorded."}</div>
			<div className="label">Tool call it made</div><pre className="work-block mono">{item.call}</pre>
			<div className="label">Result it got back</div><pre className="work-block mono">{item.result}</pre>
		</div>}
	</div>;
}

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { verilog } from "@codemirror/legacy-modes/mode/verilog";
import { python } from "@codemirror/legacy-modes/mode/python";

interface EditorProps {
	path: string;
	text: string;
	onChange: (text: string) => void;
	onSave: () => void;
}

export function Editor(props: EditorProps) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const callbacks = useRef(props);
	callbacks.current = props;
	useEffect(() => {
		if (!host.current) return;
		const language = /\.(v|sv|vh)$/i.test(props.path) ? StreamLanguage.define(verilog)
			: /\.py$/i.test(props.path) ? StreamLanguage.define(python) : [];
		const editor = new EditorView({
			parent: host.current,
			state: EditorState.create({ doc: callbacks.current.text, extensions: [
				lineNumbers(), history(), language, EditorView.lineWrapping,
				EditorView.contentAttributes.of({ "aria-label": `File contents: ${props.path}` }),
				keymap.of([{ key: "Mod-s", run: () => { callbacks.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap]),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
				}),
				EditorView.theme({
					"&": { height: "100%", backgroundColor: "var(--card)", color: "var(--ink)" },
					".cm-scroller": { overflow: "auto", fontFamily: "var(--mono)" },
					".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", borderColor: "var(--line)" },
					".cm-cursor": { borderLeftColor: "var(--ink)" },
					".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--tint)" },
					"&.cm-focused": { outline: "none" },
				}),
			] }),
		});
		view.current = editor;
		return () => { editor.destroy(); view.current = null; };
	}, [props.path]);
	useEffect(() => {
		const editor = view.current;
		if (editor && editor.state.doc.toString() !== props.text) {
			editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.text } });
		}
	}, [props.text]);
	return <div className="work-editor mono" ref={host} />;
}

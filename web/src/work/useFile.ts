import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.ts";

interface Document {
	folder: string;
	path: string;
	text: string;
	saved: string;
	conflict: boolean;
}

export function useFile(folder: string, report: (error: unknown) => void) {
	const [document, setDocument] = useState<Document | null>(null);
	const current = useRef<Document | null>(null);
	const queue = useRef(Promise.resolve());
	const request = useRef(0);
	const reportRef = useRef(report);
	reportRef.current = report;
	const publish = useCallback((next: Document | null) => {
		current.current = next;
		setDocument(next);
	}, []);
	const save = useCallback(() => {
		const doc = current.current;
		const operation = queue.current.then(async () => {
			if (!doc || doc.text === doc.saved) return;
			await api.writeFile(doc.folder, doc.path, doc.text);
			const latest = current.current;
			if (latest?.folder === doc.folder && latest.path === doc.path) {
				publish({ ...latest, saved: doc.text });
			}
		});
		queue.current = operation.catch(() => {});
		return operation;
	}, [publish]);
	const flush = useCallback(async () => {
		await save();
		while (current.current && current.current.text !== current.current.saved) await save();
	}, [save]);
	const open = useCallback(async (path: string) => {
		if (current.current?.folder === folder && current.current.path === path) return;
		const version = ++request.current;
		try {
			await flush();
			const result = await api.readFile(folder, path);
			if (version !== request.current) return;
			await flush();
			if (version === request.current) publish({ folder, path, text: result.text, saved: result.text, conflict: false });
		} catch (error) { reportRef.current(error); }
	}, [folder, publish, flush]);
	const changed = useCallback(async (path: string) => {
		const doc = current.current;
		if (!doc || doc.path !== path) return;
		if (doc.text !== doc.saved) { publish({ ...doc, conflict: true }); return; }
		try {
			const result = await api.readFile(doc.folder, path);
			const latest = current.current;
			if (latest !== doc) {
				if (latest?.path === path && latest.folder === doc.folder) publish({ ...latest, conflict: true });
				return;
			}
			publish({ ...doc, text: result.text, saved: result.text, conflict: false });
		} catch (error) { reportRef.current(error); }
	}, [publish]);
	const reload = useCallback(async () => {
		const doc = current.current;
		if (!doc) return;
		const version = ++request.current;
		try {
			await queue.current;
			const result = await api.readFile(doc.folder, doc.path);
			if (version === request.current && current.current?.path === doc.path) {
				publish({ ...doc, text: result.text, saved: result.text, conflict: false });
			}
		} catch (error) { reportRef.current(error); }
	}, [publish]);
	useEffect(() => {
		if (!document || document.text === document.saved) return;
		const timer = window.setTimeout(() => { void save().catch(reportRef.current); }, 1200);
		return () => window.clearTimeout(timer);
	}, [document, save]);
	useEffect(() => {
		return () => {
			++request.current;
			void save().catch(reportRef.current);
			publish(null);
		};
	}, [folder, publish, save]);
	useEffect(() => {
		const leave = (event: BeforeUnloadEvent) => {
			if (current.current && current.current.text !== current.current.saved) {
				void save().catch(reportRef.current);
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", leave);
		return () => window.removeEventListener("beforeunload", leave);
	}, [save]);
	return {
		document, open, save, flush, changed, reload,
		edit: (text: string) => { if (current.current) publish({ ...current.current, text }); },
	};
}

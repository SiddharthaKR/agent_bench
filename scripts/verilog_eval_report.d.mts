// Types for the parts of the scoring script the app uses.
export const root: string;
export const dataset: string;
export const task: string;
export function problemNames(): string[];
export function ensureSplits(names: string[], write?: boolean): { dev: string[]; heldout: string[] };
export function judge(candidate: string, test: string, reference: string, folder: string, commands: Record<string, string[] | undefined>, timedOut?: boolean): string;

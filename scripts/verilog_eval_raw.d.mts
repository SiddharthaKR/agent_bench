// Types for the parts of the raw scoring script the app uses.
import type { ServerConfig } from "../src/model.ts";
export function messagesFor(prompt: string): { role: string; content: string }[];
export function extractCode(text: string): string;
export function requestReply(server: ServerConfig, prompt: string, seconds: number, folder?: string): Promise<{ reply: { text: string; reasoning?: string }; timedOut: boolean; error?: string }>;

import { expect, it } from "vitest";
import { setAgentSetting, setStepTools } from "./logic.ts";
import type { AgentStep } from "../../../src/shared/api.ts";
const step: AgentStep = { id: "one", name: "One", type: "agent", agent: "fpga", task: "Work" };
it("keeps retry task when editing settings and serializing the workflow step", () => {
	const retry = { task: "Repair {design}", protect: ["{design}"] };
	const edited = setStepTools(setAgentSetting({ ...step, protect: ["spec.md"], retry }, "model", "local"), ["read_file"]);
	expect(JSON.parse(JSON.stringify(edited)).retry).toEqual(retry);
	expect(JSON.parse(JSON.stringify(edited)).protect).toEqual(["spec.md"]);
});
it("sets overrides and removes empty values instead of storing defaults", () => {
	const model = setAgentSetting(step, "model", "local-model");
	expect(model.model).toBe("local-model");
	expect(setAgentSetting(model, "model", " ")).not.toHaveProperty("model");
	expect(setAgentSetting(step, "temperature", "0").temperature).toBe(0);
	expect(setAgentSetting(step, "maxTurns", "12").maxTurns).toBe(12);
	expect(setAgentSetting({ ...step, temperature: 1 }, "temperature", "")).not.toHaveProperty("temperature");
});
it("removes tools for the agent default when all are unchecked", () => {
	expect(setStepTools(step, ["read_file"]).tools).toEqual(["read_file"]);
	expect(setStepTools({ ...step, tools: ["read_file"] }, [])).not.toHaveProperty("tools");
});

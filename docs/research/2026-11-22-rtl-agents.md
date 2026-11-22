# What the literature says works for LLM RTL generation (read 2026-11-22)

Only measured claims, with the setting. None of these used a ~12B local model; our numbers decide.

| Work | Setting | Measured effect | Fits our rules? |
|---|---|---|---|
| VRank (arXiv 2502.00028) | Sample n candidates, LLM writes test inputs (no expected values), cluster by identical sim output, pick largest cluster; optional step: LLM predicts the correct output where clusters disagree | pass@1 +6.7 to +15.7 points: Llama-3-70B 41.8 to 48.5, CodeV-Qwen 32.4 to 48.1, GPT-4o 57.4 to 66.6. Sequential problems gain too. ~90% of the gain at 20 samples (of 50) | Yes: no reference used |
| MAGE (arXiv 2412.07822), Claude 3.5 | Separate agents: testbench writer (text-waveform output), RTL writer, judge, debugger; T=0.85 sampling; debug window of inputs/outputs/expected before the first mismatch | Vanilla 72.4, one agent with shared history 83.9, separate agents 93.6. High temperature + candidates: 93.6 to 95.7. No ablation of judge or waveform window | Yes: the testbench is generated |
| VerilogCoder (arXiv 2408.08927) | Signal-level task graph plan + AST waveform tracing debug tool | Plan +7.7, tracing +11.5, both +27.5 (66.7 to 94.2). Llama3-70B version 67.3 | **No as published**: the debugger runs the benchmark's own testbench. The tracing format is reusable with a generated check |
| LLM-FSM (arXiv 2602.07032) | Finite-state reasoning | FSMs are a known weak spot for all models | Matches our failures |

## What this means for the queue

1. Self-consistency by simulation (VRank, our V) has the most evidence for open models. Start here.
2. Arbitration where drafts disagree (VRank's optional step): show the model the input vectors where groups differ and each group's outputs, ask which matches the spec. Cheap, no testbench needed.
3. Role separation (MAGE): a fresh-context testbench writer that prints inputs/outputs with expected values from the spec, separate from the RTL writer. Our E4B result (own testbench not worth it) was a single agent with shared history, the variant MAGE found weaker.
4. Debug window (MAGE/VerilogCoder): on a mismatch against the generated checks, show the cycles before the first mismatch as a table.
5. Signal-level plan (VerilogCoder): weaker evidence alone (+7.7 on GPT-4), and plan-first gave nothing on E4B.
No evidence found for: one-shot examples, self-questioning of the spec, compaction. Low priority unless our traces point there.

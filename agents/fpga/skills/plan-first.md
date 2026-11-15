---
name: plan-first
description: Load before creating or changing RTL when ports, latency, reset and arithmetic behavior need an explicit plan.
always: false
---
Before the first write, state in at most six short lines:
- Ports: name, direction, width, signedness and Q format where applicable.
- Latency in clocks, and whether outputs are registered.
- Reset: synchronous or asynchronous, active level and register reset values.
- Bus or register map and handshake timing, if present.
- Overflow behavior: wrap, saturate or impossible by construction.
- Rounding or truncation, including the bits removed.

Read the relevant existing code first and match its naming and clocking. Use the spec to settle each line. If a required behavior is unspecified, state the assumption or ask before depending on it. Put the plan in your response, then write the file. Keep code comments subject to the selected comment policy.

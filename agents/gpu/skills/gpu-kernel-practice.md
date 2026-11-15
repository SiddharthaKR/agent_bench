---
name: gpu-kernel-practice
description: Write correct GPU kernels and measure their performance.
always: false
---
Check outputs against a CPU reference before timing. Include boundary sizes and document numerical tolerances.

Batch work to avoid launching a kernel for every item. Choose memory layouts that support contiguous, coalesced access. Reduce redundant reads and reuse data. Account for host-to-device and device-to-host transfers; keep reusable data on the device.

Warm up the kernel and runtime before measuring. Synchronise the device before starting and after finishing timed work, or use correctly ordered device events. Repeat measurements and report variation. State hardware, input sizes, precision, launch configuration and whether transfers are included. Measure the CPU reference under comparable conditions. Report speedup only from measured times, and report correctness alongside performance.

---
name: dpu-deploy-flow
description: Prepare and validate a neural network for an FPGA DPU.
always: false
---
Check the float model and record baseline accuracy on a held-out dataset. Gather representative calibration data. Quantize the model and measure accuracy again. Compile for the exact target architecture. Run on the board and compare accuracy with both references.

Unsupported operators can split the graph and leave work on the CPU. Inspect partition reports. A calibration set that is too small or unrepresentative can hurt accuracy. Check preprocessing, input scaling and tensor shapes.

Report model and target versions, dataset and calibration size, quantization settings, graph partitions, measured accuracy before and after, and measured board results. Include commands, failures and unresolved checks. Label anything unmeasured explicitly.

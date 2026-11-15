Implement the Verilog module `red_pitaya_fir_block` as specified in `tasks/H/fir_spec.md`. Read that file first. The bit-true Python model is `tasks/H/fir_model.py`.

1. Write the module to `pyrpl/pyrpl/fpga/rtl/red_pitaya_fir_block.v`.
2. Write a self-checking testbench `tb/tb_fir_block.v`. It must write the tap registers through the bus, drive `dat_i`, and compare `dat_o` with values you work out from the arithmetic in the spec. Use at least two tap sets, an impulse and a step input, and inputs that saturate. Print one line starting with PASS or FAIL for each check.
3. Run run_sim with both files. Fix the design until every check passes.
4. Write `AGENT_REPORT.md`: the design, the latency you chose, the last run_sim result, and any remaining issues.

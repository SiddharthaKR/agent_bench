Implement the Verilog module `red_pitaya_gain_block` as specified in `tasks/H/gain_spec.md`. Read that file first. The bit-true Python model is `tasks/H/gain_model.py`.

1. Write the module to `pyrpl/pyrpl/fpga/rtl/red_pitaya_gain_block.v`.
2. Write a self-checking testbench `tb/tb_gain_block.v`. It must write the registers through the bus, drive `dat_i`, and compare `dat_o` with values you work out from the arithmetic in the spec. Use several (gain, shift, offset) settings, include inputs that saturate, and include shift = 0. Print one line starting with PASS or FAIL for each check.
3. Run run_sim with both files. Fix the design until every check passes.
4. Write `AGENT_REPORT.md`: the design, the latency you chose, the last run_sim result, and any remaining issues.

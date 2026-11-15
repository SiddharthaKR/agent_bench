# Raw model against the harness: VerilogEval dev, 2026-11-15

Model: Gemma 4 E4B on Ollama, thinking off (server `local-fast`). Harness code: commit c7778f9. Dev is the split the harness was tuned on, so the gap is an upper estimate.

Folders (kept under `runs/`, not committed): `runs/verilog-eval/2026-11-15T12-48-50-768Z-37976` and `runs/verilog-eval-raw/2026-11-15T13-23-52-233Z-40740`.

```
Problem | Harness verdict | Harness seconds | Raw verdict | Raw seconds
Prob004_vector2 | PASS | 8.9 | MISMATCH | 2.8
Prob008_m2014_q4h | PASS | 4.7 | PASS | 0.7
Prob012_xnorgate | PASS | 5.9 | PASS | 1.1
Prob016_m2014_q4j | PASS | 9.2 | COMPILE_ERROR | 6.9
Prob020_mt2015_eq2 | PASS | 6.4 | PASS | 1.0
Prob024_hadd | PASS | 6.6 | PASS | 1.1
Prob028_m2014_q4a | PASS | 12.8 | PASS | 0.9
Prob032_vector0 | PASS | 5.4 | PASS | 1.7
Prob036_ringer | PASS | 18.9 | COMPILE_ERROR | 2.9
Prob040_count10 | PASS | 10.8 | PASS | 2.0
Prob044_vectorgates | MISMATCH | 13.8 | MISMATCH | 4.4
Prob048_m2014_q4c | PASS | 10.1 | MISMATCH | 1.3
Prob052_gates100 | PASS | 5.6 | PASS | 2.2
Prob056_ece241_2013_q7 | PASS | 10.8 | PASS | 2.0
Prob060_m2014_q4k | PASS | 10.2 | PASS | 3.5
Prob064_vector3 | MISMATCH | 16.8 | MISMATCH | 3.5
Prob068_countbcd | MISMATCH | 66.1 | MISMATCH | 10.7
Prob072_thermostat | PASS | 17.1 | PASS | 3.1
Prob076_always_case | PASS | 14.5 | PASS | 2.2
Prob080_timer | PASS | 19.7 | PASS | 2.6
Prob084_ece241_2013_q12 | PASS | 43.1 | COMPILE_ERROR | 6.2
Prob088_ece241_2014_q5b | PASS | 17.4 | PASS | 5.7
Prob092_gatesv100 | PASS | 49.8 | COMPILE_ERROR | 6.2
Prob096_review2015_fsmseq | PASS | 35.7 | MISMATCH | 6.5
Prob100_fsm3comb | PASS | 27.8 | PASS | 4.6
Prob104_mt2015_muxdff | MISMATCH | 64.4 | MISMATCH | 9.2
Prob108_rule90 | PASS | 32.8 | MISMATCH | 6.3
Prob112_always_case2 | MISMATCH | 19.6 | MISMATCH | 3.2
Prob116_m2014_q3 | MISMATCH | 31.7 | MISMATCH | 11.3
Prob120_fsm3s | PASS | 12.1 | MISMATCH | 4.8
Prob124_rule110 | MISMATCH | 54.4 | COMPILE_ERROR | 7.2
Prob128_fsm_ps2 | MISMATCH | 22.9 | MISMATCH | 5.0
Prob132_always_if2 | PASS | 29.1 | MISMATCH | 2.8
Prob136_m2014_q6 | MISMATCH | 35.9 | MISMATCH | 6.8
Prob140_fsm_hdlc | MISMATCH | 61.6 | MISMATCH | 17.0
Prob144_conwaylife | PASS | 101.9 | COMPILE_ERROR | 8.1
Prob148_2013_q2afsm | MISMATCH | 41.5 | MISMATCH | 8.8
Prob152_lemmings3 | PASS | 66.2 | COMPILE_ERROR | 23.3
Prob156_review2015_fancytimer | TIME | 122.1 | COMPILE_ERROR | 30.7
Harness: passed 27 of 39 (69.2%). Median 18.9 s.
Raw: passed 15 of 39 (38.5%). Median 4.4 s.
Passed by both: Prob008_m2014_q4h, Prob012_xnorgate, Prob020_mt2015_eq2, Prob024_hadd, Prob028_m2014_q4a, Prob032_vector0, Prob040_count10, Prob052_gates100, Prob056_ece241_2013_q7, Prob060_m2014_q4k, Prob072_thermostat, Prob076_always_case, Prob080_timer, Prob088_ece241_2014_q5b, Prob100_fsm3comb
Passed only with the harness: Prob004_vector2, Prob016_m2014_q4j, Prob036_ringer, Prob048_m2014_q4c, Prob084_ece241_2013_q12, Prob092_gatesv100, Prob096_review2015_fsmseq, Prob108_rule90, Prob120_fsm3s, Prob132_always_if2, Prob144_conwaylife, Prob152_lemmings3
Passed only raw: None
```

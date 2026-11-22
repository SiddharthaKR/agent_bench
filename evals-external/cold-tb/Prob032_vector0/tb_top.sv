`timescale 1ns/1ps

module tb_top;
    reg  [2:0] vec;
    wire [2:0] outv;
    wire o2, o1, o0;
    integer i;
    integer checks;
    integer failures;
    reg [31:0] rng;

    TopModule dut (
        .vec(vec),
        .outv(outv),
        .o2(o2),
        .o1(o1),
        .o0(o0)
    );

    // The specified interface is purely combinational: no clock or reset.
    // Allow propagation after every input change before observing outputs.
    task automatic check_vector(input [2:0] stimulus, input string name);
        begin
            vec = stimulus;
            #1;
            checks = checks + 4;
            if (outv === stimulus)
                $display("PASS %s_outv", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s_outv expected=%b got=%b inputs=vec:%b",
                         name, stimulus, outv, vec);
            end
            if (o2 === stimulus[2])
                $display("PASS %s_o2", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s_o2 expected=%b got=%b inputs=vec:%b",
                         name, stimulus[2], o2, vec);
            end
            if (o1 === stimulus[1])
                $display("PASS %s_o1", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s_o1 expected=%b got=%b inputs=vec:%b",
                         name, stimulus[1], o1, vec);
            end
            if (o0 === stimulus[0])
                $display("PASS %s_o0", name);
            else begin
                failures = failures + 1;
                $display("FAIL %s_o0 expected=%b got=%b inputs=vec:%b",
                         name, stimulus[0], o0, vec);
            end
        end
    endtask

    initial begin
        checks = 0;
        failures = 0;
        rng = 32'h9e3779b9;

        // All-zero, all-one, single-bit, and mixed patterns exhaust the domain.
        for (i = 0; i < 8; i = i + 1)
            check_vector(i[2:0], $sformatf("exhaustive_%0d", i));

        // Exercise every ordered pair of binary values, including holds.
        for (i = 0; i < 64; i = i + 1) begin
            check_vector((i / 8), $sformatf("transition_%0d_before", i));
            check_vector(i[2:0], $sformatf("transition_%0d_after", i));
        end

        // Reproducible pseudo-random stimulus, independent of simulator seed.
        for (i = 0; i < 256; i = i + 1) begin
            rng = rng ^ (rng << 13);
            rng = rng ^ (rng >> 17);
            rng = rng ^ (rng << 5);
            check_vector(rng[2:0], $sformatf("random_%0d", i));
        end

        if (failures == 0)
            $display("PASS summary checks=%0d", checks);
        else
            $display("FAIL summary expected=0 got=%0d inputs=vec:%b checks=%0d",
                     failures, vec, checks);
        $finish;
    end
endmodule

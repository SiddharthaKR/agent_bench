`timescale 1ns/1ps

module tb_top;
    reg  [3:0] in;
    wire [1:0] pos;
    integer i;
    integer j;
    reg [3:0] random_input;

    TopModule dut (
        .in(in),
        .pos(pos)
    );

    // The example in the specification gives the lowest numbered set bit
    // priority. Zero input also has position zero.
    function automatic [1:0] expected_position(input [3:0] value);
        begin
            if      (value[0]) expected_position = 2'd0;
            else if (value[1]) expected_position = 2'd1;
            else if (value[2]) expected_position = 2'd2;
            else if (value[3]) expected_position = 2'd3;
            else              expected_position = 2'd0;
        end
    endfunction

    task automatic check(input [3:0] stimulus, input string name);
        reg [1:0] expected;
        begin
            in = stimulus;
            expected = expected_position(stimulus);
            #1;
            if (pos === expected)
                $display("PASS %s", name);
            else
                $display("FAIL %s expected=%b got=%b inputs=in=%b",
                         name, expected, pos, in);
        end
    endtask

    initial begin
        // This interface is entirely combinational: no clock or reset exists.
        check(4'b0000, "initial_zero");

        // Exercise every possible binary input, including each one-hot input,
        // every priority conflict, and the all-zero/all-one cases.
        for (i = 0; i < 16; i = i + 1)
            check(i[3:0], $sformatf("exhaustive_%0d", i));

        // Exercise every ordered transition to expose stale combinational
        // outputs and dependencies on the previous input value.
        for (i = 0; i < 16; i = i + 1) begin
            for (j = 0; j < 16; j = j + 1) begin
                check(i[3:0], $sformatf("transition_%0d_%0d_source", i, j));
                check(j[3:0], $sformatf("transition_%0d_%0d_target", i, j));
            end
        end

        for (i = 0; i < 256; i = i + 1) begin
            random_input = $urandom_range(0, 15);
            check(random_input, $sformatf("random_%0d", i));
        end

        check(4'b0000, "final_zero");
        $finish;
    end
endmodule

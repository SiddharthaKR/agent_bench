`timescale 1ns/1ps
module tb_gain;
  reg clk = 0;
  reg rst = 1;
  reg signed [15:0] din = 0;
  reg signed [7:0] k = 0;
  wire signed [15:0] dout;
  integer fails = 0;

  gain #(.W(16)) dut (.clk(clk), .rst(rst), .din(din), .k(k), .dout(dout));

  always #5 clk = ~clk;

  task check(input signed [15:0] d, input signed [7:0] kk, input signed [15:0] want, input [8*16:1] name);
    begin
      @(negedge clk); din = d; k = kk;
      @(negedge clk);
      if (dout === want) $display("PASS %0s", name);
      else begin
        $display("FAIL %0s got %0d wanted %0d", name, dout, want);
        fails = fails + 1;
      end
    end
  endtask

  initial begin
    repeat (2) @(negedge clk);
    rst = 0;
    check(16'sd160, 8'sd16, 16'sd160, "unity");
    check(16'sd100, 8'sd32, 16'sd200, "times_two");
    check(-16'sd100, 8'sd32, -16'sd200, "negative");
    check(16'sd30000, 8'sd32, 16'sd32767, "saturate_pos");
    check(-16'sd30000, 8'sd32, -16'sd32768, "saturate_neg");
    check(16'sd7, 8'sd8, 16'sd3, "truncate");
    rst = 1;
    @(negedge clk); @(negedge clk);
    if (dout === 16'sd0) $display("PASS reset");
    else begin $display("FAIL reset got %0d", dout); fails = fails + 1; end
    if (fails == 0) $display("ALL TESTS PASSED");
    else $display("%0d TESTS FAILED", fails);
    $finish;
  end
endmodule

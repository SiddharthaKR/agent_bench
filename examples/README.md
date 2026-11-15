# Run workflows from code
Run these examples from the repository root with dependencies already installed.
Configure the `local` model server in `config.json` or `config.local.json`.
Start that model server before running an agent step.
Use a project folder containing `spec.md` and any input design files.
The FPGA workflow also needs the configured Verilog tools on your path.
Run the shipped workflow with:
`npx tsx examples/run-workflow.ts /absolute/project "Build the block in spec.md."`
Run the workflow built in code with:
`npx tsx examples/custom-workflow.ts /absolute/project`
Both scripts print state changes and return a nonzero exit code on failure.
Import `runWorkflow` and the `Workflow` type from `src/index.ts` for your own scripts.

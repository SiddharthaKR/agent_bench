# Development mode on the office server

This is development mode. Start it by hand and stop it with Ctrl+C. Nothing is installed as a service; there is no deployment or installer.

The Linux server needs Node 22.19 or newer, npm, Bash, iverilog (including vvp), and an OpenAI-compatible model server with a loaded model. H scoring also needs Python and the old ai_demo harness.

From your PC, copy the repository source (leave out node_modules, web/node_modules and config.local.json), or fetch it from your own repository. For a prepared source folder:
```bash
scp -r ./Harness <user>@172.20.1.126:~/agent-bench
```
On the server:
```bash
cd ~/agent-bench
```
```bash
npm install
```
```bash
npm run web:install
```
```bash
npm run web:build
```

Create config.local.json in the repository root. Use the exact model ID from your model server; change the URL and executable paths for this machine. Local settings override config.json:
```json
{
  "servers": {
    "office": { "baseUrl": "http://127.0.0.1:1234/v1", "model": "your-model-id" }
  },
  "commands": {
    "compile": ["/usr/bin/iverilog", "-g2012", "-o", "{out}", "{files}"],
    "simulate": ["/usr/bin/vvp", "{out}"]
  }
}
```
Start with an absolute project folder:
```bash
npm run app -- --folder <project>
```

Recommended: from another PC, keep an SSH tunnel open:
```bash
ssh -L 4600:localhost:4600 <user>@172.20.1.126
```
Then open http://localhost:4600 in that PC's browser.

Alternatively, on a trusted network, start the app with:
```bash
npm run app -- --folder <project> --host 0.0.0.0
```
Open http://172.20.1.126:4600. Anyone who can reach this port can read and change project files. Host and Origin checks accept this machine's IPv4 addresses and hostname.

Run scoring from the repository root. Each H attempt prepares a fresh old-harness workspace and replaces its previous workspace. The model server must be running. The H limit defaults to 600 seconds per run:
```bash
bash scripts/h_task.sh <path-to-ai_demo> easy office <model-id> -n 3 -t 600
```
```bash
bash scripts/h_task.sh <path-to-ai_demo> medium office <model-id> -n 3 -t 600
```
```bash
bash scripts/eval_local.sh -s office -m <model-id> -n 3 -t 600
```
Scores append to runs/results.jsonl. In the browser, enable Lab tools and open Results, then Reload. H traces remain in the old harness's run folder; local evaluation traces remain under runs/.

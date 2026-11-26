#!/usr/bin/env python3
"""
llmfit - Will this local LLM fit on my machine?

* Detects your hardware (macOS Apple Silicon unified memory, Linux RAM + NVIDIA/AMD VRAM).
* Pulls the latest model info live from Hugging Face (MLX builds on Mac, GGUF on Linux):
  file size, params (total / active), MoE vs dense, experts, layers, context, license.
* Scans models already on disk (LM Studio, Ollama, llama.cpp, Hugging Face cache, any folder)
  and reads their GGUF headers / config.json.
* Shows FIT / TIGHT / NO for each, and lets you select several to see if they fit together.

Standard library only. Python 3.8+. Works on macOS and Linux.
"""
import argparse
import concurrent.futures as cf
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VERSION = "1.0.0"
HF = "https://huggingface.co"
HERE = Path(__file__).resolve().parent
CACHE_DIR = Path(os.environ.get("LLMFIT_CACHE", Path.home() / ".cache" / "llmfit"))
CACHE_FILE = CACHE_DIR / "hf_cache.json"
CACHE_TTL = 24 * 3600
GB = 1024 ** 3

# ----------------------------------------------------------------------------- output helpers
USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def c(text, code):
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else str(text)


GREEN, YELLOW, RED, DIM, BOLD, CYAN = "32", "33", "31", "2", "1", "36"


def gb(x):
    return "-" if x is None else f"{x / GB:.1f}"


def fmt_params(p):
    if not p:
        return "?"
    return f"{p / 1e9:.0f}B" if p >= 1e10 else f"{p / 1e9:.1f}B"


def fmt_ctx(n):
    if not n:
        return "?"
    return f"{n // 1024}K" if n >= 1024 else str(n)


# ----------------------------------------------------------------------------- hardware
def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        return ""


def detect_specs():
    s = {"os": platform.system(), "arch": platform.machine(), "cpu": "", "ram": 0,
         "gpus": [], "unified": False, "budget": 0, "offload_budget": 0, "notes": []}
    if s["os"] == "Darwin":
        s["cpu"] = run(["sysctl", "-n", "machdep.cpu.brand_string"])
        s["ram"] = int(run(["sysctl", "-n", "hw.memsize"]) or 0)
        s["unified"] = s["arch"] == "arm64"
        wired = run(["sysctl", "-n", "iogpu.wired_limit_mb"])
        wired = int(wired) if wired.isdigit() else 0
        if s["unified"]:
            if wired > 0:
                s["budget"] = wired * 1024 * 1024
                s["notes"].append(f"GPU limit set by iogpu.wired_limit_mb={wired}")
            else:
                frac = 0.75 if s["ram"] > 36 * GB else 0.67
                s["budget"] = int(s["ram"] * frac)
                s["notes"].append(
                    f"macOS default GPU limit ~{int(frac * 100)}% of RAM. Raise it with: "
                    f"sudo sysctl iogpu.wired_limit_mb={int(s['ram'] / 1024 / 1024 * 0.9)}")
            s["gpus"].append({"name": "Apple GPU (unified memory)", "vram": s["budget"]})
        else:
            s["budget"] = int(s["ram"] * 0.6)
    else:
        try:
            for line in open("/proc/cpuinfo"):
                if line.startswith("model name"):
                    s["cpu"] = line.split(":", 1)[1].strip()
                    break
            for line in open("/proc/meminfo"):
                if line.startswith("MemTotal"):
                    s["ram"] = int(line.split()[1]) * 1024
        except OSError:
            pass
        if shutil.which("nvidia-smi"):
            out = run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
            for line in out.splitlines():
                if "," in line:
                    name, mib = line.rsplit(",", 1)
                    s["gpus"].append({"name": name.strip(), "vram": int(float(mib)) * 1024 * 1024})
        if not s["gpus"] and shutil.which("rocm-smi"):
            out = run(["rocm-smi", "--showmeminfo", "vram", "--json"])
            try:
                for k, v in json.loads(out).items():
                    tot = int(v.get("VRAM Total Memory (B)", 0))
                    if tot:
                        s["gpus"].append({"name": f"AMD {k}", "vram": tot})
            except Exception:
                pass
        vram = sum(g["vram"] for g in s["gpus"])
        if vram:
            s["budget"] = int(vram * 0.95)
            s["offload_budget"] = int(vram * 0.95 + s["ram"] * 0.8)
        else:
            s["budget"] = int(s["ram"] * 0.8)
            s["notes"].append("No GPU found: CPU-only, budget = 80% of RAM")
    return s


def override_specs(s, args):
    if args.mem:
        s["ram"] = int(args.mem * GB)
        s["budget"] = int(args.mem * GB * (0.75 if s["unified"] or s["os"] == "Darwin" else 0.8))
    if args.vram:
        s["notes"] = [n for n in s["notes"] if "No GPU" not in n]
        s["gpus"] = [{"name": "manual (--vram)", "vram": int(args.vram * GB)}]
        s["budget"] = int(args.vram * GB * 0.95)
        s["offload_budget"] = int(args.vram * GB * 0.95 + s["ram"] * 0.8)
    if args.budget:
        s["budget"] = int(args.budget * GB)
    return s


def print_specs(s):
    print(c("== Hardware ==", BOLD))
    print(f"  OS       : {s['os']} {s['arch']}")
    print(f"  CPU      : {s['cpu'] or '?'}")
    print(f"  RAM      : {gb(s['ram'])} GB" + ("  (unified)" if s["unified"] else ""))
    for g in s["gpus"]:
        print(f"  GPU      : {g['name']}  {gb(g['vram'])} GB")
    if s.get("budget_total") is not None and s.get("in_use"):
        print(f"  Budget   : {gb(s['budget_total'])} GB total, {c(gb(s['budget']) + ' GB free now', BOLD)} "
              f"for new models (weights + KV cache)")
    else:
        print(f"  Budget   : {c(gb(s['budget']) + ' GB', BOLD)} for model weights + KV cache")
    if s["offload_budget"]:
        print(f"  Offload  : {gb(s['offload_budget'])} GB if layers spill to CPU RAM (slow)")
    for n in s["notes"]:
        print(c(f"  note: {n}", DIM))
    print()



# ----------------------------------------------------------------------------- running models
DEFAULT_ENDPOINTS = ["http://127.0.0.1:11434", "http://127.0.0.1:1234", "http://127.0.0.1:8080",
                     "http://127.0.0.1:8000"]
PROC_HINTS = ("ollama", "llama-server", "llama-cli", "llama_server", "lm studio", "lmstudio", "lms",
              "mlx_lm", "mlx-lm", "vllm", "sglang", "koboldcpp", "text-generation", "tabbyapi", "exllama")


def http_json(url, timeout=1.5):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"llmfit/{VERSION}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None


def _find_size(obj):
    """Best-effort: find a byte-size field in an arbitrary JSON object."""
    if isinstance(obj, dict):
        for k in ("size_vram", "sizeBytes", "size_bytes", "size", "memory", "vram"):
            v = obj.get(k)
            if isinstance(v, (int, float)) and v > 1e8:
                return int(v)
    return None


def detect_running(endpoints, os_name):
    """Models currently loaded in local (or remote) servers, plus GPU/process memory in use."""
    found = []
    for ep in endpoints:
        ep = ep.rstrip("/")
        ps = http_json(f"{ep}/api/ps")  # Ollama
        if isinstance(ps, dict) and "models" in ps:
            for m in ps["models"]:
                found.append({"server": f"ollama {ep}", "model": m.get("name"),
                              "bytes": m.get("size"), "gpu": m.get("size_vram"),
                              "cpu": max(0, (m.get("size") or 0) - (m.get("size_vram") or 0)),
                              "ctx": m.get("context_length")})
            continue
        lm = http_json(f"{ep}/api/v0/models")  # LM Studio
        if isinstance(lm, dict) and isinstance(lm.get("data"), list) and any("state" in x for x in lm["data"]):
            for m in lm["data"]:
                if m.get("state") == "loaded":
                    found.append({"server": f"lmstudio {ep}", "model": m.get("id"), "bytes": _find_size(m),
                                  "ctx": m.get("loaded_context_length") or m.get("max_context_length")})
            continue
        props = http_json(f"{ep}/props")  # llama.cpp server
        if isinstance(props, dict) and ("default_generation_settings" in props or "model_path" in props):
            dg = props.get("default_generation_settings") or {}
            path = props.get("model_path") or dg.get("model")
            size = None
            if path and os.path.exists(str(path)):
                size = os.path.getsize(path)
            found.append({"server": f"llama.cpp {ep}", "model": Path(str(path)).name if path else "?",
                          "bytes": size, "ctx": dg.get("n_ctx"), "slots": props.get("total_slots")})
            continue
        om = http_json(f"{ep}/v1/models")  # vLLM / SGLang / mlx_lm.server / any OpenAI-compatible
        if isinstance(om, dict) and isinstance(om.get("data"), list):
            for m in om["data"]:
                found.append({"server": f"openai-api {ep}", "model": m.get("id"), "bytes": _find_size(m),
                              "ctx": m.get("max_model_len")})
    # process / GPU memory (catches anything the APIs missed, and sizes for servers that don't report it)
    procs = []
    if os_name == "Linux" and shutil.which("nvidia-smi"):
        out = run(["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory",
                   "--format=csv,noheader,nounits"])
        for line in out.splitlines():
            parts = [x.strip() for x in line.split(",")]
            if len(parts) == 3 and parts[2].replace(".", "").isdigit():
                procs.append({"pid": parts[0], "name": Path(parts[1]).name, "bytes": int(float(parts[2])) * 1024 ** 2,
                              "kind": "GPU"})
    else:
        out = run(["ps", "-axo", "pid=,rss=,comm="])
        for line in out.splitlines():
            parts = line.split(None, 2)
            if len(parts) == 3 and parts[1].isdigit():
                name = parts[2].lower()
                if any(h in name for h in PROC_HINTS) and int(parts[1]) * 1024 > 3e8:
                    procs.append({"pid": parts[0], "name": Path(parts[2]).name, "bytes": int(parts[1]) * 1024,
                                  "kind": "RAM"})
    return found, procs


def apply_running(s, found, procs, endpoints):
    """Subtract memory already in use by local servers from the budget."""
    local = [f for f in found if any(h in f["server"] for h in ("127.0.0.1", "localhost"))]
    # unified memory: everything counts; discrete GPU: only the part in VRAM uses the GPU budget
    local_model_bytes = sum((f["bytes"] or 0) if s["unified"] or s["os"] == "Darwin" or f.get("gpu") is None
                            else (f.get("gpu") or 0) for f in local)
    proc_bytes = sum(p["bytes"] for p in procs)
    in_use = max(local_model_bytes, proc_bytes)  # avoid double counting
    s["budget_total"] = s["budget"]
    s["in_use"] = in_use
    s["budget"] = max(0, s["budget"] - in_use)
    if s.get("offload_budget"):
        s["offload_budget"] = max(0, s["offload_budget"] - in_use)
    return s


def print_running(found, procs, s):
    print(c("== Already running ==", BOLD))
    if not found and not procs:
        print(c("  nothing detected (checked Ollama, LM Studio, llama.cpp, OpenAI-compatible servers, GPU processes)", DIM))
    for f in found:
        extra = f"  ctx {fmt_ctx(f.get('ctx'))}" if f.get("ctx") else ""
        if f.get("slots"):
            extra += f"  slots {f['slots']}"
        print(f"  {f['server']:<36} {str(f['model'])[:44]:<44} {gb(f['bytes']):>7} GB{extra}")
        if f.get("gpu") is not None and f.get("bytes") and not s["unified"]:
            pct = f["gpu"] / f["bytes"] * 100
            print(f"  {'':<36} GPU {gb(f['gpu'])} GB | CPU {gb(f['cpu'])} GB  "
                  f"{split_bar(f['gpu'], f['cpu'], 24)} {pct:.0f}% on GPU")
    for p in procs:
        print(f"  {p['kind']} pid {p['pid']:<8} {p['name'][:58]:<58} {gb(p['bytes']):>7} GB")
    if s.get("in_use"):
        print(f"  In use: {c(gb(s['in_use']) + ' GB', YELLOW)} -> free budget now "
              f"{c(gb(s['budget']) + ' GB', BOLD)} (of {gb(s['budget_total'])} GB)")
    print()


# ----------------------------------------------------------------------------- live view + benchmark
def prom(url):
    """Parse a Prometheus /metrics page into {metric_name: summed value}."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"llmfit/{VERSION}"})
        with urllib.request.urlopen(req, timeout=1.5) as r:
            txt = r.read().decode("utf-8", "replace")
    except Exception:
        return None
    out = {}
    for line in txt.splitlines():
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+([-+0-9.eEinfNa]+)", line)
        if m:
            try:
                out[m.group(1)] = out.get(m.group(1), 0.0) + float(m.group(3))
            except ValueError:
                pass
    return out


def server_metrics(ep):
    """Throughput counters from llama.cpp (--metrics), vLLM and SGLang."""
    m = prom(ep.rstrip("/") + "/metrics")
    if not m:
        return None
    pick = lambda *ks: next((m[k] for k in ks if k in m), None)
    return {"gen_total": pick("vllm:generation_tokens_total", "llamacpp:tokens_predicted_total",
                              "sglang:generation_tokens_total"),
            "prompt_total": pick("vllm:prompt_tokens_total", "llamacpp:prompt_tokens_total",
                                 "sglang:prompt_tokens_total"),
            "running": pick("vllm:num_requests_running", "llamacpp:requests_processing", "sglang:num_running_reqs"),
            "waiting": pick("vllm:num_requests_waiting", "llamacpp:requests_deferred", "sglang:num_queue_reqs"),
            "kv_pct": pick("vllm:kv_cache_usage_perc", "vllm:gpu_cache_usage_perc", "llamacpp:kv_cache_usage_ratio",
                           "sglang:token_usage")}


def sys_stats(os_name, prev):
    """GPU utilisation / memory, CPU load and RAM, without sudo."""
    st = {"gpus": [], "cpu": None, "ram_used": None, "ram_total": None}
    if os_name == "Darwin":
        out = run(["ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"])
        u = re.search(r'"Device Utilization %"=(\d+)', out)
        mem = re.search(r'"In use system memory"=(\d+)', out)
        st["gpus"].append({"name": "Apple GPU", "util": int(u.group(1)) if u else None,
                           "used": int(mem.group(1)) if mem else None, "total": None})
        vm = run(["vm_stat"])
        ps = re.search(r"page size of (\d+)", vm)
        page = int(ps.group(1)) if ps else 16384
        pages = {k: int(v) for k, v in re.findall(r'Pages ([\w ]+?):\s+(\d+)', vm)}
        used = sum(pages.get(k, 0) for k in ("active", "wired down", "occupied by compressor")) * page
        st["ram_used"] = used
        st["ram_total"] = int(run(["sysctl", "-n", "hw.memsize"]) or 0)
        la = os.getloadavg()[0]
        st["cpu"] = min(100.0, la / (os.cpu_count() or 1) * 100)
    else:
        if shutil.which("nvidia-smi"):
            out = run(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,power.draw,"
                       "temperature.gpu", "--format=csv,noheader,nounits"])
            for line in out.splitlines():
                p = [x.strip() for x in line.split(",")]
                if len(p) >= 4:
                    f = lambda x: float(x) if x.replace(".", "", 1).isdigit() else None
                    st["gpus"].append({"name": p[0], "util": f(p[1]), "used": (f(p[2]) or 0) * 1024 ** 2,
                                       "total": (f(p[3]) or 0) * 1024 ** 2,
                                       "power": f(p[4]) if len(p) > 4 else None,
                                       "temp": f(p[5]) if len(p) > 5 else None})
        try:
            mi = {l.split(":")[0]: int(l.split()[1]) * 1024 for l in open("/proc/meminfo")}
            st["ram_total"] = mi.get("MemTotal")
            st["ram_used"] = mi.get("MemTotal", 0) - mi.get("MemAvailable", 0)
            vals = [int(x) for x in open("/proc/stat").readline().split()[1:]]
            idle, total = vals[3] + vals[4], sum(vals)
            if prev.get("cpu"):
                di, dt = idle - prev["cpu"][0], total - prev["cpu"][1]
                st["cpu"] = 100 * (1 - di / dt) if dt else None
            prev["cpu"] = (idle, total)
        except OSError:
            pass
    return st


def gauge(v, total, width=28, warn=0.8, crit=0.95):
    if not total or v is None:
        return c("?" * 0 + "·" * width, DIM)
    f = max(0.0, min(1.0, v / total))
    k = int(round(width * f))
    col = GREEN if f < warn else YELLOW if f < crit else RED
    return c("█" * k, col) + c("·" * (width - k), DIM)


def watch(args, s):
    eps = DEFAULT_ENDPOINTS + args.endpoint
    prev, last = {}, {}
    interval = max(0.5, args.watch)
    try:
        while True:
            t0 = time.time()
            st = sys_stats(s["os"], prev)
            found, procs = detect_running(eps, s["os"])
            lines = [c(f"llmfit live  |  {time.strftime('%H:%M:%S')}  |  every {interval:g}s  |  Ctrl-C to quit", BOLD), ""]
            for gp in st["gpus"]:
                tot = gp.get("total") or s.get("budget_total") or s["budget"]
                util = gp.get("util")
                lines.append(f"  {gp['name'][:22]:<22} util {gauge(util, 100)} {util if util is not None else '?':>4}%"
                             + (f"   {gp['power']:.0f} W" if gp.get("power") else "")
                             + (f"  {gp['temp']:.0f}°C" if gp.get("temp") else ""))
                if gp.get("used") is not None:
                    lines.append(f"  {'memory':<22}      {gauge(gp['used'], tot)} {gb(gp['used']):>5} / {gb(tot)} GB")
            if st["cpu"] is not None:
                lines.append(f"  {'CPU':<22} load {gauge(st['cpu'], 100)} {st['cpu']:>4.0f}%")
            if st["ram_used"] is not None:
                lines.append(f"  {'RAM':<22}      {gauge(st['ram_used'], st['ram_total'])} "
                             f"{gb(st['ram_used']):>5} / {gb(st['ram_total'])} GB")
            lines += ["", c(f"  {'server':<30} {'model':<34} {'size':>7}  {'GPU|CPU':<22} {'tok/s':>7} {'prompt/s':>8}"
                            f" {'run':>4} {'wait':>4} {'KV%':>5}", DIM)]
            if not found:
                lines.append(c("  no running models detected", DIM))
            seen_ep = set()
            for f in found:
                ep = f["server"].split()[-1]
                met = server_metrics(ep) if ep not in seen_ep else None
                seen_ep.add(ep)
                tps = pps = None
                if met:
                    now = time.time()
                    if ep in last and met.get("gen_total") is not None:
                        dt = now - last[ep]["t"]
                        tps = (met["gen_total"] - (last[ep]["gen_total"] or 0)) / dt if dt else None
                        if met.get("prompt_total") is not None:
                            pps = (met["prompt_total"] - (last[ep]["prompt_total"] or 0)) / dt if dt else None
                    last[ep] = {"t": now, **met}
                gpu, cpu = f.get("gpu"), f.get("cpu")
                split = (split_bar(gpu, cpu or 0, 14) + f" {gpu / (gpu + (cpu or 0)) * 100:3.0f}%") if gpu else \
                    c("unified" if s["os"] == "Darwin" else "?", DIM).ljust(22)
                fmtn = lambda v, d=0: "-" if v is None else f"{v:.{d}f}"
                lines.append(f"  {f['server'][:30]:<30} {str(f['model'])[:34]:<34} {gb(f['bytes']):>7}  {split:<22} "
                             f"{fmtn(tps, 1):>7} {fmtn(pps):>8} {fmtn(met and met.get('running')):>4} "
                             f"{fmtn(met and met.get('waiting')):>4} "
                             f"{fmtn(met and met.get('kv_pct') is not None and met['kv_pct'] * 100):>5}")
            if procs:
                lines += ["", c("  processes", DIM)]
                for p in procs:
                    lines.append(f"  {p['kind']} pid {p['pid']:<8} {p['name'][:40]:<40} {gb(p['bytes']):>7} GB")
            lines += ["", c("  tok/s needs a metrics endpoint: llama-server --metrics, vLLM and SGLang have it by default. "
                            "Ollama / LM Studio: use --bench.", DIM)]
            sys.stdout.write("\033[2J\033[H" + "\n".join(lines) + "\n")
            sys.stdout.flush()
            if args.watch_once:
                return
            time.sleep(max(0.1, interval - (time.time() - t0)))
    except KeyboardInterrupt:
        print()


def bench_one(f, prompt, max_tokens):
    """Measure TTFT and decode speed of a running model with one short request."""
    ep = f["server"].split()[-1].rstrip("/")
    model = f["model"]
    if f["server"].startswith("ollama"):
        body = json.dumps({"model": model, "prompt": prompt, "stream": False,
                           "options": {"num_predict": max_tokens}}).encode()
        try:
            req = urllib.request.Request(ep + "/api/generate", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                d = json.loads(r.read())
            ns = 1e9
            return {"ttft": (d.get("load_duration", 0) + d.get("prompt_eval_duration", 0)) / ns,
                    "prefill": d.get("prompt_eval_count", 0) / (d.get("prompt_eval_duration", 1) / ns),
                    "decode": d.get("eval_count", 0) / (d.get("eval_duration", 1) / ns),
                    "tokens": d.get("eval_count")}
        except Exception as e:
            return {"error": str(e)[:60]}
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}],
                       "max_tokens": max_tokens, "stream": True, "temperature": 0}).encode()
    try:
        req = urllib.request.Request(ep + "/v1/chat/completions", data=body,
                                     headers={"Content-Type": "application/json"})
        t0 = time.time()
        first = None
        n = 0
        with urllib.request.urlopen(req, timeout=300) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:") or line.endswith("[DONE]"):
                    continue
                try:
                    ch = json.loads(line[5:])["choices"][0].get("delta", {})
                except Exception:
                    continue
                if ch.get("content") or ch.get("reasoning_content") or ch.get("reasoning"):
                    n += 1
                    if first is None:
                        first = time.time()
        end = time.time()
        if first is None:
            return {"error": "no tokens returned"}
        return {"ttft": first - t0, "decode": (n - 1) / (end - first) if n > 1 and end > first else None,
                "prefill": None, "tokens": n}
    except Exception as e:
        return {"error": str(e)[:60]}


def bench(args, s):
    found, _ = detect_running(DEFAULT_ENDPOINTS + args.endpoint, s["os"])
    if not found:
        print("No running models found to benchmark.")
        return
    prompt = ("Write a short Verilog module for a 4-bit up counter with synchronous reset, "
              "then explain it in two sentences.")
    print(c(f"== Benchmark ({args.bench} tokens each, one request at a time) ==", BOLD))
    print(c(f"  {'server':<30} {'model':<36} {'TTFT s':>7} {'prefill t/s':>11} {'decode t/s':>10} {'tokens':>6}", DIM))
    for f in found:
        r = bench_one(f, prompt, args.bench)
        if r.get("error"):
            print(f"  {f['server'][:30]:<30} {str(f['model'])[:36]:<36} " + c(r["error"], RED))
            continue
        fm = lambda v, d: "-" if v is None else f"{v:.{d}f}"
        print(f"  {f['server'][:30]:<30} {str(f['model'])[:36]:<36} {fm(r['ttft'], 2):>7} {fm(r['prefill'], 0):>11} "
              f"{fm(r['decode'], 1):>10} {fm(r['tokens'], 0):>6}")
    print(c("  TTFT includes model load time if the model was not in memory yet.", DIM))

# ----------------------------------------------------------------------------- HF client + cache
class HFClient:
    def __init__(self, refresh=False, offline=False):
        self.offline = offline
        self.cache = {}
        if not refresh and CACHE_FILE.exists():
            try:
                self.cache = json.loads(CACHE_FILE.read_text())
            except Exception:
                self.cache = {}
        self.token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

    def save(self):
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            CACHE_FILE.write_text(json.dumps(self.cache))
        except OSError:
            pass

    def get(self, url, raw=False):
        hit = self.cache.get(url)
        if hit and time.time() - hit["t"] < CACHE_TTL:
            return hit["v"]
        if self.offline:
            return hit["v"] if hit else None
        req = urllib.request.Request(url, headers={"User-Agent": f"llmfit/{VERSION}"})
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read().decode("utf-8", "replace")
            val = body if raw else json.loads(body)
        except (urllib.error.URLError, ValueError, OSError):
            return hit["v"] if hit else None
        self.cache[url] = {"t": time.time(), "v": val}
        return val

    def search(self, author, query, limit=40):
        q = urllib.parse.urlencode({"author": author, "search": query, "sort": "downloads",
                                    "direction": -1, "limit": limit})
        return self.get(f"{HF}/api/models?{q}") or []

    def recent(self, author, limit=30, search=None):
        p = {"author": author, "sort": "lastModified", "direction": -1, "limit": limit}
        if search:
            p["search"] = search
        return self.get(f"{HF}/api/models?{urllib.parse.urlencode(p)}") or []

    def info(self, repo):
        return self.get(f"{HF}/api/models/{repo}?blobs=true")

    def config(self, repo):
        return self.get(f"{HF}/{repo}/resolve/main/config.json")


# ----------------------------------------------------------------------------- model metadata
def cfg_text(cfg):
    """Merge text_config (multimodal wrappers) over the top-level config."""
    if not isinstance(cfg, dict):
        return {}
    out = dict(cfg)
    for k in ("text_config", "llm_config", "language_config"):
        if isinstance(cfg.get(k), dict):
            out.update(cfg[k])
    return out


def g(cfg, *keys):
    for k in keys:
        if cfg.get(k) is not None:
            return cfg[k]
    return None


def analyze_config(cfg):
    """Extract architecture facts from a HF/MLX config.json."""
    t = cfg_text(cfg)
    m = {}
    m["arch"] = g(t, "model_type") or (t.get("architectures") or ["?"])[0]
    m["layers"] = g(t, "num_hidden_layers", "n_layer", "num_layers")
    m["hidden"] = g(t, "hidden_size", "d_model", "n_embd")
    m["heads"] = g(t, "num_attention_heads", "n_head")
    m["kv_heads"] = g(t, "num_key_value_heads", "num_kv_heads") or m["heads"]
    m["head_dim"] = g(t, "head_dim") or (m["hidden"] // m["heads"] if m["hidden"] and m["heads"] else None)
    m["ctx"] = g(t, "max_position_embeddings", "max_seq_len", "seq_length", "n_positions")
    m["experts"] = g(t, "num_local_experts", "num_experts", "n_routed_experts", "moe_num_experts")
    m["experts_active"] = g(t, "num_experts_per_tok", "num_experts_per_token", "moe_top_k", "top_k")
    m["moe_inter"] = g(t, "moe_intermediate_size", "expert_intermediate_size")
    m["inter"] = g(t, "intermediate_size")
    m["moe"] = bool(m["experts"] and int(m["experts"]) > 1)
    m["first_dense"] = g(t, "first_k_dense_replace") or 0
    m["kv_lora"] = g(t, "kv_lora_rank")
    m["rope_dim"] = g(t, "qk_rope_head_dim") or 0
    q = cfg.get("quantization") or cfg.get("quantization_config") or {}
    m["bits"] = q.get("bits") or q.get("w_bit") or q.get("num_bits")
    if q.get("quant_method") and not m["bits"]:
        m["bits"] = q.get("quant_method")
    # attention layers that need a KV cache (hybrid linear-attention / sliding models)
    full = m["layers"]
    lt = t.get("layer_types")
    if isinstance(lt, list) and lt:
        attn = [x for x in lt if not any(w in str(x) for w in ("linear", "mamba", "ssm", "conv"))]
        slide = [x for x in attn if "slid" in str(x) or "local" in str(x)]
        full = (len(attn) - len(slide)) or full
        m["slide_layers"] = len(slide)
    elif t.get("full_attention_interval") and m["layers"]:
        full = m["layers"] // int(t["full_attention_interval"])
    m["kv_layers"] = full
    m["window"] = g(t, "sliding_window")
    return m


def estimate_active(total, m):
    """Active params for MoE ~ total - (unused experts' FFN weights)."""
    if not (total and m.get("moe") and m.get("layers") and m.get("hidden")):
        return None
    E, k = int(m["experts"]), int(m.get("experts_active") or 0)
    inter = m.get("moe_inter") or m.get("inter")
    if not (E and k and inter):
        return None
    routed_layers = m["layers"] - int(m.get("first_dense") or 0)
    expert_params = routed_layers * E * 3 * m["hidden"] * inter
    if expert_params >= total:
        return None
    act = int(total - expert_params * (1 - k / E))
    return act if act < total * 0.25 else None  # implausible -> config uses unknown layout


def params_from_name(name):
    n = name.replace("_", "-")
    tot = act = None
    m = re.search(r"(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)[Bb](?![a-z])", n)
    if m:
        tot = float(m.group(1)) * 1e9
    m = re.search(r"-A(\d+(?:\.\d+)?)B", n)
    if m:
        act = float(m.group(1)) * 1e9
    return tot, act


def kv_bytes(m, ctx, kv_bits=16):
    """KV cache size for `ctx` tokens (capped at the model's max context)."""
    if m.get("ctx"):
        ctx = min(ctx, int(m["ctx"]))
    L = m.get("kv_layers") or m.get("layers")
    if not (L and ctx):
        return None
    if m.get("kv_lora"):  # MLA (DeepSeek / GLM / Mistral 4): compressed latent cache
        return int(L * (m["kv_lora"] + (m.get("rope_dim") or 0)) * ctx * kv_bits / 8)
    kvh, hd = m.get("kv_heads"), m.get("head_dim")
    if isinstance(kvh, list):
        kvh = max(kvh)
    if not (kvh and hd):
        return None
    full = 2 * L * kvh * hd * ctx
    slide = 2 * (m.get("slide_layers") or 0) * kvh * hd * min(ctx, m.get("window") or ctx)
    return int((full + slide) * kv_bits / 8)


# ----------------------------------------------------------------------------- GGUF reader
GGUF_FTYPE = {0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 7: "Q8_0", 8: "Q5_0", 9: "Q5_1", 10: "Q2_K",
              11: "Q3_K_S", 12: "Q3_K_M", 13: "Q3_K_L", 14: "Q4_K_S", 15: "Q4_K_M", 16: "Q5_K_S",
              17: "Q5_K_M", 18: "Q6_K", 19: "IQ2_XXS", 20: "IQ2_XS", 21: "Q2_K_S", 22: "IQ3_XS",
              23: "IQ3_XXS", 24: "IQ1_S", 25: "IQ4_NL", 26: "IQ3_S", 27: "IQ3_M", 28: "IQ2_S",
              29: "IQ2_M", 30: "IQ4_XS", 31: "IQ1_M", 32: "BF16", 36: "TQ1_0", 37: "TQ2_0",
              38: "MXFP4_MOE"}
_SCALAR = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i", 6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}


def read_gguf_meta(path):
    """Read GGUF key/value metadata (header only, no tensors)."""
    meta = {}
    with open(path, "rb") as f:
        if f.read(4) != b"GGUF":
            return None
        ver = struct.unpack("<I", f.read(4))[0]
        if ver < 2:
            return None
        _n_tensors, n_kv = struct.unpack("<QQ", f.read(16))

        def rstr():
            n = struct.unpack("<Q", f.read(8))[0]
            return f.read(n).decode("utf-8", "replace")

        def rval(t):
            if t in _SCALAR:
                fmt = _SCALAR[t]
                return struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0]
            if t == 8:
                return rstr()
            if t == 9:
                at, n = struct.unpack("<IQ", f.read(12))
                if at in _SCALAR and n > 64:  # skip big numeric arrays fast
                    f.seek(n * struct.calcsize(_SCALAR[at]), 1)
                    return f"<array {n}>"
                vals = [rval(at) for _ in range(n)]
                return vals if n <= 64 else f"<array {n}>"
            raise ValueError(f"bad gguf type {t}")

        for _ in range(n_kv):
            k = rstr()
            t = struct.unpack("<I", f.read(4))[0]
            meta[k] = rval(t)
    return meta


def analyze_gguf(meta):
    a = meta.get("general.architecture", "?")
    p = lambda k: meta.get(f"{a}.{k}")
    m = {"arch": a, "name": meta.get("general.name"), "layers": p("block_count"),
         "hidden": p("embedding_length"), "heads": p("attention.head_count"),
         "kv_heads": p("attention.head_count_kv"), "ctx": p("context_length"),
         "experts": p("expert_count"), "experts_active": p("expert_used_count"),
         "moe_inter": p("expert_feed_forward_length"), "inter": p("feed_forward_length"),
         "quant": GGUF_FTYPE.get(meta.get("general.file_type"), str(meta.get("general.file_type", "?"))),
         "license": meta.get("general.license"), "size_label": meta.get("general.size_label")}
    for k in ("heads", "kv_heads", "inter"):
        if isinstance(m[k], list):
            m[k] = max(m[k])
    m["head_dim"] = p("attention.key_length") or (m["hidden"] // m["heads"] if m["hidden"] and m["heads"] else None)
    m["moe"] = bool(m["experts"] and m["experts"] > 1)
    fai = p("full_attention_interval")
    m["kv_layers"] = (m["layers"] // fai) if (fai and m["layers"]) else m["layers"]
    return m


# ----------------------------------------------------------------------------- catalog resolution
QUANT_PREF_MLX = {4: ["mxfp4", "4bit", "4-bit", "q4"], 8: ["8bit", "8-bit", "q8"], 6: ["6bit"], 3: ["3bit"]}
QUANT_PREF_GGUF = {4: ["Q4_K_M", "UD-Q4_K_XL", "Q4_K_XL", "Q4_K_S", "IQ4_XS", "MXFP4"],
                   8: ["Q8_0", "UD-Q8_K_XL"], 6: ["Q6_K", "UD-Q6_K_XL"], 3: ["Q3_K_M", "UD-Q3_K_XL", "IQ3_M"],
                   2: ["Q2_K", "UD-Q2_K_XL", "IQ2_M"]}
SKIP_WORDS = ("dwq-teacher", "eagle", "draft", "-mtp", "abliterated", "uncensored", "obliterated",
              "heretic", "optiq", "unrestricted", "obliterat", "-distill", "-base", "awq", "gptq")


def pick_mlx(hf, query, bits):
    toks = [t for t in re.split(r"[\s]+", query.lower()) if t]
    for author in ("mlx-community", "lmstudio-community"):
        cands = [x["id"] for x in hf.search(author, query)
                 if all(t in x["id"].lower() for t in toks)
                 and not any(w in x["id"].lower() for w in SKIP_WORDS)
                 and (author == "mlx-community" or "mlx" in x["id"].lower())]
        # prefer the plain build: shortest name for each quant
        ql = query.lower()
        cands.sort(key=lambda x: (not x.lower().split("/")[-1].startswith(ql), len(x)))
        for pref in QUANT_PREF_MLX.get(bits, ["4bit"]):
            for cid in cands:
                if cid.lower().endswith(pref):
                    return cid
    return None


def gguf_groups(siblings):
    groups = {}
    for s in siblings:
        fn = s.get("rfilename", "")
        if not fn.endswith(".gguf") or "mmproj" in fn.lower():
            continue
        key = fn.split("/")[0] if "/" in fn else re.sub(r"-\d{5}-of-\d{5}", "", fn)
        groups.setdefault(key, {"files": [], "size": 0})
        groups[key]["files"].append(fn)
        groups[key]["size"] += s.get("size") or 0
    return groups


def pick_gguf(hf, query, bits, authors=("unsloth", "bartowski", "lmstudio-community", "ggml-org")):
    toks = [t for t in query.lower().split() if t]
    for author in authors:
        for x in hf.search(author, query):
            rid = x["id"]
            if "gguf" not in rid.lower() or not all(t in rid.lower() for t in toks):
                continue
            info = hf.info(rid)
            if not info:
                continue
            groups = gguf_groups(info.get("siblings", []))
            for pref in QUANT_PREF_GGUF.get(bits, ["Q4_K_M"]):
                for key, grp in groups.items():
                    if pref.lower() in key.lower():
                        return rid, key, grp, info
    return None


def resolve_entry(hf, e, fmt, bits, ctx, kv_bits):
    """Turn a catalog entry into a fully described row using live HF data, with fallback estimates."""
    row = {"name": e["name"], "kind": "catalog", "role": e.get("role", ""), "repo": None, "quant": None,
           "size": None, "total": e.get("params_b") and e["params_b"] * 1e9,
           "active": e.get("active_b") and e["active_b"] * 1e9, "moe": e.get("moe"), "arch": None,
           "layers": None, "experts": None, "experts_active": None, "ctx": None, "license": None,
           "updated": None, "kv": None, "source": "estimate", "base": e.get("base")}
    meta = {}
    base = e.get("base")
    if base:
        binfo = hf.info(base)
        if binfo:
            st = (binfo.get("safetensors") or {}).get("total")
            if st:
                row["total"] = row["total"] or st
            row["license"] = (binfo.get("cardData") or {}).get("license")
        bcfg = hf.config(base)
        if isinstance(bcfg, dict):
            meta = analyze_config(bcfg)

    q = e.get("query") or e["name"]
    if fmt == "mlx":
        rid = pick_mlx(hf, q, bits)
        if rid:
            info = hf.info(rid) or {}
            size = sum(s.get("size") or 0 for s in info.get("siblings", [])
                       if s.get("rfilename", "").endswith(".safetensors"))
            if size:
                row.update(repo=rid, size=size, source="hf", updated=(info.get("lastModified") or "")[:10])
                row["quant"] = rid.split("-")[-1]
                cfg = hf.config(rid)
                if isinstance(cfg, dict):
                    mm = analyze_config(cfg)
                    meta = {**mm, **{k: v for k, v in meta.items() if v}} if meta else mm
                    if mm.get("bits"):
                        row["quant"] = f"{mm['bits']}bit" if isinstance(mm["bits"], int) else str(mm["bits"])
                if not row["license"]:
                    row["license"] = (info.get("cardData") or {}).get("license")
    else:
        hit = pick_gguf(hf, q, bits)
        if hit:
            rid, key, grp, info = hit
            row.update(repo=rid, size=grp["size"], quant=key.split("/")[-1].replace(".gguf", "").split("-")[-1]
                       if "/" not in key and "-" in key else key, source="hf",
                       updated=(info.get("lastModified") or "")[:10])
            m2 = re.search(r"((?:UD-)?I?Q\d[A-Z0-9_]*|BF16|F16|MXFP4[A-Z_]*)", key, re.I)
            if m2:
                row["quant"] = m2.group(1)
            if not row["license"]:
                row["license"] = (info.get("cardData") or {}).get("license")
            if not meta:
                base_guess = (info.get("cardData") or {}).get("base_model")
                if isinstance(base_guess, list):
                    base_guess = base_guess[0] if base_guess else None
                if base_guess:
                    bcfg = hf.config(base_guess)
                    if isinstance(bcfg, dict):
                        meta = analyze_config(bcfg)

    # merge architecture facts
    for k in ("arch", "layers", "experts", "experts_active", "ctx"):
        row[k] = meta.get(k) or row.get(k)
    if row["moe"] is None and meta:
        row["moe"] = meta.get("moe")
    ntot, nact = params_from_name(e.get("query") or e["name"])
    row["total"] = row["total"] or ntot
    if not (row["active"] or nact):
        est = estimate_active(row["total"], meta)
        if est:
            row["active"], row["active_est"] = est, True
    row["active"] = row["active"] or nact
    if row["moe"] is None:
        row["moe"] = bool(nact)
    if not row["moe"] and row["total"]:
        row["active"] = row["total"]
    if row["size"] is None and row["total"]:  # offline / not found: estimate from params
        eb = {"mlx": {4: 4.5, 8: 8.5, 6: 6.5, 3: 3.5}, "gguf": {4: 4.85, 8: 8.5, 6: 6.6, 3: 3.9, 2: 2.9}}
        row["size"] = int(row["total"] * eb[fmt].get(bits, bits + 0.5) / 8)
        row["quant"] = f"~{bits}bit"
    if any(w in row["role"] for w in ("embed", "rerank")):
        ctx = min(ctx, 8192)  # embedders/rerankers only see short chunks
    row["kv"] = kv_bytes(meta, ctx, kv_bits) if meta else None
    return row


def load_catalog(path):
    data = json.loads(Path(path).read_text())
    return data["models"] if isinstance(data, dict) else data


QUANT_REPO = re.compile(r"gguf|mlx|fp8|awq|gptq|nvfp4|mxfp4|int4|int8|exl|abliter|uncens|heretic|"
                        r"-bf16|-adapted|lora|dflash|strata|research|video|ocr|image|embed|rerank", re.I)


LABS = {"qwen", "deepseek-ai", "zai-org", "moonshotai", "minimaxai", "xiaomimimo", "openai", "google",
        "mistralai", "meta-llama", "nvidia", "microsoft", "tencent", "baidu", "inclusionai", "thinkingmachines",
        "ibm-granite", "allenai", "liquidai", "coherelabs", "stepfun-ai", "aleph-alpha", "sarvamai", "krafton",
        "bytedance-seed", "internlm", "huggingfacetb", "amazon", "apple", "servicenow-ai", "swiss-ai", "upstage",
        "ai21labs", "xai-org", "nousresearch", "arcee-ai", "lgai-exaone", "naver-hyperclovax", "rednote-hilab"}


def discover(hf, limit, days=120, any_org=False):
    """Trending, recently released chat/coding models from Hugging Face (original repos)."""
    seen, out = set(), []
    cutoff = time.time() - days * 86400
    for tag in ("text-generation", "image-text-to-text"):
        q = urllib.parse.urlencode({"pipeline_tag": tag, "sort": "trendingScore", "direction": -1, "limit": 80})
        for x in hf.get(f"{HF}/api/models?{q}") or []:
            rid = x["id"]
            name = rid.split("/")[-1]
            if QUANT_REPO.search(rid) or name.lower() in seen or any(w in rid.lower() for w in SKIP_WORDS):
                continue
            if not any_org and rid.split("/")[0].lower() not in LABS:
                continue
            try:
                created = time.mktime(time.strptime(x.get("createdAt", "")[:10], "%Y-%m-%d"))
            except ValueError:
                created = 0
            if created < cutoff:
                continue
            seen.add(name.lower())
            out.append({"name": name, "query": name, "base": rid, "role": "trending"})
    return out[: limit * 2]  # resolved later; tiny models are dropped then


# ----------------------------------------------------------------------------- local scan
def default_scan_dirs():
    h = Path.home()
    d = [h / ".lmstudio" / "models", h / ".cache" / "lm-studio" / "models",
         h / ".cache" / "huggingface" / "hub", h / ".cache" / "llama.cpp", h / "models"]
    hfh = os.environ.get("HF_HOME")
    if hfh:
        d.append(Path(hfh) / "hub")
    return [x for x in d if x.exists()]


def ollama_dirs():
    d = [Path(os.environ["OLLAMA_MODELS"])] if os.environ.get("OLLAMA_MODELS") else []
    d += [Path.home() / ".ollama" / "models", Path("/usr/share/ollama/.ollama/models"),
          Path("/var/lib/ollama/.ollama/models")]
    return [x for x in d if (x / "manifests").exists()]


def dir_size(files):
    t = 0
    for f in files:
        try:
            t += os.stat(f).st_size  # follows HF cache symlinks
        except OSError:
            pass
    return t


def local_row(name, kind, size, m, path, ctx, kv_bits, quant=None):
    tot, act = params_from_name(name)
    row = {"name": name, "kind": kind, "role": "installed", "repo": str(path), "size": size,
           "quant": quant or m.get("quant") or (f"{m['bits']}bit" if isinstance(m.get("bits"), int) else m.get("bits")),
           "arch": m.get("arch"), "layers": m.get("layers"), "experts": m.get("experts"),
           "experts_active": m.get("experts_active"), "ctx": m.get("ctx"), "moe": m.get("moe"),
           "license": m.get("license"), "updated": time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(path))),
           "total": tot, "active": act, "kv": kv_bytes(m, ctx, kv_bits), "source": "local"}
    if not row["total"] and m.get("size_label"):
        t2, a2 = params_from_name("x-" + str(m["size_label"]))
        row["total"] = t2
        row["active"] = row["active"] or a2
    if not row["active"]:
        est = estimate_active(row["total"], m)
        if est:
            row["active"], row["active_est"] = est, True
    if not row["moe"] and row["total"]:
        row["active"] = row["total"]
    return row


def scan_local(dirs, ctx, kv_bits):
    rows, seen = [], set()
    for root in dirs:
        root = Path(root).expanduser()
        if not root.exists():
            continue
        ggufs, cfgdirs = [], []
        for dp, dn, fn in os.walk(root, followlinks=False):
            dn[:] = [d for d in dn if not d.startswith(".") and d not in ("blobs", "refs")]
            for f in fn:
                if f.endswith(".gguf") and "mmproj" not in f.lower():
                    ggufs.append(Path(dp) / f)
            if "config.json" in fn and any(f.endswith(".safetensors") for f in fn):
                cfgdirs.append(Path(dp))
        shards = {}
        for p in ggufs:
            key = re.sub(r"-\d{5}-of-\d{5}", "", str(p))
            shards.setdefault(key, []).append(p)
        for key, files in shards.items():
            files.sort()
            real = os.path.realpath(files[0])
            if real in seen:
                continue
            seen.add(real)
            try:
                meta = read_gguf_meta(files[0]) or {}
            except Exception:
                meta = {}
            m = analyze_gguf(meta) if meta else {}
            name = m.get("name") or Path(key).stem
            src = "lmstudio" if "lm-studio" in key or ".lmstudio" in key else "gguf"
            rows.append(local_row(f"{name} [{Path(key).stem}]" if m.get("name") else name, src,
                                  dir_size(files), m, files[0], ctx, kv_bits))
        for d in cfgdirs:
            real = os.path.realpath(d)
            if real in seen:
                continue
            seen.add(real)
            try:
                cfg = json.loads((d / "config.json").read_text())
            except Exception:
                continue
            m = analyze_config(cfg)
            sz = dir_size([d / f for f in os.listdir(d) if f.endswith(".safetensors")])
            parts = d.parts
            name = next((p.replace("models--", "").replace("--", "/") for p in parts if p.startswith("models--")),
                        "/".join(parts[-2:]))
            src = "hf-cache" if "huggingface" in str(d) else ("lmstudio" if "lm" in str(d).lower() else "mlx" if m.get("bits") else "safetensors")
            rows.append(local_row(name, src, sz, m, d, ctx, kv_bits))
    for od in ollama_dirs():
        for mf in (od / "manifests").rglob("*"):
            if not mf.is_file():
                continue
            try:
                man = json.loads(mf.read_text())
            except Exception:
                continue
            layer = next((l for l in man.get("layers", []) if l.get("mediaType", "").endswith(".model")), None)
            if not layer:
                continue
            blob = od / "blobs" / layer["digest"].replace(":", "-")
            if str(blob) in seen:
                continue
            seen.add(str(blob))
            try:
                meta = read_gguf_meta(blob) or {}
            except Exception:
                meta = {}
            m = analyze_gguf(meta) if meta else {}
            rel = mf.relative_to(od / "manifests").parts
            name = f"{rel[-2]}:{rel[-1]}" if len(rel) >= 2 else mf.name
            rows.append(local_row(name, "ollama", layer.get("size", 0), m, blob, ctx, kv_bits))
    return rows



# ----------------------------------------------------------------------------- GPU / CPU placement map
SEG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
SEG_COLORS = ["36", "35", "34", "32", "33", "96", "95", "94", "92", "93"]


def place(rows_sel, s, overhead_gb):
    """Greedy layer placement in selection order: fill free GPU memory, spill remaining layers to CPU RAM.
    Unified memory (Apple Silicon): CPU and GPU share one pool, everything runs on the GPU (Metal)."""
    unified = s["unified"] or s["os"] == "Darwin"
    gpu_left = s["budget"]
    cpu_left = int(s["ram"] * 0.8) if not unified else 0
    out = []
    for r in rows_sel:
        n = need(r, overhead_gb) or 0
        L = int(r.get("layers") or 1)
        fixed = int(overhead_gb * GB)
        per = max(1, (n - fixed) / L)
        if n <= gpu_left:
            gpu, lg = n, L
        elif unified:
            gpu, lg = n, L  # does not fit; macOS would swap/compress, reported as over budget
        else:
            lg = max(0, min(L, int((gpu_left - fixed) / per))) if gpu_left > fixed else 0
            gpu = fixed + int(lg * per) if lg else 0
        cpu = n - gpu
        gpu_left -= gpu
        cpu_left -= cpu
        out.append({"row": r, "need": n, "gpu": gpu, "cpu": cpu, "layers": L, "layers_gpu": lg,
                    "over_gpu": gpu_left < 0, "over_cpu": cpu_left < 0})
    return out


def split_bar(gpu, cpu, width=30):
    tot = gpu + cpu
    if not tot:
        return ""
    g = int(round(width * gpu / tot))
    return c("█" * g, GREEN) + c("▒" * (width - g), YELLOW)


def memory_map(s, segs, width=60):
    """One bar for the GPU / unified pool: running models, selected models, free."""
    total = s.get("budget_total") or s["budget"]
    if not total:
        return
    bar, legend, used = "", [], 0
    if s.get("in_use"):
        k = max(1, int(width * s["in_use"] / total))
        bar += c("▓" * k, DIM)
        used += k
        legend.append(c("▓", DIM) + f" running {gb(s['in_use'])} GB")
    for i, sg in enumerate(segs):
        k = int(round(width * sg["gpu"] / total))
        if sg["gpu"] and k == 0:
            k = 1
        ch, col = SEG_CHARS[i % 26], SEG_COLORS[i % len(SEG_COLORS)]
        bar += c(ch * k, col)
        used += k
        legend.append(c(ch, col) + f" {sg['row']['name'][:26]} {gb(sg['gpu'])} GB")
    over = used > width
    if over:
        bar = bar  # overflow shown by the length past the frame
    else:
        bar += "·" * (width - used)
    label = "Unified memory (GPU)" if (s["unified"] or s["os"] == "Darwin") else "GPU VRAM"
    print(f"  {label} {gb(total)} GB")
    print("  |" + bar + "|" + (c("  OVER", RED) if over else ""))
    for i in range(0, len(legend), 3):
        print("   " + "   ".join(legend[i:i + 3]))

# ----------------------------------------------------------------------------- fit logic + table
def need(row, overhead_gb):
    if not row.get("size"):
        return None
    return int(row["size"] * 1.03 + (row.get("kv") or 0) + overhead_gb * GB)


def fit_label(n, s):
    if n is None:
        return c("?", DIM), "?"
    if n <= s["budget"] * 0.85:
        return c("FIT", GREEN), "FIT"
    if n <= s["budget"]:
        return c("TIGHT", YELLOW), "TIGHT"
    if s["offload_budget"] and n <= s["offload_budget"]:
        return c("OFFLOAD", YELLOW), "OFFLOAD"
    return c("NO", RED), "NO"


def strip_ansi(x):
    return re.sub(r"\033\[[0-9;]*m", "", str(x))


def print_table(rows, s, overhead_gb, wide=False):
    hdr = ["#", "Model", "Role", "Type", "Total", "Active", "Experts", "Layers", "Ctx", "Quant", "Weights", "KV", "Need GB", "Fit"]
    if wide:
        hdr += ["Arch", "License", "Updated", "Repo / path"]
    lines = []
    for i, r in enumerate(rows, 1):
        n = need(r, overhead_gb)
        lab, _ = fit_label(n, s)
        exp = f"{r['experts_active']}/{r['experts']}" if r.get("experts") else "-"
        typ = "MoE" if r.get("moe") else ("Dense" if r.get("total") or r.get("layers") else "?")
        name = r["name"] + ("" if r.get("source") != "estimate" else c(" (est)", DIM))
        act = ("~" if r.get("active_est") else "") + fmt_params(r.get("active"))
        line = [str(i), name, str(r.get("role") or "")[:14], typ, fmt_params(r.get("total")),
                act if r.get("moe") else "=", exp, str(r.get("layers") or "?"),
                fmt_ctx(r.get("ctx")), str(r.get("quant") or "?"), gb(r.get("size")), gb(r.get("kv")), gb(n), lab]
        if wide:
            line += [str(r.get("arch") or "?"), str(r.get("license") or "?"), str(r.get("updated") or "?"),
                     str(r.get("repo") or "-")]
        lines.append(line)
    widths = [max(len(strip_ansi(x)) for x in col) for col in zip(hdr, *lines)] if lines else [len(h) for h in hdr]
    widths[1] = min(widths[1], 40)

    def fmt(cols, bold=False):
        out = []
        for i, (col, w) in enumerate(zip(cols, widths)):
            raw = strip_ansi(col)
            if len(raw) > w:
                col = raw[:w - 1] + "…"
                raw = col
            out.append(col + " " * (w - len(raw)))
        txt = "  ".join(out)
        return c(txt, BOLD) if bold else txt

    print(fmt(hdr, True))
    for l in lines:
        print(fmt(l))


def show_selection(rows, idx, s, overhead_gb):
    segs = place([rows[i] for i in idx], s, overhead_gb)
    unified = s["unified"] or s["os"] == "Darwin"
    print(c("\n== Selection: where each model lives ==", BOLD))
    hdr = "GPU" if not unified else "GPU (unified)"
    print(c(f"  {'#':>3}  {'Model':<34} {'Need':>7}  {hdr:<13} {'CPU':>7}   layers on GPU   " +
            ("[" + c("█", GREEN) + " GPU " + c("▒", YELLOW) + " CPU]" if not unified else ""), DIM))
    for i, sg in zip(idx, segs):
        r = sg["row"]
        lay = f"{sg['layers_gpu']}/{sg['layers']}"
        print(f"  {i + 1:>3}  {r['name'][:34]:<34} {gb(sg['need']):>7}  {gb(sg['gpu']):>7} GB    {gb(sg['cpu']):>7}   "
              f"{lay:>9}       {split_bar(sg['gpu'], sg['cpu']) if not unified else ''}")
        if sg["cpu"] and r.get("moe"):
            print(c("        tip: MoE - offload experts instead of whole layers "
                    "(llama.cpp --n-cpu-moe N / -ot exps=CPU) to keep attention on GPU", DIM))
    print()
    memory_map(s, segs)
    tot = sum(sg["need"] for sg in segs)
    gpu = sum(sg["gpu"] for sg in segs)
    cpu = sum(sg["cpu"] for sg in segs)
    left = s["budget"] - gpu
    print()
    if unified:
        lab, plain = fit_label(tot, s)
        msg = {"FIT": f"fits, {gb(left)} GB free for longer context / more parallel requests",
               "TIGHT": f"fits but tight ({gb(left)} GB free), keep context short",
               "NO": f"over by {gb(-left)} GB - macOS will swap (very slow)", "OFFLOAD": ""}[plain]
    elif cpu == 0:
        lab, plain = fit_label(tot, s)
        msg = f"all on GPU, {gb(left)} GB VRAM free"
    elif segs and segs[-1]["over_cpu"]:
        lab, msg = c("NO", RED), f"needs {gb(cpu)} GB of CPU RAM for offload - not enough RAM"
    else:
        lab, msg = c("OFFLOAD", YELLOW), (f"{gb(gpu)} GB on GPU + {gb(cpu)} GB on CPU RAM - runs, "
                                         f"but CPU layers are much slower")
    print(f"  => {lab}: {msg}\n")


def parse_sel(text, n):
    idx = set()
    for part in re.split(r"[,\s]+", text.strip()):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            if a.isdigit() and b.isdigit():
                idx.update(range(int(a) - 1, int(b)))
        elif part.isdigit():
            idx.add(int(part) - 1)
    return sorted(i for i in idx if 0 <= i < n)


def interactive(rows, s, overhead_gb, wide):
    sel = []
    help_txt = ("Enter numbers to toggle (e.g. 1,3 5-7) | a=show all again | c=clear | "
                "w=toggle wide view | q=quit")
    print(c(help_txt, DIM))
    while True:
        try:
            t = input(c("select> ", CYAN)).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if t in ("q", "quit", "exit"):
            return
        if t == "c":
            sel = []
            print("cleared")
            continue
        if t == "a":
            print_table(rows, s, overhead_gb, wide)
            continue
        if t == "w":
            wide = not wide
            print_table(rows, s, overhead_gb, wide)
            continue
        for i in parse_sel(t, len(rows)):
            if i in sel:
                sel.remove(i)
            else:
                sel.append(i)
        if sel:
            show_selection(rows, sel, s, overhead_gb)
        else:
            print(c(help_txt, DIM))


# ----------------------------------------------------------------------------- HTML report
HTML_TMPL = r"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>llmfit report</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1f;--mut:#6b6b70;--line:#e4e4e7;--card:#fff;--ok:#1a7f37;--warn:#b26b00;--bad:#c62828;--acc:#3b5bdb}
@media(prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--mut:#9a9aa3;--line:#2b2b31;--card:#1c1c20;--ok:#4ac26b;--warn:#e3a33b;--bad:#ef6b6b;--acc:#8ea5ff}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:20px 24px 8px}h1{font-size:20px;margin:0 0 4px}.mut{color:var(--mut)}
.specs{display:flex;flex-wrap:wrap;gap:8px;padding:0 24px 12px}.chip{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
.bar{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 24px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.meter{flex:1;min-width:220px;height:12px;border-radius:6px;background:var(--line);overflow:hidden}.meter>div{height:100%;width:0;transition:width .2s}
input[type=search],select{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.wrap{padding:12px 24px 40px;overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:8px}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{cursor:pointer;font-weight:600;font-size:12px;color:var(--mut);position:sticky;top:0}
td.n{text-align:right;font-variant-numeric:tabular-nums}tr.sel{background:color-mix(in srgb,var(--acc) 12%,transparent)}
.FIT{color:var(--ok);font-weight:600}.TIGHT,.OFFLOAD{color:var(--warn);font-weight:600}.NO{color:var(--bad);font-weight:600}
a{color:var(--acc);text-decoration:none}.tag{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--mut)}
</style></head><body>
<header><h1>llmfit: what fits on this machine</h1><div class="mut" id="sub"></div></header>
<div class="specs" id="specs"></div>
<div class="bar"><b id="tot">Selected: 0 GB</b><div class="meter"><div id="fill"></div></div><span id="verdict" class="mut">Tick models to check a combination</span>
<input type="search" id="q" placeholder="filter…"><select id="fit"><option value="">all</option><option>FIT</option><option>TIGHT</option><option>NO</option></select>
<label class="mut">parallel <input type="number" id="par" min="1" max="64" value="1" style="width:56px"></label>
<button id="clr">clear</button></div>
<div class="wrap"><table><thead><tr id="hd"></tr></thead><tbody id="tb"></tbody></table>
<p class="mut">Need = weights + KV cache (for the chosen context) + runtime overhead. FIT &lt; 85% of budget, TIGHT ≤ 100%. "~" active = computed from config (may include embedding tables). (est) = no prebuilt quant found; size estimated.</p></div>
<script>
const D=__DATA__;const GB=1073741824;const S=D.specs;
const f1=x=>x==null?"–":(x/GB).toFixed(1);const fp=p=>!p?"?":(p>=1e10?(p/1e9).toFixed(0):(p/1e9).toFixed(1))+"B";
const fc=n=>!n?"?":(n>=1024?Math.round(n/1024)+"K":n);
document.getElementById("sub").textContent=`Format ${D.format.toUpperCase()} · ~${D.bits}-bit · KV for ${D.ctx.toLocaleString()} tokens @ ${D.kv_bits}-bit per request · +${D.overhead} GB overhead each · generated ${D.generated}`;
const chips=[["OS",S.os+" "+S.arch],["CPU",S.cpu||"?"],["RAM",f1(S.ram)+" GB"+(S.unified?" unified":"")],...S.gpus.map(g=>["GPU",g.name+" "+f1(g.vram)+" GB"]),["Budget",f1(S.budget)+" GB"]];
if(S.offload_budget)chips.push(["With CPU offload",f1(S.offload_budget)+" GB"]);
if(S.in_use)chips.push(["Already in use",f1(S.in_use)+" GB (budget shown is what is free)"]);
(S.running||[]).forEach(r=>chips.push(["Running",`${r.model} · ${r.server}${r.bytes?" · "+f1(r.bytes)+" GB":""}`]));
document.getElementById("specs").innerHTML=chips.map(([k,v])=>`<span class="chip"><span class="mut">${k}</span> <b>${v}</b></span>`).join("")+S.notes.map(n=>`<span class="chip mut">${n}</span>`).join("");
const cols=[["","sel"],["Model","name"],["Role","role"],["Src","kind"],["Type","type"],["Total","total"],["Active","active"],["Experts","exp"],["Layers","layers"],["Ctx","ctx"],["Quant","quant"],["Weights GB","size"],["KV GB","kv"],["Need GB","need"],["Fit","fit"],["Arch","arch"],["License","license"],["Updated","updated"]];
D.models.forEach((r,i)=>{r.i=i;r.type=r.moe?"MoE":(r.total||r.layers?"Dense":"?");r.exp=r.experts?`${r.experts_active||"?"}/${r.experts}`:"–";});
let sel=new Set(),sortK="need",sortD=1;const P0=D.parallel||1;
function recalc(){const P=Math.max(1,+document.getElementById("par").value||1);
 D.models.forEach(r=>{const ks=r.kv_single!=null?r.kv_single:(r.kv!=null?r.kv/P0:null);r.kv=ks==null?null:ks*P;
  r.need=r.size?Math.round(r.size*1.03+(r.kv||0)+D.overhead*GB):null;
  r.fit=r.need==null?"?":r.need<=S.budget*.85?"FIT":r.need<=S.budget?"TIGHT":(S.offload_budget&&r.need<=S.offload_budget)?"OFFLOAD":"NO";});draw();}
document.getElementById("hd").innerHTML=cols.map(([h,k])=>`<th data-k="${k}">${h}</th>`).join("");
document.querySelectorAll("th").forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(k==="sel")return;sortD=sortK===k?-sortD:1;sortK=k;draw();});
function link(r){return r.repo&&r.repo.includes("/")&&!r.repo.startsWith("/")?`<a href="https://huggingface.co/${r.repo}" target="_blank">${r.name}</a>`:r.name}
function draw(){const q=document.getElementById("q").value.toLowerCase(),ff=document.getElementById("fit").value;
 let rs=D.models.filter(r=>(!q||(r.name+" "+r.role+" "+r.arch).toLowerCase().includes(q))&&(!ff||r.fit===ff));
 rs.sort((a,b)=>{let x=a[sortK],y=b[sortK];if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*sortD;});
 document.getElementById("tb").innerHTML=rs.map(r=>`<tr class="${sel.has(r.i)?"sel":""}"><td><input type="checkbox" data-i="${r.i}" ${sel.has(r.i)?"checked":""}></td>
 <td>${link(r)}${r.source==="estimate"?' <span class="tag">est</span>':""}</td><td class="mut">${r.role||""}</td><td><span class="tag">${r.kind}</span></td><td>${r.type}</td>
 <td class="n">${fp(r.total)}</td><td class="n">${r.moe?(r.active_est?"~":"")+fp(r.active):"="}</td><td class="n">${r.exp}</td><td class="n">${r.layers||"?"}</td><td class="n">${fc(r.ctx)}</td>
 <td>${r.quant||"?"}</td><td class="n">${f1(r.size)}</td><td class="n">${f1(r.kv)}</td><td class="n"><b>${f1(r.need)}</b></td><td class="${r.fit}">${r.fit}</td>
 <td class="mut">${r.arch||"?"}</td><td class="mut">${r.license||"?"}</td><td class="mut">${r.updated||"?"}</td></tr>`).join("");
 document.querySelectorAll("#tb input").forEach(cb=>cb.onchange=()=>{const i=+cb.dataset.i;cb.checked?sel.add(i):sel.delete(i);draw();});
 const tot=[...sel].reduce((a,i)=>a+(D.models[i].need||0),0),pct=S.budget?tot/S.budget*100:0;
 const fill=document.getElementById("fill");fill.style.width=Math.min(100,pct)+"%";fill.style.background=pct<=85?"var(--ok)":pct<=100?"var(--warn)":"var(--bad)";
 document.getElementById("tot").textContent=`Selected: ${f1(tot)} / ${f1(S.budget)} GB (${pct.toFixed(0)}%)`;
 const left=S.budget-tot,v=document.getElementById("verdict");
 v.className=!sel.size?"mut":pct<=85?"FIT":pct<=100?"TIGHT":"NO";
 v.textContent=!sel.size?"Tick models to check a combination":pct<=85?`Fits — ${f1(left)} GB left for context`:pct<=100?`Tight — ${f1(left)} GB left, keep context short`:`Does not fit — over by ${f1(-left)} GB`;}
document.getElementById("par").value=P0;document.getElementById("par").oninput=recalc;document.getElementById("q").oninput=draw;document.getElementById("fit").onchange=draw;document.getElementById("clr").onclick=()=>{sel.clear();draw();};draw();
</script></body></html>"""


def write_html(path, rows, s, fmt, args):
    out = []
    for r in rows:
        r = dict(r)
        r["need"] = need(r, args.overhead)
        r["fit"] = fit_label(r["need"], s)[1]
        out.append(r)
    data = {"specs": s, "format": fmt, "bits": args.bits, "ctx": args.ctx, "kv_bits": args.kv_bits,
            "parallel": args.parallel,
            "overhead": args.overhead, "generated": time.strftime("%Y-%m-%d %H:%M"), "models": out}
    blob = json.dumps(data, default=str).replace("</", "<\\/")
    Path(path).write_text(HTML_TMPL.replace("__DATA__", blob), encoding="utf-8")


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Check which local LLMs fit your machine (Mac + Linux).")
    ap.add_argument("--catalog", default=str(HERE / "catalog.json"), help="model catalog JSON")
    ap.add_argument("--format", choices=["auto", "mlx", "gguf"], default="auto",
                    help="weights format: mlx (Mac default) or gguf (Linux / llama.cpp / Ollama / LM Studio)")
    ap.add_argument("--bits", type=int, default=4, choices=[2, 3, 4, 6, 8], help="quantization to look up (default 4)")
    ap.add_argument("--ctx", type=int, default=32768, help="context length for KV-cache estimate (default 32768)")
    ap.add_argument("--kv-bits", type=int, default=16, choices=[4, 8, 16], help="KV cache precision (default 16)")
    ap.add_argument("--parallel", type=int, default=1,
                    help="concurrent requests per model; each needs its own KV cache (default 1)")
    ap.add_argument("--ignore-running", action="store_true",
                    help="don't subtract models already loaded / running from the budget")
    ap.add_argument("--endpoint", action="append", default=[],
                    help="extra server to check for loaded models, e.g. http://192.168.1.126:1234 (repeatable)")
    ap.add_argument("--watch", type=float, nargs="?", const=2.0, metavar="SEC",
                    help="live dashboard: GPU/CPU/RAM, running models, GPU|CPU split, tok/s (default every 2 s)")
    ap.add_argument("--watch-once", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--bench", type=int, nargs="?", const=128, metavar="TOKENS",
                    help="benchmark every running model: TTFT, prefill and decode tokens/s (default 128 tokens)")
    ap.add_argument("--overhead", type=float, default=1.0, help="runtime overhead per model in GB (default 1.0)")
    ap.add_argument("--role", help="only catalog models with this role (coding, rag, reasoning, ...)")
    ap.add_argument("--filter", help="only models whose name contains this text")
    ap.add_argument("--trending", type=int, default=15, metavar="N",
                    help="also add N trending models released in the last --days days (default 15, 0 = off)")
    ap.add_argument("--trending-any", action="store_true", help="trending from any uploader, not only known labs")
    ap.add_argument("--days", type=int, default=120, help="how recent a trending model must be (default 120)")
    ap.add_argument("--min-params", type=float, default=7, help="hide trending models smaller than N billion (default 7)")
    ap.add_argument("--no-catalog", action="store_true", help="skip the catalog")
    ap.add_argument("--no-local", action="store_true", help="skip scanning installed models")
    ap.add_argument("--local-only", action="store_true", help="only scan installed models")
    ap.add_argument("--scan-dir", action="append", default=[], help="extra folder to scan for GGUF / MLX models")
    ap.add_argument("--select", help="non-interactive: check these row numbers together, e.g. 1,3,5")
    ap.add_argument("--fits-only", action="store_true", help="hide models that do not fit")
    ap.add_argument("--wide", action="store_true", help="show arch, license, update date and repo")
    ap.add_argument("--json", action="store_true", help="print JSON instead of a table")
    ap.add_argument("--html", nargs="?", const="llmfit_report.html", metavar="FILE",
                    help="write a one-page interactive report (specs + all models + pick & sum)")
    ap.add_argument("--no-interactive", action="store_true", help="print table and exit")
    ap.add_argument("--mem", type=float, help="pretend total RAM is N GB (plan for another machine)")
    ap.add_argument("--vram", type=float, help="pretend total VRAM is N GB")
    ap.add_argument("--budget", type=float, help="set memory budget for models directly, in GB")
    ap.add_argument("--refresh", action="store_true", help="ignore cached Hugging Face data")
    ap.add_argument("--offline", action="store_true", help="no network; use cache or estimates")
    ap.add_argument("--version", action="version", version=f"llmfit {VERSION}")
    args = ap.parse_args()

    s = override_specs(detect_specs(), args)
    if args.watch is not None:
        return watch(args, s)
    if args.bench is not None:
        return bench(args, s)
    fmt = args.format if args.format != "auto" else ("mlx" if s["os"] == "Darwin" and s["unified"] else "gguf")
    found, procs = ([], [])
    if not args.ignore_running:
        found, procs = detect_running(DEFAULT_ENDPOINTS + args.endpoint, s["os"])
        s = apply_running(s, found, procs, args.endpoint)
    s["running"] = found
    if not args.json:
        print_specs(s)
        if not args.ignore_running:
            print_running(found, procs, s)
        print(c(f"Format: {fmt.upper()}  |  quant ~{args.bits}-bit  |  KV cache for {args.ctx:,} tokens "
                f"@ {args.kv_bits}-bit x {args.parallel} parallel  |  +{args.overhead} GB runtime overhead each\n", DIM))

    hf = HFClient(refresh=args.refresh, offline=args.offline)
    rows = []
    entries = []
    if not args.local_only:
        if not args.no_catalog:
            entries += load_catalog(args.catalog)
        if args.trending:
            known = {e["name"].lower() for e in entries} | {str(e.get("base")).lower() for e in entries}
            entries += [e for e in discover(hf, args.trending, args.days, args.trending_any)
                        if e["name"].lower() not in known and e["base"].lower() not in known]
        if args.role:
            entries = [e for e in entries if args.role.lower() in str(e.get("role", "")).lower()]
        if args.filter:
            entries = [e for e in entries if args.filter.lower() in e["name"].lower()]
        if entries and not args.json:
            print(c(f"Fetching live info for {len(entries)} models from Hugging Face...", DIM), flush=True)
        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            rows = list(ex.map(lambda e: resolve_entry(hf, e, fmt, args.bits, args.ctx, args.kv_bits), entries))
        hf.save()
        trend = [r for r in rows if r["role"] == "trending"]
        keep = [r for r in trend if (r.get("total") or 0) >= args.min_params * 1e9][: args.trending]
        rows = [r for r in rows if r["role"] != "trending"] + keep
    if not args.no_local or args.local_only or args.scan_dir:
        dirs = default_scan_dirs() + [Path(d) for d in args.scan_dir]
        loc = scan_local(dirs, args.ctx, args.kv_bits)
        if args.filter:
            loc = [r for r in loc if args.filter.lower() in r["name"].lower()]
        rows += loc
        if not args.json:
            print(c(f"Installed models found: {len(loc)} (scanned {len(dirs)} folders + Ollama)", DIM))
    for r in rows:
        if r.get("kv"):
            r["kv_single"] = r["kv"]
            r["kv"] = r["kv"] * max(1, args.parallel)
    if args.fits_only:
        rows = [r for r in rows if fit_label(need(r, args.overhead), s)[1] in ("FIT", "TIGHT")]

    if args.html:
        write_html(args.html, rows, s, fmt, args)
        print(c(f"Report written: {Path(args.html).resolve()}  (open it in a browser)", GREEN))
    if args.json:
        for r in rows:
            r["need"] = need(r, args.overhead)
            r["fit"] = fit_label(r["need"], s)[1]
        print(json.dumps({"specs": s, "format": fmt, "models": rows}, indent=2, default=str))
        return
    if not rows:
        print("No models to show.")
        return
    print()
    print_table(rows, s, args.overhead, args.wide)
    print(c("\nNeed = weights + KV cache + overhead.  FIT <85% of budget, TIGHT <=100%, "
            "(est) = no HF build found, size estimated from params.", DIM))
    if args.select:
        show_selection(rows, parse_sel(args.select, len(rows)), s, args.overhead)
    elif not args.no_interactive and sys.stdin.isatty():
        print()
        interactive(rows, s, args.overhead, args.wide)


if __name__ == "__main__":
    main()

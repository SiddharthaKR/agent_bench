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
    print(f"  Budget   : {c(gb(s['budget']) + ' GB', BOLD)} for model weights + KV cache")
    if s["offload_budget"]:
        print(f"  Offload  : {gb(s['offload_budget'])} GB if layers spill to CPU RAM (slow)")
    for n in s["notes"]:
        print(c(f"  note: {n}", DIM))
    print()


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
    tot = 0
    print(c("\n== Selection ==", BOLD))
    for i in idx:
        r = rows[i]
        n = need(r, overhead_gb) or 0
        tot += n
        print(f"  {i + 1:>3}. {r['name'][:46]:<46} {gb(n):>7} GB")
    pct = tot / s["budget"] * 100 if s["budget"] else 0
    bar_len = 40
    filled = min(bar_len, int(bar_len * pct / 100))
    col = GREEN if pct <= 85 else YELLOW if pct <= 100 else RED
    print(f"  {'Total':<51} {gb(tot):>7} GB  of {gb(s['budget'])} GB budget")
    print("  [" + c("#" * filled, col) + "." * (bar_len - filled) + f"] {pct:.0f}%")
    lab, plain = fit_label(tot, s)
    left = s["budget"] - tot
    msg = {"FIT": f"fits together, {gb(left)} GB left for longer context / other apps",
           "TIGHT": f"fits but tight ({gb(left)} GB left), keep context short",
           "OFFLOAD": "only fits with CPU offload (slow)", "NO": f"does not fit, over by {gb(-left)} GB"}[plain]
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
<button id="clr">clear</button></div>
<div class="wrap"><table><thead><tr id="hd"></tr></thead><tbody id="tb"></tbody></table>
<p class="mut">Need = weights + KV cache (for the chosen context) + runtime overhead. FIT &lt; 85% of budget, TIGHT ≤ 100%. "~" active = computed from config (may include embedding tables). (est) = no prebuilt quant found; size estimated.</p></div>
<script>
const D=__DATA__;const GB=1073741824;const S=D.specs;
const f1=x=>x==null?"–":(x/GB).toFixed(1);const fp=p=>!p?"?":(p>=1e10?(p/1e9).toFixed(0):(p/1e9).toFixed(1))+"B";
const fc=n=>!n?"?":(n>=1024?Math.round(n/1024)+"K":n);
document.getElementById("sub").textContent=`Format ${D.format.toUpperCase()} · ~${D.bits}-bit · KV for ${D.ctx.toLocaleString()} tokens @ ${D.kv_bits}-bit · +${D.overhead} GB overhead each · generated ${D.generated}`;
const chips=[["OS",S.os+" "+S.arch],["CPU",S.cpu||"?"],["RAM",f1(S.ram)+" GB"+(S.unified?" unified":"")],...S.gpus.map(g=>["GPU",g.name+" "+f1(g.vram)+" GB"]),["Budget",f1(S.budget)+" GB"]];
if(S.offload_budget)chips.push(["With CPU offload",f1(S.offload_budget)+" GB"]);
document.getElementById("specs").innerHTML=chips.map(([k,v])=>`<span class="chip"><span class="mut">${k}</span> <b>${v}</b></span>`).join("")+S.notes.map(n=>`<span class="chip mut">${n}</span>`).join("");
const cols=[["","sel"],["Model","name"],["Role","role"],["Src","kind"],["Type","type"],["Total","total"],["Active","active"],["Experts","exp"],["Layers","layers"],["Ctx","ctx"],["Quant","quant"],["Weights GB","size"],["KV GB","kv"],["Need GB","need"],["Fit","fit"],["Arch","arch"],["License","license"],["Updated","updated"]];
D.models.forEach((r,i)=>{r.i=i;r.type=r.moe?"MoE":(r.total||r.layers?"Dense":"?");r.exp=r.experts?`${r.experts_active||"?"}/${r.experts}`:"–";});
let sel=new Set(),sortK="need",sortD=1;
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
document.getElementById("q").oninput=draw;document.getElementById("fit").onchange=draw;document.getElementById("clr").onclick=()=>{sel.clear();draw();};draw();
</script></body></html>"""


def write_html(path, rows, s, fmt, args):
    out = []
    for r in rows:
        r = dict(r)
        r["need"] = need(r, args.overhead)
        r["fit"] = fit_label(r["need"], s)[1]
        out.append(r)
    data = {"specs": s, "format": fmt, "bits": args.bits, "ctx": args.ctx, "kv_bits": args.kv_bits,
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
    fmt = args.format if args.format != "auto" else ("mlx" if s["os"] == "Darwin" and s["unified"] else "gguf")
    if not args.json:
        print_specs(s)
        print(c(f"Format: {fmt.upper()}  |  quant ~{args.bits}-bit  |  KV cache for {args.ctx:,} tokens "
                f"@ {args.kv_bits}-bit  |  +{args.overhead} GB runtime overhead each\n", DIM))

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

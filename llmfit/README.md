# llmfit

Check which local LLMs fit your machine, all in one place. It works on **macOS (Apple Silicon)** and **Linux (NVIDIA / AMD / CPU)**.

- **Your hardware**: detects unified memory and the GPU wired limit on Mac, or RAM plus VRAM (`nvidia-smi` / `rocm-smi`) on Linux.
- **Latest model info, fetched live from Hugging Face**: real download size of the MLX (Mac) or GGUF (Linux) build, total and active params, MoE or dense, experts (active/total), layers, max context, architecture, license and last update.
- **New releases**: adds trending models from known labs released in the last 120 days, so the list stays current without editing anything.
- **Installed models**: scans LM Studio, Ollama, llama.cpp, the Hugging Face cache and any folder you name. It reads GGUF headers and `config.json` directly.
- **KV cache estimate** for your context length. It handles GQA, MLA (DeepSeek/GLM/Mistral 4), sliding-window and hybrid linear-attention models.
- **Fit check**: each model is marked `FIT` / `TIGHT` / `OFFLOAD` / `NO`. You can **select several models** to see whether they fit together.
- **One-page HTML report** with checkboxes, a live memory bar, sorting and filters.

No dependencies: only Python 3.8+ and the standard library.

## Quick start

```bash
git clone <this repo> && cd llmfit
python3 llmfit.py                 # table + interactive picker
python3 llmfit.py --html          # also writes llmfit_report.html (open in a browser)
```

In the picker, type `2,3 5-7` to toggle models, then `c` to clear, `w` for the wide view and `q` to quit.

## Common runs

| Goal | Command |
|---|---|
| Coding models only | `python3 llmfit.py --role coding` |
| RAG stack (embedders, rerankers, generators) | `python3 llmfit.py --role rag` |
| Only what fits | `python3 llmfit.py --fits-only` |
| Check a combination without the prompt | `python3 llmfit.py --select 2,3,4,23` |
| 8-bit weights, 128K context | `python3 llmfit.py --bits 8 --ctx 131072` |
| 8-bit KV cache | `python3 llmfit.py --kv-bits 8` |
| Plan for another machine | `python3 llmfit.py --format gguf --vram 48 --mem 128` |
| Installed models only | `python3 llmfit.py --local-only --scan-dir ~/my-models` |
| Force fresh data | `python3 llmfit.py --refresh` |
| More trending models, any uploader | `python3 llmfit.py --trending 30 --trending-any` |
| Machine-readable output | `python3 llmfit.py --json > models.json` |

## How "fits" is decided

`Need = weights × 1.03 + KV cache(ctx) + 1 GB runtime overhead`, compared against your **budget**:

| Machine | Budget |
|---|---|
| Mac (Apple Silicon) | `iogpu.wired_limit_mb` if you set it, otherwise macOS's default GPU limit (~75% of RAM above 36 GB) |
| Linux + GPU | 95% of total VRAM. `OFFLOAD` means it fits only with CPU RAM offload (slow) |
| Linux, CPU only | 80% of RAM |

`FIT` < 85% of budget · `TIGHT` ≤ 100% · `NO` above.

To give a Mac more GPU memory (this resets on reboot):

```bash
sudo sysctl iogpu.wired_limit_mb=230000   # 256 GB Mac example
```

## Reading the table

| Column | Meaning |
|---|---|
| Total / Active | Total params / params used per token. `=` means dense (all active). `~` means computed from config, which can include embedding tables |
| Experts | Experts used per token / total routed experts |
| Quant | The prebuilt quant found (`mxfp4`, `4bit`, `Q4_K_M`, `UD-Q4_K_XL`...). `~4bit` means none found, so the size is estimated |
| (est) | No MLX/GGUF build on Hugging Face yet; size estimated from params |

## Editing the model list

`catalog.json` lists the models that are always checked. Add an entry like this:

```json
{"name": "My-Model-70B", "query": "My-Model-70B", "base": "org/My-Model-70B", "role": "coding"}
```

- `query`: text used to find the quantized build (MLX: mlx-community / lmstudio-community; GGUF: unsloth / bartowski / lmstudio-community / ggml-org)
- `base`: official repo, used for params, config and license
- optional `params_b` / `active_b` to override params with vendor numbers

## Notes

- Hugging Face responses are cached for 24 hours in `~/.cache/llmfit/`. Set `HF_TOKEN` for gated repos or higher rate limits.
- Speed (tokens/s) is not predicted. On a Mac, decode speed scales with **active** params, so low-active MoE models feel fastest.

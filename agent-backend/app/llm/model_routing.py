"""OpenCode model routing: Go vs Zen endpoints and fallback chains."""

from __future__ import annotations

# Models that must use Zen (not Go). Same API key works for both.
_ZEN_ONLY_MODELS = frozenset(
    {
        "gpt-5",
        "gpt-5-codex",
        "gpt-5-nano",
        "gemini-3-flash",
        "gemini-3.1-pro",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "claude-sonnet-4",
        "claude-sonnet-4-5",
        "claude-sonnet-4-6",
        "claude-sonnet-5",
        "claude-opus-4-1",
        "claude-opus-4-5",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8",
        "claude-haiku-4-5",
        "claude-fable-5",
        "big-pickle",
    }
)

# Prefer Go when the model is on both (cheaper subscription path).
_GO_PREFERRED_MODELS = frozenset(
    {
        "deepseek-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "kimi-k3",
        "kimi-k2.5",
        "kimi-k2.6",
        "kimi-k2.7-code",
        "qwen3.5-plus",
        "qwen3.6-plus",
        "qwen3.7-plus",
        "qwen3.7-max",
        "qwen3.8-max",
        "glm-5",
        "glm-5.1",
        "glm-5.2",
        "grok-4.5",
        "minimax-m2.5",
        "minimax-m2.7",
        "minimax-m3",
        "mimo-v2.5",
        "mimo-v2.5-pro",
        "hy3",
        "gpt-5.6-luna",
    }
)

DEFAULT_FALLBACK_MODELS = (
    "deepseek-v4-flash",
    "glm-5.2",
    "deepseek-v4-pro",
)

# Known-unavailable ids: still listed in some catalogs but rejected by the gateway.
_BLOCKED_MODELS = frozenset(
    {
        "qwen3.7-max",
        "opencode-go/qwen3.7-max",
        "opencode/qwen3.7-max",
    }
)


def parse_model_list(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return []
    out: list[str] = []
    seen: set[str] = set()
    for part in raw.split(","):
        mid = part.strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append(mid)
    return out


def model_chain(primary: str, fallbacks_raw: str | None) -> list[str]:
    """Primary first, then configured fallbacks (deduped)."""
    fallbacks = parse_model_list(fallbacks_raw)
    if not fallbacks:
        fallbacks = list(DEFAULT_FALLBACK_MODELS)
    chain: list[str] = []
    seen: set[str] = set()
    for mid in [primary, *fallbacks]:
        if not mid or mid in seen:
            continue
        if mid in _BLOCKED_MODELS or mid.rsplit("/", 1)[-1] in _BLOCKED_MODELS:
            continue
        seen.add(mid)
        chain.append(mid)
    return chain


def base_url_for_model(model: str, go_base: str, zen_base: str) -> str:
    """Pick OpenCode Go or Zen base URL for a bare model id."""
    mid = model.strip()
    if mid in _ZEN_ONLY_MODELS:
        return zen_base.rstrip("/")
    if mid in _GO_PREFERRED_MODELS:
        return go_base.rstrip("/")
    # Unknown: try Zen (broader catalog), callers may still fail over.
    if mid.startswith(("gpt-", "gemini-", "claude-")):
        return zen_base.rstrip("/")
    return go_base.rstrip("/")

"""Canonical tool / intent error_kind values."""

from __future__ import annotations

from typing import Any

ERROR_KINDS = (
    "empty_result",
    "missing_params",
    "identity_mismatch",
    "http_error",
    "timeout",
    "index_missing",
    "data_unavailable",
    "auth_required",
    "call_bug",
    "unknown_tool",
    "tool_error",
)

KIND_PRIORITY = (
    "call_bug",
    "timeout",
    "http_error",
    "auth_required",
    "index_missing",
    "data_unavailable",
    "identity_mismatch",
    "missing_params",
    "unknown_tool",
    "tool_error",
    "empty_result",
)

_HTTP_FAIL = (400, 401, 403, 404, 429, 500, 502, 503, 504)
_FAIL_PRESETS = set(ERROR_KINDS) - {"empty_result"}
_LIST_KEYS = (
    "kinases", "conditions", "events", "entries", "items", "results", "sites",
    "papers", "abstracts", "disease_associations", "interactions", "pathways",
)


def _positive_count(val: Any) -> bool:
    if val in (None, "", 0, "0"):
        return False
    try:
        return int(val) > 0
    except (TypeError, ValueError):
        return bool(val)


def _kind_from_text(err_s: str, preset: str | None, http_status: Any) -> str:
    low = f"{preset or ''} {err_s}".lower()
    if preset in _FAIL_PRESETS:
        return preset
    if http_status in _HTTP_FAIL:
        return "http_error"
    if "timed out" in low or low.strip().endswith("timeout") or " timeout" in low:
        return "timeout"
    if "index missing" in low or "not built" in low:
        return "index_missing"
    if (
        "access key" in low
        or "api key" in low
        or "not configured" in low
        or "authentication" in low
    ):
        return "auth_required"
    if (
        "dataset not loaded" in low
        or "not loaded" in low
        or "prepare_" in low
        or "matrices not available" in low
    ):
        return "data_unavailable"
    if "not consistent with" in low:
        return "identity_mismatch"
    if (
        err_s == "missing_identifier"
        or "missing_identifier" in low
        or "provide " in low
        or low.startswith("missing")
        or "required" in low
    ):
        return "missing_params"
    if "target_uniprot_ac" in err_s or "unexpected keyword" in low:
        return "call_bug"
    if "unknown" in low and "tool" in low:
        return "unknown_tool"
    return "tool_error"


def classify_tool_result(tool_name: str, result: Any) -> dict[str, Any]:
    """Normalize a handler dict to success / error_kind / summary / data."""
    if not isinstance(result, dict):
        return {
            "success": True,
            "error_kind": None,
            "summary": str(result)[:800],
            "data": result,
        }

    err = result.get("error")
    preset = result.get("error_kind")
    preset = preset.strip() if isinstance(preset, str) and preset.strip() else None
    http_status = result.get("http_status")
    err_s = str(err) if err else ""

    if err or preset in _FAIL_PRESETS:
        kind = _kind_from_text(err_s, preset, http_status)
        return {
            "success": False,
            "error_kind": kind,
            "summary": (err_s or str(result.get("summary") or kind))[:500],
            "data": result,
        }

    if result.get("available") is False:
        return {
            "success": False,
            "error_kind": "data_unavailable",
            "summary": str(result.get("summary") or f"{tool_name}: dataset not available")[:500],
            "data": result,
        }

    summary = str(result.get("summary") or "")[:800]
    list_counts = [
        len(result[key]) for key in _LIST_KEYS if isinstance(result.get(key), list)
    ]
    numeric_fields = [
        result.get("count"),
        result.get("total"),
        result.get("n"),
        result.get("total_conditions"),
        result.get("total_disease"),
        result.get("total_sites"),
    ]
    empty = not any(_positive_count(c) for c in numeric_fields) and not any(c > 0 for c in list_counts)
    if empty:
        return {
            "success": True,
            "error_kind": "empty_result",
            "summary": summary or f"{tool_name}: no matching records",
            "data": result,
        }
    return {
        "success": True,
        "error_kind": None,
        "summary": summary or f"{tool_name} completed",
        "data": result,
    }


def rollup_intent_status(
    blocks: list[dict[str, Any]],
    *,
    success: bool = True,
    error_kind: str | None = None,
) -> tuple[bool, str | None]:
    """Hits win; otherwise worst infra kind; scientific empties stay empty_result."""
    if not blocks:
        return success, error_kind
    has_hits = any(b.get("success") and not b.get("error_kind") for b in blocks)
    kinds = [str(b.get("error_kind")) for b in blocks if b.get("error_kind")]
    worst = next((p for p in KIND_PRIORITY if p in kinds), None)
    if has_hits:
        return True, None
    if worst and worst != "empty_result":
        return False, worst
    if worst == "empty_result":
        return True, "empty_result"
    return success, error_kind

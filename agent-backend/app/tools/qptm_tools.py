"""qPTM database tools — call the qPTM PHP REST API.

Stage 1 tools:
  1. qptm_search — search PTM events by keyword
  2. qptm_site_conditions — get conditions for a specific site

Stage 2 tool:
  3. qptm_kinases — get kinases from qPTM's integrated data
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.config import settings
from app.tools.registry import registry

logger = logging.getLogger(__name__)

_sync_http: httpx.Client | None = None


def _sync_client() -> httpx.Client:
    """Process-wide client — do not close per request."""
    global _sync_http
    if _sync_http is None:
        _sync_http = httpx.Client(
            base_url=settings.qptm_api_base_url,
            timeout=settings.http_timeout_seconds,
            headers={"Accept": "application/json"},
        )
    return _sync_http


def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Make a GET request to the qPTM API and return parsed JSON.

    HTTP 4xx/5xx are returned as ``{"error", "http_status"}`` so callers can
    surface a clean failure instead of raising inside the tool handler.
    """
    client = _sync_client()
    resp = client.get(path, params=params)
    if resp.status_code >= 400:
        snippet = ""
        try:
            snippet = (resp.text or "")[:240]
        except Exception:
            snippet = ""
        logger.warning("qPTM API %s HTTP %s: %s", path, resp.status_code, snippet)
        return {
            "error": f"qPTM API {path} HTTP {resp.status_code}",
            "http_status": resp.status_code,
            "detail": snippet,
        }
    return resp.json()


# ── Tool 1: qptm_search ───────────────────────────────────────────

def _qptm_search(
    query: str,
    field: str = "any",
    organism: str = "all",
    ptm_type: str = "all",
    page: int = 1,
    per_page: int = 20,
) -> dict[str, Any]:
    """Search qPTM for PTM events matching a keyword."""
    q = (query or "").strip()
    # Infer a fast field when the model omits it (avoids slow field=any scans).
    if field == "any" and q:
        if re.fullmatch(r"[OPQ][0-9][A-Z0-9]{3}[0-9](?:-[0-9]+)?", q, re.I) or re.fullmatch(
            r"[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9](?:-[0-9]+)?", q, re.I
        ):
            field = "uniprot"
        elif re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{1,14}", q):
            field = "gene"

    data = _get("/search.php", {
        "q": q,
        "field": field,
        "organism": organism,
        "ptm_type": ptm_type,
        "page": page,
        "per_page": min(max(int(per_page or 20), 1), 50),
    })
    events = data.get("events", [])
    cap = min(max(int(per_page or 20), 1), 50)
    events = events[:cap]
    # Summarize for the LLM (don't dump all events if too many)
    summary = (
        f"Found {data.get('total', 0)} PTM events (showing {len(events)}). "
    )
    if events:
        genes = set(e.get("gene", "") for e in events)
        ptm_types = set(e.get("ptm_type", "") for e in events)
        conditions = set(e.get("condition", "") for e in events if e.get("condition"))
        summary += f"Genes: {', '.join(sorted(genes)[:10])}. "
        summary += f"PTM types: {', '.join(sorted(ptm_types))}. "
        summary += f"Conditions: {', '.join(sorted(conditions)[:10])}."
    return {
        "summary": summary,
        "total": data.get("total", 0),
        "page": data.get("page", 1),
        "events": events,
    }


# ── Tool 2: qptm_site_conditions ──────────────────────────────────

_CONTRAST_TYPES = frozenset(
    {"disease", "pharmacological", "genetic", "physical", "cell_state", "other"}
)


def normalize_contrast_type(value: str | None) -> str:
    t = (value or "").strip().lower()
    return t if t in _CONTRAST_TYPES else ""


def condition_log2_abs(cond: dict[str, Any]) -> float:
    rng = cond.get("log2_range") if isinstance(cond.get("log2_range"), dict) else {}
    for key in ("avg", "max", "min"):
        try:
            v = rng.get(key)
            if v is not None:
                return abs(float(v))
        except (TypeError, ValueError):
            continue
    return 0.0


def filter_site_conditions(
    conditions: list[dict[str, Any]],
    contrast_type: str = "",
) -> list[dict[str, Any]]:
    """Filter then optionally sort. Apply *before* limit so disease rows are kept."""
    rows = [c for c in conditions if isinstance(c, dict)]
    ctype = normalize_contrast_type(contrast_type)
    if ctype:
        rows = [
            c
            for c in rows
            if str(c.get("contrast_type") or "").strip().lower() == ctype
        ]
        if ctype == "disease":
            rows = sorted(rows, key=condition_log2_abs, reverse=True)
    return rows


def _by_type_counts(conditions: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for c in conditions:
        if not isinstance(c, dict):
            continue
        t = str(c.get("contrast_type") or "unannotated").strip().lower() or "unannotated"
        counts[t] = counts.get(t, 0) + 1
    return counts


def _qptm_site_conditions(
    uniprot_ac: str,
    position: int,
    ptm_type: str = "all",
    limit: int = 15,
    contrast_type: str = "",
) -> dict[str, Any]:
    """Get experimental conditions for a PTM site via /api/protein.php."""
    ac = (uniprot_ac or "").strip().upper()
    try:
        pos = int(position)
    except (TypeError, ValueError):
        pos = 0
    if not ac:
        return {
            "error": "qptm_site_conditions requires uniprot_ac",
            "http_status": 400,
        }
    if pos <= 0:
        return {
            "error": "qptm_site_conditions requires a positive residue position",
            "http_status": 400,
        }
    params: dict[str, Any] = {
        "uniprot_ac": ac,
        "position": str(pos),
    }
    if ptm_type and ptm_type != "all":
        params["ptm_type"] = ptm_type
    data = _get("/protein.php", params)
    if data.get("error"):
        status = data.get("http_status")
        return {
            "error": (
                f"位点定量接口失败（HTTP {status}）。未取得 fold-change 数值。"
                if status
                else str(data.get("error"))
            ),
            "http_status": status,
            "uniprot_ac": ac,
            "position": pos,
            "summary": (
                f"Site-conditions lookup failed for {ac} position {pos}: {data.get('error')}"
            ),
        }
    raw = [c for c in (data.get("conditions") or []) if isinstance(c, dict)]
    ctype = normalize_contrast_type(contrast_type)
    filtered = filter_site_conditions(raw, ctype)
    cap = max(1, min(int(limit or 15), 200)) if filtered else 0
    shown = filtered[:cap] if filtered else []
    by_type = _by_type_counts(raw)
    total_all = int(data.get("total_conditions") or len(raw))
    total = len(filtered) if ctype else total_all

    if ctype:
        summary = (
            f"qPTM: {total} {ctype}-type condition(s) for {ac} position {pos} "
            f"(of {total_all} total). "
        )
    else:
        summary = (
            f"Site {ac} position {pos} was quantified under "
            f"{total_all} condition(s). "
        )
    if shown:
        top = shown[:10]
        cond_names = [c.get("condition_name", "") for c in top]
        summary += f"Top conditions: {', '.join(cond_names)}. "
        significant = [
            c for c in filtered
            if condition_log2_abs(c) > 1.0
        ]
        if significant:
            summary += f"{len(significant)} condition(s) show |log2| > 1 (significant change)."
    elif data.get("message") and not ctype:
        summary += str(data["message"])
    elif not raw:
        summary += "库内无定量 / no site-specific quantitative records."
    elif ctype:
        summary += f"No {ctype}-type conditions for this site."
    return {
        "summary": summary,
        "uniprot_ac": ac,
        "position": pos,
        "gene": data.get("gene"),
        "contrast_type": ctype or None,
        "by_type": by_type,
        "total_conditions": total,
        "total_conditions_all": total_all,
        "conditions": shown,
    }


# ── Tool 3: qptm_kinases ──────────────────────────────────────────

def _qptm_kinases(
    uniprot_ac: str,
    position: int,
) -> dict[str, Any]:
    """Get kinases/enzymes from qPTM's integrated kinase-substrate data."""
    data = _get("/kinases.php", {
        "uniprot_ac": uniprot_ac,
        "position": str(position),
    })
    kinases = data.get("kinases", [])
    summary = f"Found {len(kinases)} kinase(s)/enzyme(s) for {uniprot_ac} position {position}. "
    if kinases:
        exp_kinases = [k for k in kinases if k.get("evidence_type") == "experimental"]
        pred_kinases = [k for k in kinases if k.get("evidence_type") == "predicted"]
        if exp_kinases:
            names = [k.get("kinase_gene", "") for k in exp_kinases]
            summary += f"Experimentally validated: {', '.join(names)}. "
        if pred_kinases:
            names = [k.get("kinase_gene", "") for k in pred_kinases]
            summary += f"Predicted: {', '.join(names)}. "
        inhibitors = [k.get("inhibitor") for k in kinases if k.get("inhibitor")]
        if inhibitors:
            summary += f"Known inhibitors: {', '.join(set(inhibitors))}."
    else:
        summary += "No kinase information available in qPTM for this site."
    return {
        "summary": summary,
        "uniprot_ac": uniprot_ac,
        "position": position,
        "total": len(kinases),
        "kinases": kinases,
    }


# ── Register tools ────────────────────────────────────────────────

def register_qptm_tools() -> None:
    """Register all qPTM tools with the global registry."""
    registry.register(
        name="qptm_search",
        description=(
            "Search the qPTM database for PTM events. "
            "ALWAYS set field explicitly: use field='gene' for gene symbols (e.g. TP53), "
            "field='uniprot' for UniProt accessions (e.g. P04637). "
            "Returns quantitative PTM events with conditions, samples, log2 ratios, and p-values."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search keyword (gene name, protein name, UniProt AC, sample, or condition)",
                },
                "field": {
                    "type": "string",
                    "enum": ["any", "gene", "uniprot", "protein", "function", "sample", "condition"],
                    "description": "Search field. Prefer 'gene' or 'uniprot' for speed; avoid 'any' when possible.",
                },
                "organism": {
                    "type": "string",
                    "enum": ["all", "human", "mouse", "rat", "yeast"],
                    "description": "Filter by organism (default: all)",
                },
                "ptm_type": {
                    "type": "string",
                    "enum": ["all", "phosphorylation", "acetylation", "ubiquitylation",
                             "methylation", "glycosylation", "sumoylation"],
                    "description": "Filter by PTM type (default: all)",
                },
            },
            "required": ["query"],
        },
        handler=_qptm_search,
    )

    registry.register(
        name="qptm_site_conditions",
        description=(
            "Get all experimental conditions (cell types, treatments, stimuli, time points) "
            "where a specific PTM site was quantified. Requires UniProt accession and residue position. "
            "Returns condition names, sample types, event counts, and log2 ratio ranges. "
            "Use this for Stage 1: understanding when and where a site is modified."
        ),
        parameters={
            "type": "object",
            "properties": {
                "uniprot_ac": {
                    "type": "string",
                    "description": "UniProt accession (e.g., P04637 for TP53)",
                },
                "position": {
                    "type": "integer",
                    "description": "Residue position in the protein sequence (e.g., 15 for S15)",
                },
                "ptm_type": {
                    "type": "string",
                    "enum": ["all", "phosphorylation", "acetylation", "ubiquitylation",
                             "methylation", "glycosylation", "sumoylation"],
                    "description": "Filter by PTM type (default: all)",
                },
                "contrast_type": {
                    "type": "string",
                    "enum": ["disease", "pharmacological", "genetic", "physical",
                             "cell_state", "other"],
                    "description": (
                        "Optional Condition type filter matching qPTM Browse/API "
                        "(disease|pharmacological|genetic|physical|cell_state|other). "
                        "Applied before the row limit."
                    ),
                },
            },
            "required": ["uniprot_ac", "position"],
        },
        handler=_qptm_site_conditions,
    )

    registry.register(
        name="qptm_kinases",
        description=(
            "Get kinases and enzymes associated with a specific PTM site from qPTM's integrated "
            "kinase-substrate data. Includes experimentally validated and computationally predicted "
            "kinases, plus known inhibitors from DrugBank. Use this for Stage 2: identifying which "
            "kinase catalyzes the modification."
        ),
        parameters={
            "type": "object",
            "properties": {
                "uniprot_ac": {
                    "type": "string",
                    "description": "UniProt accession of the substrate protein",
                },
                "position": {
                    "type": "integer",
                    "description": "Residue position of the modification site",
                },
            },
            "required": ["uniprot_ac", "position"],
        },
        handler=_qptm_kinases,
    )

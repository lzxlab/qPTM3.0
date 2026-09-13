"""Per-source MCP result blocks — shaped for LLM consumption, not DGIdb envelopes."""

from __future__ import annotations

import re
from typing import Any

from app.sources.catalog import get_catalog
from app.tools.metadata import tool_database

# Tools whose primary output is computational prediction.
_PREDICTED_TOOLS = frozenset(
    {
        "gps6_kinases",
        "gpsuber_e3_sites",
        "ptmphase_phosllps",
        "dscope_predictions",
        "gpssumo2_sites",
    }
)

_BLOCK_LEGENDS: dict[str, str] = {
    "psp_kinase_substrate": "IN_VIVO_RXN / IN_VITRO_RXN indicate experimental context; curated literature.",
    "gps6_kinases": "GPS_Score is a prediction confidence — not experimental evidence.",
    "ptmd_disease": "State codes: U/D=up/down regulation, A/P=absence/presence, C/N=create/disrupt site.",
    "cancerproteome_disease": "Column 'pmid' in rows is a PDC dataset ID, not PubMed — cite resource PMID 37823596.",
    "pmads_drug_ptm": "Prefer Curated associations; Inferred rows are lower confidence.",
    "drugbank_targets": "Protein-level drug targets — not site-specific PTM regulation.",
    "decryptm_drug_ptm": "Dose–response PTM curves from decryptM / ProteomicsDB.",
    "string_ppi": "STRING scores are association confidence, not PTM mechanism.",
}

_READING_GUIDES: dict[str, str] = {
    "qptm_search": "Quantitative MS PTM events from qPTM — use for site discovery and conditions.",
    "qptm_site_conditions": "Fold changes per experimental condition for one site.",
    "qptm_kinases": "Integrated experimental and predicted kinases for a site from qPTM.",
    "psp_kinase_substrate": "Curated kinase–substrate relationships from PhosphoSitePlus.",
    "gps6_kinases": "Predicted kinase specificity — label as predicted in synthesis.",
    "ptmd_disease": "Disease-associated PTM states; literature subset includes PMIDs.",
    "ptm_stability": "Curated PTM effects on protein stability (experimental).",
    "funcscore_phosphosite": "Functional priority score — high score ≠ proven mechanism.",
}


def _evidence_level(tool_name: str) -> str:
    if tool_name in _PREDICTED_TOOLS:
        return "predicted"
    if tool_name in ("gps6_kinases", "qptm_kinases"):
        return "mixed"
    if tool_name.startswith("psp_") or tool_name in ("iptmnet_enzymes", "ptmint_ppi"):
        return "curated"
    if tool_name.startswith("qptm_") or tool_name in ("ekpi_quantitative", "decryptm_drug_ptm"):
        return "experimental"
    return "curated"


def _manifest_meta(tool_name: str) -> dict[str, Any]:
    manifest = get_catalog().by_tool(tool_name)
    if manifest:
        cite = manifest.citation_defaults()
        return {
            "source_id": manifest.id,
            "source_name": manifest.name,
            "aspect": manifest.aspect,
            "homepage": manifest.homepage or manifest.api_docs or manifest.api_base,
            "pmid": manifest.pmid,
            "doi": manifest.doi,
        }
    return {
        "source_id": tool_name,
        "source_name": tool_database(tool_name),
        "aspect": "unknown",
        "homepage": None,
        "pmid": None,
        "doi": None,
    }


def _extract_rows(data: Any) -> list[dict[str, Any]]:
    if data is None:
        return []
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if not isinstance(data, dict):
        return [{"value": data}]
    for key in (
        "kinases",
        "conditions",
        "events",
        "entries",
        "items",
        "results",
        "sites",
        "hits",
        "rows",
        "associations",
        "interactions",
        "pathways",
        "papers",
        "abstracts",
        "curves",
        "mutations",
    ):
        val = data.get(key)
        if isinstance(val, list) and val and isinstance(val[0], dict):
            return list(val)
    if any(isinstance(v, dict) for v in data.values()):
        return [data]
    return [data]


def _sort_key(tool_name: str, row: dict[str, Any]) -> tuple:
    if tool_name == "psp_kinase_substrate":
        invivo = 1 if str(row.get("IN_VIVO_RXN") or row.get("in_vivo") or "").upper() in ("X", "Y", "1", "TRUE") else 0
        invitro = 1 if str(row.get("IN_VITRO_RXN") or row.get("in_vitro") or "").upper() in ("X", "Y", "1", "TRUE") else 0
        return (-invivo, -invitro)
    if tool_name == "gps6_kinases":
        try:
            sc = float(row.get("score") or row.get("GPS_Score") or 0)
        except (TypeError, ValueError):
            sc = 0.0
        return (-sc,)
    if tool_name in ("qptm_site_conditions", "ekpi_quantitative", "cancerproteome_disease"):
        for k in ("log2fc", "log2_fold_change", "qratio", "fold_change", "fc"):
            try:
                return (-abs(float(row.get(k) or 0)),)
            except (TypeError, ValueError):
                continue
    if tool_name == "ptmd_disease":
        has_pmid = 1 if row.get("pmid") else 0
        return (-has_pmid,)
    if tool_name == "string_ppi":
        try:
            return (-float(row.get("score") or row.get("combined_score") or 0),)
        except (TypeError, ValueError):
            return (0,)
    if tool_name == "funcscore_phosphosite":
        try:
            return (-float(row.get("score") or row.get("funcscore") or 0),)
        except (TypeError, ValueError):
            return (0,)
    return (0,)


def _trim_row(row: dict[str, Any], max_len: int = 320) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if v is None or v == "":
            continue
        if isinstance(v, str) and len(v) > max_len:
            out[k] = v[: max_len - 3] + "..."
        else:
            out[k] = v
    return out


def format_tool_block(
    tool_name: str,
    invoke_result: dict[str, Any],
    *,
    limit: int = 15,
    tier: str | None = None,
) -> dict[str, Any]:
    """Turn one registry/MCP invoke result into a source block."""
    meta = _manifest_meta(tool_name)
    data = invoke_result.get("data")
    if isinstance(data, dict) and "preview" in data and data.get("truncated"):
        rows = []
        total = 0
    else:
        rows = _extract_rows(data)
        rows = sorted(rows, key=lambda r: _sort_key(tool_name, r))
        total = len(rows)
        rows = [_trim_row(r) for r in rows[:limit]]

    success = bool(invoke_result.get("success"))
    summary = str(invoke_result.get("summary") or "")[:500]
    error_kind = invoke_result.get("error_kind")

    block: dict[str, Any] = {
        **meta,
        "tool": tool_name,
        "tier": tier,
        "evidence_level": _evidence_level(tool_name),
        "success": success,
        "error_kind": error_kind,
        "summary": summary,
        "total": total,
        "shown": len(rows),
        "truncated": total > len(rows),
        "rows": rows,
    }
    if tool_name in _BLOCK_LEGENDS:
        block["legend"] = _BLOCK_LEGENDS[tool_name]
    if tool_name in _READING_GUIDES:
        block["reading_guide"] = _READING_GUIDES[tool_name]
    pmid = block.get("pmid")
    if pmid and str(pmid).isdigit():
        block["resource_pmid_url"] = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
    return block


def format_intent_response(
    *,
    intent: str,
    resolved: dict[str, Any],
    blocks: list[dict[str, Any]],
    summary: str,
    success: bool = True,
    error_kind: str | None = None,
    missing: list[str] | None = None,
) -> dict[str, Any]:
    any_ok = success and any(b.get("success") and b.get("rows") for b in blocks)
    if not any_ok and blocks:
        any_ok = any(b.get("success") for b in blocks)
    return {
        "success": any_ok if blocks else success,
        "error_kind": error_kind,
        "summary": summary[:800],
        "missing": missing or [],
        "intent": intent,
        "resolved": resolved,
        "blocks": blocks,
    }


def blocks_to_text(payload: dict[str, Any]) -> str:
    """Serialize intent payload for MCP text content."""
    import json

    return json.dumps(payload, ensure_ascii=False, default=str)

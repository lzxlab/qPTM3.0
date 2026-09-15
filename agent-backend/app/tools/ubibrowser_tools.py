"""UbiBrowser 2.0 tools — E3 / DUB–substrate interactions.

Stage 1 WHO tool:
  ubibrowser_interactions — known (literature) + optional predicted ESIs/DSIs

Local: data/enzymes/UbiBrowser/tables/interactions.tsv (curated)
Predicted: on-demand via downloadData (UniProt AC)
Homepage: http://ubibrowser.bio-it.cn/ubibrowser_v3/home/index
PMID: 34634807  DOI: 10.1093/nar/gkab962
"""

from __future__ import annotations

import csv
import io
import logging
import re
from collections import Counter
from html import unescape
from typing import Any

import httpx

from app.config import settings
from app.sources.catalog import get_catalog
from app.sources.query import index_exists, query_records
from app.sources.uniprot_id import resolve_identity
from app.tools.registry import registry

logger = logging.getLogger(__name__)

_DEFAULTS = {
    "name": "UbiBrowser",
    "homepage": "http://ubibrowser.bio-it.cn/ubibrowser_v3/home/index",
    "pmid": "34634807",
    "doi": "10.1093/nar/gkab962",
    "api_base": "http://ubibrowser.bio-it.cn/ubibrowser_v3",
}


def _meta() -> dict[str, Any]:
    m = get_catalog().get("ubibrowser")
    return {
        "source": _DEFAULTS["name"],
        "access": "hybrid",
        "homepage": (m.homepage if m else None) or _DEFAULTS["homepage"],
        "pmid": (m.pmid if m else None) or _DEFAULTS["pmid"],
        "doi": (m.doi if m else None) or _DEFAULTS["doi"],
    }


def _api_base() -> str:
    m = get_catalog().get("ubibrowser")
    base = (getattr(m, "api_base", None) if m else None) or _DEFAULTS["api_base"]
    return str(base).rstrip("/")


def _clean_html(text: str) -> str:
    text = unescape(text or "")
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _compact(row: dict[str, Any]) -> dict[str, Any]:
    out = {
        "enzyme_type": row.get("enzyme_type"),
        "enzyme_gene": row.get("enzyme_gene"),
        "enzyme_uniprot": row.get("enzyme_uniprot"),
        "substrate_gene": row.get("substrate_gene"),
        "substrate_uniprot": row.get("substrate_uniprot"),
        "family": row.get("family"),
        "evidence": row.get("evidence"),
        "confidence": row.get("confidence"),
        "pmid": row.get("pmid"),
        "species": row.get("species"),
        "sentence": (row.get("sentence") or "")[:240] or None,
    }
    return {k: v for k, v in out.items() if v not in (None, "")}


def _summarize(
    hits: list[dict[str, Any]],
    *,
    gene: str | None,
    ac: str | None,
    known_n: int,
    pred_n: int,
) -> str:
    label = gene or ac or "query"
    if not hits:
        return (
            f"UbiBrowser: no E3/DUB–substrate interactions for {label} "
            f"(known={known_n}, predicted={pred_n})."
        )
    as_sub = [h for h in hits if (h.get("substrate_uniprot") or "").upper() == (ac or "").upper()
              or (gene and (h.get("substrate_gene") or "").upper() == gene.upper())]
    as_enz = [h for h in hits if (h.get("enzyme_uniprot") or "").upper() == (ac or "").upper()
              or (gene and (h.get("enzyme_gene") or "").upper() == gene.upper())]
    parts = [f"UbiBrowser: {len(hits)} ESI/DSI hit(s) for {label}"]
    if known_n or pred_n:
        parts.append(f"(known={known_n}, predicted={pred_n})")
    examples = []
    for h in (as_sub or as_enz or hits)[:4]:
        examples.append(
            f"{h.get('enzyme_gene') or h.get('enzyme_uniprot')}→"
            f"{h.get('substrate_gene') or h.get('substrate_uniprot')} "
            f"[{h.get('enzyme_type')}, {h.get('evidence')}"
            + (f", conf={h.get('confidence')}" if h.get("confidence") else "")
            + (f", PMID {h.get('pmid')}" if h.get("pmid") else "")
            + "]"
        )
    roles = Counter(h.get("enzyme_type") for h in hits)
    parts.append("types: " + ", ".join(f"{k}×{v}" for k, v in roles.most_common()))
    parts.append("Examples: " + "; ".join(examples))
    return ". ".join(parts)


def _query_local(
    *,
    gene: str | None,
    uniprot_ac: str | None,
    enzyme_type: str | None,
    species: str,
    as_role: str,
    limit: int,
) -> list[dict[str, Any]]:
    if not index_exists("ubibrowser", "interactions"):
        return []

    equals_ci: dict[str, str] = {}
    if species and species.lower() not in ("any", "all", ""):
        equals_ci["species"] = species
    if enzyme_type and enzyme_type.upper() in ("E3", "DUB"):
        equals_ci["enzyme_type"] = enzyme_type.upper()

    rows: list[dict[str, Any]] = []
    fetch = min(max(limit * 4, limit), 200)

    def _run(extra: dict[str, str]) -> list[dict[str, Any]]:
        filt = {**equals_ci, **extra}
        try:
            return query_records(
                "ubibrowser",
                "interactions",
                equals_ci=filt,
                limit=fetch,
            )
        except Exception as e:
            logger.warning("UbiBrowser local query failed: %s", e)
            return []

    roles = []
    if as_role in ("substrate", "both", "auto"):
        roles.append("substrate")
    if as_role in ("enzyme", "both", "auto"):
        roles.append("enzyme")

    seen: set[tuple] = set()
    for role in roles:
        if uniprot_ac:
            key = "substrate_uniprot" if role == "substrate" else "enzyme_uniprot"
            chunk = _run({key: uniprot_ac})
        elif gene:
            key = "substrate_gene" if role == "substrate" else "enzyme_gene"
            chunk = _run({key: gene})
        else:
            chunk = []
        for r in chunk:
            k = (
                r.get("enzyme_type"),
                r.get("enzyme_uniprot"),
                r.get("substrate_uniprot"),
                r.get("pmid"),
                r.get("species"),
            )
            if k in seen:
                continue
            seen.add(k)
            rows.append(r)
    return rows


def _fetch_predicted_tsv(
    uniprot_ac: str,
    *,
    enzyme_type: str,
    as_role: str,
    timeout: float,
) -> list[dict[str, Any]]:
    """Fetch predicted interactions via UbiBrowser downloadData (UniProt AC)."""
    ac = uniprot_ac.strip().upper()
    # module/proteinType mapping from site behaviour
    if enzyme_type.upper() == "DUB":
        module = "DUB"
        ptype = "DUB" if as_role == "enzyme" else "noE3"
    else:
        module = "Strict"
        ptype = "E3" if as_role == "enzyme" else "noE3"

    url = (
        f"{_api_base()}/Home/Index/downloadData/module/{module}/"
        f"proteinType/{ptype}/name/{ac}/downloadType/prediction"
    )
    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": "qPTM_agent/1.0"},
        ) as client:
            resp = client.get(url)
            resp.raise_for_status()
            text = resp.text
    except Exception as e:
        logger.warning("UbiBrowser predicted fetch failed %s: %s", url, e)
        return []

    lines = text.splitlines() if text else []
    if len(lines) <= 1:
        return []

    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    out: list[dict[str, Any]] = []
    for r in reader:
        # Predicted E3 header:
        # SwissProt ID (E3), Gene Symbol (E3), SwissProt ID (Substrate),
        # Gene Symbol(Substrate), Domain_LR, Go_LR, Network_LR, Motif_LR,
        # Confidence Score, Species
        enz_ac = (r.get("SwissProt ID (E3)") or r.get("SwissProt ID (DUB)") or "").strip().upper()
        enz_gene = (r.get("Gene Symbol (E3)") or r.get("Gene Symbol (DUB)") or "").strip()
        sub_ac = (r.get("SwissProt ID (Substrate)") or "").strip().upper()
        sub_gene = (r.get("Gene Symbol(Substrate)") or r.get("Gene Symbol (Substrate)") or "").strip()
        conf = (r.get("Confidence Score") or "").strip()
        # When querying substrate (noE3), enzyme columns may be E3 even for DUB module
        if not enz_ac and not sub_ac:
            continue
        out.append({
            "enzyme_type": enzyme_type.upper(),
            "enzyme_gene": enz_gene,
            "enzyme_uniprot": enz_ac,
            "substrate_gene": sub_gene,
            "substrate_uniprot": sub_ac,
            "family": "",
            "pmid": "",
            "source": "UbiBrowser prediction",
            "sentence": "",
            "species": (r.get("Species") or "H.sapiens").strip(),
            "evidence": "predicted",
            "confidence": conf,
            "domain_lr": r.get("Domain_LikelihoodRatio"),
            "go_lr": r.get("Go_LikelihoodRatio"),
            "network_lr": r.get("Network_LikelihoodRatio"),
            "motif_lr": r.get("Motif_LikelihoodRatio"),
        })
    return out


def _fetch_known_api(
    uniprot_ac: str,
    *,
    enzyme_type: str,
    as_role: str,
    timeout: float,
) -> list[dict[str, Any]]:
    """Optional known download (useful if local index missing)."""
    ac = uniprot_ac.strip().upper()
    if enzyme_type.upper() == "DUB":
        module, ptype = "DUB", ("DUB" if as_role == "enzyme" else "noE3")
    else:
        module, ptype = "Strict", ("E3" if as_role == "enzyme" else "noE3")
    url = (
        f"{_api_base()}/Home/Index/downloadData/module/{module}/"
        f"proteinType/{ptype}/name/{ac}/downloadType/known"
    )
    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": "qPTM_agent/1.0"},
        ) as client:
            resp = client.get(url)
            resp.raise_for_status()
            text = resp.text
    except Exception as e:
        logger.warning("UbiBrowser known API failed %s: %s", url, e)
        return []

    lines = text.splitlines() if text else []
    if len(lines) <= 1:
        return []
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    out: list[dict[str, Any]] = []
    for r in reader:
        # Species  SUBGENE  E3GENE  SOURCE  SOURCEID  SENTENCE
        # or DUB variant with same shape (E3GENE column = enzyme gene)
        enz_gene = (r.get("E3GENE") or r.get("DUBGENE") or "").strip()
        sub_gene = (r.get("SUBGENE") or "").strip()
        out.append({
            "enzyme_type": enzyme_type.upper(),
            "enzyme_gene": enz_gene,
            "enzyme_uniprot": ac if as_role == "enzyme" else "",
            "substrate_gene": sub_gene,
            "substrate_uniprot": ac if as_role == "substrate" else "",
            "family": "",
            "pmid": (r.get("SOURCEID") or "").strip(),
            "source": (r.get("SOURCE") or "").strip(),
            "sentence": _clean_html(r.get("SENTENCE") or ""),
            "species": (r.get("Species") or "").strip(),
            "evidence": "literature",
            "confidence": "",
        })
    return out


def _ubibrowser_interactions(
    gene: str | None = None,
    uniprot_ac: str | None = None,
    enzyme_type: str = "any",
    query_as: str = "auto",
    include_predicted: bool = False,
    min_confidence: float = 0.8,
    species: str = "H.sapiens",
    limit: int = 40,
) -> dict[str, Any]:
    """Query UbiBrowser E3/DUB–substrate interactions for a protein."""
    if not any([gene, uniprot_ac]):
        return {
            "error": "Provide gene and/or uniprot_ac",
            "summary": "Missing query key for UbiBrowser",
            "found": False,
            **_meta(),
        }

    identity = resolve_identity(uniprot_ac=uniprot_ac, gene=gene)
    resolved_ac = ((identity or {}).get("uniprot_ac") or uniprot_ac or "").strip().upper() or None
    resolved_gene = (identity or {}).get("gene") or (gene or "").strip() or None

    et = (enzyme_type or "any").strip().upper()
    types = ["E3", "DUB"] if et in ("ANY", "ALL", "") else [et]
    role = (query_as or "auto").strip().lower()

    local_rows = _query_local(
        gene=resolved_gene,
        uniprot_ac=resolved_ac,
        enzyme_type=None if len(types) > 1 else types[0],
        species=species,
        as_role=role,
        limit=limit,
    )

    # If local empty and we have AC, fall back to known API
    if not local_rows and resolved_ac:
        for t in types:
            roles = ["substrate", "enzyme"] if role in ("auto", "both") else [role]
            for rr in roles:
                local_rows.extend(_fetch_known_api(resolved_ac, enzyme_type=t, as_role=rr, timeout=settings.http_timeout_seconds))

    predicted: list[dict[str, Any]] = []
    pred_note = None
    if include_predicted and resolved_ac:
        timeout = max(float(settings.http_timeout_seconds), 60.0)
        roles = ["substrate", "enzyme"] if role in ("auto", "both") else [role]
        for t in types:
            for rr in roles:
                predicted.extend(
                    _fetch_predicted_tsv(resolved_ac, enzyme_type=t, as_role=rr, timeout=timeout)
                )
        # confidence filter
        filtered = []
        for p in predicted:
            try:
                conf = float(p.get("confidence") or 0)
            except ValueError:
                conf = 0.0
            if conf >= float(min_confidence or 0):
                p["confidence"] = f"{conf:.3f}"
                filtered.append(p)
        predicted = filtered
        if not predicted:
            pred_note = (
                f"No predicted hits above min_confidence={min_confidence} "
                "(or remote predicted endpoint returned empty)."
            )

    # Sort: literature first, then confidence desc
    def _sort_key(r: dict[str, Any]) -> tuple:
        ev = 0 if r.get("evidence") == "literature" else 1
        try:
            conf = -float(r.get("confidence") or 0)
        except ValueError:
            conf = 0.0
        return (ev, conf, r.get("enzyme_gene") or "", r.get("substrate_gene") or "")

    # Deduplicate predicted vs local by enzyme+substrate+type
    seen: set[tuple] = set()
    merged: list[dict[str, Any]] = []
    for r in list(local_rows) + list(predicted):
        k = (
            (r.get("enzyme_type") or "").upper(),
            (r.get("enzyme_uniprot") or r.get("enzyme_gene") or "").upper(),
            (r.get("substrate_uniprot") or r.get("substrate_gene") or "").upper(),
            r.get("evidence"),
            r.get("pmid") or "",
        )
        if k in seen:
            continue
        seen.add(k)
        merged.append(r)

    merged.sort(key=_sort_key)
    known_n = sum(1 for r in merged if r.get("evidence") == "literature")
    pred_n = sum(1 for r in merged if r.get("evidence") == "predicted")
    shown = [_compact(r) for r in merged[: min(limit, 80)]]

    summary = _summarize(
        shown,
        gene=resolved_gene,
        ac=resolved_ac,
        known_n=known_n,
        pred_n=pred_n,
    )
    if pred_note and include_predicted:
        summary += " " + pred_note

    return {
        "summary": summary,
        "found": bool(shown),
        "gene": resolved_gene,
        "uniprot_ac": resolved_ac,
        "uniprot_identity": identity,
        "enzyme_type": enzyme_type,
        "query_as": query_as,
        "include_predicted": include_predicted,
        "min_confidence": min_confidence,
        "species": species,
        "known_total": known_n,
        "predicted_total": pred_n,
        "total": len(shown),
        "interactions": shown,
        "note": (
            "UbiBrowser 2.0: literature-curated ESIs/DSIs locally; "
            "predicted interactions via on-demand downloadData (UniProt AC). "
            "High-confidence predicted hits filtered by Confidence Score."
        ),
        **_meta(),
    }


def register_ubibrowser_tools() -> None:
    registry.register(
        name="ubibrowser_interactions",
        description=(
            "Query UbiBrowser 2.0 for ubiquitin ligase (E3) and deubiquitinase "
            "(DUB)–substrate interactions. Returns literature-curated ESIs/DSIs "
            "plus optional high-confidence predicted interactions. Use in Stage 1 "
            "WHO for ubiquitination regulators. PMID 34634807."
        ),
        parameters={
            "type": "object",
            "properties": {
                "gene": {"type": "string", "description": "Gene symbol (e.g. TP53, MDM2, USP7)"},
                "uniprot_ac": {"type": "string", "description": "UniProt accession"},
                "enzyme_type": {
                    "type": "string",
                    "description": "any | E3 | DUB (default any)",
                },
                "query_as": {
                    "type": "string",
                    "description": (
                        "auto | substrate | enzyme | both — treat query protein as "
                        "substrate and/or enzyme (default auto=both)"
                    ),
                },
                "include_predicted": {
                    "type": "boolean",
                    "description": "Include predicted ESIs/DSIs via remote download (default true)",
                },
                "min_confidence": {
                    "type": "number",
                    "description": "Min predicted Confidence Score (default 0.8)",
                },
                "species": {
                    "type": "string",
                    "description": "Species code, default H.sapiens",
                },
                "limit": {"type": "integer", "description": "Max hits (default 40)"},
            },
            "required": [],
        },
        handler=_ubibrowser_interactions,
    )

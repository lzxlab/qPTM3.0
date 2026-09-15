"""GPS-Uber tools — site-specific E3–substrate ubiquitination relations (ssESRs).

Stage 1 WHO tool:
  gpsuber_e3_sites — literature-curated E3 → substrate lysine site links

Data: data/enzymes/GPS-Uber/ (Wang et al. Brief Bioinform 2022, PMID 35037020)
Homepage: http://gpsuber.biocuckoo.cn/
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any

from app.sources.catalog import get_catalog
from app.sources.query import index_exists, query_records
from app.sources.uniprot_id import resolve_identity
from app.tools.registry import registry

logger = logging.getLogger(__name__)

_DEFAULTS = {
    "name": "GPS-Uber",
    "homepage": "http://gpsuber.biocuckoo.cn/",
    "pmid": "35037020",
    "doi": "10.1093/bib/bbab574",
}


def _meta() -> dict[str, Any]:
    m = get_catalog().get("gpsuber")
    return {
        "source": _DEFAULTS["name"],
        "access": "local",
        "homepage": (m.homepage if m else None) or _DEFAULTS["homepage"],
        "pmid": (m.pmid if m else None) or _DEFAULTS["pmid"],
        "doi": (m.doi if m else None) or _DEFAULTS["doi"],
    }


def _split_pmids(raw: Any) -> list[str]:
    text = str(raw or "").strip()
    if not text:
        return []
    parts = []
    for p in text.replace(";", "|").replace(",", "|").split("|"):
        p = p.strip()
        if p.isdigit():
            parts.append(p)
    return parts


def _compact(row: dict[str, Any]) -> dict[str, Any]:
    pmids = _split_pmids(row.get("pmids"))
    out = {
        "substrate_gene": row.get("substrate_gene"),
        "substrate_uniprot": row.get("substrate_uniprot"),
        "position": int(row["position"]) if str(row.get("position") or "").isdigit() else row.get("position"),
        "site": f"K{row.get('position')}" if row.get("position") else None,
        "peptide": row.get("peptide"),
        "e3_gene": row.get("e3_gene"),
        "e3_uniprot": row.get("e3_uniprot"),
        "e3_class": row.get("e3_class"),
        "pmids": pmids,
        "evidence": "literature",
    }
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def _summarize(hits: list[dict[str, Any]], keys: list[str]) -> str:
    if not hits:
        return f"GPS-Uber: no site-specific E3–substrate relations for {', '.join(keys)}."
    e3s = sorted({h.get("e3_gene") or h.get("e3_uniprot") or "?" for h in hits})
    sites = sorted({
        f"{h.get('substrate_gene') or '?'} K{h.get('position')}"
        for h in hits if h.get("position") is not None
    })
    classes = Counter(h.get("e3_class") or "unclassified" for h in hits)
    examples = []
    for h in hits[:4]:
        examples.append(
            f"{h.get('e3_gene') or h.get('e3_uniprot')} → "
            f"{h.get('substrate_gene') or h.get('substrate_uniprot')} "
            f"K{h.get('position')} ({h.get('e3_class') or 'E3'}"
            + (f"; PMID {','.join(h.get('pmids') or [])}" if h.get("pmids") else "")
            + ")"
        )
    return (
        f"GPS-Uber: {len(hits)} site-specific E3–substrate relation(s) "
        f"for {', '.join(keys)} "
        f"({len(e3s)} E3(s), {len(sites)} site(s); "
        f"classes: {', '.join(f'{k}×{v}' for k, v in classes.most_common(4))}). "
        f"Examples: " + "; ".join(examples)
    )


def _gpsuber_e3_sites(
    gene: str | None = None,
    uniprot_ac: str | None = None,
    position: int | None = None,
    e3_gene: str | None = None,
    e3_uniprot: str | None = None,
    e3_class: str | None = None,
    limit: int = 40,
) -> dict[str, Any]:
    """Query GPS-Uber curated site-specific E3–substrate ubiquitination relations."""
    if not any([gene, uniprot_ac, e3_gene, e3_uniprot]):
        return {
            "error": "Provide substrate gene/uniprot_ac and/or e3_gene/e3_uniprot",
            "summary": "Missing query key for GPS-Uber",
            "found": False,
            **_meta(),
        }

    if not index_exists("gpsuber", "ssesr"):
        return {
            "error": "GPS-Uber index missing. Run: python -m app.sources.build_index gpsuber",
            "summary": "GPS-Uber index not built yet",
            "found": False,
            **_meta(),
        }

    identity = None
    resolved_ac = (uniprot_ac or "").strip().upper() or None
    resolved_gene = (gene or "").strip() or None
    if resolved_gene or resolved_ac:
        identity = resolve_identity(uniprot_ac=resolved_ac, gene=resolved_gene)
        if identity:
            resolved_ac = (identity.get("uniprot_ac") or resolved_ac or "").upper() or None
            resolved_gene = identity.get("gene") or resolved_gene

    e3_ac = (e3_uniprot or "").strip().upper() or None
    e3_g = (e3_gene or "").strip() or None

    equals_ci: dict[str, str] = {}
    equals: dict[str, str] = {}

    # Substrate filters
    if resolved_ac:
        # prefer exact accession; also try base (isoform-stripped) via second query merge
        equals_ci["substrate_uniprot_base"] = resolved_ac.split("-")[0]
    elif resolved_gene:
        equals_ci["substrate_gene"] = resolved_gene

    # E3 filters
    if e3_ac:
        equals_ci["e3_uniprot_base"] = e3_ac.split("-")[0]
    elif e3_g:
        equals_ci["e3_gene"] = e3_g

    if e3_class and e3_class.strip().lower() not in ("any", "all", ""):
        equals_ci["e3_class"] = e3_class.strip()

    if position is not None:
        equals["position"] = str(int(position))

    if not equals_ci and not equals:
        return {
            "error": "No usable filters after identity resolution",
            "summary": "GPS-Uber: empty query",
            "found": False,
            **_meta(),
        }

    try:
        rows = query_records(
            "gpsuber",
            "ssesr",
            equals=equals or None,
            equals_ci=equals_ci or None,
            limit=min(max(limit * 3, limit), 200),
        )
    except Exception as e:
        logger.error("GPS-Uber query failed: %s", e, exc_info=True)
        return {
            "error": str(e),
            "summary": f"GPS-Uber query failed: {e}",
            "found": False,
            **_meta(),
        }

    # If queried by full isoform accession, prefer exact matches first
    if resolved_ac and "-" in resolved_ac:
        exact = [r for r in rows if (r.get("substrate_uniprot") or "").upper() == resolved_ac]
        if exact:
            rows = exact

    hits = [_compact(r) for r in rows[: min(limit, 80)]]
    protein_level_note = None
    if position is not None and not hits and (resolved_ac or resolved_gene):
        try:
            protein_rows = query_records(
                "gpsuber",
                "ssesr",
                equals=equals or None,
                equals_ci={k: v for k, v in equals_ci.items() if k != "position"},
                limit=min(max(limit, 40), 200),
            )
            n_prot = len(protein_rows)
            if n_prot:
                protein_level_note = (
                    f"No ssESR at lysine {position}, but {n_prot} protein-level "
                    f"GPS-Uber relation(s) exist for this substrate (try omitting position)."
                )
        except Exception:
            protein_level_note = None
    keys = []
    if resolved_gene:
        keys.append(f"gene={resolved_gene}")
    if resolved_ac:
        keys.append(f"uniprot={resolved_ac}")
    if position is not None:
        keys.append(f"K{position}")
    if e3_g:
        keys.append(f"e3={e3_g}")
    if e3_ac:
        keys.append(f"e3_uniprot={e3_ac}")
    if e3_class:
        keys.append(f"class={e3_class}")

    e3_list = sorted({h.get("e3_gene") for h in hits if h.get("e3_gene")})
    class_list = sorted({h.get("e3_class") for h in hits if h.get("e3_class")})

    summary = _summarize(hits, keys or ["query"])
    if protein_level_note:
        summary = f"{summary} {protein_level_note}"
    return {
        "summary": summary,
        "found": bool(hits),
        "gene": resolved_gene,
        "uniprot_ac": resolved_ac,
        "uniprot_identity": identity,
        "position": position,
        "e3_gene": e3_g,
        "e3_uniprot": e3_ac,
        "e3_class": e3_class,
        "e3s_found": e3_list,
        "e3_classes_found": class_list,
        "total": len(hits),
        "relations": hits,
        "note": (
            "GPS-Uber curated site-specific E3–substrate relations (ssESRs) from "
            "literature (Table S1). Distinct from UbiBrowser protein-level ESI/DSI: "
            "these records include the modified lysine position."
        ),
        **_meta(),
    }


def register_gpsuber_tools() -> None:
    registry.register(
        name="gpsuber_e3_sites",
        description=(
            "Query GPS-Uber curated site-specific E3–substrate ubiquitination "
            "relations (ssESRs): which E3 ligase modifies which lysine on a "
            "substrate (or substrates of an E3). Use in Stage 1 WHO for "
            "ubiquitination site writers. PMID 35037020."
        ),
        parameters={
            "type": "object",
            "properties": {
                "gene": {"type": "string", "description": "Substrate gene symbol"},
                "uniprot_ac": {"type": "string", "description": "Substrate UniProt accession"},
                "position": {"type": "integer", "description": "Lysine position (e.g. 48)"},
                "e3_gene": {"type": "string", "description": "E3 ligase gene symbol"},
                "e3_uniprot": {"type": "string", "description": "E3 UniProt accession"},
                "e3_class": {
                    "type": "string",
                    "description": "Optional E3 class/family filter (e.g. RBR, HECT)",
                },
                "limit": {"type": "integer", "description": "Max hits (default 40)"},
            },
            "required": [],
        },
        handler=_gpsuber_e3_sites,
    )

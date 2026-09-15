"""iPTMnet tools — official REST API v1 (enzyme–substrate + PTM-dependent PPI).

Stage tools:
  iptmnet_enzymes — PTM enzymes for a substrate (GET /v1/{id}/substrate)
  iptmnet_ptm_ppi — PTM-dependent PPI (GET /v1/{id}/ptmppi)

API docs: https://research.bioinformatics.udel.edu/iptmnet/api/doc/
About:   https://research.bioinformatics.udel.edu/iptmnet/about/api
PMID: 29145615  DOI: 10.1093/nar/gkx1104
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.config import settings
from app.sources.catalog import get_catalog
from app.sources.uniprot_id import resolve_identity
from app.tools.registry import registry

logger = logging.getLogger(__name__)

_DEFAULTS = {
    "name": "iPTMnet",
    "homepage": "https://research.bioinformatics.udel.edu/iptmnet/",
    "pmid": "29145615",
    "doi": "10.1093/nar/gkx1104",
}

_PTM_ENZYME_TYPE = {
    "phosphorylation": "kinase",
    "acetylation": "acetyltransferase",
    "ubiquitination": "E3 ligase",
    "ubiquitylation": "E3 ligase",
    "methylation": "methyltransferase",
    "sumoylation": "SUMO E3 ligase",
    "glycosylation": "glycosyltransferase",
    "n-glycosylation": "glycosyltransferase",
    "o-glycosylation": "glycosyltransferase",
    "s-nitrosylation": "nitrosylase",
    "myristoylation": "acyltransferase",
}


def _meta() -> dict[str, Any]:
    m = get_catalog().get("iptmnet")
    return {
        "source": _DEFAULTS["name"],
        "access": "api",
        "homepage": (m.homepage if m else None) or _DEFAULTS["homepage"],
        "pmid": (m.pmid if m else None) or _DEFAULTS["pmid"],
        "doi": (m.doi if m else None) or _DEFAULTS["doi"],
        "api_docs": "https://research.bioinformatics.udel.edu/iptmnet/api/doc/",
    }


def _base() -> str:
    return (settings.iptmnet_api_base_url or _DEFAULTS["homepage"].rstrip("/") + "/api").rstrip("/")


def _iptmnet_get(path: str) -> dict[str, Any] | list[Any] | None:
    """GET JSON from iPTMnet API (expects paths like v1/{id}/substrate).

    Returns an error dict with ``http_status`` on 5xx so callers classify as
    ``http_error`` instead of scientific empty.
    """
    url = f"{_base()}/{path.lstrip('/')}"
    try:
        with httpx.Client(
            timeout=min(float(settings.http_timeout_seconds), 15.0),
            follow_redirects=True,
            headers={"Accept": "application/json", "User-Agent": "qPTM_agent/1.0"},
        ) as client:
            resp = client.get(url)
            if resp.status_code == 404:
                return None
            if resp.status_code >= 500:
                logger.warning("iPTMnet API %s for %s", resp.status_code, path)
                return {
                    "error": f"iPTMnet API HTTP {resp.status_code} for {path}",
                    "http_status": resp.status_code,
                }
            resp.raise_for_status()
            return resp.json()
    except httpx.TimeoutException as e:
        logger.warning("iPTMnet API timeout for %s: %s", path, e)
        return {"error": f"iPTMnet API timeout for {path}", "http_status": 504}
    except httpx.HTTPError as e:
        logger.warning("iPTMnet API error for %s: %s", path, e)
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status:
            return {"error": f"iPTMnet API HTTP {status} for {path}", "http_status": status}
        return {"error": f"iPTMnet API error for {path}: {e}"}
    except Exception as e:
        logger.error("iPTMnet request failed for %s: %s", path, e)
        return {"error": f"iPTMnet request failed: {e}"}


def _iptmnet_api_error(data: Any) -> dict[str, Any] | None:
    if isinstance(data, dict) and data.get("error") and data.get("http_status"):
        return data
    return None


def _resolve(gene: str | None, uniprot_ac: str | None) -> tuple[str | None, str | None, dict | None]:
    g = (gene or "").strip() or None
    ac = (uniprot_ac or "").strip().upper() or None
    identity = None
    if g or ac:
        identity = resolve_identity(uniprot_ac=ac, gene=g)
        if identity:
            g = identity.get("gene") or g
            ac = (identity.get("uniprot_ac") or ac or "").upper() or None
    return g, ac, identity


def _parse_site(site: str | None) -> dict[str, Any]:
    """Parse 'T55', 'S15', or legacy 'pT55' into residue / position / raw."""
    if not site:
        return {"raw": "", "residue": None, "position": None}
    s = str(site).strip()
    m = re.match(r"^([A-Za-z]*)([A-Z])(\d+)$", s)
    if not m:
        return {"raw": s, "residue": None, "position": None}
    _mod, residue, pos = m.groups()
    return {"raw": s, "residue": residue, "position": int(pos)}


def _normalize_enzyme_gene(name: str | None) -> str:
    """Strip organism prefix (hATM → ATM) and PRO-style labels."""
    if not name:
        return ""
    label = str(name).strip()
    m = re.match(r"^([hmry])([A-Z0-9].+)$", label)
    if m:
        return m.group(2)
    return label


def _enzyme_uniprot(enz: dict[str, Any]) -> str:
    eid = str(enz.get("id") or "").strip()
    etype = str(enz.get("enz_type") or enz.get("type") or "").lower()
    if etype in ("uniprot_ac", "uniprot") and eid and not eid.startswith("PR:"):
        return eid.upper()
    if eid.startswith("PR:"):
        # Often PR:<UniProtAC> for organism-gene entries
        tail = eid[3:]
        if re.match(r"^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$", tail):
            return tail.upper()
    if re.match(r"^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$", eid):
        return eid.upper()
    return ""


def _iter_substrate_sites(data: Any) -> list[dict[str, Any]]:
    """Normalize /v1/{id}/substrate payload (dict of isoform → sites list)."""
    rows: list[dict[str, Any]] = []
    if isinstance(data, dict):
        # Shape A: { "P04637-1": [ {...}, ... ], "P04637": [...] }
        looks_like_isoforms = any(isinstance(v, list) for v in data.values())
        if looks_like_isoforms and "table" not in data:
            for form, sites in data.items():
                if not isinstance(sites, list):
                    continue
                for s in sites:
                    if isinstance(s, dict):
                        rows.append({**s, "proteoform": form})
            return rows
        # Shape B: { "form": "...", "table": [...] }
        table = data.get("table")
        if isinstance(table, list):
            form = data.get("form") or ""
            for s in table:
                if isinstance(s, dict):
                    rows.append({**s, "proteoform": form})
            return rows
    if isinstance(data, list):
        for s in data:
            if isinstance(s, dict):
                rows.append(s)
    return rows


def _site_enzymes(site_row: dict[str, Any]) -> list[dict[str, Any]]:
    """Collect enzymes from a substrate site row (enzymes[] or single enzyme)."""
    out: list[dict[str, Any]] = []
    enzymes = site_row.get("enzymes")
    if isinstance(enzymes, list):
        for e in enzymes:
            if isinstance(e, dict) and (e.get("name") or e.get("id")):
                out.append(e)
    enz = site_row.get("enzyme")
    if isinstance(enz, dict) and (enz.get("name") or enz.get("id")):
        out.append(enz)
    return out


def _ptm_type(site_row: dict[str, Any]) -> str:
    return str(site_row.get("ptm_type") or site_row.get("PTM type") or site_row.get("type") or "").strip()


def _pmids(site_row: dict[str, Any]) -> list[str]:
    raw = site_row.get("pmids") or site_row.get("PMIDs") or []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for p in raw:
        s = str(p).strip()
        if s.isdigit():
            out.append(s)
    return out


def _source_names(site_row: dict[str, Any]) -> list[str]:
    sources = site_row.get("sources")
    names: list[str] = []
    if isinstance(sources, list):
        for s in sources:
            if isinstance(s, dict) and s.get("name"):
                names.append(str(s["name"]))
    elif isinstance(sources, dict):
        names.extend(str(k) for k in sources.keys())
    return names


# ── Tool: iptmnet_enzymes ─────────────────────────────────────────

def _iptmnet_enzymes(
    uniprot_ac: str | None = None,
    gene: str | None = None,
    position: int | None = None,
    ptm_type: str | None = None,
    limit: int = 40,
) -> dict[str, Any]:
    """Query iPTMnet substrate table for enzyme–site associations."""
    meta = _meta()
    gene, ac, identity = _resolve(gene, uniprot_ac)
    if not ac:
        return {
            **meta,
            "summary": "Provide uniprot_ac or gene to query iPTMnet enzymes.",
            "gene": gene,
            "uniprot_ac": None,
            "enzymes": [],
            "total": 0,
            "error": "missing_identifier",
        }

    data = _iptmnet_get(f"v1/{ac}/substrate")
    api_err = _iptmnet_api_error(data)
    if api_err:
        return {
            **meta,
            "summary": str(api_err.get("error")),
            "gene": gene or (identity or {}).get("gene"),
            "uniprot_ac": ac,
            "enzymes": [],
            "total": 0,
            **api_err,
        }
    if data is None:
        return {
            **meta,
            "summary": f"No data found in iPTMnet for {ac}.",
            "gene": gene or (identity or {}).get("gene"),
            "uniprot_ac": ac,
            "enzymes": [],
            "total": 0,
        }

    info = _iptmnet_get(f"v1/{ac}/info")
    gene_name = gene
    if isinstance(info, dict):
        gene_name = info.get("gene_name") or gene_name

    ptm_filter = (ptm_type or "").strip().lower() or None
    enzymes: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in _iter_substrate_sites(data):
        parsed = _parse_site(row.get("site"))
        pos = parsed.get("position")
        if position is not None and pos != position:
            continue
        ptm = _ptm_type(row)
        if ptm_filter and ptm_filter not in ptm.lower():
            continue
        enz_list = _site_enzymes(row)
        if not enz_list:
            continue
        score = row.get("score")
        pmids = _pmids(row)
        sources = _source_names(row)
        for enz in enz_list:
            egene = _normalize_enzyme_gene(enz.get("name"))
            euc = _enzyme_uniprot(enz)
            dedup = f"{egene}|{euc}|{pos}|{ptm.lower()}"
            if dedup in seen:
                continue
            seen.add(dedup)
            enzymes.append({
                "enzyme_gene": egene,
                "enzyme_label": enz.get("name") or egene,
                "enzyme_uniprot": euc,
                "enzyme_type": _PTM_ENZYME_TYPE.get(ptm.lower(), "enzyme"),
                "substrate_position": pos,
                "substrate_site": parsed.get("raw") or row.get("site"),
                "residue": parsed.get("residue"),
                "ptm_type": ptm,
                "score": score,
                "pmids": pmids[:8],
                "evidence": "experimental" if (score is None or int(score or 0) >= 2) else "literature",
                "source": ", ".join(sources[:4]) if sources else "iPTMnet",
                "proteoform": row.get("proteoform"),
            })

    enzymes.sort(key=lambda e: (-int(e.get("score") or 0), e.get("substrate_position") or 0, e.get("enzyme_gene") or ""))
    limit = max(1, min(int(limit or 40), 100))
    shown = enzymes[:limit]

    summary = f"Found {len(enzymes)} enzyme–site association(s) in iPTMnet for {ac}"
    if gene_name:
        summary += f" ({gene_name})"
    if position is not None:
        summary += f" at position {position}"
    if ptm_filter:
        summary += f" ({ptm_filter})"
    summary += ". "
    if shown:
        names = sorted({e["enzyme_gene"] for e in shown if e.get("enzyme_gene")})
        summary += f"Enzymes: {', '.join(names[:12])}."
    else:
        summary += "No enzyme data for this protein/site filter."

    return {
        **meta,
        "summary": summary,
        "gene": gene_name,
        "uniprot_ac": ac,
        "position": position,
        "ptm_type": ptm_type,
        "total": len(enzymes),
        "enzymes": shown,
        "uniprot_identity": identity,
    }


# ── Tool: iptmnet_ptm_ppi ─────────────────────────────────────────

def _iptmnet_ptm_ppi(
    uniprot_ac: str | None = None,
    gene: str | None = None,
    position: int | None = None,
    limit: int = 30,
) -> dict[str, Any]:
    """PTM-dependent protein–protein interactions via /v1/{id}/ptmppi."""
    meta = _meta()
    gene, ac, identity = _resolve(gene, uniprot_ac)
    if not ac:
        return {
            **meta,
            "summary": "Provide uniprot_ac or gene to query iPTMnet PTM-PPI.",
            "gene": gene,
            "uniprot_ac": None,
            "interactions": [],
            "total": 0,
            "error": "missing_identifier",
        }

    data = _iptmnet_get(f"v1/{ac}/ptmppi")
    api_err = _iptmnet_api_error(data)
    if api_err:
        return {
            **meta,
            "summary": str(api_err.get("error")),
            "gene": gene or (identity or {}).get("gene"),
            "uniprot_ac": ac,
            "interactions": [],
            "total": 0,
            **api_err,
        }
    if data is None:
        return {
            **meta,
            "summary": f"No PTM-dependent PPI data found in iPTMnet for {ac}.",
            "gene": gene or (identity or {}).get("gene"),
            "uniprot_ac": ac,
            "interactions": [],
            "total": 0,
        }

    rows = data if isinstance(data, list) else []
    interactions: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in rows:
        if not isinstance(item, dict):
            continue
        site = item.get("site")
        parsed = _parse_site(site)
        if position is not None and parsed.get("position") != position:
            continue

        substrate = item.get("substrate") if isinstance(item.get("substrate"), dict) else {}
        interactant = item.get("interactant") if isinstance(item.get("interactant"), dict) else {}
        sub_ac = str(substrate.get("uniprot_id") or "").upper()
        sub_gene = substrate.get("name") or ""
        int_ac = str(interactant.get("uniprot_id") or "").upper()
        int_gene = interactant.get("name") or ""

        pmid = item.get("pmid")
        pmid_str = str(pmid).strip() if pmid is not None else ""
        source = item.get("source") if isinstance(item.get("source"), dict) else {}
        assoc = item.get("association_type") or "association"
        ptm = item.get("ptm_type") or ""

        # Queried protein may be substrate or interactant
        if sub_ac == ac or (not sub_ac and sub_gene and gene and sub_gene.upper() == gene.upper()):
            role = "as_substrate"
            partner_gene, partner_ac = int_gene, int_ac
        else:
            role = "as_interactant"
            partner_gene, partner_ac = sub_gene, sub_ac

        key = f"{role}|{partner_ac}|{partner_gene}|{site}|{ptm}|{assoc}"
        if key in seen:
            continue
        seen.add(key)

        interactions.append({
            "interactor_a": gene or ac,
            "interactor_a_uniprot": ac,
            "interactor_b": partner_gene or partner_ac,
            "interactor_b_uniprot": partner_ac,
            "role": role,
            "ptm_site": parsed.get("raw") or site,
            "substrate_position": parsed.get("position"),
            "ptm_type": ptm,
            "interaction_type": "PTM-dependent",
            "association_type": assoc,
            "effect": assoc.replace("_", " "),
            "pmid": pmid_str if pmid_str.isdigit() else None,
            "evidence": "experimental",
            "source": source.get("name") or "iPTMnet",
            "substrate_gene": sub_gene,
            "substrate_uniprot": sub_ac,
        })

    limit = max(1, min(int(limit or 30), 100))
    shown = interactions[:limit]

    summary_lines: list[str] = []
    query_label = gene or ac or "?"
    for i in shown[:8]:
        sub = i.get("substrate_gene") or i.get("substrate_uniprot") or "?"
        partner = i.get("interactor_b") or "?"
        site = i.get("ptm_site") or "?"
        ptm = i.get("ptm_type") or "PTM"
        effect = i.get("effect") or i.get("association_type") or "association"
        pmid = i.get("pmid")
        if i.get("role") == "as_substrate":
            note = f"{ptm} of {query_label} at {site} → {effect} with {partner}"
        else:
            note = (
                f"{ptm} of {sub} at {site} → {effect} involving {query_label} "
                f"(partner of modified {sub})"
            )
        if pmid:
            note += f" (PMID {pmid})"
        if i.get("source"):
            note += f" [{i['source']}]"
        i["note"] = note
        summary_lines.append(note)

    target = ac + (f" ({gene})" if gene else "")
    if position is not None:
        target += f", position {position}"
    if not summary_lines:
        summary = (
            f"Found 0 PTM-dependent interaction(s) in iPTMnet for {target}."
        )
    else:
        summary = (
            f"Found {len(interactions)} PTM-dependent interaction(s) in iPTMnet for {target}: "
            + " ".join(summary_lines[:6])
        )
        if len(interactions) > 6:
            summary += f" …and {len(interactions) - 6} more."

    return {
        **meta,
        "summary": summary,
        "gene": gene or (identity or {}).get("gene"),
        "uniprot_ac": ac,
        "position": position,
        "total": len(interactions),
        "interactions": shown,
        "uniprot_identity": identity,
    }


# ── Register ──────────────────────────────────────────────────────

def register_iptmnet_tools() -> None:
    """Register iPTMnet tools with the global registry."""
    registry.register(
        name="iptmnet_enzymes",
        description=(
            "Query iPTMnet (REST API v1 /substrate) for PTM enzymes (kinases, "
            "acetyltransferases, E3 ligases, etc.) on a substrate protein or site. "
            "Integrates PhosphoSitePlus, UniProt, PRO, text mining and more. "
            "Use for Stage 2 WHO: writers/erasers when qPTM kinase data is incomplete. "
            "Citation: Huang et al. NAR 2018 (PMID 29145615)."
        ),
        parameters={
            "type": "object",
            "properties": {
                "uniprot_ac": {
                    "type": "string",
                    "description": "UniProt accession of the substrate (e.g. P04637)",
                },
                "gene": {
                    "type": "string",
                    "description": "Gene symbol; resolved to UniProt via local identity map",
                },
                "position": {
                    "type": "integer",
                    "description": "Optional residue position filter (e.g. 15 for S15)",
                },
                "ptm_type": {
                    "type": "string",
                    "description": "Optional PTM type filter (e.g. Phosphorylation)",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max enzyme rows to return (default 40)",
                },
            },
            "required": [],
        },
        handler=_iptmnet_enzymes,
    )

    registry.register(
        name="iptmnet_ptm_ppi",
        description=(
            "Query iPTMnet (REST API v1 /ptmppi) for PTM-dependent protein–protein "
            "interactions (how a modification modulates binding). "
            "Use for Stage 3–4 WHY: functional impact on interaction networks. "
            "Distinct from PTMint / STRING / BioGRID general PPI. "
            "Citation: Huang et al. NAR 2018 (PMID 29145615)."
        ),
        parameters={
            "type": "object",
            "properties": {
                "uniprot_ac": {
                    "type": "string",
                    "description": "UniProt accession (e.g. P04637)",
                },
                "gene": {
                    "type": "string",
                    "description": "Gene symbol; resolved to UniProt via local identity map",
                },
                "position": {
                    "type": "integer",
                    "description": "Optional site position filter",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max interactions to return (default 30)",
                },
            },
            "required": [],
        },
        handler=_iptmnet_ptm_ppi,
    )

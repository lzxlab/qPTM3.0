"""PPI API tools — STRING, BioGRID, IntAct (Stage 4 WHY / interactions).

 complementary to PTMint / iPTMnet (PTM-specific PPIs):
  string_ppi            — scored functional/physical association network
  biogrid_interactions  — curated experimental physical/genetic interactions
  intact_interactions   — IMEx-quality molecular interactions (PSICQUIC)

Citations:
  STRING  PMID 39558183  DOI 10.1093/nar/gkae1113
  BioGRID PMID 33070389  DOI 10.1002/pro.3978
  IntAct  PMID 34761267  DOI 10.1093/nar/gkab1006
"""

from __future__ import annotations

import csv
import io
import logging
import re
from typing import Any
from urllib.parse import quote

import httpx

from app.config import settings
from app.sources.catalog import get_catalog
from app.sources.uniprot_id import resolve_identity
from app.tools.registry import registry

logger = logging.getLogger(__name__)

_ORG_TAXON = {
    "human": 9606,
    "homo sapiens": 9606,
    "mouse": 10090,
    "mus musculus": 10090,
    "rat": 10116,
    "rattus norvegicus": 10116,
    # UniProt / NCBI strain S288C — used for identity and BioGRID/IntAct.
    "yeast": 559292,
    "saccharomyces cerevisiae": 559292,
}

# STRING's species table uses the species-level taxid, not the S288C strain.
_STRING_TAXON_ALIAS = {
    559292: 4932,  # S. cerevisiae S288C → S. cerevisiae
}

_CALLER = "qPTM_agent"


def _taxon(organism: str | int | None) -> int:
    if isinstance(organism, int):
        return organism
    if organism is None or str(organism).strip() == "":
        return 9606
    key = str(organism).strip().lower()
    if key.isdigit():
        return int(key)
    return _ORG_TAXON.get(key, 9606)


def _string_taxon(organism: str | int | None) -> int:
    """NCBI taxid STRING actually indexes (4932, not UniProt's 559292)."""
    tax = _taxon(organism)
    return _STRING_TAXON_ALIAS.get(tax, tax)


def _meta(source_id: str, defaults: dict[str, str]) -> dict[str, Any]:
    m = get_catalog().get(source_id)
    return {
        "source": defaults["name"],
        "access": "api",
        "homepage": (m.homepage if m else None) or defaults["homepage"],
        "pmid": (m.pmid if m else None) or defaults["pmid"],
        "doi": (m.doi if m else None) or defaults["doi"],
    }


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=settings.http_timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": f"{_CALLER}/1.0 (academic research)"},
    )


def _prefer_gene(gene: str | None, uniprot_ac: str | None, organism: str | None) -> tuple[str | None, str | None, dict | None]:
    identity = None
    g = (gene or "").strip() or None
    ac = (uniprot_ac or "").strip().upper() or None
    if g or ac:
        identity = resolve_identity(uniprot_ac=ac, gene=g, organism_id=_taxon(organism))
        if identity:
            g = identity.get("gene") or g
            ac = identity.get("uniprot_ac") or ac
    return g, ac, identity


def _clip(text: str | None, n: int = 180) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) <= n:
        return t
    return t[: n - 1].rsplit(" ", 1)[0] + "…"


def _ppi_summary(source: str, target: str, lines: list[str], total: int) -> str:
    """Readable multi-hit summary (names / methods / effects — not ID-only)."""
    if not lines:
        return f"{source}: no interactions found for {target}."
    head = f"{source}: {total} interaction(s) for {target}:"
    body = " ".join(lines[:6])
    if total > 6:
        body += f" …and {total - 6} more."
    return f"{head} {body}"


# ── STRING ────────────────────────────────────────────────────────

def _string_base() -> str:
    return (settings.string_api_base_url or "https://cn.string-db.org/api").rstrip("/")


def _string_post(method: str, data: dict[str, Any]) -> Any:
    """POST to STRING; fall back across mirrors if Cloudflare blocks."""
    bases = [_string_base()]
    for alt in ("https://cn.string-db.org/api", "https://string-db.org/api"):
        if alt not in bases:
            bases.append(alt)
    last_err = None
    last_status: int | None = None
    for base in bases:
        url = f"{base}/{method.lstrip('/')}"
        try:
            with _client() as client:
                resp = client.post(url, data=data)
                if resp.status_code == 403 and "Just a moment" in resp.text:
                    last_err = f"Cloudflare blocked {base}"
                    last_status = 503
                    continue
                if resp.status_code == 400:
                    last_status = 400
                    body = resp.text[:300].replace("\n", " ")
                    last_err = f"STRING HTTP 400 from {base}: {body}"
                    # Same payload will fail on every mirror; do not burn the fallback.
                    break
                resp.raise_for_status()
                ctype = resp.headers.get("content-type", "")
                if "json" in ctype or resp.text.lstrip().startswith(("[", "{")):
                    return resp.json()
                return resp.text
        except Exception as e:
            last_err = str(e)
            last_status = getattr(getattr(e, "response", None), "status_code", last_status)
            logger.warning("STRING %s via %s failed: %s", method, base, e)
    err = RuntimeError(last_err or "STRING API unavailable")
    setattr(err, "http_status", last_status)
    raise err


def _string_annotations(names: list[str], taxon: int) -> dict[str, str]:
    """Map preferredName → short protein annotation via STRING resolve."""
    uniq = []
    seen: set[str] = set()
    for n in names:
        key = str(n or "").strip()
        if not key or key.upper() in seen:
            continue
        seen.add(key.upper())
        uniq.append(key)
    if not uniq:
        return {}
    try:
        rows = _string_post(
            "json/get_string_ids",
            {
                "identifiers": "\n".join(uniq[:30]),
                "species": taxon,
                "caller_identity": _CALLER,
            },
        )
    except Exception as e:
        logger.warning("STRING annotation resolve failed: %s", e)
        return {}
    out: dict[str, str] = {}
    if not isinstance(rows, list):
        return out
    for r in rows:
        if not isinstance(r, dict):
            continue
        name = str(r.get("preferredName") or r.get("queryItem") or "").strip()
        ann = _clip(r.get("annotation"), 200)
        if name and ann:
            out[name.upper()] = ann
            # Also keep display-cased key for convenience
            out[name] = ann
    return out


def _string_ppi(
    gene: str | None = None,
    uniprot_ac: str | None = None,
    organism: str = "human",
    network_type: str = "functional",
    required_score: int = 400,
    limit: int = 20,
) -> dict[str, Any]:
    """Query STRING interaction partners for a protein."""
    g, ac, identity = _prefer_gene(gene, uniprot_ac, organism)
    identifier = g or ac
    if not identifier:
        return {"error": "Provide gene or uniprot_ac", "summary": "Missing query for STRING"}

    nt = (network_type or "functional").strip().lower()
    if nt not in ("functional", "physical", "regulatory"):
        nt = "functional"
    score = max(0, min(int(required_score or 400), 1000))
    lim = max(1, min(int(limit or 20), 50))
    taxon = _string_taxon(organism)

    try:
        rows = _string_post(
            "json/interaction_partners",
            {
                "identifiers": identifier,
                "species": taxon,
                "required_score": score,
                "limit": lim,
                "network_type": nt,
                "caller_identity": _CALLER,
            },
        )
    except Exception as e:
        err = str(e)
        payload: dict[str, Any] = {"error": err, "summary": f"STRING API failed: {e}"}
        status = getattr(e, "http_status", None)
        if status:
            payload["http_status"] = status
        elif "Cloudflare" in err or "blocked" in err.lower():
            payload["http_status"] = 503
        elif "HTTP 400" in err:
            payload["http_status"] = 400
        return payload

    if not isinstance(rows, list):
        return {"error": "Unexpected STRING response", "summary": "STRING returned non-list data"}

    interactions = []
    for r in rows[:lim]:
        a = r.get("preferredName_A") or r.get("stringId_A")
        b = r.get("preferredName_B") or r.get("stringId_B")
        query_up = (g or identifier or "").upper()
        partner = b if str(a).upper() == query_up else a
        if str(b).upper() == query_up:
            partner = a
        interactions.append({
            "interactor_a": a,
            "interactor_b": b,
            "partner": partner,
            "partner_annotation": None,
            "score": r.get("score"),
            "experimental_score": r.get("escore"),
            "database_score": r.get("dscore"),
            "textmining_score": r.get("tscore"),
            "coexpression_score": r.get("ascore"),
            "network_type": nt,
            "note": None,
            "source_db": "STRING",
            "taxon_id": r.get("ncbiTaxonId") or taxon,
            "url": f"https://string-db.org/network/{taxon}/{partner}" if partner else None,
        })

    anns = _string_annotations(
        [str(i.get("partner")) for i in interactions if i.get("partner")],
        taxon,
    )
    summary_lines: list[str] = []
    for i in interactions:
        partner = str(i.get("partner") or "")
        ann = anns.get(partner) or anns.get(partner.upper())
        if ann:
            i["partner_annotation"] = ann
        sc = i.get("score")
        bits = [f"score={sc}"]
        if i.get("experimental_score"):
            bits.append(f"exp={i['experimental_score']}")
        note = f"{identifier}–{partner} ({', '.join(bits)}; {nt})"
        if ann:
            note += f" — {ann}"
        i["note"] = note
        summary_lines.append(note)

    target = f"{identifier} (taxon {taxon}, score≥{score}, {nt})"
    return {
        "summary": _ppi_summary("STRING", target, summary_lines, len(interactions)),
        "gene": g,
        "uniprot_ac": ac,
        "uniprot_identity": identity,
        "organism": organism,
        "network_type": nt,
        "required_score": score,
        "total": len(interactions),
        "interactions": interactions,
        **_meta("string", {
            "name": "STRING",
            "homepage": "https://string-db.org",
            "pmid": "39558183",
            "doi": "10.1093/nar/gkae1113",
        }),
    }


# ── BioGRID ───────────────────────────────────────────────────────

def _biogrid_interactions(
    gene: str | None = None,
    uniprot_ac: str | None = None,
    organism: str = "human",
    evidence_type: str = "physical",
    limit: int = 30,
) -> dict[str, Any]:
    """Query BioGRID curated interactions (requires BIOGRID_ACCESS_KEY)."""
    key = (settings.biogrid_access_key or "").strip()
    if not key:
        return {
            "error": (
                "BioGRID access key not configured. Register free at "
                "https://webservice.thebiogrid.org/ and set BIOGRID_ACCESS_KEY."
            ),
            "summary": "BioGRID API key missing",
        }

    g, ac, identity = _prefer_gene(gene, uniprot_ac, organism)
    if not g and not ac:
        return {"error": "Provide gene or uniprot_ac", "summary": "Missing query for BioGRID"}

    gene_list = g or ac
    lim = max(1, min(int(limit or 30), 100))
    et = (evidence_type or "physical").strip().lower()
    # tab2 columns (BioGRID REST):
    # 0 BioGRID Interaction ID … 7/8 Official Symbol A/B … 11 Experimental System
    # 12 Experimental System Type … 14 Pubmed ID
    # Note: do NOT pass evidenceList=physical — that param expects evidence codes,
    # not system type; filter physical/genetic client-side on column 12.
    fetch = lim if et in ("all", "any", "") else min(lim * 5, 200)
    params: dict[str, Any] = {
        "accesskey": key,
        "format": "tab2",
        "searchNames": "true",
        "geneList": gene_list,
        "includeInteractors": "true",
        "includeInteractorInteractions": "false",
        "taxId": _taxon(organism),
        "max": fetch,
        "start": 0,
    }

    url = f"{settings.biogrid_api_base_url.rstrip('/')}/interactions/"
    try:
        with _client() as client:
            resp = client.get(url, params=params)
            if resp.status_code in (401, 403):
                return {
                    "error": "BioGRID rejected the access key",
                    "summary": "BioGRID authentication failed",
                }
            if resp.status_code >= 400:
                return {
                    "error": f"BioGRID HTTP {resp.status_code}: {resp.text[:200]}",
                    "summary": f"BioGRID API failed ({resp.status_code})",
                }
            resp.raise_for_status()
            text = resp.text
    except Exception as e:
        logger.error("BioGRID query failed: %s", e, exc_info=True)
        return {"error": str(e), "summary": f"BioGRID API failed: {e}"}

    interactions = []
    for row in csv.reader(io.StringIO(text), delimiter="\t"):
        if not row or row[0].startswith("BioGRID Interaction ID") or len(row) < 15:
            continue
        sys_type = (row[12] or "").strip().lower()
        if et in ("physical", "genetic") and sys_type != et:
            continue
        interactions.append({
            "interactor_a": row[7],
            "interactor_b": row[8],
            "detection_method": row[11],
            "evidence_type": row[12],
            "pmids": [row[14]] if row[14] and row[14].isdigit() else [],
            "note": None,
            "source_db": "BioGRID",
            "biogrid_id": row[0],
            "url": f"https://thebiogrid.org/interaction/{row[0]}" if row[0] else None,
        })
        if len(interactions) >= lim:
            break

    query_up = (g or gene_list or "").upper()
    summary_lines: list[str] = []
    for i in interactions:
        a, b = i.get("interactor_a"), i.get("interactor_b")
        partner = b if str(a).upper() == query_up else a
        if str(b).upper() == query_up:
            partner = a
        i["partner"] = partner
        pmid = (i.get("pmids") or [None])[0]
        note = (
            f"{a}–{b} ({i.get('detection_method') or i.get('evidence_type') or 'interaction'}"
            + (f"; PMID {pmid}" if pmid else "")
            + ")"
        )
        i["note"] = note
        summary_lines.append(note)

    target = f"{gene_list} (taxon {_taxon(organism)}, type={et})"
    return {
        "summary": _ppi_summary("BioGRID", target, summary_lines, len(interactions)),
        "gene": g,
        "uniprot_ac": ac,
        "uniprot_identity": identity,
        "organism": organism,
        "evidence_type": et,
        "total": len(interactions),
        "interactions": interactions,
        **_meta("biogrid", {
            "name": "BioGRID",
            "homepage": "https://thebiogrid.org",
            "pmid": "33070389",
            "doi": "10.1002/pro.3978",
        }),
    }


# ── IntAct (PSICQUIC) ─────────────────────────────────────────────

_MITAB_PUBID = re.compile(r"(?:pubmed|pmid):(\d+)", re.I)
_MITAB_GENE = re.compile(r"(?:gene\s*name|uniprotkb|psi-mi):([^\|;(]+)", re.I)


def _mitab_field_ids(cell: str) -> list[str]:
    out = []
    for part in (cell or "").split("|"):
        part = part.strip()
        if ":" in part:
            out.append(part.split(":", 1)[1].split("(")[0].strip())
        elif part:
            out.append(part)
    return out


def _mitab_best_label(cell: str, aliases: str = "") -> str:
    # Prefer gene name alias
    for src in (aliases, cell):
        for part in (src or "").split("|"):
            low = part.lower()
            if "gene name" in low or low.startswith("uniprotkb:"):
                val = part.split(":", 1)[-1]
                val = val.split("(")[0].strip()
                if val and val.lower() not in ("-", ""):
                    return val
    ids = _mitab_field_ids(cell)
    return ids[0] if ids else (cell or "")[:40]


def _mitab_pmids(cell: str) -> list[str]:
    return list(dict.fromkeys(_MITAB_PUBID.findall(cell or "")))


def _intact_interactions(
    gene: str | None = None,
    uniprot_ac: str | None = None,
    organism: str = "human",
    limit: int = 30,
) -> dict[str, Any]:
    """Query IntAct via PSICQUIC REST (MITAB 2.5)."""
    g, ac, identity = _prefer_gene(gene, uniprot_ac, organism)
    if not ac and not g:
        return {"error": "Provide gene or uniprot_ac", "summary": "Missing query for IntAct"}

    # Prefer UniProt id query for precision
    if ac:
        query = f"id:{ac}"
    else:
        query = f'alias:("{g}") AND species:{_taxon(organism)}'

    lim = max(1, min(int(limit or 30), 100))
    base = settings.intact_api_base_url.rstrip("/")
    url = f"{base}/query/{quote(query)}"
    try:
        with _client() as client:
            resp = client.get(
                url,
                params={"format": "tab25", "firstResult": 0, "maxResults": lim},
            )
            resp.raise_for_status()
            text = resp.text
    except Exception as e:
        logger.error("IntAct query failed: %s", e, exc_info=True)
        return {"error": str(e), "summary": f"IntAct API failed: {e}"}

    if not text.strip():
        return {
            "summary": f"IntAct: 0 interactions for {ac or g}",
            "gene": g,
            "uniprot_ac": ac,
            "uniprot_identity": identity,
            "total": 0,
            "interactions": [],
            **_meta("intact", {
                "name": "IntAct",
                "homepage": "https://www.ebi.ac.uk/intact",
                "pmid": "34761267",
                "doi": "10.1093/nar/gkab1006",
            }),
        }

    reader = csv.reader(io.StringIO(text), delimiter="\t")
    interactions = []
    for row in reader:
        if len(row) < 14:
            continue
        a = _mitab_best_label(row[0], row[4] if len(row) > 4 else "")
        b = _mitab_best_label(row[1], row[5] if len(row) > 5 else "")
        method = row[6] if len(row) > 6 else ""
        itype = row[11] if len(row) > 11 else ""
        pmids = _mitab_pmids(row[8] if len(row) > 8 else "")
        interactions.append({
            "interactor_a": a,
            "interactor_b": b,
            "detection_method": method.split("(")[-1].rstrip(")") if method else method,
            "interaction_type": itype.split("(")[-1].rstrip(")") if itype else itype,
            "pmids": pmids,
            "note": None,
            "source_db": "IntAct",
            "interaction_id": (row[13].split("|")[0] if len(row) > 13 else ""),
            "url": None,
        })

    query_up = (g or ac or "").upper()
    summary_lines: list[str] = []
    for i in interactions:
        a, b = i.get("interactor_a"), i.get("interactor_b")
        partner = b if str(a).upper() == query_up else a
        if str(b).upper() == query_up:
            partner = a
        i["partner"] = partner
        iid = i.get("interaction_id") or ""
        if iid.startswith("intact:"):
            i["url"] = f"https://www.ebi.ac.uk/intact/interaction/{iid.split(':', 1)[1]}"
        pmid = (i.get("pmids") or [None])[0]
        note = (
            f"{a}–{b} ({i.get('interaction_type') or 'interaction'}"
            + (f" via {i['detection_method']}" if i.get("detection_method") else "")
            + (f"; PMID {pmid}" if pmid else "")
            + ")"
        )
        i["note"] = note
        summary_lines.append(note)

    return {
        "summary": _ppi_summary("IntAct", str(ac or g), summary_lines, len(interactions)),
        "gene": g,
        "uniprot_ac": ac,
        "uniprot_identity": identity,
        "organism": organism,
        "total": len(interactions),
        "interactions": interactions,
        **_meta("intact", {
            "name": "IntAct",
            "homepage": "https://www.ebi.ac.uk/intact",
            "pmid": "34761267",
            "doi": "10.1093/nar/gkab1006",
        }),
    }


def register_ppi_api_tools() -> None:
    registry.register(
        name="string_ppi",
        description=(
            "Query STRING for protein association partners (functional / physical / "
            "regulatory networks with confidence scores). Use for Stage 4 WHY when "
            "asking about binding partners or interaction context (not PTM-site specific)."
        ),
        parameters={
            "type": "object",
            "properties": {
                "gene": {"type": "string"},
                "uniprot_ac": {"type": "string"},
                "organism": {
                    "type": "string",
                    "enum": ["human", "mouse", "rat", "yeast"],
                    "description": "Species (default human)",
                },
                "network_type": {
                    "type": "string",
                    "enum": ["functional", "physical", "regulatory"],
                    "description": "STRING network type (default functional)",
                },
                "required_score": {
                    "type": "integer",
                    "description": "Confidence threshold 0–1000 (default 400)",
                },
                "limit": {"type": "integer", "description": "Max partners (default 20)"},
            },
            "required": [],
        },
        handler=_string_ppi,
    )

    registry.register(
        name="biogrid_interactions",
        description=(
            "Query BioGRID for curated experimental protein/genetic interactions "
            "with literature PMIDs. Requires BIOGRID_ACCESS_KEY. Use for Stage 4 WHY "
            "physical/genetic PPI evidence."
        ),
        parameters={
            "type": "object",
            "properties": {
                "gene": {"type": "string"},
                "uniprot_ac": {"type": "string"},
                "organism": {
                    "type": "string",
                    "enum": ["human", "mouse", "rat", "yeast"],
                },
                "evidence_type": {
                    "type": "string",
                    "enum": ["physical", "genetic", "all"],
                    "description": "Default physical",
                },
                "limit": {"type": "integer"},
            },
            "required": [],
        },
        handler=_biogrid_interactions,
    )

    registry.register(
        name="intact_interactions",
        description=(
            "Query IntAct (PSICQUIC) for curated molecular interactions with detection "
            "methods and PMIDs. Use for Stage 4 WHY experimental PPI context."
        ),
        parameters={
            "type": "object",
            "properties": {
                "gene": {"type": "string"},
                "uniprot_ac": {"type": "string"},
                "organism": {
                    "type": "string",
                    "enum": ["human", "mouse", "rat", "yeast"],
                },
                "limit": {"type": "integer"},
            },
            "required": [],
        },
        handler=_intact_interactions,
    )

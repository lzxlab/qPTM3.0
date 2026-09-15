"""UniProt identity helpers — canonical gene / accession resolution.

External databases (e.g. ProteomicsDB) may carry stale gene symbols or protein
names. Always resolve identity via UniProt REST before reporting results.

API: https://rest.uniprot.org
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

from app.config import settings
from app.http_clients import get_uniprot_client

logger = logging.getLogger(__name__)


def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    url = f"{settings.uniprot_api_base_url.rstrip('/')}/{path.lstrip('/')}"
    try:
        resp = get_uniprot_client().get(url, params=params)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning("UniProt identity request failed %s: %s", path, e)
        return None


def _parse_entry(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize a UniProtKB JSON entry into a compact identity record."""
    gene_names: list[str] = []
    synonyms: list[str] = []
    for g in data.get("genes") or []:
        if not isinstance(g, dict):
            continue
        name = g.get("geneName")
        if isinstance(name, dict) and name.get("value"):
            gene_names.append(str(name["value"]))
        elif isinstance(name, str) and name:
            gene_names.append(name)
        for syn in g.get("synonyms") or []:
            if isinstance(syn, dict) and syn.get("value"):
                synonyms.append(str(syn["value"]))
            elif isinstance(syn, str) and syn:
                synonyms.append(syn)

    protein_name = ""
    desc = data.get("proteinDescription") or {}
    if isinstance(desc, dict):
        rec = desc.get("recommendedName") or {}
        if isinstance(rec, dict):
            full = rec.get("fullName") or {}
            protein_name = full.get("value", "") if isinstance(full, dict) else str(full or "")

    organism = ""
    org = data.get("organism") or {}
    if isinstance(org, dict):
        organism = org.get("scientificName") or ""
        taxon = org.get("taxonId")
    else:
        taxon = None

    return {
        "uniprot_ac": data.get("primaryAccession") or "",
        "entry_name": data.get("uniProtkbId") or "",
        "gene": gene_names[0] if gene_names else None,
        "gene_names": gene_names,
        "gene_synonyms": synonyms,
        "protein_name": protein_name or None,
        "organism": organism or None,
        "taxon_id": taxon,
        "reviewed": (data.get("entryType") or "").lower().find("reviewed") >= 0
        or data.get("entryType") == "UniProtKB reviewed (Swiss-Prot)",
        "source": "UniProt",
        "url": f"https://www.uniprot.org/uniprotkb/{data.get('primaryAccession') or ''}",
    }


def normalize_uniprot_ac(uniprot_ac: str | None) -> str | None:
    """Canonical base accession (strip isoform suffix ``-N``)."""
    ac = (uniprot_ac or "").strip().upper()
    if not ac:
        return None
    return ac.split("-")[0]


def _lookup_by_accession_uncached(uniprot_ac: str) -> dict[str, Any] | None:
    ac = (uniprot_ac or "").strip().upper()
    if not ac:
        return None
    data = _get(f"uniprotkb/{ac}", params={"format": "json"})
    if not data and "-" in ac:
        data = _get(f"uniprotkb/{ac.split('-')[0]}", params={"format": "json"})
    if not data:
        return None
    return _parse_entry(data)


@lru_cache(maxsize=512)
def _lookup_by_accession_cached(uniprot_ac: str) -> str:
    ident = _lookup_by_accession_uncached(uniprot_ac)
    return json.dumps(ident, sort_keys=True) if ident else ""


def lookup_by_accession(uniprot_ac: str) -> dict[str, Any] | None:
    """Fetch canonical identity for a UniProt accession."""
    ac = (uniprot_ac or "").strip().upper()
    if not ac:
        return None
    raw = _lookup_by_accession_cached(ac)
    return json.loads(raw) if raw else None


def _lookup_by_gene_uncached(
    gene: str,
    *,
    organism_id: int = 9606,
    reviewed_only: bool = True,
) -> dict[str, Any] | None:
    symbol = (gene or "").strip()
    if not symbol:
        return None
    safe = symbol.replace("'", "")
    parts = [f"gene_exact:{safe}", f"organism_id:{organism_id}"]
    if reviewed_only:
        parts.append("reviewed:true")
    data = _get(
        "uniprotkb/search",
        params={"query": " AND ".join(parts), "format": "json", "size": "5"},
    )
    if not data:
        return None
    results = data.get("results") or []
    if not results and reviewed_only:
        return _lookup_by_gene_uncached(gene, organism_id=organism_id, reviewed_only=False)
    if not results:
        syn_parts = [
            f"(gene_exact:{safe} OR gene_synonym:{safe})",
            f"organism_id:{organism_id}",
        ]
        if reviewed_only:
            syn_parts.append("reviewed:true")
        data = _get(
            "uniprotkb/search",
            params={"query": " AND ".join(syn_parts), "format": "json", "size": "5"},
        )
        results = (data or {}).get("results") or []
        if not results and reviewed_only:
            return _lookup_by_gene_synonym_uncached(
                gene, organism_id=organism_id, reviewed_only=False,
            )
    if not results:
        return None
    return _parse_entry(results[0])


def _lookup_by_gene_synonym_uncached(
    gene: str,
    *,
    organism_id: int = 9606,
    reviewed_only: bool = True,
) -> dict[str, Any] | None:
    symbol = (gene or "").strip()
    if not symbol:
        return None
    safe = symbol.replace("'", "")
    parts = [
        f"(gene_exact:{safe} OR gene_synonym:{safe})",
        f"organism_id:{organism_id}",
    ]
    if reviewed_only:
        parts.append("reviewed:true")
    data = _get(
        "uniprotkb/search",
        params={"query": " AND ".join(parts), "format": "json", "size": "5"},
    )
    results = (data or {}).get("results") or []
    if not results:
        return None
    return _parse_entry(results[0])


@lru_cache(maxsize=512)
def _lookup_by_gene_cached(gene: str, organism_id: int, reviewed_only: bool) -> str:
    ident = _lookup_by_gene_uncached(
        gene, organism_id=organism_id, reviewed_only=reviewed_only,
    )
    return json.dumps(ident, sort_keys=True) if ident else ""


def lookup_by_gene(
    gene: str,
    *,
    organism_id: int = 9606,
    reviewed_only: bool = True,
) -> dict[str, Any] | None:
    """Resolve gene symbol → UniProt accession (human SwissProt by default)."""
    symbol = (gene or "").strip()
    if not symbol:
        return None
    raw = _lookup_by_gene_cached(symbol, organism_id, reviewed_only)
    return json.loads(raw) if raw else None


_ORGANISM_IDS: dict[str, int] = {
    "human": 9606,
    "homo sapiens": 9606,
    "9606": 9606,
    "mouse": 10090,
    "mus musculus": 10090,
    "10090": 10090,
    "rat": 10116,
    "rattus norvegicus": 10116,
    "10116": 10116,
    "yeast": 559292,
    "saccharomyces cerevisiae": 559292,
    "559292": 559292,
}


def organism_id_for(organism: str | None, default: int = 9606) -> int:
    """Map organism name / taxon string → NCBI taxonomy id."""
    if organism is None:
        return default
    key = str(organism).strip().lower()
    if not key:
        return default
    return _ORGANISM_IDS.get(key, default)


def _norm_gene(symbol: str | None) -> str:
    return str(symbol or "").strip().upper()


def gene_matches_identity(gene: str | None, identity: dict[str, Any] | None) -> bool:
    """True when ``gene`` is the primary symbol or a listed synonym of ``identity``."""
    target = _norm_gene(gene)
    if not target or not identity:
        return False
    names = [
        identity.get("gene"),
        *(identity.get("gene_names") or []),
        *(identity.get("gene_synonyms") or []),
    ]
    return any(_norm_gene(n) == target for n in names if n)


def resolve_identity(
    *,
    uniprot_ac: str | None = None,
    gene: str | None = None,
    organism_id: int = 9606,
) -> dict[str, Any] | None:
    """Resolve protein identity.

    If both gene and accession are given, they must refer to the same protein.
    A mismatched accession is discarded and the gene is re-resolved.
    """
    ac_norm = normalize_uniprot_ac(uniprot_ac) if uniprot_ac else None
    ident_ac: dict[str, Any] | None = None
    if ac_norm:
        ident_ac = lookup_by_accession(ac_norm)

    if gene and ident_ac:
        if gene_matches_identity(gene, ident_ac):
            return ident_ac
        logger.warning(
            "gene/uniprot mismatch: gene=%s accession=%s identity_gene=%s — resolving by gene",
            gene,
            ac_norm,
            ident_ac.get("gene"),
        )
        ident_ac = None

    if ident_ac and not gene:
        return ident_ac

    if gene:
        ident_gene = lookup_by_gene(gene, organism_id=organism_id)
        if ident_gene:
            return ident_gene

    return ident_ac

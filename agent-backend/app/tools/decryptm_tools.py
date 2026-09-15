"""decryptM tools — drug–PTM dose-response curves (local + ProteomicsDB API).

Stage 3 (drug) tool:
  decryptm_drug_ptm — query drug-regulated PTMs (phospho/ubiquitin/acetyl)
    Local index (tables/curves.tsv) is queried first; ProteomicsDB API supplements.

Paper: Zecha et al., Science 2023 (PMID 36926954, DOI 10.1126/science.ade3925)
UI: https://www.proteomicsdb.org/decryptm
"""

from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any

import httpx

from app.config import settings
from app.sources.build_index import index_path_for
from app.sources.catalog import get_catalog
from app.sources.query import index_exists
from app.sources.uniprot_id import resolve_identity
from app.tools.registry import registry

logger = logging.getLogger(__name__)

_HOST_DEFAULT = "https://www.proteomicsdb.org"
_ODATA = "/proteomicsdb/logic/api_v2/api.xsodata"
_PROTEIN_PTM = "/proteomicsdb/logic/proteincentric/getDDPTMProtein.xsjs"
_DRUG_PTM = "/proteomicsdb/logic/drugcentric/getDDPTMDrug.xsjs"
_DRUG_SEARCH = "/proteomicsdb/logic/drugSearchEndpoint.xsodata/InputParams(SEARCH_STR='{q}',ED_SCOPE='')/Results"

_COMPACT = (
    "gene", "uniprot", "site", "modification", "regulation", "fold_change",
    "log_ic50", "r2", "log_p_value", "drug", "cell_line", "experiment",
    "sequence", "functional_score", "start_position", "end_position",
)


def _host() -> str:
    return (settings.proteomicsdb_api_base_url or _HOST_DEFAULT).rstrip("/")


def _meta() -> dict[str, str]:
    m = get_catalog().get("decryptm")
    return {
        "homepage": m.homepage if m else "https://www.proteomicsdb.org/decryptm",
        "pmid": m.pmid if m else "36926954",
        "doi": m.doi if m else "10.1126/science.ade3925",
        "api_docs": "https://www.proteomicsdb.org/api",
    }


def _client() -> httpx.Client:
    # Cap remote wait so intent-level parallel runs do not stall on dense proteins.
    timeout = min(max(float(settings.http_timeout_seconds), 30.0), 60.0)
    return httpx.Client(timeout=timeout, follow_redirects=True)


def _get_json(path: str, *, params: dict[str, Any] | None = None) -> Any:
    url = f"{_host()}{path}"
    with _client() as client:
        resp = client.get(url, params=params, headers={"Accept": "application/json"})
        resp.raise_for_status()
        return resp.json()


def _resolve_protein_id(
    *,
    uniprot_ac: str | None = None,
    gene: str | None = None,
) -> dict[str, Any] | None:
    """Map UniProt accession → ProteomicsDB PROTEIN_ID.

    Always prefer accession (from UniProt identity). Gene-only lookup against
    ProteomicsDB is a last resort — PDB gene symbols can be stale (e.g. FFR vs VPS51).
    """
    clauses = ["TAXCODE eq 9606", "DECOY eq 0"]
    if uniprot_ac:
        clauses.append(f"UNIQUE_IDENTIFIER eq '{uniprot_ac.strip().upper()}'")
        clauses.append("DATABASE eq 'sp'")
    elif gene:
        clauses.append(f"GENE_NAME eq '{gene.strip().upper()}'")
        clauses.append("DATABASE eq 'sp'")
    else:
        return None

    data = _get_json(
        f"{_ODATA}/Protein",
        params={
            "$format": "json",
            "$filter": " and ".join(clauses),
            "$top": "10",
            "$select": (
                "PROTEIN_ID,UNIQUE_IDENTIFIER,GENE_NAME,PROTEIN_NAME,"
                "ENTRY_NAME,DATABASE,PARENT_PROTEIN_ID"
            ),
        },
    )
    results = (data.get("d") or data).get("results") or data.get("value") or []

    if not results and uniprot_ac:
        # retry without DATABASE filter
        data = _get_json(
            f"{_ODATA}/Protein",
            params={
                "$format": "json",
                "$filter": (
                    f"TAXCODE eq 9606 and DECOY eq 0 and "
                    f"UNIQUE_IDENTIFIER eq '{uniprot_ac.strip().upper()}'"
                ),
                "$top": "10",
            },
        )
        results = (data.get("d") or data).get("results") or []

    if not results:
        return None

    def _rank(p: dict[str, Any]) -> tuple:
        db = (p.get("DATABASE") or "").lower()
        acc = p.get("UNIQUE_IDENTIFIER") or ""
        parent = p.get("PARENT_PROTEIN_ID")
        pid = p.get("PROTEIN_ID")
        is_sp = 0 if db == "sp" else 1
        is_canonical = 0 if parent in (None, pid) else 1
        is_short = 0 if len(acc) == 6 else 1
        return (is_sp, is_canonical, is_short, acc)

    return sorted(results, key=_rank)[0]


def _local_row_to_api_shape(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize a local curves.tsv / SQLite row to API-like field names."""
    reg = (row.get("regulation") or "").strip()
    if reg == "-":
        reg = "-"
    return {
        "UNIPROT_ACC": row.get("uniprot") or row.get("protein"),
        "GENE_NAME": row.get("gene"),
        "MOD_RSD": row.get("site"),
        "POSITION": row.get("position"),
        "MODIFICATION_TYPE": row.get("ptm_type"),
        "REGULATION": reg,
        "DRUG_NAME": row.get("drug"),
        "CELLLINE_NAME": row.get("cell"),
        "EXPERIMENT_NAME": row.get("experiment"),
        "LOG_IC50": row.get("pec50"),
        "MOD_SEQUENCE": row.get("modified_sequence"),
        "PROTEIN_NAME": row.get("protein_name"),
        "_data_source": "local",
    }


def _query_local_curves(
    *,
    uniprot_ac: str | None = None,
    gene: str | None = None,
    drug: str | None = None,
    only_regulated: bool = False,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Query local decryptM SQLite index."""
    manifest = get_catalog().require("decryptm")
    meta = manifest.file_by_id("curves")
    if meta is None:
        return []
    path = index_path_for(manifest, meta)
    if not path.exists():
        return []

    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        where: list[str] = []
        params: list[Any] = []
        if uniprot_ac:
            where.append('UPPER("uniprot") = ?')
            params.append(uniprot_ac.strip().upper())
        elif gene:
            where.append('UPPER("gene") = ?')
            params.append(gene.strip().upper())
        elif drug:
            where.append('UPPER("drug") LIKE ?')
            params.append(f"%{drug.strip().upper()}%")
        else:
            return []

        if drug and (uniprot_ac or gene):
            where.append('UPPER("drug") LIKE ?')
            params.append(f"%{drug.strip().upper()}%")

        if only_regulated:
            where.append('LOWER("regulation") IN ("up", "down")')

        sql = f'SELECT * FROM records WHERE {" AND ".join(where)} LIMIT ?'
        params.append(max(limit, 50))
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        return [_local_row_to_api_shape(r) for r in rows]
    finally:
        conn.close()


def _fetch_api_curves(
    *,
    gene: str | None,
    uniprot_ac: str | None,
    drug: str | None,
    identity: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], str, str | None, dict[str, Any] | None, list[str]]:
    """Fetch dose-response curves from ProteomicsDB API."""
    notes: list[str] = []
    protein_info = None
    query_mode = ""
    resolved_drug = drug
    raw: list[dict[str, Any]] = []

    if gene or uniprot_ac:
        if not identity:
            identity = resolve_identity(uniprot_ac=uniprot_ac, gene=gene)
        if not identity:
            return [], "protein", resolved_drug, protein_info, notes

        canon_ac = identity["uniprot_ac"]
        canon_gene = identity.get("gene")
        protein_info = _resolve_protein_id(uniprot_ac=canon_ac)
        if not protein_info:
            notes.append(
                f"ProteomicsDB has no protein entry for UniProt {canon_ac}; "
                "using local data only."
            )
            return [], "protein", resolved_drug, protein_info, notes

        pdb_gene = protein_info.get("GENE_NAME")
        if pdb_gene and canon_gene and str(pdb_gene).upper() != str(canon_gene).upper():
            notes.append(
                f"ProteomicsDB labels {canon_ac} as '{pdb_gene}' (stale); "
                f"UniProt gene is '{canon_gene}'."
            )

        pid = protein_info["PROTEIN_ID"]
        query_mode = "protein"
        raw = _get_json(_PROTEIN_PTM, params={"proteinId": pid})
        if not isinstance(raw, list):
            raw = []
        for r in raw:
            r["_data_source"] = "api"
        if drug:
            resolved_drug = _resolve_drug_name(drug)
    else:
        query_mode = "drug"
        resolved_drug = _resolve_drug_name(drug or "")
        raw = _get_json(_DRUG_PTM, params={"drugName": resolved_drug})
        if not isinstance(raw, list):
            raw = []
        for r in raw:
            r["_data_source"] = "api"

    return raw, query_mode, resolved_drug, protein_info, notes


def _dedupe_key(row: dict[str, Any]) -> tuple:
    return (
        str(row.get("UNIPROT_ACC") or row.get("uniprot") or "").upper(),
        str(row.get("DRUG_NAME") or row.get("drug") or "").upper(),
        str(row.get("MOD_RSD") or row.get("site") or row.get("POSITION") or ""),
        str(row.get("CELLLINE_NAME") or row.get("cell") or "").upper(),
    )


def _merge_curves(api_rows: list[dict[str, Any]], local_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge API + local; API rows win on duplicate keys."""
    seen: set[tuple] = set()
    merged: list[dict[str, Any]] = []
    for row in api_rows + local_rows:
        key = _dedupe_key(row)
        if key in seen:
            continue
        seen.add(key)
        merged.append(row)
    return merged


def _annotate_curve(row: dict[str, Any], identity: dict[str, Any] | None) -> dict[str, Any]:
    """Compact a decryptM row; overwrite gene/protein with UniProt identity when available."""
    out = _compact_row(row)
    if row.get("_data_source"):
        out["data_source"] = row["_data_source"]
    if identity:
        out["gene"] = identity.get("gene") or out.get("gene")
        out["uniprot"] = identity.get("uniprot_ac") or out.get("uniprot")
        out["protein_name"] = identity.get("protein_name") or out.get("protein_name")
        pdb_gene = row.get("GENE_NAME")
        if pdb_gene and identity.get("gene") and str(pdb_gene).upper() != str(identity["gene"]).upper():
            out["proteomicsdb_gene_stale"] = pdb_gene
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def _resolve_drug_name(drug: str) -> str:
    """Best-effort canonicalize drug name via ProteomicsDB drug search."""
    q = drug.strip().replace("'", "")
    if not q:
        return drug
    try:
        path = _DRUG_SEARCH.format(q=q)
        data = _get_json(path, params={"$format": "json", "$top": "5"})
        results = (data.get("d") or {}).get("results") or []
        if results:
            return results[0].get("DRUG_NAME") or drug
    except Exception as e:
        logger.warning("decryptM drug search failed for %s: %s", drug, e)
    return drug


def _site_positions(row: dict[str, Any]) -> list[int]:
    positions: list[int] = []
    pos = row.get("POSITION")
    if pos not in (None, ""):
        try:
            positions.append(int(pos))
        except (TypeError, ValueError):
            pass
    mod_rsd = row.get("MOD_RSD") or row.get("site") or ""
    for m in re.finditer(r"[A-Za-z]+(\d+)", str(mod_rsd)):
        positions.append(int(m.group(1)))
    for key in ("START_POSITION", "END_POSITION"):
        v = row.get(key)
        if v is not None:
            try:
                positions.append(int(v))
            except (TypeError, ValueError):
                pass
    return positions


def _compact_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {
        "gene": row.get("GENE_NAME"),
        "uniprot": row.get("UNIPROT_ACC") or row.get("ACC_ID"),
        "site": row.get("MOD_RSD"),
        "modification": row.get("MODIFICATION_TYPE"),
        "regulation": row.get("REGULATION"),
        "fold_change": row.get("FOLD_CHANGE"),
        "log_ic50": row.get("LOG_IC50"),
        "r2": row.get("R2"),
        "log_p_value": row.get("LOG_P_VALUE"),
        "drug": row.get("DRUG_NAME"),
        "cell_line": row.get("CELLLINE_NAME"),
        "experiment": row.get("EXPERIMENT_NAME"),
        "sequence": row.get("MOD_SEQUENCE") or row.get("SEQUENCE"),
        "functional_score": row.get("FUNCTIONAL_SCORES"),
        "start_position": row.get("START_POSITION"),
        "end_position": row.get("END_POSITION"),
        "position": row.get("POSITION"),
    }
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def _rank_key(row: dict[str, Any]) -> tuple:
    reg = (row.get("REGULATION") or "").lower()
    regulated = 0 if reg in ("up", "down") else 1
    try:
        fc = abs(float(row.get("FOLD_CHANGE") or 0))
    except (TypeError, ValueError):
        fc = 0.0
    try:
        lp = float(row.get("LOG_P_VALUE") or 0)
    except (TypeError, ValueError):
        lp = 0.0
    return (regulated, -fc, -lp)


def _filter_rows(
    rows: list[dict[str, Any]],
    *,
    drug: str | None,
    cell_line: str | None,
    modification_type: str | None,
    only_regulated: bool,
    site_position: int | None,
    gene: str | None,
    uniprot_ac: str | None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    drug_u = (drug or "").strip().upper()
    cell_u = (cell_line or "").strip().upper()
    mod_u = (modification_type or "").strip().upper()
    gene_u = (gene or "").strip().upper()
    acc_u = (uniprot_ac or "").strip().upper()

    for row in rows:
        if only_regulated and (row.get("REGULATION") or "").lower() not in ("up", "down"):
            continue
        if drug_u:
            dn = (row.get("DRUG_NAME") or "").upper()
            if drug_u not in dn and dn not in drug_u:
                continue
        if cell_u:
            cn = (row.get("CELLLINE_NAME") or "").upper()
            if cell_u not in cn:
                continue
        if mod_u and mod_u not in ("ALL", ""):
            mt = (row.get("MODIFICATION_TYPE") or "").upper()
            # accept Phospho / phosphorylation / Ubiquitin / Acetyl aliases
            aliases = {
                "PHOSPHO": ("PHOSPHO", "PHOSPHORYLATION", "P"),
                "PHOSPHORYLATION": ("PHOSPHO", "PHOSPHORYLATION"),
                "UBIQUITIN": ("UBIQUITIN", "UB", "GG"),
                "ACETYL": ("ACETYL", "ACETYLATION"),
                "ACETYLATION": ("ACETYL", "ACETYLATION"),
            }
            ok = False
            for key, vals in aliases.items():
                if mod_u.startswith(key[:5]) or mod_u in vals:
                    if any(v in mt for v in vals) or mt in vals:
                        ok = True
                        break
            if not ok and mod_u not in mt:
                continue
        if gene_u and (row.get("GENE_NAME") or "").upper() != gene_u:
            # protein-centric rows may omit GENE_NAME
            if row.get("GENE_NAME"):
                continue
        if acc_u:
            acc = (row.get("UNIPROT_ACC") or row.get("ACC_ID") or "").upper()
            if acc_u not in acc:
                continue
        if site_position is not None:
            if site_position not in _site_positions(row):
                continue
        out.append(row)
    out.sort(key=_rank_key)
    return out


def _decryptm_drug_ptm(
    gene: str | None = None,
    uniprot_ac: str | None = None,
    drug: str | None = None,
    cell_line: str | None = None,
    modification_type: str | None = None,
    site_position: int | None = None,
    only_regulated: bool = True,
    limit: int = 30,
) -> dict[str, Any]:
    """Query decryptM drug–PTM dose-response (local index + ProteomicsDB API)."""
    if not any([gene, uniprot_ac, drug]):
        return {
            "error": "Provide at least one of: gene, uniprot_ac, drug",
            "summary": "Missing query key for decryptM",
        }

    identity: dict[str, Any] | None = None
    protein_info = None
    query_mode = ""
    resolved_drug = drug
    notes: list[str] = []
    local_raw: list[dict[str, Any]] = []
    api_raw: list[dict[str, Any]] = []

    try:
        if gene or uniprot_ac:
            identity = resolve_identity(uniprot_ac=uniprot_ac, gene=gene)
            if not identity:
                return {
                    "error": (
                        f"Protein not found in UniProt for gene={gene} "
                        f"uniprot={uniprot_ac}"
                    ),
                    "summary": "decryptM: UniProt identity resolution failed",
                    **_meta(),
                }
            uniprot_ac = identity["uniprot_ac"]
            gene = identity.get("gene")

        if index_exists("decryptm", "curves"):
            local_raw = _query_local_curves(
                uniprot_ac=uniprot_ac,
                gene=gene,
                drug=drug,
                only_regulated=only_regulated,
                limit=max(limit * 20, 200),
            )

        # Remote API only when local index has no rows for this target.
        use_api = not local_raw
        if use_api:
            try:
                api_raw, query_mode, resolved_drug, protein_info, api_notes = _fetch_api_curves(
                    gene=gene,
                    uniprot_ac=uniprot_ac,
                    drug=drug,
                    identity=identity,
                )
                notes.extend(api_notes)
            except httpx.HTTPError as e:
                logger.error("decryptM API error: %s", e)
                if not local_raw:
                    return {
                        "error": f"ProteomicsDB API error: {e}",
                        "summary": f"decryptM API request failed: {e}",
                        **_meta(),
                    }
                notes.append(f"ProteomicsDB API unavailable ({e}); showing local data only.")
        elif drug:
            query_mode = "drug"
            resolved_drug = drug

        raw = _merge_curves(api_raw, local_raw)
        if not query_mode:
            query_mode = "protein" if (gene or uniprot_ac) else "drug"

    except Exception as e:
        logger.error("decryptM query failed: %s", e)
        return {"error": str(e), "summary": f"decryptM query failed: {e}", **_meta()}

    filtered = _filter_rows(
        raw,
        drug=resolved_drug if query_mode == "protein" else drug,
        cell_line=cell_line,
        modification_type=modification_type,
        only_regulated=only_regulated,
        site_position=site_position,
        gene=gene if query_mode == "drug" else None,
        uniprot_ac=uniprot_ac if query_mode == "drug" else None,
    )

    keep = filtered[: max(1, min(limit, 80))]
    up_n = sum(1 for r in filtered if (r.get("REGULATION") or "").lower() == "up")
    down_n = sum(1 for r in filtered if (r.get("REGULATION") or "").lower() == "down")
    local_n = sum(1 for r in filtered if r.get("_data_source") == "local")
    api_n = sum(1 for r in filtered if r.get("_data_source") == "api")

    keys = []
    if gene:
        keys.append(f"gene={gene}")
    if uniprot_ac:
        keys.append(f"uniprot={uniprot_ac}")
    if resolved_drug or drug:
        keys.append(f"drug={resolved_drug or drug}")
    if cell_line:
        keys.append(f"cell_line={cell_line}")
    if site_position is not None:
        keys.append(f"site={site_position}")
    if modification_type:
        keys.append(f"mod={modification_type}")

    if local_raw and api_raw:
        access = "hybrid"
    elif local_raw:
        access = "local"
    else:
        access = "api"

    summary = (
        f"decryptM: {len(keep)} of {len(filtered)} filtered curve(s) for "
        f"{', '.join(keys) or 'query'} "
        f"(local={len(local_raw)}, api={len(api_raw)}, merged={len(raw)}, "
        f"up={up_n}, down={down_n}, only_regulated={only_regulated}; "
        f"mode={query_mode}, access={access}). "
        f"Identity from UniProt when available (Science 2023)."
    )
    if notes:
        summary += " " + " ".join(notes)
    if not keep:
        summary += " No matching PTM dose-response curves."

    result: dict[str, Any] = {
        "summary": summary,
        "gene": gene,
        "uniprot_ac": uniprot_ac,
        "protein_name": (identity or {}).get("protein_name"),
        "drug": resolved_drug or drug,
        "cell_line": cell_line,
        "modification_type": modification_type,
        "site_position": site_position,
        "only_regulated": only_regulated,
        "query_mode": query_mode,
        "local_count": len(local_raw),
        "api_count": len(api_raw),
        "raw_count": len(raw),
        "filtered_count": len(filtered),
        "filtered_local": local_n,
        "filtered_api": api_n,
        "total": len(keep),
        "curves": [_annotate_curve(r, identity) for r in keep],
        "uniprot_identity": identity,
        "source": "decryptM",
        "access": access,
        "explore_url": "https://www.proteomicsdb.org/decryptm",
        **_meta(),
    }
    if protein_info:
        result["proteomicsdb_protein_id"] = protein_info.get("PROTEIN_ID")
        result["proteomicsdb_gene_label"] = protein_info.get("GENE_NAME")
    if notes:
        result["notes"] = notes
    return result


def register_decryptm_tools() -> None:
    registry.register(
        name="decryptm_drug_ptm",
        description=(
            "Query decryptM for drug–PTM dose-response curves "
            "(Zecha et al., Science 2023; PMID 36926954). Local index (~1.3M rows) "
            "is queried first; ProteomicsDB API supplements aggregated curves. "
            "Covers phospho, ubiquitin and acetyl across cancer drugs × cell lines."
        ),
        parameters={
            "type": "object",
            "properties": {
                "gene": {"type": "string", "description": "Gene symbol (e.g. EGFR)"},
                "uniprot_ac": {"type": "string", "description": "UniProt accession"},
                "drug": {"type": "string", "description": "Drug name (e.g. Gefitinib)"},
                "cell_line": {"type": "string", "description": "Cell line filter (e.g. A431)"},
                "modification_type": {
                    "type": "string",
                    "description": "Phospho / Ubiquitin / Acetyl (optional)",
                },
                "site_position": {"type": "integer"},
                "only_regulated": {
                    "type": "boolean",
                    "description": "If true (default), keep only up/down regulated curves",
                },
            },
            "required": [],
        },
        handler=_decryptm_drug_ptm,
    )

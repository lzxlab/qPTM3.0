"""qPTM MCP tool implementations — resolve target, map args, invoke tools."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.sources.uniprot_id import (
    gene_matches_identity,
    lookup_by_accession,
    organism_id_for,
    resolve_identity,
)
from app.tools.registry import registry
from app.mcp.tool_args import infer_tool_arguments, parse_query_entities

logger = logging.getLogger(__name__)

_ENTITY_TOOL_MAP: dict[str, list[str]] = {
    "site": ["qptm_search", "qptm_site_conditions", "uniprot_annotation"],
    "kinase": ["qptm_kinases", "iptmnet_enzymes", "psp_kinase_substrate", "gps6_kinases"],
    "condition": ["qptm_site_conditions", "qptm_search", "ekpi_quantitative"],
    "disease": ["ptmd_disease", "psp_disease_sites", "activedriver_mutations", "cancerproteome_disease"],
    "drug": ["pmads_drug_ptm", "drugbank_targets", "decryptm_drug_ptm"],
    "localization": ["compartments_localization", "inuloc_nls_nes", "interpro_domains"],
    "function": ["psp_regulatory", "ptm_stability", "funcscore_phosphosite", "ptmcode_associations"],
    "pathway": ["reactome_pathways", "kegg_pathways", "pathbank_pathways"],
    "ppi": ["string_ppi", "iptmnet_ptm_ppi", "ptmint_ppi"],
    "llps": ["ptmphase_llps", "dscope_predictions"],
    "literature": [
        "pubtator_literature_search",
        "pubmed_esearch",
        "europepmc_literature_search",
        "pubmed_fetch_abstracts",
        "pubmed_fetch_fulltext",
    ],
}

# Tools that typically need UniProt AC (after gene→AC resolve).
_NEEDS_UNIPROT = {
    "qptm_kinases",
    "qptm_site_conditions",
    "uniprot_annotation",
    "psp_regulatory",
    "psp_kinase_substrate",
    "psp_disease_sites",
    "psp_ptmvar",
    "iptmnet_enzymes",
    "iptmnet_ptm_ppi",
    "interpro_domains",
    "pfam_domains",
    "compartments_localization",
    "inuloc_nls_nes",
    "ptm_stability",
    "funcscore_phosphosite",
    "dbptm_functional",
    "gps6_kinases",
    "ekpi_kinases",
    "ekpi_quantitative",
    "ptmd_disease",
    "cancerproteome_disease",
}

_NEEDS_POSITION = {
    "qptm_kinases",
    "qptm_site_conditions",
    "psp_regulatory",
    "funcscore_phosphosite",
    "ptm_stability",
    "ekpi_quantitative",
}


def _dump(payload: dict[str, Any], limit: int = 12000) -> str:
    """Serialize a tool envelope. Never cut mid-JSON; shrink ``data`` if needed."""
    raw = json.dumps(payload, ensure_ascii=False, default=str)
    if len(raw) <= limit:
        return raw
    out = dict(payload)
    data = out.get("data")
    if data is not None:
        data_s = json.dumps(data, ensure_ascii=False, default=str)
        keep = max(400, limit - 2500)
        out["data"] = {"truncated": True, "preview": data_s[:keep]}
    summary = str(out.get("summary") or "")
    if len(summary) > 800:
        out["summary"] = summary[:800]
    raw = json.dumps(out, ensure_ascii=False, default=str)
    if len(raw) > limit:
        out["data"] = {"truncated": True}
        raw = json.dumps(out, ensure_ascii=False, default=str)
    return raw


def _error(
    summary: str,
    *,
    error_kind: str,
    missing: list[str] | None = None,
    data: Any = None,
) -> str:
    return _dump(
        {
            "success": False,
            "error_kind": error_kind,
            "summary": summary,
            "missing": missing or [],
            "data": data,
        }
    )


def _looks_like_residue_token(token: str | None) -> bool:
    return bool(token and re.fullmatch(r"[STYKR]\d{2,5}", str(token).strip(), re.I))


def _infer_gene_position(query: str, gene: str | None, position: int | None) -> tuple[str | None, int | None]:
    g = gene if gene and not _looks_like_residue_token(str(gene)) else None
    p = position
    if not g:
        # Prefer colloquial p53 before scanning ALL-CAPS tokens (S15 would otherwise win).
        if re.search(r"\btrp53\b", query or "", re.I) or (
            re.search(r"\bp53\b", query or "", re.I)
            and re.search(r"小鼠|\bmouse\b", query or "", re.I)
        ):
            g = "Trp53"
        elif re.search(r"\bp53\b", query or "", re.I):
            g = "TP53"
        else:
            for m in re.finditer(r"\b([A-Z][A-Z0-9]{1,9})\b", query or ""):
                tok = m.group(1)
                if not _looks_like_residue_token(tok):
                    g = tok
                    break
    if not p:
        m = re.search(r"\b[STYKR](\d{2,5})\b", query or "", re.I)
        if m:
            p = int(m.group(1))
    return g, p


def _build_entities(args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query") or "")
    entities = parse_query_entities(query)
    entities["query"] = query
    for key in ("gene", "uniprot_ac", "position", "ptm_type", "pmid", "organism", "entity"):
        val = args.get(key)
        if val not in (None, "", 0, "0"):
            entities[key] = val
    # Normalize types
    if entities.get("position") is not None:
        try:
            entities["position"] = int(entities["position"])
        except (TypeError, ValueError):
            entities.pop("position", None)
    if entities.get("uniprot_ac"):
        entities["uniprot_ac"] = str(entities["uniprot_ac"]).upper()
    if entities.get("gene"):
        entities["gene"] = str(entities["gene"]).strip()
        if _looks_like_residue_token(entities["gene"]):
            entities["gene"] = None
    return entities


def _local_resolve_from_qptm(gene: str, organism: str = "human") -> dict[str, Any] | None:
    """Fallback: gene → UniProt AC from qPTM search (no UniProt REST).

    Only accept hits whose gene symbol matches ``gene`` so STAT3 cannot
    pick up a leftover TP53 accession.
    """
    want = str(gene or "").strip().upper()
    if not want:
        return None
    try:
        result = registry.execute(
            "qptm_search",
            {"query": gene, "field": "gene", "organism": organism or "human", "per_page": 10},
        )
    except Exception as exc:
        logger.warning("local qPTM resolve failed: %s", exc)
        return None
    if not isinstance(result, dict):
        return None
    for event in result.get("events") or []:
        if not isinstance(event, dict):
            continue
        ev_gene = str(event.get("gene") or "").strip().upper()
        if ev_gene and ev_gene != want:
            continue
        ac = event.get("uniprot_ac") or event.get("uniprot") or event.get("up")
        if not ac:
            continue
        return {
            "uniprot_ac": str(ac).upper(),
            "gene": event.get("gene") or gene,
            "protein_name": event.get("protein_name") or event.get("protein"),
            "source": "qPTM",
        }
    return None


def resolve_target_entities(entities: dict[str, Any]) -> dict[str, Any]:
    """Fill gene/uniprot_ac via UniProt identity, then local qPTM fallback.

    Always validates gene↔accession homology when both are present. A stale
    session accession (e.g. STAT3 + P04637) is discarded and re-resolved.
    """
    gene = entities.get("gene")
    uniprot = entities.get("uniprot_ac")
    org_id = organism_id_for(entities.get("organism"))
    identity: dict[str, Any] | None = None

    try:
        identity = resolve_identity(uniprot_ac=uniprot, gene=gene, organism_id=org_id)
    except Exception as exc:
        logger.warning("resolve_identity failed: %s", exc)
        identity = None

    if identity and gene and not gene_matches_identity(str(gene), identity):
        identity = None

    if not identity and gene:
        identity = _local_resolve_from_qptm(str(gene), str(entities.get("organism") or "human"))

    if not identity:
        return entities

    ident_ac = str(identity.get("uniprot_ac") or "").upper()
    ident_gene = identity.get("gene")
    if ident_ac:
        entities["uniprot_ac"] = ident_ac
    if ident_gene and (
        not entities.get("gene") or gene_matches_identity(str(entities.get("gene")), identity)
    ):
        entities["gene"] = str(ident_gene)
    if not entities.get("organism") and identity.get("organism"):
        entities["organism"] = identity.get("organism")
    entities["_resolved"] = {
        "uniprot_ac": entities.get("uniprot_ac"),
        "gene": entities.get("gene"),
        "protein_name": identity.get("protein_name") or identity.get("name"),
        "source": identity.get("source") or "UniProt",
    }
    return entities


def _missing_for_tool(tool_name: str, entities: dict[str, Any], args: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    if tool_name in _NEEDS_UNIPROT and not args.get("uniprot_ac") and not entities.get("uniprot_ac"):
        # Some tools accept gene instead; only flag if neither present after infer
        if not args.get("gene") and not entities.get("gene"):
            missing.append("gene_or_uniprot_ac")
        elif not args.get("uniprot_ac") and tool_name in (
            "qptm_kinases",
            "qptm_site_conditions",
            "uniprot_annotation",
        ):
            missing.append("uniprot_ac")
    if tool_name in _NEEDS_POSITION and not args.get("position") and not entities.get("position"):
        missing.append("position")
    if tool_name in (
        "pubtator_literature_search",
        "pubmed_esearch",
        "europepmc_literature_search",
    ) and not args.get("query") and not entities.get("query"):
        missing.append("query")
    return missing


def _classify_result(tool_name: str, result: dict[str, Any]) -> dict[str, Any]:
    """Normalize tool result with success / error_kind."""
    from app.mcp.classify import classify_tool_result

    return classify_tool_result(tool_name, result)


def qptm_resolve(
    query: str = "",
    gene: str = "",
    position: int = 0,
    uniprot_ac: str = "",
    ptm_type: str = "",
) -> str:
    """Resolve gene/site → UniProt identity for downstream tool calls."""
    entities = _build_entities(
        {
            "query": query,
            "gene": gene,
            "position": position,
            "uniprot_ac": uniprot_ac,
            "ptm_type": ptm_type,
        }
    )
    g, p = _infer_gene_position(query, entities.get("gene"), entities.get("position"))
    if g:
        entities["gene"] = g
    if p:
        entities["position"] = p

    entities = resolve_target_entities(entities)
    resolved = entities.get("_resolved") or {}
    gene = entities.get("gene")
    if _looks_like_residue_token(str(gene or "")):
        gene = None
        entities["gene"] = None
    ok = bool(entities.get("uniprot_ac") or gene)
    summary_bits = []
    if gene:
        summary_bits.append(f"gene={gene}")
    if entities.get("uniprot_ac"):
        summary_bits.append(f"UniProt={entities['uniprot_ac']}")
    if entities.get("position"):
        summary_bits.append(f"site={entities['position']}")
    if resolved.get("protein_name"):
        summary_bits.append(str(resolved["protein_name"])[:80])

    return _dump(
        {
            "success": ok,
            "error_kind": None if ok else "missing_params",
            "summary": (
                "Resolved target: " + ", ".join(summary_bits)
                if ok
                else "Could not resolve gene/UniProt from the question"
            ),
            "missing": [] if ok else ["gene_or_uniprot_ac"],
            "data": {
                "gene": gene,
                "uniprot_ac": entities.get("uniprot_ac"),
                "position": entities.get("position"),
                "ptm_type": entities.get("ptm_type") or "phosphorylation",
                "organism": entities.get("organism") or "human",
                "protein_name": resolved.get("protein_name"),
            },
        }
    )


def qptm_search(
    entity: str,
    query: str,
    gene: str = "",
    position: int = 0,
    uniprot_ac: str = "",
) -> str:
    entity = (entity or "site").lower().strip()
    tools = _ENTITY_TOOL_MAP.get(entity, _ENTITY_TOOL_MAP["site"])
    entities = _build_entities(
        {"query": query, "gene": gene, "position": position, "uniprot_ac": uniprot_ac}
    )
    g, p = _infer_gene_position(query, entities.get("gene"), entities.get("position"))
    if g:
        entities["gene"] = g
    if p:
        entities["position"] = p
    entities = resolve_target_entities(entities)

    outputs: list[dict[str, Any]] = []
    for tool_name in tools[:3]:
        out = _invoke_one(tool_name, entities)
        outputs.append({"tool": tool_name, **out})

    summary_parts = []
    for o in outputs:
        if o.get("summary"):
            tag = "ok" if o.get("success") else o.get("error_kind") or "fail"
            summary_parts.append(f"[{o['tool']}|{tag}] {o['summary']}")

    any_ok = any(o.get("success") for o in outputs)
    return _dump(
        {
            "success": any_ok,
            "error_kind": None if any_ok else "tool_error",
            "summary": " | ".join(summary_parts)[:800] or "Search completed",
            "data": outputs,
        }
    )


def qptm_get(entity: str, id: str, section: str = "") -> str:
    id = (id or "").strip()
    entity = (entity or "").lower().strip()

    if id.startswith("pmid:") or entity == "literature":
        pmid = id.replace("pmid:", "").strip()
        result = registry.execute("pubmed_fetch_abstracts", {"pmids": [pmid]})
        return _dump(_classify_result("pubmed_fetch_abstracts", result))

    if ":" in id:
        left, right = id.split(":", 1)
        if re.match(r"^\d+$", right):
            gene, pos = left, int(right)
            entities = resolve_target_entities({"gene": gene, "position": pos, "query": f"{gene} {pos}"})
            tool = "qptm_site_conditions" if entity in ("condition", "site") else "qptm_kinases"
            return _dump(_invoke_one(tool, entities))
        if re.match(r"^[OPQ][0-9]", left, re.I):
            entities = {"uniprot_ac": left.upper(), "position": int(right), "query": id}
            return _dump(_invoke_one("qptm_site_conditions", entities))

    if id in registry.tool_names:
        return _dump(_invoke_one(id, {"query": section or id}))

    return _error(f"Unknown id: {id}", error_kind="missing_params")


def _invoke_one(tool_name: str, entities: dict[str, Any]) -> dict[str, Any]:
    if tool_name not in registry.tool_names:
        return {
            "success": False,
            "error_kind": "unknown_tool",
            "summary": f"Unknown tool: {tool_name}",
            "missing": [],
            "data": None,
        }

    # Put query into entities for infer_tool_arguments — NEVER pass query as state.
    args = infer_tool_arguments(tool_name, entities, None)
    if not args:
        if tool_name in (
            "pubtator_literature_search",
            "pubmed_esearch",
            "europepmc_literature_search",
            "pubmed_fetch_abstracts",
            "pubmed_fetch_fulltext",
        ):
            args = {"query": entities.get("query") or entities.get("gene") or ""}
            if entities.get("pmids") is not None:
                args["pmids"] = entities.get("pmids")
            if entities.get("max_chars"):
                args["max_chars"] = entities.get("max_chars")
            if entities.get("limit"):
                args["limit"] = entities.get("limit")
        elif tool_name == "qptm_search":
            args = {
                "query": entities.get("gene") or entities.get("uniprot_ac") or entities.get("query") or "",
                "field": "gene" if entities.get("gene") else ("uniprot" if entities.get("uniprot_ac") else "any"),
            }
        else:
            miss = _missing_for_tool(tool_name, entities, {})
            if not miss:
                if tool_name in _NEEDS_UNIPROT and not entities.get("uniprot_ac"):
                    miss = ["uniprot_ac"]
                elif tool_name in _NEEDS_POSITION and not entities.get("position"):
                    miss = ["position"]
                else:
                    miss = ["required_arguments"]
            return {
                "success": False,
                "error_kind": "missing_params",
                "summary": f"Skipped {tool_name}: need {', '.join(miss)}",
                "missing": miss,
                "data": None,
            }

    from app.tools.identity_guard import check_gene_accession_mismatch

    gene_arg = args.get("gene") or entities.get("gene")
    ac_arg = args.get("uniprot_ac") or entities.get("uniprot_ac")
    mismatch = check_gene_accession_mismatch(gene_arg, ac_arg, tool_name=tool_name)
    if mismatch:
        return {
            "success": False,
            "error_kind": "identity_mismatch",
            "summary": mismatch.get("summary") or mismatch.get("error"),
            "missing": [],
            "data": mismatch,
        }

    limit_raw = entities.get("limit")
    if tool_name == "pubmed_fetch_abstracts":
        pmids = entities.get("pmids") or args.get("pmids")
        if pmids:
            args["pmids"] = pmids
        if entities.get("max_chars"):
            args["max_chars"] = entities.get("max_chars")
        args.pop("query", None)
    if tool_name == "pubmed_fetch_fulltext":
        pmids = entities.get("pmids") or entities.get("fulltext_pmids") or args.get("pmids")
        args = {"pmids": pmids}
        if entities.get("max_chars"):
            args["max_chars"] = entities.get("max_chars")
    if limit_raw not in (None, "", 0, "0"):
        try:
            n = max(1, min(int(limit_raw), 200))
            args["limit"] = n
            if tool_name == "qptm_search":
                args["per_page"] = min(50, n)
        except (TypeError, ValueError):
            pass

    if tool_name in ("qptm_kinases", "qptm_site_conditions"):
        if not args.get("uniprot_ac") or not args.get("position"):
            miss = []
            if not args.get("uniprot_ac"):
                miss.append("uniprot_ac")
            if not args.get("position"):
                miss.append("position")
            return {
                "success": False,
                "error_kind": "missing_params",
                "summary": f"Skipped {tool_name}: need {', '.join(miss)} (resolve gene→UniProt first)",
                "missing": miss,
                "data": None,
            }

    try:
        result = registry.execute(tool_name, args)
    except TypeError as exc:
        logger.exception("tool invoke TypeError: %s", tool_name)
        return {
            "success": False,
            "error_kind": "call_bug",
            "summary": f"{tool_name} argument error: {exc}",
            "missing": [],
            "data": None,
        }
    except Exception as exc:
        logger.exception("tool invoke failed: %s", tool_name)
        return {
            "success": False,
            "error_kind": "call_bug",
            "summary": f"{tool_name} crashed: {exc}",
            "missing": [],
            "data": None,
        }

    classified = _classify_result(tool_name, result if isinstance(result, dict) else {"summary": str(result)})
    return classified


def qptm_invoke(tool_name: str, arguments_json: str = "{}") -> str:
    try:
        args = json.loads(arguments_json or "{}")
    except json.JSONDecodeError:
        args = {}
    if not isinstance(args, dict):
        args = {}

    tool_name = (tool_name or "").strip()
    if not tool_name:
        return _error("tool_name is required", error_kind="missing_params", missing=["tool_name"])

    entities = _build_entities(args)
    g, p = _infer_gene_position(
        str(entities.get("query") or ""),
        entities.get("gene"),
        entities.get("position"),
    )
    if g:
        entities["gene"] = g
    if p:
        entities["position"] = p

    entities = resolve_target_entities(entities)
    out = _invoke_one(tool_name, entities)
    # Attach resolved identity for the TS runtime to cache.
    if entities.get("uniprot_ac") or entities.get("gene"):
        out["resolved"] = {
            "gene": entities.get("gene"),
            "uniprot_ac": entities.get("uniprot_ac"),
            "position": entities.get("position"),
            "ptm_type": entities.get("ptm_type") or "phosphorylation",
        }
    return _dump(out)

"""MCP intent tools — domain-level wrappers over the 48-tool registry."""

from __future__ import annotations

import logging
import re
from typing import Any, Callable

from concurrent.futures import ThreadPoolExecutor

from app.mcp.formatters import blocks_to_text, format_intent_response, format_tool_block
from app.tools.pubtator_tools import merge_paper_hits
from mcp_tools import (
    _build_entities,
    _infer_gene_position,
    _invoke_one,
    resolve_target_entities,
)

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 15
MAX_LIMIT = 200

_DISEASE_QUERY_RE = re.compile(
    r"disease|cancer|tumor|tumour|疾病|肿瘤|癌",
    re.I,
)
_STABILITY_QUERY_RE = re.compile(
    r"stabil|destabil|半衰期|降解",
    re.I,
)

SOURCE_TOOL_ALIASES: dict[str, tuple[str, ...]] = {
    "qptm": ("qptm_kinases", "qptm_site_conditions", "qptm_search"),
    "psp": ("psp_kinase_substrate", "psp_regulatory", "psp_disease_sites", "psp_ptmvar"),
    "phosphosite": ("psp_kinase_substrate", "psp_regulatory", "psp_disease_sites", "psp_ptmvar"),
    "phosphositeplus": ("psp_kinase_substrate", "psp_regulatory", "psp_disease_sites", "psp_ptmvar"),
    "gps": ("gps6_kinases",),
    "gps6": ("gps6_kinases",),
    "iptmnet": ("iptmnet_enzymes", "iptmnet_ptm_ppi"),
    "ekpi": ("ekpi_kinases", "ekpi_quantitative"),
    "ubibrowser": ("ubibrowser_interactions",),
    "gpsuber": ("gpsuber_e3_sites",),
    "weram": ("weram_regulators",),
    "kaka": ("kaka_kinase_mutations",),
}


def clamp_limit(limit: int, default: int = DEFAULT_LIMIT) -> int:
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = default
    return max(1, min(n, MAX_LIMIT))


def parse_source_filter(sources: str) -> Callable[[str], bool] | None:
    tokens = [t.strip().lower() for t in re.split(r"[,;/\s]+", sources or "") if t.strip()]
    if not tokens:
        return None

    def _ok(tool_name: str) -> bool:
        tl = tool_name.lower()
        for tok in tokens:
            aliases = SOURCE_TOOL_ALIASES.get(tok, ())
            if tl in aliases or tl == tok or tl.startswith(f"{tok}_"):
                return True
        return False

    return _ok

# Intent → underlying registry tools (order matters for presentation).
INTENT_TOOL_MAP: dict[str, list[tuple[str, str | None]]] = {
    "search_ptm_sites": [
        ("qptm_search", "experimental"),
        ("uniprot_annotation", "context"),
    ],
    "get_site_conditions": [
        ("qptm_site_conditions", "experimental"),
        ("ekpi_quantitative", "experimental"),
        ("cancerproteome_disease", "experimental"),
    ],
    "get_upstream_enzymes": [
        ("qptm_kinases", "experimental"),
        ("psp_kinase_substrate", "curated"),
        ("iptmnet_enzymes", "curated"),
        ("ekpi_kinases", "experimental"),
        ("ubibrowser_interactions", "curated"),
        ("gpsuber_e3_sites", "curated"),
        ("weram_regulators", "curated"),
        ("gps6_kinases", "predicted"),
        ("kaka_kinase_mutations", "curated"),
    ],
    "get_function_disease": [
        ("psp_regulatory", "curated"),
        ("psp_disease_sites", "curated"),
        ("psp_ptmvar", "curated"),
        ("ptmd_disease", "curated"),
        ("dbptm_functional", "curated"),
        ("ptm_stability", "experimental"),
        ("funcscore_phosphosite", "curated"),
        ("activedriver_mutations", "curated"),
        ("qptm_site_conditions", "experimental"),
        ("cancerproteome_disease", "experimental"),
    ],
    "get_llps": [
        ("ptmphase_llps", "experimental"),
        ("ptmphase_phosllps", "predicted"),
        ("dscope_literature", "experimental"),
        ("dscope_predictions", "predicted"),
    ],
    "get_drug_ptm": [
        ("pmads_drug_ptm", "curated"),
        ("drugbank_targets", "curated"),
        ("decryptm_drug_ptm", "experimental"),
    ],
    "get_localization": [
        ("compartments_localization", "curated"),
        ("inuloc_nls_nes", "predicted"),
        ("inuloc_nuclear_prob", "predicted"),
        ("subcell_scsi", "curated"),
        ("uniprot_annotation", "curated"),
        ("interpro_domains", "curated"),
        ("pfam_domains", "curated"),
    ],
    "get_ppi_pathways": [
        ("ptmint_ppi", "experimental"),
        ("iptmnet_ptm_ppi", "curated"),
        ("ptmcode_associations", "curated"),
        ("string_ppi", "curated"),
        ("biogrid_interactions", "curated"),
        ("intact_interactions", "curated"),
        ("reactome_pathways", "curated"),
        ("kegg_pathways", "curated"),
        ("pathbank_pathways", "curated"),
    ],
    "search_literature": [
        ("pubtator_literature_search", None),
        ("pubmed_esearch", None),
        ("europepmc_literature_search", None),
        ("pubmed_fetch_abstracts", None),
        ("pubmed_fetch_fulltext", None),
    ],
}

MCP_SERVER_INSTRUCTIONS = """You are the qPTM PTM research assistant with MCP access to quantitative PTM databases.

Use these intent tools (not raw database names):
- resolve_ptm_target — resolve gene/site → UniProt before site-specific queries
- search_ptm_sites — discover PTM events (qPTM + UniProt context)
- get_site_conditions — quantitative conditions / fold changes (qPTM, eKPI, CancerProteome)
- get_upstream_enzymes — kinases, E3/DUB, histone writers (experimental/curated blocks before GPS predictions)
- get_function_disease — regulatory annotations, disease PTMs, stability, mutations
- get_llps — phase separation (experimental separate from predictions)
- get_drug_ptm — PMADS / DrugBank / decryptM (different evidence types per block)
- get_localization — compartments, NLS/NES, domains
- get_ppi_pathways — PTM-dependent PPI and pathways
- search_literature — PubTator3 + PubMed esearch + Europe PMC; abstracts via PubMed; OA full text via Europe PMC XML

Each tool returns blocks[] per data source with evidence_level (experimental/curated/predicted/mixed).
Choose intents by research dimension (regulation, conditions, downstream function, localization) — do not query every tool for every question.
Never treat GPS scores or PhosLLPS predictions as experimental facts. Cite database names and PMIDs in answers."""


def _prepare_entities(
    query: str = "",
    gene: str = "",
    position: int = 0,
    uniprot_ac: str = "",
    ptm_type: str = "",
) -> dict[str, Any]:
    entities = _build_entities(
        {
            "query": query,
            "gene": gene,
            "position": position,
            "uniprot_ac": uniprot_ac,
            "ptm_type": ptm_type or "phosphorylation",
        }
    )
    g, p = _infer_gene_position(query, entities.get("gene"), entities.get("position"))
    if g:
        entities["gene"] = g
    if p:
        entities["position"] = p
    return resolve_target_entities(entities)


def _resolved_dict(entities: dict[str, Any]) -> dict[str, Any]:
    resolved = entities.get("_resolved") or {}
    return {
        "gene": entities.get("gene"),
        "uniprot_ac": entities.get("uniprot_ac"),
        "position": entities.get("position"),
        "ptm_type": entities.get("ptm_type") or "phosphorylation",
        "organism": entities.get("organism") or "human",
        "protein_name": resolved.get("protein_name"),
    }


def _run_tools(
    intent: str,
    entities: dict[str, Any],
    *,
    limit: int = DEFAULT_LIMIT,
    tool_filter: Callable[[str], bool] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    blocks: list[dict[str, Any]] = []
    summaries: list[str] = []
    call_entities = dict(entities)
    call_entities["limit"] = limit
    query = str(call_entities.get("query") or "")
    skip_stability = (
        intent == "get_function_disease"
        and not _STABILITY_QUERY_RE.search(query)
        and tool_filter is None
    )
    for tool_name, tier in INTENT_TOOL_MAP.get(intent, []):
        if tool_filter and not tool_filter(tool_name):
            continue
        if skip_stability and tool_name == "ptm_stability":
            continue
        out = _invoke_one(tool_name, call_entities)
        block = format_tool_block(tool_name, out, limit=limit, tier=tier)
        blocks.append(block)
        if out.get("summary"):
            tag = "ok" if out.get("success") else out.get("error_kind") or "fail"
            summaries.append(f"[{tool_name}|{tag}] {out['summary']}")
    return blocks, summaries


def intent_resolve_ptm_target(
    query: str = "",
    gene: str = "",
    position: int = 0,
    uniprot_ac: str = "",
    ptm_type: str = "",
) -> str:
    entities = _prepare_entities(query, gene, position, uniprot_ac, ptm_type)
    resolved = _resolved_dict(entities)
    ok = bool(resolved.get("uniprot_ac") or resolved.get("gene"))
    bits = []
    if resolved.get("gene"):
        bits.append(f"gene={resolved['gene']}")
    if resolved.get("uniprot_ac"):
        bits.append(f"UniProt={resolved['uniprot_ac']}")
    if resolved.get("position"):
        bits.append(f"site={resolved['position']}")
    payload = format_intent_response(
        intent="resolve_ptm_target",
        resolved=resolved,
        blocks=[],
        summary=("Resolved: " + ", ".join(bits)) if ok else "Could not resolve gene/UniProt",
        success=ok,
        error_kind=None if ok else "missing_params",
        missing=[] if ok else ["gene_or_uniprot_ac"],
    )
    return blocks_to_text(payload)


def _intent_multi(
    intent: str,
    query: str = "",
    gene: str = "",
    position: int = 0,
    uniprot_ac: str = "",
    ptm_type: str = "",
    limit: int = DEFAULT_LIMIT,
    sources: str = "",
    tool_filter: Callable[[str], bool] | None = None,
) -> str:
    limit = clamp_limit(limit)
    entities = _prepare_entities(query, gene, position, uniprot_ac, ptm_type)
    if intent == "get_function_disease" and _DISEASE_QUERY_RE.search(query or ""):
        entities["contrast_type"] = "disease"
    resolved = _resolved_dict(entities)
    filt = tool_filter or parse_source_filter(sources)
    blocks, summaries = _run_tools(intent, entities, limit=limit, tool_filter=filt)
    any_ok = any(b.get("success") and (b.get("rows") or b.get("summary")) for b in blocks)
    payload = format_intent_response(
        intent=intent,
        resolved=resolved,
        blocks=blocks,
        summary=" | ".join(summaries) or f"{intent}: no results",
        success=any_ok,
        error_kind=None if any_ok else "empty_result",
    )
    if resolved.get("uniprot_ac") or resolved.get("gene"):
        payload["resolved"] = resolved
    return blocks_to_text(payload)


def intent_search_ptm_sites(**kwargs: Any) -> str:
    return _intent_multi("search_ptm_sites", **kwargs)


def intent_get_site_conditions(**kwargs: Any) -> str:
    return _intent_multi("get_site_conditions", **kwargs)


def intent_get_upstream_enzymes(**kwargs: Any) -> str:
    return _intent_multi("get_upstream_enzymes", **kwargs)


def intent_get_function_disease(**kwargs: Any) -> str:
    return _intent_multi("get_function_disease", **kwargs)


def intent_get_llps(**kwargs: Any) -> str:
    return _intent_multi("get_llps", **kwargs)


def intent_get_drug_ptm(**kwargs: Any) -> str:
    return _intent_multi("get_drug_ptm", **kwargs)


def intent_get_localization(**kwargs: Any) -> str:
    return _intent_multi("get_localization", **kwargs)


def intent_get_ppi_pathways(**kwargs: Any) -> str:
    return _intent_multi("get_ppi_pathways", **kwargs)


def _papers_from_invoke(out: dict[str, Any]) -> list[dict[str, Any]]:
    data = out.get("data") if isinstance(out, dict) else None
    if isinstance(data, dict):
        papers = data.get("papers") or data.get("abstracts")
        if isinstance(papers, list):
            return [p for p in papers if isinstance(p, dict)]
        # classified wrapper sometimes nests the tool payload
        inner = data.get("data")
        if isinstance(inner, dict):
            papers = inner.get("papers") or inner.get("abstracts")
            if isinstance(papers, list):
                return [p for p in papers if isinstance(p, dict)]
    return []


def intent_search_literature(
    query: str = "",
    gene: str = "",
    position: int = 0,
    uniprot_ac: str = "",
    ptm_type: str = "",
    limit: int = 20,
    pmids: str = "",
    fulltext_pmids: str = "",
    sources: str = "",
    max_chars: int = 0,
) -> str:
    entities = _prepare_entities(query, gene, position, uniprot_ac, ptm_type)
    resolved = _resolved_dict(entities)
    blocks: list[dict[str, Any]] = []
    summaries: list[str] = []
    limit = clamp_limit(limit, default=20)

    lit_query = (query or "").strip() or " ".join(
        x for x in [entities.get("gene"), str(entities.get("position") or ""), ptm_type] if x
    )
    pmid_list = [p.strip() for p in re_split_pmids(pmids) if p.strip().isdigit()]
    ft_list = [p.strip() for p in re_split_pmids(fulltext_pmids) if p.strip().isdigit()]
    search_payload = {**entities, "query": lit_query, "limit": limit}
    if lit_query and not pmid_list and not ft_list:
        names = (
            "pubtator_literature_search",
            "pubmed_esearch",
            "europepmc_literature_search",
        )
        results: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = {pool.submit(_invoke_one, name, search_payload): name for name in names}
            for fut, name in futs.items():
                results[name] = fut.result()
        for name in names:
            out = results.get(name) or {}
            blocks.append(format_tool_block(name, out, limit=limit))
            if out.get("summary"):
                summaries.append(str(out["summary"]))
        merged = merge_paper_hits(
            _papers_from_invoke(results.get("pubtator_literature_search") or {}),
            _papers_from_invoke(results.get("pubmed_esearch") or {}),
            _papers_from_invoke(results.get("europepmc_literature_search") or {}),
            limit=limit,
        )
        if merged:
            blocks.append(
                format_tool_block(
                    "pubtator_literature_search",
                    {
                        "success": True,
                        "summary": f"Merged {len(merged)} unique PMID(s) from PubTator3, PubMed, and Europe PMC",
                        "data": {"papers": merged, "total": len(merged)},
                    },
                    limit=limit,
                )
            )
            summaries.append(f"Merged {len(merged)} unique PMID(s)")

    abs_cap = min(20, max(limit, 10))
    abs_chars = int(max_chars) if max_chars else 4000
    if pmid_list:
        out = _invoke_one(
            "pubmed_fetch_abstracts",
            {**entities, "pmids": pmid_list[:abs_cap], "max_chars": abs_chars, "query": lit_query},
        )
        blocks.append(format_tool_block("pubmed_fetch_abstracts", out, limit=abs_cap))
        if out.get("summary"):
            summaries.append(str(out["summary"]))

    if ft_list:
        out = _invoke_one(
            "pubmed_fetch_fulltext",
            {**entities, "pmids": ft_list[:10], "max_chars": 6000, "query": lit_query},
        )
        blocks.append(format_tool_block("pubmed_fetch_fulltext", out, limit=10))
        if out.get("summary"):
            summaries.append(str(out["summary"]))

    any_ok = any(b.get("success") for b in blocks)
    payload = format_intent_response(
        intent="search_literature",
        resolved=resolved,
        blocks=blocks,
        summary=" | ".join(summaries) or "Literature search returned no hits",
        success=any_ok,
        error_kind=None if any_ok else "empty_result",
    )
    return blocks_to_text(payload)


def re_split_pmids(pmids: str) -> list[str]:
    if not pmids:
        return []
    return re.split(r"[\s,;]+", pmids.strip())


# Internal/debug only — not exposed via tools/list
def intent_invoke_raw(tool_name: str, arguments_json: str = "{}") -> str:
    from mcp_tools import qptm_invoke

    return qptm_invoke(tool_name, arguments_json)


INTENT_HANDLERS: dict[str, Callable[..., str]] = {
    "resolve_ptm_target": intent_resolve_ptm_target,
    "search_ptm_sites": intent_search_ptm_sites,
    "get_site_conditions": intent_get_site_conditions,
    "get_upstream_enzymes": intent_get_upstream_enzymes,
    "get_function_disease": intent_get_function_disease,
    "get_llps": intent_get_llps,
    "get_drug_ptm": intent_get_drug_ptm,
    "get_localization": intent_get_localization,
    "get_ppi_pathways": intent_get_ppi_pathways,
    "search_literature": intent_search_literature,
}

COMMON_PARAMS: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "User question or search focus"},
        "gene": {"type": "string", "description": "Gene symbol (e.g. TP53, AKT1)"},
        "position": {"type": "integer", "description": "Residue position (e.g. 473 for S473)"},
        "uniprot_ac": {"type": "string", "description": "UniProt accession if known"},
        "ptm_type": {
            "type": "string",
            "description": "PTM type (default phosphorylation)",
            "default": "phosphorylation",
        },
        "limit": {
            "type": "integer",
            "description": "Max rows per source block (default 15, max 200)",
            "default": DEFAULT_LIMIT,
        },
        "sources": {
            "type": "string",
            "description": "Optional comma-separated source filter (e.g. qptm, psp, gps)",
        },
    },
}

INTENT_DESCRIPTIONS: dict[str, str] = {
    "resolve_ptm_target": "Resolve gene/site to UniProt accession before site-specific PTM queries.",
    "search_ptm_sites": "Discover PTM sites and protein context (qPTM quantitative search + UniProt).",
    "get_site_conditions": "Quantitative PTM conditions: fold changes across treatments (qPTM, eKPI, CancerProteome).",
    "get_upstream_enzymes": "Upstream regulators: kinases (experimental/curated first), E3/DUB, histone writers, then GPS predictions.",
    "get_function_disease": "Functional/disease annotations: PSP regulatory, PTMD states, stability, mutations.",
    "get_llps": "Phase separation / LLPS: experimental PTMPhaSe and dSCOPE literature separate from predictions.",
    "get_drug_ptm": "Drug–PTM links: PMADS curated associations, DrugBank targets, decryptM dose–response.",
    "get_localization": "Subcellular localization, NLS/NES motifs, compartments, and structural domains.",
    "get_ppi_pathways": "PTM-dependent PPI, curated interactions, and pathway membership.",
    "search_literature": "Search PubTator3, PubMed esearch, and Europe PMC; fetch abstracts by PMID; OA full text via Europe PMC XML.",
}


def intent_tool_definitions() -> list[dict[str, Any]]:
    tools = []
    for name, desc in INTENT_DESCRIPTIONS.items():
        schema = dict(COMMON_PARAMS)
        if name == "search_literature":
            schema = {
                "type": "object",
                "properties": {
                    **COMMON_PARAMS["properties"],
                    "pmids": {
                        "type": "string",
                        "description": "Comma-separated PMIDs to fetch abstracts",
                    },
                    "fulltext_pmids": {
                        "type": "string",
                        "description": "Comma-separated PMIDs to fetch OA full text",
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "Max characters per abstract (default 4000)",
                    },
                },
            }
        tools.append(
            {
                "name": name,
                "description": desc,
                "inputSchema": schema,
            }
        )
    return tools

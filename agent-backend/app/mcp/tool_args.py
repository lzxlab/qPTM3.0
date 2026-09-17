"""MCP argument inference — cut from planner.py without rewriting call logic.

Live MCP entry points: ``parse_query_entities``, ``infer_tool_arguments``.
"""

from __future__ import annotations

import re
from typing import Any

# ── Amino-acid helpers (missense / PTM site parsing) ───────────────

_AA1 = set("ACDEFGHIKLMNPQRSTVWY")
_AA3_TO_1 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
    "TER": "*", "STOP": "*",
}


def _normalize_aa_token(token: str) -> str | None:
    """Normalize 1-letter or 3-letter amino-acid token to 1-letter (or '*')."""
    t = (token or "").strip().upper()
    if not t:
        return None
    if t in ("*", "X", "DEL", "FS"):
        return "*" if t in ("*", "X") else t[0]
    if len(t) == 1 and t in _AA1:
        return t
    return _AA3_TO_1.get(t)


# ASCII-only boundaries: Python ``\b`` treats CJK as word chars, so
# ``TP53 S15的…`` fails to parse position with ``\b`` after the digits.
_GENE_LEFT = r"(?<![A-Za-z0-9_])"
_GENE_RIGHT = r"(?![A-Za-z0-9_])"
_SITE_RIGHT = r"(?![A-Za-z0-9_])"  # allow CJK after S15 (S15的 / S15磷酸化)


# English / jargon tokens that must never be treated as gene symbols
_GENE_STOPWORDS = {
    "PTM", "DNA", "RNA", "ATP", "GTP", "WHO", "WHY", "WHEN", "WHERE", "THE", "AND", "FOR",
    "HUMAN", "MOUSE", "SEARCH", "WHAT", "WHICH", "UNDER", "STAGE", "WITH", "FROM", "THAT",
    "THIS", "THAN", "THEN", "THEY", "THEM", "HAVE", "HAS", "HAD", "WAS", "WERE", "ARE",
    "BEEN", "BEING", "WILL", "WOULD", "COULD", "SHOULD", "ABOUT", "INTO", "OVER", "AFTER",
    "BEFORE", "BETWEEN", "THROUGH", "DURING", "WITHOUT", "WITHIN",
    "AT", "IN", "ON", "BY", "TO", "OF", "OR", "IS", "AS", "AN", "BE", "IF", "NO", "UP",
    "SO", "WE", "IT", "DO", "MY", "ME", "AM", "US", "OUR", "YOU", "YOUR", "HIS", "HER",
    "ITS", "NOT", "BUT", "CAN", "MAY", "HOW", "ALL", "ANY", "BOTH", "EACH", "FEW", "MORE",
    "MOST", "OTHER", "SOME", "SUCH", "ONLY", "OWN", "SAME", "THAN", "TOO", "VERY",
    "E3", "E1", "E2", "DUB", "ESI", "DSI", "ESR", "SSER", "SSERS", "PMID",
    "API", "NAR", "GPS", "UBER", "HAT", "HDAC", "HMT", "HDM",
    "SUMO", "SIM", "SUMOYLATION", "UBIQUITINATION", "UBIQUITYLATION",
    "PHOSPHORYLATION", "ACETYLATION", "METHYLATION", "GLYCOSYLATION",
    "PHOSPHORYLATES", "PHOSPHORYLATE", "PHOSPHORYLATED", "KINASE", "KINASES",
    "ENZYME", "ENZYMES", "PROTEIN", "PROTEINS", "SITE", "SITES", "RESIDUE", "RESIDUES",
    "POSITION", "POSITIONS", "MUTATION", "MUTATIONS", "VARIANT", "VARIANTS",
    "CLINVAR", "PCAWG", "MC3", "SNV", "SNP", "INDEL", "QUERY", "TELL", "PLEASE",
    "DOES", "DID", "DONE", "FIND", "SHOW", "LIST", "GIVE", "GET",
    # Conversational / off-topic tokens often misparsed as genes
    "HELLO", "HI", "HEY", "THANKS", "THANK", "BYE", "GOODBYE", "PLEASE",
    "HELP", "WHAT", "WHO", "WHY", "WHEN", "WHERE", "HOW", "YES", "OK", "OKAY",
    "WEATHER", "TODAY", "TOMORROW", "SORRY", "WELCOME", "MORNING", "EVENING",
    "NIGHT", "TEST", "DEMO", "EXAMPLE", "NULL", "NONE", "TRUE", "FALSE",
    "POST", "TRANSLATIONAL", "MODIFICATION", "MODIFICATIONS", "EXPLAIN",
    "ABOUT", "DEFINE", "DEFINITION", "INTRODUCTION", "OVERVIEW", "GENERAL",
    "MEANING", "PURPOSE", "ROLE", "ROLES", "ACTION", "ACTIONS",
}


def _is_plausible_gene(token: str | None) -> bool:
    """Reject English glue words misparsed as genes (e.g. 'at' in 'at S15')."""
    if not token:
        return False
    t = token.strip().upper()
    if not t or t in _GENE_STOPWORDS or t.isdigit():
        return False
    # Gene symbols are usually 2+ chars; single letter is almost never a gene query
    if len(t) < 2:
        return False
    # Residue tokens (S15, Y394, T308…) are never gene symbols.
    if re.fullmatch(r"[STYKR]\d{2,5}", t):
        return False
    return bool(re.fullmatch(r"[A-Z][A-Z0-9]{1,14}", t))


# ── Entity parsing ────────────────────────────────────────────────

def parse_query_entities(message: str) -> dict[str, Any]:
    """Extract protein/site/mutation entities from a user question."""
    entities: dict[str, Any] = {
        "gene": None,
        "uniprot_ac": None,
        "position": None,
        "ptm_type": "phosphorylation",
        "organism": "human",
        "query": message.strip(),
        # Missense allele when present (e.g. TP53 S15F → ref=S, alt=F, label=S15F)
        "mutation_ref": None,
        "mutation_alt": None,
        "mutation_label": None,
        "narrative": None,  # e.g. "mutation_precision"
    }

    msg_lower = message.lower()

    # PTM type
    ptm_keywords = {
        "acetyl": "acetylation",
        "ubiquit": "ubiquitylation",
        "methyl": "methylation",
        "glycosyl": "glycosylation",
        "sumo": "sumoylation",
        "phosph": "phosphorylation",
    }
    for kw, ptm in ptm_keywords.items():
        if kw in msg_lower:
            entities["ptm_type"] = ptm
            break

    # Organism — word-boundary for short tokens (avoid "rat" in "separation")
    if re.search(r"\b(mouse|mus musculus)\b", msg_lower) or "小鼠" in msg_lower:
        entities["organism"] = "mouse"
    elif re.search(r"\b(rat|rattus)\b", msg_lower) or "大鼠" in msg_lower:
        entities["organism"] = "rat"
    elif re.search(r"\b(yeast|saccharomyces)\b", msg_lower) or "酿酒酵母" in msg_lower:
        entities["organism"] = "yeast"

    # UniProt accession
    uni_match = re.search(
        r"\b([OPQ][0-9][A-Z0-9]{3}[0-9](?:-[0-9]+)?|[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9](?:-[0-9]+)?)\b",
        message,
        re.I,
    )
    if uni_match:
        entities["uniprot_ac"] = uni_match.group(1).upper()

    # Gene + missense allele first (TP53 S15F, TP53 p.S15F, TP53 p.Ser15Phe)
    mut_match = re.search(
        _GENE_LEFT + r"([A-Z][A-Z0-9]{1,14})\s+(?:p\.)?"
        r"([A-Z]{1,3})(\d+)([A-Z*]{1,3}|\*)" + _SITE_RIGHT,
        message,
        re.I,
    )
    if mut_match and _is_plausible_gene(mut_match.group(1)):
        ref = _normalize_aa_token(mut_match.group(2))
        alt = _normalize_aa_token(mut_match.group(4))
        pos = int(mut_match.group(3))
        # Require a real aa change (ref≠alt) so "TP53 S15" alone is not a mutation
        if ref and alt and ref != alt:
            entities["gene"] = mut_match.group(1).upper()
            entities["position"] = pos
            entities["mutation_ref"] = ref
            entities["mutation_alt"] = alt
            entities["mutation_label"] = f"{ref}{pos}{alt}"
            if ref in ("S", "T", "Y") and not any(
                k in msg_lower for k in ("acetyl", "ubiquit", "methyl", "glycosyl", "sumo")
            ):
                entities["ptm_type"] = "phosphorylation"

    # Standalone p.S15F / Ser15Phe (gene may appear elsewhere)
    if not entities["mutation_label"]:
        lone_mut = re.search(
            _GENE_LEFT + r"(?:p\.)?([A-Z]{1,3})(\d+)([A-Z*]{1,3}|\*)" + _SITE_RIGHT,
            message,
            re.I,
        )
        if lone_mut:
            ref = _normalize_aa_token(lone_mut.group(1))
            alt = _normalize_aa_token(lone_mut.group(3))
            if ref and alt and ref != alt:
                entities["position"] = int(lone_mut.group(2))
                entities["mutation_ref"] = ref
                entities["mutation_alt"] = alt
                entities["mutation_label"] = f"{ref}{entities['position']}{alt}"

    # Gene + site patterns (order matters). Never accept English words as gene.
    # 1) "TP53 at S15" / "TP53 at Ser15" / "TP53 at p.S15"
    if not entities["position"] or not entities["gene"]:
        at_site = re.search(
            _GENE_LEFT + r"([A-Z][A-Z0-9]{1,14})\s+at\s+(?:p\.)?"
            r"(?:([STYKR])(\d+)|(Ser|Thr|Tyr|Lys|Arg)(\d+))" + _SITE_RIGHT,
            message,
            re.I,
        )
        if at_site and _is_plausible_gene(at_site.group(1)):
            entities["gene"] = at_site.group(1).upper()
            if at_site.group(2):
                entities["position"] = int(at_site.group(3))
            else:
                entities["position"] = int(at_site.group(5))

    # 2) "TP53 S15" / "AKT1 S473" / "TP53 S15的…" (CJK after site OK)
    if not entities["position"]:
        site_match = re.search(
            _GENE_LEFT + r"([A-Z][A-Z0-9]{1,14})\s+([STYKR])(\d+)" + _SITE_RIGHT,
            message,
            re.I,
        )
        if site_match and _is_plausible_gene(site_match.group(1)):
            entities["gene"] = site_match.group(1).upper()
            entities["position"] = int(site_match.group(3))
    elif entities["gene"] and not _is_plausible_gene(entities["gene"]):
        # Clear bogus gene from earlier allele parsing (e.g. AT)
        entities["gene"] = None

    # 3) "TP53 Ser15" three-letter residue without "at"
    if not entities["position"]:
        ser_site = re.search(
            _GENE_LEFT + r"([A-Z][A-Z0-9]{1,14})\s+(Ser|Thr|Tyr|Lys|Arg)(\d+)" + _SITE_RIGHT,
            message,
            re.I,
        )
        if ser_site and _is_plausible_gene(ser_site.group(1)):
            entities["gene"] = ser_site.group(1).upper()
            entities["position"] = int(ser_site.group(3))

    # 4) Lone "S15" / "Ser15" when gene is found separately
    if not entities["position"]:
        lone_site = re.search(
            _GENE_LEFT + r"(?:p\.)?(?:([STYKR])(\d+)|(Ser|Thr|Tyr|Lys|Arg)(\d+))" + _SITE_RIGHT,
            message,
            re.I,
        )
        if lone_site:
            if lone_site.group(1):
                entities["position"] = int(lone_site.group(2))
            else:
                entities["position"] = int(lone_site.group(4))

    # Histone shorthand
    if re.search(r"\bhistone\s+h3\b", msg_lower):
        entities["gene"] = entities["gene"] or "H3"
        entities["query"] = "histone H3"

    # Standalone gene name (prefer tokens that look like gene symbols in the original text)
    if not entities["gene"]:
        # Prefer ALL-CAPS symbols in the original message (TP53, AKT1)
        for match in re.finditer(_GENE_LEFT + r"([A-Z][A-Z0-9]{1,14})" + _GENE_RIGHT, message):
            token = match.group(1)
            if _is_plausible_gene(token):
                entities["gene"] = token.upper()
                break
        if not entities["gene"]:
            for match in re.finditer(
                _GENE_LEFT + r"([A-Za-z][A-Za-z0-9]{1,14})" + _GENE_RIGHT, message
            ):
                token = match.group(1).upper()
                if _is_plausible_gene(token):
                    entities["gene"] = token
                    break

    # Colloquial p53 / Trp53 (case-insensitive) when no better symbol was found
    mouseish = entities.get("organism") == "mouse" or bool(
        re.search(r"小鼠|\bmouse\b", message, re.I)
    )
    if not entities["gene"] and re.search(r"\b(?:trp53|p53)\b", message, re.I):
        entities["gene"] = "Trp53" if mouseish else "TP53"

    # Final sanity: never keep stopword / residue “genes”
    if entities["gene"] and not _is_plausible_gene(entities["gene"]):
        entities["gene"] = None
    # Canonicalize p53 family
    if entities.get("gene") and entities["gene"].upper() in ("P53", "TP53", "TRP53"):
        entities["gene"] = "Trp53" if mouseish else "TP53"

    return entities


def _mentions_mutation(message: str, entities: dict[str, Any] | None = None) -> bool:
    """Detect mutation / variant / PTM-disruption precision-medicine intent."""
    if entities and entities.get("mutation_label"):
        return True
    mut_keywords = (
        "mutation", "mutations", "mutant", "missense", "somatic", "germline",
        "variant", "variants", "clinvar", "mc3", "pcawg", "ptmvar", "nssnp",
        "snp", "snv", "disrupt", "disrupts", "destroy", "abolish", "rewiring",
        "rewire", "loss of phosphorylation", "site loss", "site gain",
        "kinase-dead", "kinase dead", "gain-of-function", "loss-of-function",
        "gof", "lof", "enzyme activity", "kinase activity",
        "突变", "体细胞", "胚系", "变异", "破坏", "废除", "位点丢失", "位点获得",
        "重布线", "激酶重连", "激酶失活", "酶活性", "激酶活性",
    )
    msg_lower = message.lower()
    return any(kw in msg_lower for kw in mut_keywords)


def _build_pubtator_query(entities: dict[str, Any], message: str) -> str:
    """Build a PubTator keyword query from parsed entities and user context."""
    parts: list[str] = []
    gene = entities.get("gene")
    position = entities.get("position")
    ptm_type = (entities.get("ptm_type") or "").strip()
    uniprot = entities.get("uniprot_ac")
    mut_label = entities.get("mutation_label")

    if gene:
        parts.append(str(gene))
    if mut_label:
        parts.append(str(mut_label))
    elif position:
        parts.append(str(position))
    if ptm_type:
        parts.append(ptm_type)
    if (
        mut_label
        or entities.get("narrative") == "mutation_precision"
        or _mentions_mutation(message or entities.get("query") or "", entities)
    ):
        parts.append("mutation")
        parts.append("cancer")
    if uniprot and not gene:
        parts.append(str(uniprot))

    if parts:
        return " ".join(parts)

    # Fall back to the user message with workflow boilerplate stripped
    cleaned = re.sub(
        r"\b(who|when|where|why|stage|search|query|tell me|what|which|how)\b",
        " ",
        message,
        flags=re.I,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:240] if cleaned else message.strip()[:240]


def infer_tool_arguments(
    tool_name: str,
    entities: dict[str, Any],
    state: Any | None = None,
) -> dict[str, Any]:
    """Infer tool call arguments from parsed entities (deterministic routing).

    ``state`` must be a ConversationState (or None). Passing a string query here
    is unsupported — put the query into ``entities["query"]`` instead.
    """
    # Guard against historical misuse (query str passed as 3rd arg).
    if state is not None and not hasattr(state, "target_uniprot_ac"):
        state = None

    from app.sources.uniprot_id import normalize_uniprot_ac

    gene = entities.get("gene") or (getattr(state, "target_gene", None) if state else None)
    uniprot = entities.get("uniprot_ac") or (getattr(state, "target_uniprot_ac", None) if state else None)
    if uniprot:
        uniprot = normalize_uniprot_ac(str(uniprot)) or uniprot
    position = entities.get("position") or (getattr(state, "target_position", None) if state else None)
    ptm_type = entities.get("ptm_type") or (
        getattr(state, "target_ptm_type", None) if state else None
    ) or "phosphorylation"
    organism = entities.get("organism", "human")
    query = entities.get("query", "")

    if tool_name == "qptm_search":
        from app.sources.uniprot_id import organism_id_for, resolve_identity
        from app.tools.identity_guard import check_gene_accession_mismatch

        org_id = organism_id_for(organism)
        if gene and uniprot and check_gene_accession_mismatch(gene, uniprot):
            pass  # preserve stale pair — registry.execute will refuse
        elif gene or uniprot:
            ident = resolve_identity(uniprot_ac=uniprot, gene=gene, organism_id=org_id)
            if ident:
                gene = ident.get("gene") or gene
                uniprot = ident.get("uniprot_ac") or uniprot
        search_q = gene or query
        field = "uniprot" if uniprot else ("gene" if gene else "any")
        if uniprot:
            search_q = uniprot
        out: dict[str, Any] = {
            "query": search_q,
            "field": field,
            "organism": organism,
            "ptm_type": ptm_type,
            "per_page": 20,
        }
        if gene:
            out["gene"] = gene
        if uniprot:
            out["uniprot_ac"] = uniprot
        return out

    if tool_name == "qptm_site_conditions":
        if not (uniprot and position):
            return {}
        args: dict[str, Any] = {
            "uniprot_ac": uniprot,
            "position": position,
            "ptm_type": ptm_type,
        }
        ctype = str(entities.get("contrast_type") or "").strip().lower()
        if ctype:
            args["contrast_type"] = ctype
        return args

    if tool_name == "qptm_kinases":
        if not (uniprot and position):
            return {}
        return {"uniprot_ac": uniprot, "position": position}

    if tool_name == "uniprot_annotation":
        if not uniprot:
            return {}
        return {"uniprot_ac": uniprot}

    if tool_name == "signalp_prediction":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if position:
            args["site_position"] = position
        return args

    if tool_name in ("iptmnet_enzymes", "iptmnet_ptm_ppi", "psp_regulatory",
                     "dbptm_functional", "ptm_stability",
                     "psp_kinase_substrate", "psp_disease_sites", "psp_ptmvar",
                     "interpro_domains", "pfam_domains"):
        args = {}
        if uniprot:
            args["uniprot_ac"] = uniprot
        elif gene:
            args["gene"] = gene
        if position and tool_name != "uniprot_annotation":
            args["position"] = position
        if tool_name in ("psp_regulatory", "ptm_stability", "dbptm_functional"):
            args["ptm_type"] = ptm_type
        return args

    if tool_name in ("activedriver_mutations", "activedriver_kinase_network"):
        if not gene:
            return {}
        args: dict[str, Any] = {"gene": gene}
        if position:
            args["site_position"] = position
        if tool_name == "activedriver_mutations":
            # Cancer precision medicine: germline + somatic cohorts
            args["datasets"] = "clinvar,mc3,pcawg"
        return args

    if tool_name == "pmads_drug_ptm":
        args = {}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if position:
            args["site_position"] = position
        if ptm_type:
            args["ptm_type"] = ptm_type
        args["status"] = "Curated"
        if not (gene or uniprot):
            return {}
        return args

    if tool_name == "drugbank_targets":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        return args

    if tool_name == "weram_regulators":
        args: dict[str, Any] = {}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if ptm_type in ("acetylation", "methylation"):
            args["modification"] = ptm_type
        if not (gene or uniprot or args.get("modification")):
            return {}
        return args

    if tool_name == "ubibrowser_interactions":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {"include_predicted": True, "min_confidence": 0.8}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if ptm_type in ("ubiquitylation", "ubiquitination"):
            args["enzyme_type"] = "any"
        return args

    if tool_name == "gpsuber_e3_sites":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if position:
            args["position"] = position
        return args

    if tool_name == "gps6_kinases":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {"min_score": 1.0}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if position:
            args["position"] = position
        return args

    if tool_name == "kaka_kinase_mutations":
        if not (gene or uniprot or entities.get("mutation_label")):
            return {}
        args: dict[str, Any] = {}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        mut_label = entities.get("mutation_label")
        if mut_label:
            args["mutation"] = str(mut_label)
        elif position:
            args["position"] = position
        if organism:
            args["organism"] = organism
        return args

    if tool_name == "ekpi_kinases":
        if not ((gene or uniprot) and position):
            return {}
        args: dict[str, Any] = {"evidence_type": "any"}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        args["position"] = position
        return args

    if tool_name == "ekpi_quantitative":
        if not ((gene or uniprot) and position):
            return {}
        args: dict[str, Any] = {
            "cohort": "tumor",
            "max_pvalue": 0.05,
        }
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        args["position"] = position
        return args

    if tool_name == "gpssumo2_sites":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {
            "organism": organism or "human",
            "include_sims": True,
        }
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if position:
            args["position"] = position
        return args

    if tool_name == "decryptm_drug_ptm":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {"only_regulated": True}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if position:
            args["site_position"] = position
        if ptm_type:
            args["modification_type"] = ptm_type
        return args

    if tool_name in ("ptmphase_llps", "ptmphase_phosllps", "dscope_literature", "dscope_predictions"):
        if not (gene or uniprot):
            return {}
        args = {}
        if uniprot:
            args["uniprot_ac"] = uniprot
        if gene:
            args["gene"] = gene
        if position:
            args["site_position"] = position
        if tool_name == "ptmphase_llps" and ptm_type:
            args["ptm_type"] = ptm_type
        return args

    if tool_name == "ptmd_disease":
        if not (gene or uniprot):
            return {}
        args = {}
        if uniprot:
            args["uniprot_ac"] = uniprot
        if gene:
            args["gene"] = gene
        if position:
            args["position"] = position
        if ptm_type:
            args["ptm_type"] = ptm_type
        args["source"] = "both"
        return args

    if tool_name == "cancerproteome_disease":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {"query_type": "both"}
        if uniprot:
            args["uniprot_ac"] = uniprot
        if gene:
            args["gene"] = gene
        if position:
            args["position"] = position
        return args

    if tool_name == "ptmint_ppi":
        if not (gene or uniprot):
            return {}
        args = {}
        if uniprot:
            args["uniprot_ac"] = uniprot
        if gene:
            args["gene"] = gene
        if position:
            args["site_position"] = position
        if ptm_type:
            args["ptm_type"] = ptm_type
        return args

    if tool_name in ("string_ppi", "biogrid_interactions", "intact_interactions"):
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {"organism": organism or "human"}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        if tool_name == "string_ppi":
            args["network_type"] = "physical"
            args["required_score"] = 400
        elif tool_name == "biogrid_interactions":
            args["evidence_type"] = "physical"
        return args

    if tool_name in ("reactome_pathways", "kegg_pathways", "pathbank_pathways"):
        if not (gene or uniprot):
            return {}
        args = {"organism": organism or "human"}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        return args

    if tool_name == "ptmcode_associations":
        if not gene:
            return {}
        args = {"gene": gene, "scope": "both", "organism": organism or "human"}
        if position:
            args["position"] = position
        return args

    if tool_name in ("inuloc_nls_nes", "inuloc_nuclear_prob"):
        if not (gene or uniprot):
            return {}
        args = {}
        if uniprot:
            args["uniprot_ac"] = uniprot
        if gene:
            args["gene"] = gene
        if tool_name == "inuloc_nuclear_prob":
            args["organism"] = organism if organism in ("human", "mouse", "rat", "yeast") else "human"
        return args

    if tool_name == "compartments_localization":
        if not (gene or uniprot):
            return {}
        args: dict[str, Any] = {"min_confidence": 3.0}
        if uniprot:
            args["uniprot_ac"] = uniprot
        if gene:
            args["gene"] = gene
        return args

    if tool_name == "subcell_scsi":
        if not (gene or uniprot):
            return {}
        args = {"organism": organism or "human", "include_locations": True}
        if gene:
            args["gene"] = gene
        if uniprot:
            args["uniprot_ac"] = uniprot
        return args

    if tool_name == "funcscore_phosphosite":
        if not uniprot:
            return {}
        args: dict[str, Any] = {"uniprot_ac": uniprot}
        if position:
            args["site_position"] = position
        return args

    if tool_name == "pubtator_literature_search":
        return {
            "query": _build_pubtator_query(entities, query or ""),
            "limit": 20,
        }

    if tool_name in ("pubmed_esearch", "europepmc_literature_search"):
        q = (query or entities.get("query") or "").strip()
        if not q:
            return {}
        return {"query": q, "limit": 20}

    if tool_name == "pubmed_fetch_abstracts":
        pmids = entities.get("pmids")
        if not pmids:
            return {}
        args: dict[str, Any] = {"pmids": pmids}
        if entities.get("max_chars"):
            args["max_chars"] = entities["max_chars"]
        return args

    if tool_name == "pubmed_fetch_fulltext":
        pmids = entities.get("pmids") or entities.get("fulltext_pmids")
        if not pmids:
            return {}
        args = {"pmids": pmids}
        if entities.get("max_chars"):
            args["max_chars"] = entities["max_chars"]
        return args

    return {"query": query}

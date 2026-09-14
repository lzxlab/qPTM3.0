"""PTM knowledge-base grouping for tool retrieval."""

from __future__ import annotations

import re

from app.agent.gate import QUERY_MODE_LITERATURE, QUERY_MODE_PMID_LOOKUP, QUERY_MODE_RESEARCH
from app.agent.memory import InvestigationMemory

KB_QUANTITATIVE = "quantitative"
KB_REGULATORS = "regulators"
KB_CONTEXT = "context"
KB_FUNCTION = "function"
KB_VARIANTS = "variants"
KB_LITERATURE = "literature"

KB_TOOLS: dict[str, list[str]] = {
    KB_QUANTITATIVE: [
        "qptm_search", "qptm_site_conditions", "qptm_kinases",
        "ekpi_quantitative", "cancerproteome_disease",
    ],
    KB_REGULATORS: [
        "qptm_kinases", "iptmnet_enzymes", "psp_kinase_substrate",
        "gps6_kinases", "weram_regulators", "ubibrowser_interactions",
        "pmads_drug_ptm", "drugbank_targets", "decryptm_drug_ptm",
        "ekpi_kinases", "kaka_kinase_mutations",
    ],
    KB_CONTEXT: [
        "uniprot_annotation", "compartments_localization", "subcell_scsi",
        "inuloc_nls_nes", "signalp_prediction", "interpro_domains", "pfam_domains",
    ],
    KB_FUNCTION: [
        "psp_regulatory", "ptm_stability", "ptmd_disease", "funcscore_phosphosite",
        "ptmcode_associations", "string_ppi", "ptmint_ppi", "iptmnet_ptm_ppi",
        "ptmphase_llps", "dscope_predictions", "reactome_pathways", "kegg_pathways",
    ],
    KB_VARIANTS: [
        "activedriver_mutations", "activedriver_kinase_network",
        "psp_ptmvar", "dbptm_functional",
    ],
    KB_LITERATURE: [
        "pubtator_literature_search", "pubmed_esearch", "europepmc_literature_search",
        "pubmed_fetch_abstracts", "pubmed_fetch_fulltext",
    ],
}

_BROAD_RE = re.compile(
    r"\b(overview|comprehensive|全面|介绍|综述|summarize|summary|tell me about)\b",
    re.I,
)
_KINASE_RE = re.compile(
    r"\b(kinase|kinases|enzyme|phosphorylat|upstream|激酶|谁磷酸化|调控)\b",
    re.I,
)
_CONDITION_RE = re.compile(
    r"\b(condition|fold|log2|time|kinetics|treatment|定量|条件|倍数|时程)\b",
    re.I,
)
_WHERE_RE = re.compile(
    r"\b(locali[sz]|compartment|subcellular|domain|定位|细胞|结构域)\b",
    re.I,
)
_WHY_RE = re.compile(
    r"\b(function|disease|stability|mechanism|pathway|功能|疾病|机制|意义)\b",
    re.I,
)
_MUTATION_RE = re.compile(
    r"\b(mutation|variant|somatic|clinvar|ptmvar|突变|变异)\b",
    re.I,
)


def tool_knowledge_base(tool_name: str) -> str | None:
    for kb, tools in KB_TOOLS.items():
        if tool_name in tools:
            return kb
    return None


def is_literature_tool(tool_name: str) -> bool:
    return tool_name in KB_TOOLS[KB_LITERATURE]


def select_knowledge_bases(question: str, memory: InvestigationMemory) -> list[str]:
    """Pick 1–4 KB groups for the current question."""
    mode = memory.query_mode or ""
    if mode in (QUERY_MODE_LITERATURE, QUERY_MODE_PMID_LOOKUP):
        return [KB_LITERATURE]

    msg = (question or "").lower()
    scores: dict[str, int] = {
        KB_QUANTITATIVE: 0,
        KB_REGULATORS: 0,
        KB_CONTEXT: 0,
        KB_FUNCTION: 0,
        KB_VARIANTS: 0,
    }
    if _KINASE_RE.search(msg):
        scores[KB_REGULATORS] += 2
    if _CONDITION_RE.search(msg):
        scores[KB_QUANTITATIVE] += 2
    if _WHERE_RE.search(msg):
        scores[KB_CONTEXT] += 2
    if _WHY_RE.search(msg):
        scores[KB_FUNCTION] += 2
    if _MUTATION_RE.search(msg):
        scores[KB_VARIANTS] += 2

    if _BROAD_RE.search(msg):
        return [KB_QUANTITATIVE, KB_REGULATORS, KB_FUNCTION, KB_LITERATURE]

    picked = [kb for kb, sc in sorted(scores.items(), key=lambda x: x[1], reverse=True) if sc > 0]
    if not picked:
        picked = [KB_REGULATORS, KB_QUANTITATIVE, KB_FUNCTION]

    return picked[:4]


def select_knowledge_bases_for_depth(
    question: str,
    memory: InvestigationMemory,
    *,
    include_literature: bool,
) -> list[str]:
    """KB selection respecting query depth (omit literature KB when not needed)."""
    kbs = select_knowledge_bases(question, memory)
    if not include_literature:
        kbs = [k for k in kbs if k != KB_LITERATURE]
    return kbs


def tools_for_kbs(kbs: list[str], valid: set[str]) -> list[str]:
    out: list[str] = []
    for kb in kbs:
        for tool in KB_TOOLS.get(kb, []):
            if tool in valid and tool not in out:
                out.append(tool)
    return out

"""Planning helpers still used by MCP ``qptm_invoke`` (argument inference).

Chat ReAct / HTTP planning lives in agent-runtime. Do not add a second agent
loop here. Live MCP entry points: ``infer_tool_arguments``, ``parse_query_entities``.
"""

from __future__ import annotations

import re
from typing import Any

from app.models.schemas import PlanStep, PlanStepStatus, ResearchPlan, WorkflowStage
from app.workflow.stages import get_stage_label
from app.workflow.state import ConversationState

# ── Database & tool catalog (planning metadata) ──────────────────

DATABASE_CATALOG: dict[str, dict[str, str]] = {
    "qPTM": {
        "name": "qPTM",
        "type": "database",
        "description": "Quantitative PTM events, site conditions, integrated kinases",
        "url": "https://qptm3.omicsbio.info",
    },
    "iPTMnet": {
        "name": "iPTMnet",
        "type": "database",
        "description": (
            "Integrated PTM network resource — enzyme–substrate sites and "
            "PTM-dependent PPI via REST API v1; PMID 29145615"
        ),
        "url": "https://research.bioinformatics.udel.edu/iptmnet/",
    },
    "UniProt": {
        "name": "UniProt",
        "type": "database",
        "description": "Protein function, PTM annotations, disease associations",
        "url": "https://www.uniprot.org",
    },
    "InterPro": {
        "name": "InterPro",
        "type": "database",
        "description": (
            "Protein family classification and predicted domains via REST API; "
            "PMID 30398656"
        ),
        "url": "https://www.ebi.ac.uk/interpro/",
    },
    "Pfam": {
        "name": "Pfam",
        "type": "database",
        "description": (
            "Manually curated protein families (via InterPro API); PMID 30357350"
        ),
        "url": "https://www.ebi.ac.uk/interpro/entry/pfam/",
    },
    "PhosphoSitePlus": {
        "name": "PhosphoSitePlus",
        "type": "database",
        "description": "Regulatory sites, kinases, disease PTMs, PTMVars; PMID 30445427",
        "url": "https://www.phosphosite.org",
    },
    "dbPTM": {
        "name": "dbPTM",
        "type": "database",
        "description": "nsSNP-linked disease associations for PTM sites",
        "url": "https://biomics.lab.nycu.edu.tw/dbPTM/",
    },
    "ActiveDriverDB": {
        "name": "ActiveDriverDB",
        "type": "database",
        "description": "Mutations affecting PTM sites (ClinVar/TCGA/PCAWG/population) and kinase–target network",
        "url": "https://activedriverdb.org",
    },
    "PMADS": {
        "name": "PMADS",
        "type": "database",
        "description": "Drug–PTM–disease associations (curated + inferred); PMID 41099621",
        "url": "https://pmads-db.org",
    },
    "DrugBank": {
        "name": "DrugBank",
        "type": "database",
        "description": "Drug–target associations (DrugBank 6.0); PMID 37953279",
        "url": "https://go.drugbank.com",
    },
    "WERAM": {
        "name": "WERAM",
        "type": "database",
        "description": (
            "Histone acetylation/methylation writers, erasers and readers "
            "(HAT/HDAC/HMT/HDM/readers); PMID 27789692"
        ),
        "url": "http://weram.biocuckoo.org",
    },
    "UbiBrowser": {
        "name": "UbiBrowser",
        "type": "database",
        "description": (
            "E3 ligase / DUB–substrate interactions (known + predicted); "
            "PMID 34634807"
        ),
        "url": "http://ubibrowser.bio-it.cn/ubibrowser_v3/home/index",
    },
    "GPS-Uber": {
        "name": "GPS-Uber",
        "type": "database",
        "description": (
            "Site-specific E3–substrate ubiquitination relations (ssESRs); "
            "PMID 35037020"
        ),
        "url": "http://gpsuber.biocuckoo.cn/",
    },
    "GPS 6.0": {
        "name": "GPS 6.0",
        "type": "database",
        "description": (
            "Kinase-specific phosphorylation sites (GPS 6.0); "
            "PMID 37158278"
        ),
        "url": "https://gps.biocuckoo.cn",
    },
    "KAKA": {
        "name": "KAKA",
        "type": "database",
        "description": (
            "Kinase activity–related key alterations (mutation → enzyme activity); "
            "PMID 41839313"
        ),
        "url": "https://kaka.omicsbio.info/",
    },
    "eKPI": {
        "name": "eKPI",
        "type": "database",
        "description": (
            "Quantitative kinase–phosphosite correlations from cancer multi-omics "
            "(Spearman ρ; tumor/normal); PMID 40194556"
        ),
        "url": "https://ekpi.omicsbio.info/",
    },
    "GPS-SUMO 2.0": {
        "name": "GPS-SUMO 2.0",
        "type": "database",
        "description": (
            "Curated experimental SUMOylation sites and SIMs "
            "(GPS-SUMO 2.0 training/test sets); PMID 38709873"
        ),
        "url": "https://sumo.biocuckoo.cn/",
    },
    "decryptM": {
        "name": "decryptM",
        "type": "database",
        "description": "Drug–PTM dose-response curves (ProteomicsDB); PMID 36926954",
        "url": "https://www.proteomicsdb.org/decryptm",
    },
    "PTMPhaSe": {
        "name": "PTMPhaSe",
        "type": "database",
        "description": "PTM regulation of LLPS (experimental + PhosLLPS predictions); PMID 41360972",
        "url": "https://ptmphase.sjtu.edu.cn",
    },
    "dSCOPE": {
        "name": "dSCOPE",
        "type": "database",
        "description": "LLPS-driving sequence regions (literature + proteome predictions); PMID 36528388",
        "url": "https://dscope.omicsbio.info",
    },
    "PTMD": {
        "name": "PTMD",
        "type": "database",
        "description": "Disease-associated PTMs (PDAs, 6 state classes); PMID 39329270",
        "url": "https://ptmd.biocuckoo.cn/",
    },
    "CancerProteome": {
        "name": "CancerProteome",
        "type": "database",
        "description": "Cancer vs normal PTM/protein quantification across 21 cancer types; PMID 37823596",
        "url": "http://bio-bigdata.hrbmu.edu.cn/CancerProteome",
    },
    "PTMint": {
        "name": "PTMint",
        "type": "database",
        "description": "PTM regulation of PPIs (Enhance/Inhibit); PMID 36548389",
        "url": "https://ptmint.sjtu.edu.cn/",
    },
    "STRING": {
        "name": "STRING",
        "type": "database",
        "description": "Scored protein association networks; PMID 39558183",
        "url": "https://string-db.org",
    },
    "BioGRID": {
        "name": "BioGRID",
        "type": "database",
        "description": "Curated protein/genetic/chemical interactions; PMID 33070389",
        "url": "https://thebiogrid.org",
    },
    "IntAct": {
        "name": "IntAct",
        "type": "database",
        "description": "Curated molecular interactions (IMEx/PSICQUIC); PMID 34761267",
        "url": "https://www.ebi.ac.uk/intact",
    },
    "Reactome": {
        "name": "Reactome",
        "type": "database",
        "description": "Curated pathway reactions / signaling maps; PMID 29145629",
        "url": "https://reactome.org",
    },
    "KEGG": {
        "name": "KEGG",
        "type": "database",
        "description": "Organism pathway maps from molecular datasets; PMID 30321428",
        "url": "https://www.kegg.jp",
    },
    "PathBank": {
        "name": "PathBank",
        "type": "database",
        "description": "Model-organism pathways (SMPDB/PathBank family index); PMID 31602469",
        "url": "https://pathbank.org",
    },
    "PTMcode2": {
        "name": "PTMcode2",
        "type": "database",
        "description": "Functional PTM–PTM associations within/between proteins; PMID 25361965",
        "url": "http://ptmcode.embl.de",
    },
    "NLSdb": {
        "name": "NLSdb",
        "type": "database",
        "description": "NLS/NES motif database (experimental + in silico); PMID 29106588",
        "url": "https://rostlab.org/services/nlsdb/",
    },
    "COMPARTMENTS": {
        "name": "COMPARTMENTS",
        "type": "database",
        "description": "Protein subcellular localization evidence with confidence; PMID 24573882",
        "url": "https://compartments.jensenlab.org/",
    },
    "SubCELL": {
        "name": "SubCELL",
        "type": "database",
        "description": "Compartment-specific molecular interactions (SCSIs); PMID 39373488",
        "url": "https://subcell.idrblab.cn/",
    },
    "iNuLoC": {
        "name": "iNuLoC",
        "type": "database",
        "description": "DNL regions and nuclear localization probability; PMID 40087285",
        "url": "http://inuloc.omicsbio.info/",
    },
    "PTM-stability": {
        "name": "PTM-stability",
        "type": "curated dataset",
        "description": "PTM effects on protein stability (primary PMIDs; curated from PMC9839724)",
        "url": "",
    },
    "Funcscore": {
        "name": "Funcscore",
        "type": "curated dataset",
        "description": "Functional scores for human phosphosites (Ochoa et al.); PMID 31819260",
        "url": "https://www.nature.com/articles/s41587-019-0344-3",
    },
    "PubTator3": {
        "name": "PubTator3",
        "type": "literature",
        "description": (
            "NCBI biomedical literature search with entity/relation annotations; "
            "PMID 38460829"
        ),
        "url": "https://www.ncbi.nlm.nih.gov/research/pubtator3/",
    },
}

TOOL_ROUTING: dict[str, dict[str, Any]] = {
    "qptm_search": {
        "database": "qPTM",
        "stage": WorkflowStage.conditions,
        "title": "Search quantitative PTM events",
        "description": "Query qPTM for PTM events matching the protein, site, or keyword",
    },
    "qptm_site_conditions": {
        "database": "qPTM",
        "stage": WorkflowStage.conditions,
        "title": "Retrieve site-specific conditions",
        "description": "Get experimental conditions, time points and log2 ratios for a PTM site",
    },
    "qptm_kinases": {
        "database": "qPTM",
        "stage": WorkflowStage.kinase,
        "title": "Identify kinases from qPTM",
        "description": "Query integrated experimental and predicted kinase-substrate data",
    },
    "iptmnet_enzymes": {
        "database": "iPTMnet",
        "stage": WorkflowStage.kinase,
        "title": "Identify enzymes via iPTMnet",
        "description": (
            "REST /v1/{id}/substrate — kinases, acetyltransferases, E3 ligases "
            "(Huang et al. NAR 2018; PMID 29145615)"
        ),
    },
    "psp_regulatory": {
        "database": "PhosphoSitePlus",
        "stage": WorkflowStage.function,
        "title": "Regulatory annotations (PSP)",
        "description": "ON_FUNCTION, ON_PROCESS and interaction effects from Regulatory_sites",
    },
    "psp_kinase_substrate": {
        "database": "PhosphoSitePlus",
        "stage": WorkflowStage.kinase,
        "title": "Kinase–substrate (PSP)",
        "description": "Literature-curated kinase→substrate sites with in vivo/in vitro flags",
    },
    "weram_regulators": {
        "database": "WERAM",
        "stage": WorkflowStage.kinase,
        "title": "Histone Ac/Me writers/erasers/readers (WERAM)",
        "description": (
            "Classify proteins as histone acetylation/methylation writers, "
            "erasers or readers (Xu et al. NAR 2017; PMID 27789692)"
        ),
    },
    "ubibrowser_interactions": {
        "database": "UbiBrowser",
        "stage": WorkflowStage.kinase,
        "title": "E3/DUB–substrate (UbiBrowser)",
        "description": (
            "Literature + predicted ubiquitin ligase/deubiquitinase–substrate "
            "interactions (Wang et al. NAR 2022; PMID 34634807)"
        ),
    },
    "gpsuber_e3_sites": {
        "database": "GPS-Uber",
        "stage": WorkflowStage.kinase,
        "title": "Site-specific E3–substrate (GPS-Uber)",
        "description": (
            "Literature site-specific E3→lysine ubiquitination relations "
            "(Wang et al. Brief Bioinform 2022; PMID 35037020)"
        ),
    },
    "gps6_kinases": {
        "database": "GPS 6.0",
        "stage": WorkflowStage.kinase,
        "title": "Kinases (GPS 6.0)",
        "description": (
            "GPS 6.0 kinase-specific phosphorylation sites "
            "(Chen et al. NAR 2023; PMID 37158278)"
        ),
    },
    "gpssumo2_sites": {
        "database": "GPS-SUMO 2.0",
        "stage": WorkflowStage.kinase,
        "title": "SUMOylation sites / SIMs (GPS-SUMO 2.0)",
        "description": (
            "Curated experimental SUMOylation lysines and SIMs from "
            "GPS-SUMO 2.0 training/test sets (Wang et al. NAR 2024; PMID 38709873)"
        ),
    },
    "kaka_kinase_mutations": {
        "database": "KAKA",
        "stage": WorkflowStage.function,
        "title": "Kinase activity alterations (KAKA)",
        "description": (
            "Literature-curated mutations affecting kinase enzyme activity "
            "(increase / decrease / kinase-dead / no-effect); PMID 41839313"
        ),
    },
    "ekpi_kinases": {
        "database": "eKPI",
        "stage": WorkflowStage.kinase,
        "title": "Kinase–site evidence (eKPI)",
        "description": (
            "Experimental + tool-predicted kinases for a phosphosite "
            "(optional quantitative summary); PMID 40194556"
        ),
    },
    "ekpi_quantitative": {
        "database": "eKPI",
        "stage": WorkflowStage.kinase,
        "title": "Quantitative KPS correlations (eKPI)",
        "description": (
            "Cancer multi-omics Spearman correlations between kinase "
            "mRNA/protein/phosphosites and a substrate phosphosite; PMID 40194556"
        ),
    },
    "psp_disease_sites": {
        "database": "PhosphoSitePlus",
        "stage": WorkflowStage.function,
        "title": "Disease-associated sites (PSP)",
        "description": "PTM sites correlated with disease states (increased/decreased)",
    },
    "psp_ptmvar": {
        "database": "PhosphoSitePlus",
        "stage": WorkflowStage.function,
        "title": "PTMVars (mutation near PTM)",
        "description": "Class I/II variants that perturb PTM residues or ±5 aa flanks",
    },
    "uniprot_annotation": {
        "database": "UniProt",
        "stage": WorkflowStage.where,
        "title": "Protein context annotation",
        "description": "Retrieve function, domains and cellular roles for WHERE context",
    },
    "interpro_domains": {
        "database": "InterPro",
        "stage": WorkflowStage.where,
        "title": "InterPro domains / families",
        "description": (
            "REST entry→protein — families, domains, sites "
            "(Mitchell et al. NAR 2019; PMID 30398656)"
        ),
    },
    "pfam_domains": {
        "database": "Pfam",
        "stage": WorkflowStage.where,
        "title": "Pfam family signatures",
        "description": (
            "Pfam matches via InterPro API "
            "(El-Gebali et al. NAR 2019; PMID 30357350)"
        ),
    },
    "iptmnet_ptm_ppi": {
        "database": "iPTMnet",
        "stage": WorkflowStage.function,
        "title": "PTM-dependent interactions",
        "description": (
            "REST /v1/{id}/ptmppi — interactions modulated by PTM "
            "(PMID 29145615)"
        ),
    },
    "dbptm_functional": {
        "database": "dbPTM",
        "stage": WorkflowStage.function,
        "title": "Disease associations (nsSNP)",
        "description": "Query dbPTM for nsSNP-linked disease associations near PTM sites",
    },
    "ptm_stability": {
        "database": "PTM-stability",
        "stage": WorkflowStage.function,
        "title": "PTM stability effects",
        "description": "Check curated PTM-stability relationships",
    },
    "activedriver_mutations": {
        "database": "ActiveDriverDB",
        "stage": WorkflowStage.function,
        "title": "PTM-site mutations (disease/cancer)",
        "description": "ClinVar / TCGA / PCAWG / population variants affecting PTM sites",
    },
    "activedriver_kinase_network": {
        "database": "ActiveDriverDB",
        "stage": WorkflowStage.kinase,
        "title": "ActiveDriver kinase–target network",
        "description": "Site-specific kinase–substrate edges from ActiveDriverDB",
    },
    "pmads_drug_ptm": {
        "database": "PMADS",
        "stage": WorkflowStage.kinase,
        "title": "Drug–PTM–disease associations",
        "description": "Upstream drugs and drug–PTM links that regulate the site",
    },
    "drugbank_targets": {
        "database": "DrugBank",
        "stage": WorkflowStage.kinase,
        "title": "Drug–target associations (DrugBank)",
        "description": "Drugs that target the protein (ID, action, approval groups)",
    },
    "decryptm_drug_ptm": {
        "database": "decryptM",
        "stage": WorkflowStage.kinase,
        "title": "Drug–PTM dose-response (decryptM)",
        "description": "ProteomicsDB decryptM curves: which drugs regulate this PTM",
    },
    "ptmphase_llps": {
        "database": "PTMPhaSe",
        "stage": WorkflowStage.function,
        "title": "PTM–LLPS experimental evidence",
        "description": "Curated PTM effects on liquid–liquid phase separation",
    },
    "ptmphase_phosllps": {
        "database": "PTMPhaSe",
        "stage": WorkflowStage.function,
        "title": "PhosLLPS predicted LLPS sites",
        "description": "Predicted functional phosphorylation sites regulating LLPS",
    },
    "dscope_literature": {
        "database": "dSCOPE",
        "stage": WorkflowStage.function,
        "title": "dSCOPE literature LLPS-driving segments",
        "description": "Experimentally identified LLPS-driving sequence segments from literature",
    },
    "dscope_predictions": {
        "database": "dSCOPE",
        "stage": WorkflowStage.function,
        "title": "dSCOPE predicted PS-driving regions",
        "description": "Human proteome predictions of phase-separation driving regions",
    },
    "ptmd_disease": {
        "database": "PTMD",
        "stage": WorkflowStage.function,
        "title": "Disease-associated PTMs (PTMD)",
        "description": "PTM–disease associations with U/D/A/P/C/N state classes",
    },
    "cancerproteome_disease": {
        "database": "CancerProteome",
        "stage": WorkflowStage.conditions,
        "title": "Cancer vs normal PTM/protein (CancerProteome)",
        "description": (
            "Tumor/control differential PTM ratios and protein abundance by cancer type "
            "(WHEN quantification + WHY disease context)"
        ),
    },
    "ptmint_ppi": {
        "database": "PTMint",
        "stage": WorkflowStage.function,
        "title": "PTM-regulated PPIs (PTMint)",
        "description": "Curated experimental PTM enhance/inhibit protein interactions",
    },
    "string_ppi": {
        "database": "STRING",
        "stage": WorkflowStage.function,
        "title": "STRING association partners",
        "description": "Scored functional/physical/regulatory protein partners",
    },
    "biogrid_interactions": {
        "database": "BioGRID",
        "stage": WorkflowStage.function,
        "title": "BioGRID curated interactions",
        "description": "Experimental physical/genetic interactions with PMIDs",
    },
    "intact_interactions": {
        "database": "IntAct",
        "stage": WorkflowStage.function,
        "title": "IntAct molecular interactions",
        "description": "IMEx-quality interactions via PSICQUIC",
    },
    "reactome_pathways": {
        "database": "Reactome",
        "stage": WorkflowStage.function,
        "title": "Reactome pathways",
        "description": "Curated pathways containing the protein",
    },
    "kegg_pathways": {
        "database": "KEGG",
        "stage": WorkflowStage.function,
        "title": "KEGG pathways",
        "description": "Organism pathway maps linked to the gene",
    },
    "pathbank_pathways": {
        "database": "PathBank",
        "stage": WorkflowStage.function,
        "title": "PathBank pathways",
        "description": "Metabolic / disease / signaling pathways (PathBank family)",
    },
    "ptmcode_associations": {
        "database": "PTMcode2",
        "stage": WorkflowStage.function,
        "title": "PTM–PTM associations (PTMcode2)",
        "description": "Human high-evidence PTM pairs within proteins or between PPIs",
    },
    "inuloc_nls_nes": {
        "database": "NLSdb",
        "stage": WorkflowStage.where,
        "title": "NLS/NES motifs (NLSdb) + DNL (iNuLoC)",
        "description": "NLSdb experimental/predicted NLS/NES; iNuLoC DNL regions",
    },
    "inuloc_nuclear_prob": {
        "database": "iNuLoC",
        "stage": WorkflowStage.where,
        "title": "Nuclear localization probability",
        "description": "iNuLoC nuclear localization probability",
    },
    "compartments_localization": {
        "database": "COMPARTMENTS",
        "stage": WorkflowStage.where,
        "title": "Subcellular localization (COMPARTMENTS)",
        "description": "GO cellular-component evidence with confidence scores",
    },
    "subcell_scsi": {
        "database": "SubCELL",
        "stage": WorkflowStage.where,
        "title": "Compartment-specific PPIs (SubCELL)",
        "description": "Where the protein interacts (SCSIs) and location annotations",
    },
    "funcscore_phosphosite": {
        "database": "Funcscore",
        "stage": WorkflowStage.function,
        "title": "Phosphosite functional score",
        "description": "Ochoa et al. ML functional priority score (0–1) for human phosphosites",
    },
    "pubtator_literature_search": {
        "database": "PubTator3",
        "stage": WorkflowStage.function,
        "title": "Related literature (PubTator3)",
        "description": (
            "Supplementary PubMed recommendations when integrated databases "
            "cannot fully cover the question (NCBI PubTator3; PMID 38460829)"
        ),
    },
}

# Stage → ordered tools for a full research workflow (WHO → WHEN → WHERE → WHY)
STAGE_TOOL_SEQUENCE: dict[WorkflowStage, list[str]] = {
    WorkflowStage.kinase: [
        "qptm_kinases",
        "iptmnet_enzymes",
        "psp_kinase_substrate",
        "gps6_kinases",
        "weram_regulators",
        "ubibrowser_interactions",
        "gpsuber_e3_sites",
        "gpssumo2_sites",
        "ekpi_kinases",
        "ekpi_quantitative",
        "kaka_kinase_mutations",
        "activedriver_kinase_network",
        "pmads_drug_ptm",
        "drugbank_targets",
        "decryptm_drug_ptm",
    ],
    WorkflowStage.conditions: [
        "qptm_search",
        "qptm_site_conditions",
        "cancerproteome_disease",
        "ekpi_quantitative",
    ],
    WorkflowStage.where: [
        "uniprot_annotation",
        "interpro_domains",
        "pfam_domains",
        "compartments_localization",
        "subcell_scsi",
        "inuloc_nls_nes",
        "inuloc_nuclear_prob",
    ],
    WorkflowStage.function: [
        "psp_regulatory",
        "psp_disease_sites",
        "psp_ptmvar",
        "cancerproteome_disease",
        "ptmd_disease",
        "ptmcode_associations",
        "funcscore_phosphosite",
        "ptm_stability",
        "iptmnet_ptm_ppi",
        "ptmint_ppi",
        "string_ppi",
        "biogrid_interactions",
        "intact_interactions",
        "reactome_pathways",
        "kegg_pathways",
        "pathbank_pathways",
        "dbptm_functional",
        "activedriver_mutations",
        "kaka_kinase_mutations",
        "ptmphase_llps",
        "dscope_literature",
        "dscope_predictions",
    ],
}


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


def _mentions_llps(message: str) -> bool:
    """Detect liquid–liquid phase separation (LLPS) intent in a query."""
    llps_keywords = (
        "phase separation", "llps", "condensate", "droplet", "dscope",
        "phasllps", "phosllps", "membraneless", "stress granule", "p-body",
        "相分离", "液液相分离", "凝聚体", "无膜细胞器",
    )
    msg_lower = message.lower()
    return any(kw in msg_lower for kw in llps_keywords)


def _mentions_ppi(message: str) -> bool:
    """Detect protein–protein interaction intent."""
    ppi_keywords = (
        "ppi", "protein-protein", "protein interaction", "interact", "interactor",
        "binding partner", "complex", "string", "biogrid", "intact",
        "互作", "相互作用", "结合伙伴", "蛋白互作", "复合物",
    )
    msg_lower = message.lower()
    return any(kw in msg_lower for kw in ppi_keywords)


def _mentions_pathway(message: str) -> bool:
    """Detect pathway / signaling-map intent."""
    pathway_keywords = (
        "pathway", "pathways", "signaling", "signalling", "reactome", "kegg",
        "pathbank", "smpdb", "cascade", "transduction", "metabolic map",
        "通路", "信号通路", "信号转导", "代谢通路",
    )
    msg_lower = message.lower()
    return any(kw in msg_lower for kw in pathway_keywords)


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


def _mentions_domain(message: str) -> bool:
    """Detect protein domain / family architecture intent."""
    domain_keywords = (
        "domain", "domains", "family", "families", "interpro", "pfam",
        "architecture", "motif", "superfamily", "fold",
        "located in a functional domain", "in a functional domain",
        "结构域", "蛋白家族", "结构域架构", "功能域",
    )
    msg_lower = message.lower()
    return any(kw in msg_lower for kw in domain_keywords)


def _mentions_stability(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "stabiliz", "destabiliz", "stability", "half-life", "half life",
        "degradation", "turnover", "mdm2 affinity",
        "稳定", "去稳定", "降解", "半衰期",
    )
    return any(k in msg_lower for k in keys)


def _mentions_nls(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "nls", "nes", "nuclear localization signal", "nuclear export signal",
        "localization signal", "核定位信号", "核输出信号", "核定位",
    )
    return any(k in msg_lower for k in keys)


def _mentions_drug(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "drug", "drugs", "inhibitor", "compound", "dose-response",
        "decryptm", "pmads", "drugbank", "treatment affect",
        "药物", "抑制剂", "化合物",
    )
    return any(k in msg_lower for k in keys)


def _mentions_crosstalk(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "crosstalk", "cross-talk", "cross talk", "ptm-ptm", "ptm–ptm",
        "simultaneously phosphorylated", "simultaneously acetylated",
        "串扰", "协同修饰", "同时磷酸化", "同时乙酰化",
    )
    return any(k in msg_lower for k in keys)


def _mentions_structure_gap(message: str) -> bool:
    """Structural accessibility / PPI interface — no dedicated tool yet."""
    msg_lower = message.lower()
    keys = (
        "buried", "exposed", "solvent accessible", "sasa", "surface accessibility",
        "protein surface", "ppi interface", "interaction interface",
        "structural context", "structure context",
        "埋藏", "暴露", "溶剂可及", "表面可及", "相互作用界面", "结构上下文",
    )
    return any(k in msg_lower for k in keys)


def _mentions_proteoform(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "proteoform", "proteoforms", "combinatorial ptm", "combinatorial modification",
        "simultaneously modified", "co-modified", "comodified",
        "蛋白变体", "蛋白质变体", "组合修饰", "同时修饰",
    )
    return any(k in msg_lower for k in keys)


def _mentions_conservation(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "conserved", "conservation", "ortholog", "homolog", "across species",
        "in mouse", "in rat", "in yeast",
        "保守", "同源", "跨物种", "小鼠中",
    )
    return any(k in msg_lower for k in keys)


def _mentions_disease(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "disease", "cancer", "tumor", "tumour", "clinical", "patient",
        "biomarker", "li-fraumeni",
        "疾病", "癌症", "肿瘤", "临床", "标志物",
    )
    return any(k in msg_lower for k in keys)


def _user_provided_kinase(message: str) -> bool:
    """User already named the writer enzyme — skip WHO rediscovery."""
    msg_lower = message.lower()
    # Questions asking *which* kinase must never be treated as provided
    if re.search(
        r"(which kinase|what (?:enzyme|kinase)|who phosphorylates|"
        r"哪个激酶|什么酶|激酶是什么|谁磷酸化)",
        msg_lower,
    ):
        return False
    # Require a concrete gene-like token after "by" / "是" (ASCII or CJK name),
    # never bare interrogatives (什么/哪/谁) — ``\w`` matches CJK in Unicode mode.
    patterns = (
        r"phosphorylated by\s+[A-Za-z][A-Za-z0-9_-]{1,20}",
        r"acetylated by\s+[A-Za-z][A-Za-z0-9_-]{1,20}",
        r"ubiquitinated by\s+[A-Za-z][A-Za-z0-9_-]{1,20}",
        r"modified by\s+[A-Za-z][A-Za-z0-9_-]{1,20}",
        r"kinase is\s+[A-Za-z][A-Za-z0-9_-]{1,20}",
        r"由[A-Za-z\u4e00-\u9fff]{2,20}磷酸化",
        r"被[A-Za-z\u4e00-\u9fff]{2,20}磷酸化",
        r"激酶是(?!什么|哪|谁)([A-Za-z][A-Za-z0-9_-]{1,20})",
    )
    return any(re.search(p, msg_lower) for p in patterns)


def _user_provided_when(message: str) -> bool:
    """User already stated the condition/stimulus — skip WHEN rediscovery."""
    msg_lower = message.lower()
    patterns = (
        r"i know .+(phosphorylated|acetylated|modified|ubiquitinated).+(after|under|upon|following)",
        r"already know .+(after|under|upon|following)",
        r"(phosphorylated|acetylated|modified)\s+after\s+[\w\s-]{0,40}(damage|treatment|stress|stimulation)",
        r"已知.+(磷酸化|乙酰化|修饰).+(后|下|时)",
        r"我(已经)?知道.+(磷酸化|乙酰化).+(后|下)",
    )
    # Only treat as "provided WHEN" when user is asking for WHO/WHY, not asking WHEN itself
    asking_when = any(
        k in msg_lower
        for k in (
            "under what condition", "fold change", "log2", "when is", "when does",
            "time course", "kinetics", "何时", "什么条件", "倍数", "时间点",
        )
    )
    if asking_when:
        return False
    return any(re.search(p, msg_lower) for p in patterns)


def _is_broad_overview(message: str) -> bool:
    msg_lower = message.lower()
    keys = (
        "everything about", "tell me everything", "comprehensive",
        "who, when, where, why", "who when where why",
        "全面", "完整讲", "全部信息", "who，when，where，why",
    )
    return any(k in msg_lower for k in keys)


def _detect_capability_gaps(message: str) -> list[str]:
    """Known product gaps — planner annotates; synthesis must not invent answers."""
    gaps: list[str] = []
    if _mentions_structure_gap(message):
        gaps.append(
            "structural_context (no SASA / buried-exposed / PPI-interface tool)"
        )
    if _mentions_proteoform(message):
        gaps.append("proteoform (no combinatorial PTM / proteoform catalog tool)")
    if _mentions_crosstalk(message):
        # PTMcode2 exists but coverage is incomplete; still flag honesty requirement
        gaps.append(
            "crosstalk (PTMcode2 associations only — do not invent mechanisms beyond evidence)"
        )
    if _mentions_conservation(message):
        gaps.append(
            "cross_species_conservation (no dedicated conservation tool; UniProt homolog hints only)"
        )
    return gaps


def _score_stages(message: str) -> dict[WorkflowStage, int]:
    """Keyword scores per stage (shared with multi-intent classification)."""
    from app.workflow.stages import _STAGE_KEYWORDS, _keyword_hit

    msg_lower = message.lower()
    scores: dict[WorkflowStage, int] = {
        WorkflowStage.kinase: 0,
        WorkflowStage.conditions: 0,
        WorkflowStage.where: 0,
        WorkflowStage.function: 0,
    }
    for stage, keywords in _STAGE_KEYWORDS.items():
        for kw in keywords:
            if _keyword_hit(kw, msg_lower):
                scores[stage] += 1
    # Intent boosters so specialized questions get the right stage even if
    # generic keywords are sparse ("stabilize", "NLS", "domain", …).
    if _mentions_stability(message) or _mentions_disease(message) or _mentions_ppi(message):
        scores[WorkflowStage.function] += 2
    if _mentions_nls(message) or _mentions_domain(message):
        scores[WorkflowStage.where] += 2
    if _mentions_drug(message):
        scores[WorkflowStage.kinase] += 2
    if _mentions_crosstalk(message):
        scores[WorkflowStage.function] += 2
    return scores


# ── Query-mode gate (conversational vs research) ──────────────────

# Modes that must NOT trigger database tools
QUERY_MODE_RESEARCH = "research"
QUERY_MODE_GREETING = "greeting"
QUERY_MODE_HELP = "help"
QUERY_MODE_CONCEPT = "concept"  # educational: what is PTM / why it matters
QUERY_MODE_CLARIFY = "clarify"
QUERY_MODE_OFF_TOPIC = "off_topic"

_GREETING_RE = re.compile(
    r"^[\s\W]*("
    r"hi|hello|hey|yo|howdy|hiya|good\s*(morning|afternoon|evening|night)|"
    r"how\s+are\s+you(?:\s+doing)?|how'?s\s+it\s+going|"
    r"thanks?(?:\s+you)?|thank\s*you|ty|thx|cheers|bye|goodbye|see\s*you|"
    r"你好|您好|嗨|哈喽|早上好|下午好|晚上好|你好吗|谢谢|多谢|再见|拜拜"
    r")[\s\W!?.！？。]*$",
    re.I,
)

_HELP_RE = re.compile(
    r"("
    r"what\s+can\s+you\s+do|who\s+are\s+you|how\s+(do|can)\s+(i|you)|"
    r"what\s+are\s+you|help\s*me|your\s+capabilities|how\s+to\s+use|"
    r"introduce\s+yourself|what\s+is\s+this(\s+agent)?|"
    r"你能(做|干什么|做什么)|你会什么|你是谁|怎么用|如何使用|介绍一下(你自己)?|"
    r"有什么功能|帮助"
    r")",
    re.I,
)

# Conceptual / textbook questions about PTM itself (no protein target)
_CONCEPT_RE = re.compile(
    r"("
    # English
    r"what\s+(is|are)\s+(a\s+|an\s+)?(ptm|ptms|post[-\s]?translational\s+modification)s?\b|"
    r"what\s+(is|are)\s+post[-\s]?translational\s+modification|"
    r"(define|definition\s+of|explain|introduce|overview\s+of)\s+"
    r"(a\s+|an\s+)?(ptm|ptms|post[-\s]?translational\s+modification)s?\b|"
    r"\bptms?\b.{0,40}(what\s+(is|are)|mean|meaning|purpose|role|function|used\s+for|why\s+(is|are|important|matter))|"
    r"(why\s+(are|is|do)\s+).{0,20}(ptm|post[-\s]?translational)|"
    r"importance\s+of\s+(ptm|post[-\s]?translational)|"
    r"(tell\s+me\s+about|overview\s+of|introduction\s+to)\s+(ptm|ptms|post[-\s]?translational)|"
    # Chinese
    r"(什么是|何为|介绍一下?|解释一下?)(ptm|翻译后修饰)|"
    r"(ptm|翻译后修饰)\s*(是什么|是啥|指什么|有什么用|有什么作用|有何作用|的作用|的意义|的功能|为什么重要)|"
    r"(ptm|翻译后修饰).{0,12}(作用|意义|功能|用途)"
    r")",
    re.I,
)

_PTM_SIGNAL_RE = re.compile(
    r"("
    r"ptm|phospho|acetyl|ubiquit|methyl|glycosyl|sumoy|"
    r"kinase|enzyme|ligase|residue|site|s\d+|t\d+|y\d+|k\d+|"
    r"phosphorylation|acetylation|mutation|variant|localization|"
    r"nls|ppi|crosstalk|proteoform|stability|fold\s*change|log2|"
    r"磷酸化|乙酰化|泛素化|甲基化|糖基化|激酶|位点|突变|定位|稳定性|"
    r"翻译后修饰|修饰位点"
    r")",
    re.I,
)


def _message_language(message: str) -> str:
    zh = sum(1 for ch in message if "\u4e00" <= ch <= "\u9fff")
    latin = sum(1 for ch in message if "a" <= ch.lower() <= "z")
    if zh >= 1 and zh >= max(1, latin) * 0.35:
        return "zh"
    return "en"


def _is_concept_question(message: str, entities: dict[str, Any]) -> bool:
    """True for educational PTM questions without a concrete protein/site target."""
    if entities.get("uniprot_ac") or entities.get("position") or entities.get("mutation_label"):
        return False
    gene = entities.get("gene")
    # A real gene means site-level research, not textbook concept
    if gene and _is_plausible_gene(gene):
        return False
    text = (message or "").strip()
    if _CONCEPT_RE.search(text):
        return True
    # Short definitional patterns without gene
    if re.search(
        r"^(what\s+is|what\s+are|define|explain)\b.{0,60}\b(ptm|modification)",
        text,
        re.I,
    ):
        return True
    if re.search(r"^(ptm|翻译后修饰).{0,20}(是什么|有什么|作用|意义)", text, re.I):
        return True
    return False


def _has_research_signal(
    message: str,
    entities: dict[str, Any],
    state: ConversationState | None = None,
) -> bool:
    """True when the message is a concrete PTM research ask."""
    if entities.get("uniprot_ac") or entities.get("position") or entities.get("mutation_label"):
        return True
    gene = entities.get("gene")
    if gene and _is_plausible_gene(gene):
        return True
    # Stage keywords alone + generic PTM jargon (no gene) is NOT enough —
    # those are often concept/clarify questions ("PTM有什么作用").
    scores = _score_stages(message)
    if gene and any(v > 0 for v in scores.values()):
        return True
    # Follow-up in an active session with a known target
    if state and state.has_target and len(message.strip()) >= 2:
        if _PTM_SIGNAL_RE.search(message) or any(v > 0 for v in scores.values()):
            return True
    return False


def classify_query_mode(
    message: str,
    entities: dict[str, Any] | None = None,
    state: ConversationState | None = None,
) -> str:
    """Gate: greeting / help / concept / clarify / off_topic / research.

    Only ``research`` should execute database tools.
    """
    text = (message or "").strip()
    if not text:
        return QUERY_MODE_CLARIFY

    entities = entities or parse_query_entities(text)

    if _GREETING_RE.match(text):
        return QUERY_MODE_GREETING
    if _HELP_RE.search(text) and not entities.get("gene") and not entities.get("position"):
        return QUERY_MODE_HELP
    # Concept before research: "PTM是什么/有什么作用" must not open a plan
    if _is_concept_question(text, entities):
        return QUERY_MODE_CONCEPT
    if _has_research_signal(text, entities, state):
        return QUERY_MODE_RESEARCH

    # Mentions PTM broadly but no protein/site → ask for specifics
    if _PTM_SIGNAL_RE.search(text) or re.search(r"\bptm\b|翻译后修饰|修饰", text, re.I):
        return QUERY_MODE_CLARIFY

    if len(text) <= 40 and not entities.get("gene"):
        return QUERY_MODE_OFF_TOPIC

    return QUERY_MODE_OFF_TOPIC


def build_gate_reply(mode: str, message: str) -> str:
    """Deterministic professional reply for non-research modes (no tools)."""
    lang = _message_language(message)
    if mode == QUERY_MODE_GREETING:
        if lang == "zh":
            return (
                "你好！我是 **qPTM Agent**，专注于蛋白质翻译后修饰（PTM）研究。\n\n"
                "你可以按 **WHO → WHEN → WHERE → WHY** 提问，例如：\n"
                "- `TP53 S15 的磷酸化激酶是什么？`\n"
                "- `AKT1 S473 在什么条件下磷酸化？`\n"
                "- `TP53 S15 磷酸化会稳定还是降解蛋白？`\n\n"
                "请给我一个**蛋白/基因名**（最好带位点，如 S15）。"
            )
        return (
            "Hello! I'm **qPTM Agent**, a research assistant for "
            "protein post-translational modifications (PTMs).\n\n"
            "Ask along **WHO → WHEN → WHERE → WHY**, for example:\n"
            "- `Which kinase phosphorylates TP53 at S15?`\n"
            "- `Under what conditions is AKT1 S473 phosphorylated?`\n"
            "- `Does TP53 S15 phosphorylation stabilize the protein?`\n\n"
            "Please give a **gene/protein** (ideally with a site, e.g. S15)."
        )

    if mode == QUERY_MODE_HELP:
        if lang == "zh":
            return (
                "我是 **qPTM Agent**，对接 qPTM 与多个 PTM 知识库"
                "（iPTMnet、PhosphoSitePlus、UniProt、ActiveDriverDB 等）。\n\n"
                "**我能做的：**\n"
                "1. **WHO** — 谁催化/调控该修饰（激酶、乙酰化酶、E3、药物）\n"
                "2. **WHEN** — 何时发生（条件、时间点、log2 定量）\n"
                "3. **WHERE** — 在哪发生（亚细胞定位、结构域、NLS）\n"
                "4. **WHY** — 为何重要（稳定性、疾病、互作、突变影响）\n\n"
                "**请提供：** 基因/UniProt + 可选位点（如 `TP53 S15`）。\n"
                "我**不会**回答与 PTM 无关的闲聊或通用问题。"
            )
        return (
            "I'm **qPTM Agent**, connected to qPTM and external PTM knowledge bases "
            "(iPTMnet, PhosphoSitePlus, UniProt, ActiveDriverDB, and more).\n\n"
            "**What I can do:**\n"
            "1. **WHO** — enzymes / drugs that write the PTM\n"
            "2. **WHEN** — conditions, time points, log2 fold changes\n"
            "3. **WHERE** — localization, domains, NLS/NES\n"
            "4. **WHY** — stability, disease, PPI, mutation impact\n\n"
            "**Please provide:** a gene/UniProt ID and optionally a site "
            "(e.g. `TP53 S15`).\n"
            "I do **not** answer unrelated chit-chat or general non-PTM questions."
        )

    if mode == QUERY_MODE_CONCEPT:
        if lang == "zh":
            return (
                "## 什么是 PTM？\n\n"
                "**翻译后修饰（Post-Translational Modification, PTM）** 是指蛋白质在核糖体合成之后，"
                "氨基酸残基上再发生的化学修饰。它不改变基因序列，却能快速、可逆地改变蛋白的活性、定位、稳定性和相互作用。\n\n"
                "## 常见类型\n\n"
                "| 类型 | 典型残基 | 常见“写入酶” |\n"
                "|------|----------|----------------|\n"
                "| 磷酸化 | S / T / Y | 激酶（kinase） |\n"
                "| 乙酰化 | K | 乙酰转移酶（如 EP300） |\n"
                "| 泛素化 | K | E3 连接酶（如 MDM2） |\n"
                "| 甲基化 | K / R | 甲基转移酶 |\n"
                "| 糖基化、SUMO 化等 | 多种 | 相应酶系统 |\n\n"
                "## 有什么作用？\n\n"
                "1. **开关信号通路** — 如磷酸化激活/抑制激酶级联\n"
                "2. **调控蛋白稳定性** — 如磷酸化降低 MDM2 亲和力，稳定 p53\n"
                "3. **决定亚细胞定位** — 影响入核、出核、膜定位\n"
                "4. **改变蛋白互作与复合物组装**\n"
                "5. **疾病与药物相关** — 位点突变可破坏修饰；药物可改变 PTM 水平\n\n"
                "可以把它理解为蛋白质的“状态编码”：同一蛋白在不同修饰组合下，功能可以完全不同。\n\n"
                "---\n"
                "若要查**具体蛋白/位点**的证据（激酶、条件、定位、功能），请直接给出，例如：\n"
                "`TP53 S15 的磷酸化激酶是什么？`"
            )
        return (
            "## What is a PTM?\n\n"
            "A **post-translational modification (PTM)** is a chemical change added to a protein "
            "**after** it is synthesized. PTMs do not rewrite the gene sequence; instead they "
            "rapidly and often reversibly tune protein activity, localization, stability, and interactions.\n\n"
            "## Common types\n\n"
            "| Type | Typical residues | Typical writers |\n"
            "|------|------------------|-----------------|\n"
            "| Phosphorylation | S / T / Y | Kinases |\n"
            "| Acetylation | K | Acetyltransferases (e.g. EP300) |\n"
            "| Ubiquitination | K | E3 ligases (e.g. MDM2) |\n"
            "| Methylation | K / R | Methyltransferases |\n"
            "| Glycosylation, SUMOylation, … | Various | Dedicated enzyme systems |\n\n"
            "## Why do PTMs matter?\n\n"
            "1. **Signal switching** — e.g. phosphorylation turns pathways on/off\n"
            "2. **Stability control** — e.g. phospho-S15 can reduce MDM2 binding and stabilize p53\n"
            "3. **Localization** — nuclear import/export, membrane targeting\n"
            "4. **Interaction rewiring** — PTMs create or break protein interfaces\n"
            "5. **Disease & drugs** — mutations can abolish a site; compounds can shift PTM levels\n\n"
            "Think of PTMs as a **state code** on proteins: the same polypeptide can do different jobs "
            "depending on its modification pattern.\n\n"
            "---\n"
            "To look up **database evidence for a specific protein/site**, ask something like:\n"
            "`Which kinase phosphorylates TP53 at S15?`"
        )

    if mode == QUERY_MODE_CLARIFY:
        if lang == "zh":
            return (
                "这个问题还不够具体，我还无法开始数据库检索。\n\n"
                "请补充：\n"
                "1. **蛋白/基因**（如 TP53、AKT1）\n"
                "2. **位点**（如 S15、K382，可选）\n"
                "3. **关注点**（激酶？条件？定位？功能？疾病？）\n\n"
                "示例：`TP53 S15 磷酸化的上游激酶是什么？`\n"
                "如果只是想了解 PTM 概念，可以直接问：`PTM是什么？`"
            )
        return (
            "That question is too broad for a database search yet.\n\n"
            "Please specify:\n"
            "1. A **gene/protein** (e.g. TP53, AKT1)\n"
            "2. A **site** if you have one (e.g. S15, K382)\n"
            "3. What you care about (kinase, conditions, localization, function, disease)\n\n"
            "Example: `Which kinase phosphorylates TP53 at S15?`\n"
            "For a general definition, ask: `What is PTM?`"
        )

    # off_topic
    if lang == "zh":
        return (
            "我是面向 **PTM（翻译后修饰）** 的研究助手，无法回答与 PTM 无关的问题。\n\n"
            "如果你想查某个蛋白的修饰，请直接给出基因名和位点，例如：\n"
            "`TP53 S15` 或 `AKT1 S473 phosphorylation who/when/where/why`。\n"
            "若想了解概念，可以问：`PTM是什么？有什么作用？`"
        )
    return (
        "I'm a research assistant focused on **PTMs (post-translational modifications)** "
        "and can't help with unrelated topics.\n\n"
        "If you want to investigate a protein modification, send a gene and site, e.g.\n"
        "`TP53 S15` or `AKT1 S473 phosphorylation — who, when, where, why?`\n"
        "For a conceptual overview, ask: `What is PTM and why does it matter?`"
    )


def empty_conversational_plan(message: str, mode: str) -> ResearchPlan:
    """Plan with zero tool steps — used for gated conversational turns."""
    labels = {
        QUERY_MODE_GREETING: "Greeting — no database search",
        QUERY_MODE_HELP: "Capability help — no database search",
        QUERY_MODE_CONCEPT: "PTM concept / education — no database search",
        QUERY_MODE_CLARIFY: "Need a specific protein/site — no database search yet",
        QUERY_MODE_OFF_TOPIC: "Off-topic for PTM agent — no database search",
    }
    return ResearchPlan(
        question=message,
        intent_summary=labels.get(mode, "Conversational — no database search"),
        steps=[],
    )


# ── Intent classification ─────────────────────────────────────────

def classify_research_stages(message: str) -> list[WorkflowStage]:
    """Determine which workflow stages the question requires.

    - Multi-intent questions (e.g. Chinese WHO+WHY) return all matched stages
      in WHO → WHEN → WHERE → WHY order.
    - Stages the user already answered are skipped (known kinase / known WHEN).
    - Broad / no-keyword questions keep the full pipeline.
    - Pure capability-gap questions still get a minimal resolve path.
    """
    order = [
        WorkflowStage.kinase,
        WorkflowStage.conditions,
        WorkflowStage.where,
        WorkflowStage.function,
    ]

    if _is_broad_overview(message):
        stages = list(order)
    else:
        scores = _score_stages(message)
        matched = [s for s in order if scores[s] > 0]
        if not matched:
            # Gap-only or vague: minimal function/where resolve rather than full spam
            if _mentions_structure_gap(message) or _mentions_proteoform(message):
                stages = [WorkflowStage.where, WorkflowStage.function]
            else:
                stages = list(order)
        elif len(matched) == 1:
            stages = matched
        else:
            stages = matched

    if _user_provided_kinase(message):
        stages = [s for s in stages if s != WorkflowStage.kinase]
        if WorkflowStage.function not in stages:
            stages.append(WorkflowStage.function)
    if _user_provided_when(message):
        stages = [s for s in stages if s != WorkflowStage.conditions]
        # "who does it and why" after known WHEN → ensure WHO + WHY
        if WorkflowStage.kinase not in stages and not _user_provided_kinase(message):
            stages.insert(0, WorkflowStage.kinase)
        if WorkflowStage.function not in stages:
            stages.append(WorkflowStage.function)

    # Preserve canonical order, drop empties
    stages = [s for s in order if s in stages]
    return stages or [WorkflowStage.function]


def _intent_summary(stages: list[WorkflowStage], entities: dict[str, Any]) -> str:
    """Human-readable summary of the planned investigation."""
    target_parts = []
    if entities.get("gene"):
        target_parts.append(entities["gene"])
    if entities.get("position"):
        target_parts.append(f"position {entities['position']}")
    if entities.get("ptm_type"):
        target_parts.append(entities["ptm_type"])
    target = " ".join(target_parts) if target_parts else "the query target"

    stage_labels = [get_stage_label(s) for s in stages]
    summary = (
        f"Investigate {target} through {len(stages)} stage(s): "
        + " → ".join(stage_labels)
    )
    gaps = entities.get("capability_gaps") or []
    if gaps:
        summary += " | CAPABILITY GAPS (do not invent): " + "; ".join(gaps)
    skips = entities.get("skipped_stages") or []
    if skips:
        summary += " | skipped (user-provided): " + ", ".join(skips)
    return summary


# ── Plan builder ──────────────────────────────────────────────────

def _make_plan_step(
    step_num: int,
    tool_name: str,
    stage: WorkflowStage,
    *,
    chain_label: str | None = None,
) -> PlanStep:
    """Create a PlanStep from TOOL_ROUTING metadata."""
    meta = TOOL_ROUTING[tool_name]
    db_info = DATABASE_CATALOG[meta["database"]]
    stage_label = chain_label or get_stage_label(stage)
    return PlanStep(
        step=step_num,
        stage=stage,
        title=f"Step {step_num}: {meta['title']}",
        description=(
            f"{stage_label} — {meta['description']} "
            f"[{db_info['name']}]"
        ),
        database=meta["database"],
        tool=tool_name,
    )


def _build_mutation_precision_plan(
    message: str,
    entities: dict[str, Any],
) -> ResearchPlan:
    """Plan for mutation → PTM site loss/gain → kinase rewiring → disease.

    Priority-ordered tool chain (no generic 10-step tail-cut that drops disease).
    """
    entities["narrative"] = "mutation_precision"
    need_search = not bool(entities.get("uniprot_ac"))
    ptm = (entities.get("ptm_type") or "phosphorylation").lower()
    has_gene = bool(entities.get("gene"))
    has_pos = bool(entities.get("position"))

    # Ordered chain: each tuple is (tool, stage, chain_phase_label)
    chain: list[tuple[str, WorkflowStage, str]] = []

    if need_search:
        chain.append((
            "qptm_search",
            WorkflowStage.function,
            "Resolve target identity",
        ))

    # 1) Mutation discovery (site loss/gain + kinase activity effects)
    if has_gene:
        chain.append((
            "activedriver_mutations",
            WorkflowStage.function,
            "Mutation → PTM site (ActiveDriverDB ClinVar/MC3/PCAWG)",
        ))
    if has_gene or entities.get("uniprot_ac"):
        chain.append((
            "psp_ptmvar",
            WorkflowStage.function,
            "Mutation → PTM site (PSP PTMVar Class I/II)",
        ))
        chain.append((
            "kaka_kinase_mutations",
            WorkflowStage.function,
            "Mutation → kinase activity (KAKA curated)",
        ))

    # 2) PTM site functional meaning if the site is lost/gained
    chain.append((
        "psp_regulatory",
        WorkflowStage.function,
        "PTM site loss/gain → functional consequence",
    ))
    if ptm == "phosphorylation" and (entities.get("uniprot_ac") or need_search):
        chain.append((
            "funcscore_phosphosite",
            WorkflowStage.function,
            "PTM site loss/gain → functional priority score",
        ))
    if has_gene or entities.get("uniprot_ac"):
        chain.append((
            "ptm_stability",
            WorkflowStage.function,
            "PTM site loss/gain → stability effect",
        ))

    # 3) Kinase rewiring around the site
    if has_gene:
        chain.append((
            "activedriver_kinase_network",
            WorkflowStage.kinase,
            "Kinase rewiring (ActiveDriverDB network)",
        ))
    if has_gene or entities.get("uniprot_ac"):
        chain.append((
            "psp_kinase_substrate",
            WorkflowStage.kinase,
            "Kinase rewiring (PSP kinase→substrate)",
        ))
        chain.append((
            "iptmnet_enzymes",
            WorkflowStage.kinase,
            "Kinase rewiring (iPTMnet enzymes)",
        ))
    if entities.get("uniprot_ac") and has_pos:
        chain.append((
            "qptm_kinases",
            WorkflowStage.kinase,
            "Kinase rewiring (qPTM kinases)",
        ))
    elif need_search and has_pos:
        # UniProt may resolve after qptm_search; still schedule kinases
        chain.append((
            "qptm_kinases",
            WorkflowStage.kinase,
            "Kinase rewiring (qPTM kinases)",
        ))

    # 4) Disease / cancer context
    if has_gene or entities.get("uniprot_ac"):
        chain.append((
            "psp_disease_sites",
            WorkflowStage.function,
            "Disease association (PSP disease sites)",
        ))
    if has_gene:
        chain.append((
            "ptmd_disease",
            WorkflowStage.function,
            "Disease association (PTMD)",
        ))
        chain.append((
            "cancerproteome_disease",
            WorkflowStage.conditions,
            "Disease association (CancerProteome tumor vs normal)",
        ))
    chain.append((
        "dbptm_functional",
        WorkflowStage.function,
        "Disease association (dbPTM nsSNP)",
    ))

    # Cap with explicit priority so disease tools are not tail-cut
    priority = [
        "qptm_search",
        "activedriver_mutations",
        "psp_ptmvar",
        "kaka_kinase_mutations",
        "psp_regulatory",
        "activedriver_kinase_network",
        "psp_kinase_substrate",
        "iptmnet_enzymes",
        "qptm_kinases",
        "psp_disease_sites",
        "ptmd_disease",
        "cancerproteome_disease",
        "funcscore_phosphosite",
        "ptm_stability",
        "dbptm_functional",
    ]
    by_tool = {t: (t, st, lab) for t, st, lab in chain}
    ordered: list[tuple[str, WorkflowStage, str]] = []
    for t in priority:
        if t in by_tool:
            ordered.append(by_tool[t])
    for item in chain:
        if item[0] not in {x[0] for x in ordered}:
            ordered.append(item)
    max_steps = 12  # before PubTator
    chain = ordered[:max_steps]

    steps: list[PlanStep] = []
    seen: set[str] = set()
    for tool, stage, label in chain:
        if tool in seen:
            continue
        seen.add(tool)
        steps.append(_make_plan_step(len(steps) + 1, tool, stage, chain_label=label))

    # Always end with literature
    lit = _make_plan_step(
        len(steps) + 1,
        "pubtator_literature_search",
        WorkflowStage.function,
        chain_label="Literature (mutation–PTM–disease)",
    )
    steps.append(lit)

    gene = entities.get("gene") or ""
    if entities.get("mutation_label"):
        target = entities["mutation_label"]
    elif entities.get("position") is not None:
        target = f"site {entities['position']}"
    else:
        target = "the queried site"
    intent = (
        f"Precision-medicine chain for {gene} {target}: "
        f"mutation → PTM site loss/gain → kinase rewiring → disease"
    ).strip()
    intent = re.sub(r"\s+", " ", intent)

    return ResearchPlan(
        question=message,
        intent_summary=intent,
        steps=steps,
    )


def _pick_tools_for_stage(
    stage: WorkflowStage,
    entities: dict[str, Any],
    *,
    include_search: bool = False,
) -> list[str]:
    """Select tools for a stage based on available entity information + intent."""
    has_uniprot = bool(entities.get("uniprot_ac"))
    has_position = bool(entities.get("position"))
    has_gene = bool(entities.get("gene"))
    query = entities.get("query") or ""
    ptm = (entities.get("ptm_type") or "").lower()

    # Stage 1 WHO — regulators (enzymes + upstream drugs)
    if stage == WorkflowStage.kinase:
        tools: list[str] = []
        if include_search:
            tools.append("qptm_search")
        # Site known (or UniProt known): always schedule experimental enzyme tools.
        # UniProt may resolve mid-plan via qptm_search / early gene lookup.
        if has_position or has_uniprot:
            tools.extend([
                "qptm_kinases",
                "iptmnet_enzymes",
                "psp_kinase_substrate",
                "gps6_kinases",
            ])
        elif has_gene:
            # Gene-only WHO (e.g. "which E3 ubiquitinates TP53"): still hit
            # experimental enzyme resources that accept gene symbols.
            tools.extend(["iptmnet_enzymes", "psp_kinase_substrate", "gps6_kinases"])
            if ptm == "phosphorylation":
                tools.insert(1, "qptm_kinases")  # may skip until UniProt resolves
        # Histone acetylation / methylation writers–erasers–readers (WERAM)
        if (has_gene or has_uniprot) and (
            ptm in ("acetylation", "methylation")
            or any(
                kw in query.lower()
                for kw in (
                    "acetyl", "methyl", "histone", "hdac", "bromodomain",
                    "chromodomain", "weram", "writer", "eraser", "reader",
                )
            )
            or re.search(r"\b(hat|hmt|hdm|kat|sirt)\b", query.lower())
        ):
            tools.append("weram_regulators")
        if (has_gene or has_uniprot) and (
            ptm in ("ubiquitylation", "ubiquitination")
            or any(
                k in query.lower()
                for k in (
                    "ubiquit", "e3 ligase", "deubiquit", "dub", "ubibrowser",
                    "mdm2", "usp", "gps-uber", "gpsuber", "ssesr",
                )
            )
        ):
            tools.append("ubibrowser_interactions")
            tools.append("gpsuber_e3_sites")
        if (has_gene or has_uniprot) and (
            ptm == "sumoylation"
            or any(
                k in query.lower()
                for k in (
                    "sumoylation", "sumoylat", "sumo", "sim motif",
                    "sumo-interacting", "sumo interacting",
                    "gps-sumo", "gpssumo", "gps sumo",
                    "苏素化", "类泛素",
                )
            )
        ):
            tools.append("gpssumo2_sites")
        # Kinase mutation → activity (KAKA)
        if (has_gene or has_uniprot) and (
            _mentions_mutation(query, entities)
            or any(
                k in query.lower()
                for k in (
                    "kinase-dead", "kinase dead", "kinase activity",
                    "enzyme activity", "gain-of-function", "loss-of-function",
                    "kaka", "激酶失活", "激酶活性", "酶活性",
                )
            )
        ):
            tools.append("kaka_kinase_mutations")
        # eKPI: experimental + predicted kinases; quantitative when cancer/correlation asked
        if (has_gene or has_uniprot) and has_position and (
            ptm == "phosphorylation"
            or any(
                k in query.lower()
                for k in (
                    "ekpi", "kinase", "phosphorylat", "related kinase",
                    "潜在激酶", "磷酸化",
                )
            )
        ):
            tools.append("ekpi_kinases")
        if (has_gene or has_uniprot) and has_position and (
            _mentions_disease(query)
            or any(
                k in query.lower()
                for k in (
                    "ekpi", "correlation", "spearman", "quantitative",
                    "multi-omics", "multiomics", "cptac", "tumor kinase",
                    "相关", "定量", "肿瘤", "癌",
                )
            )
        ):
            tools.append("ekpi_quantitative")
        # Drug–PTM: always for drug intent; otherwise soft include when gene known
        if _mentions_drug(query) and (has_gene or has_uniprot):
            tools.extend(["pmads_drug_ptm", "decryptm_drug_ptm", "drugbank_targets"])
        else:
            if has_gene:
                tools.append("pmads_drug_ptm")
            if has_gene or has_uniprot:
                tools.append("drugbank_targets")
        if not tools:
            tools = ["qptm_search"]
        return tools

    # Stage 2 WHEN — kinetics / quantitative conditions
    if stage == WorkflowStage.conditions:
        tools = []
        if include_search:
            tools.append("qptm_search")
        if has_position:
            tools.append("qptm_site_conditions")
        elif not tools:
            tools.append("qptm_search")
        if has_gene or has_uniprot:
            tools.append("cancerproteome_disease")
        if (has_gene or has_uniprot) and has_position:
            tools.append("ekpi_quantitative")
        return tools

    # Stage 3 WHERE — cell context + localization (+ domain / NLS when asked)
    if stage == WorkflowStage.where:
        tools = []
        if include_search:
            tools.append("qptm_search")
        tools.extend(["uniprot_annotation", "compartments_localization"])
        # Domains: always when gene known OR domain intent (coordinate–domain reasoning)
        if has_gene or has_uniprot or _mentions_domain(query):
            tools.extend(["interpro_domains", "pfam_domains"])
        if has_gene or has_uniprot:
            tools.append("subcell_scsi")
        # NLS/NES: required for localization-signal questions
        if _mentions_nls(query) and (has_gene or has_uniprot):
            tools.extend(["inuloc_nls_nes", "inuloc_nuclear_prob"])
        elif has_gene or has_uniprot:
            # Soft include NLS when a site is known (site-vs-signal reasoning)
            if has_position:
                tools.append("inuloc_nls_nes")
        if (has_gene or has_uniprot) and _mentions_pathway(query):
            tools.extend(["reactome_pathways", "kegg_pathways", "pathbank_pathways"])
        return tools

    # Stage 4 WHY — mechanism / outcome / value
    if stage == WorkflowStage.function:
        tools = []
        if include_search:
            tools.append("qptm_search")
        tools.append("psp_regulatory")
        # Stability first when asked (avoid being cut by the 10-step cap)
        if _mentions_stability(query) and (has_gene or has_uniprot):
            tools.append("ptm_stability")
        if has_gene or has_uniprot:
            if _mentions_disease(query) or has_position:
                tools.append("psp_disease_sites")
                tools.append("psp_ptmvar")
            if _mentions_mutation(query) or has_position:
                tools.append("kaka_kinase_mutations")
            if has_position and (
                _mentions_disease(query)
                or any(
                    k in query.lower()
                    for k in (
                        "ekpi", "correlation", "spearman", "quantitative",
                        "kinase", "phosphorylat", "相关", "定量", "肿瘤", "癌",
                    )
                )
            ):
                tools.append("ekpi_kinases")
                tools.append("ekpi_quantitative")
        if has_gene:
            if _mentions_disease(query) or has_position:
                tools.append("cancerproteome_disease")
                tools.append("ptmd_disease")
            if _mentions_crosstalk(query) or has_position:
                tools.append("ptmcode_associations")
        if ptm == "phosphorylation" and (has_uniprot or has_position):
            tools.append("funcscore_phosphosite")
        if not _mentions_stability(query) and (has_gene or has_uniprot):
            tools.append("ptm_stability")
        if _mentions_disease(query) or has_position:
            tools.append("dbptm_functional")
        else:
            tools.append("dbptm_functional")
        # PPI: PTM-specific always when site known; general PPI when asked
        if has_gene or has_uniprot:
            if has_position or _mentions_ppi(query):
                tools.extend(["ptmint_ppi", "iptmnet_ptm_ppi"])
            if _mentions_ppi(query):
                tools.extend([
                    "string_ppi",
                    "biogrid_interactions",
                    "intact_interactions",
                    "subcell_scsi",
                ])
            if _mentions_pathway(query) or (has_position and not _mentions_stability(query)):
                # Skip bulky pathway tools on pure stability questions (preserve cap budget)
                if not _mentions_stability(query):
                    tools.extend([
                        "reactome_pathways",
                        "kegg_pathways",
                        "pathbank_pathways",
                    ])
        if _mentions_llps(query) and (has_gene or has_uniprot):
            tools.extend([
                "ptmphase_llps",
                "ptmphase_phosllps",
                "dscope_literature",
                "dscope_predictions",
            ])
        return tools

    return []


def build_research_plan(
    message: str,
    state: ConversationState | None = None,
) -> ResearchPlan:
    """Build a structured WHO→WHEN→WHERE→WHY research plan.

    This is the planning layer — databases and tools are selected here,
    not delegated to the LLM.

    Non-research turns (greeting / help / clarify / off-topic) return an
    empty plan so the agent loop can reply without calling databases.
    """
    entities = parse_query_entities(message)

    # Intent gate BEFORE any UniProt/network work
    mode = classify_query_mode(message, entities, state)
    entities["query_mode"] = mode
    if mode != QUERY_MODE_RESEARCH:
        return empty_conversational_plan(message, mode)

    # Reuse known target from session if the message doesn't specify one
    if state and state.has_target:
        if not entities["gene"] and state.target_gene:
            entities["gene"] = state.target_gene
        if not entities["uniprot_ac"] and state.target_uniprot_ac:
            entities["uniprot_ac"] = state.target_uniprot_ac
        if not entities["position"] and state.target_position:
            entities["position"] = state.target_position
        if state.target_ptm_type:
            entities["ptm_type"] = state.target_ptm_type

    # Early gene → UniProt so site tools (qptm_kinases / conditions) are not skipped
    if entities.get("gene") and not entities.get("uniprot_ac"):
        try:
            from app.sources.uniprot_id import lookup_by_gene

            organism = (entities.get("organism") or "human").lower()
            tax = {"human": 9606, "mouse": 10090, "rat": 10116}.get(organism, 9606)
            ident = lookup_by_gene(entities["gene"], organism_id=tax)
            if ident and ident.get("uniprot_ac"):
                entities["uniprot_ac"] = ident["uniprot_ac"]
                if ident.get("gene") and not entities.get("gene"):
                    entities["gene"] = ident["gene"]
        except Exception:
            pass

    # Capability gaps + skip annotations (for synthesis honesty)
    entities["capability_gaps"] = _detect_capability_gaps(message)
    skipped: list[str] = []
    if _user_provided_kinase(message):
        skipped.append("WHO/kinase (user already named the enzyme)")
    if _user_provided_when(message):
        skipped.append("WHEN/conditions (user already stated the stimulus)")
    entities["skipped_stages"] = skipped

    # Dedicated precision-medicine path
    if _mentions_mutation(message, entities):
        return _build_mutation_precision_plan(message, entities)

    stages = classify_research_stages(message)
    steps: list[PlanStep] = []
    step_num = 1
    seen_tools: set[str] = set()
    need_search = not bool(entities.get("uniprot_ac"))

    for stage in stages:
        tools = _pick_tools_for_stage(
            stage,
            entities,
            include_search=need_search and stage == stages[0],
        )
        stage_label = get_stage_label(stage)

        for tool_name in tools:
            if tool_name in seen_tools:
                continue
            seen_tools.add(tool_name)
            steps.append(_make_plan_step(step_num, tool_name, stage, chain_label=stage_label))
            step_num += 1

    # Cap at a reasonable number of steps; never drop intent-critical tools
    priority_tools = set()
    if _mentions_stability(message):
        priority_tools.add("ptm_stability")
    if _mentions_nls(message):
        priority_tools.update(["inuloc_nls_nes", "inuloc_nuclear_prob"])
    if _mentions_domain(message):
        priority_tools.update(["interpro_domains", "pfam_domains"])
    if _mentions_drug(message):
        priority_tools.update(["pmads_drug_ptm", "decryptm_drug_ptm"])
    if _mentions_crosstalk(message):
        priority_tools.add("ptmcode_associations")
    if _mentions_disease(message):
        priority_tools.update(["ptmd_disease", "psp_disease_sites", "dbptm_functional"])
    if _mentions_ppi(message):
        priority_tools.update(["ptmint_ppi", "iptmnet_ptm_ppi"])
    if WorkflowStage.kinase in stages:
        priority_tools.update([
            "qptm_kinases", "iptmnet_enzymes", "psp_kinase_substrate",
        ])
    if WorkflowStage.conditions in stages and entities.get("position"):
        priority_tools.add("qptm_site_conditions")
    if WorkflowStage.function in stages:
        priority_tools.update(["psp_regulatory", "ptm_stability"])
    if WorkflowStage.where in stages and _mentions_nls(message):
        priority_tools.update(["inuloc_nls_nes", "inuloc_nuclear_prob"])

    if len(steps) > 10:
        required: set[int] = set()
        seen_stages: set[WorkflowStage] = set()
        for i, step in enumerate(steps):
            if step.stage not in seen_stages:
                required.add(i)
                seen_stages.add(step.stage)
            if step.stage == WorkflowStage.conditions:
                required.add(i)
            if step.tool in priority_tools:
                required.add(i)
            if step.tool == "qptm_search":
                required.add(i)
        extras = [i for i in range(len(steps)) if i not in required]
        keep = sorted(required | set(extras[: max(0, 10 - len(required))]))
        if len(keep) > 12:
            keep = sorted(required)[:12]
        steps = [steps[i] for i in keep]
        for i, step in enumerate(steps, start=1):
            step.step = i
            step.title = f"Step {i}: {TOOL_ROUTING[step.tool]['title']}"

    steps.append(_make_plan_step(
        len(steps) + 1,
        "pubtator_literature_search",
        WorkflowStage.function,
    ))

    return ResearchPlan(
        question=message,
        intent_summary=_intent_summary(stages, entities),
        steps=steps,
    )


def infer_tool_arguments(
    tool_name: str,
    entities: dict[str, Any],
    state: ConversationState | None = None,
) -> dict[str, Any]:
    """Infer tool call arguments from parsed entities (deterministic routing).

    ``state`` must be a ConversationState (or None). Passing a string query here
    is unsupported — put the query into ``entities["query"]`` instead.
    """
    # Guard against historical misuse (query str passed as 3rd arg).
    if state is not None and not hasattr(state, "target_uniprot_ac"):
        state = None

    gene = entities.get("gene") or (getattr(state, "target_gene", None) if state else None)
    uniprot = entities.get("uniprot_ac") or (getattr(state, "target_uniprot_ac", None) if state else None)
    position = entities.get("position") or (getattr(state, "target_position", None) if state else None)
    ptm_type = entities.get("ptm_type") or (
        getattr(state, "target_ptm_type", None) if state else None
    ) or "phosphorylation"
    organism = entities.get("organism", "human")
    query = entities.get("query", "")

    if tool_name == "qptm_search":
        search_q = gene or query
        field = "uniprot" if uniprot else ("gene" if gene else "any")
        if uniprot:
            search_q = uniprot
        return {
            "query": search_q,
            "field": field,
            "organism": organism,
            "ptm_type": ptm_type,
            "per_page": 20,
        }

    if tool_name == "qptm_site_conditions":
        if not (uniprot and position):
            return {}
        return {
            "uniprot_ac": uniprot,
            "position": position,
            "ptm_type": ptm_type,
        }

    if tool_name == "qptm_kinases":
        if not (uniprot and position):
            return {}
        return {"uniprot_ac": uniprot, "position": position}

    if tool_name == "uniprot_annotation":
        if not uniprot:
            return {}
        return {"uniprot_ac": uniprot}

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
            "limit": 8,
        }

    return {"query": query}

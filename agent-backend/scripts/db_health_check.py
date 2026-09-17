#!/usr/bin/env python3
"""Probe all registry tools with multiple biological cases.

Does not change tool handlers. Classifies configuration, API, empty, and
reasonableness. Run from agent-backend:

    .venv/bin/python scripts/db_health_check.py
    .venv/bin/python scripts/db_health_check.py --workers 3 --timeout 40
    .venv/bin/python scripts/db_health_check.py --case tp53_s15 --tool qptm_search
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from concurrent.futures import as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from app.config import settings  # noqa: E402
from app.sources.build_index import index_path_for  # noqa: E402
from app.sources.catalog import get_catalog  # noqa: E402
from app.tools.metadata import TOOL_DATABASES  # noqa: E402
from app.tools.register_all import register_all_tools  # noqa: E402
from app.tools.registry import registry  # noqa: E402
from app.mcp.tool_args import infer_tool_arguments  # noqa: E402
from mcp_tools import _classify_result, _invoke_one  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("db_health")

# ── Cases ─────────────────────────────────────────────────────────
# Broad coverage: sites, protein-level, other PTMs, organisms, aliases,
# isoforms, mutations, secreted/nuclear/metabolic proteins, and adversarial.

CASES: dict[str, dict[str, Any]] = {
    "tp53_s15": {
        "label": "TP53 p.Ser15 phosphorylation (human)",
        "tags": ["core", "phospho", "site", "human", "kinase"],
        "entities": {
            "query": "TP53 S15 phosphorylation",
            "gene": "TP53",
            "uniprot_ac": "P04637",
            "position": 15,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "tp53_protein": {
        "label": "TP53 protein-level (no site) — typical agent fan-out",
        "tags": ["core", "protein", "human"],
        "entities": {
            "query": "TP53 post-translational modifications",
            "gene": "TP53",
            "uniprot_ac": "P04637",
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "tp53_k382": {
        "label": "TP53 p.Lys382 acetylation",
        "tags": ["acetyl", "site", "human"],
        "entities": {
            "query": "TP53 K382 acetylation",
            "gene": "TP53",
            "uniprot_ac": "P04637",
            "position": 382,
            "ptm_type": "acetylation",
            "organism": "human",
        },
    },
    "tp53_ub": {
        "label": "TP53 ubiquitination K120 (MDM2 axis; site often missing in GPS-Uber)",
        "tags": ["ub", "site", "human"],
        "entities": {
            "query": "TP53 ubiquitination MDM2",
            "gene": "TP53",
            "uniprot_ac": "P04637",
            "position": 120,
            "ptm_type": "ubiquitination",
            "organism": "human",
        },
    },
    "tp53_ub_k101": {
        "label": "TP53 ubiquitination K101 (present in GPS-Uber dump)",
        "tags": ["ub", "site", "human"],
        "entities": {
            "query": "TP53 K101 ubiquitination",
            "gene": "TP53",
            "uniprot_ac": "P04637",
            "position": 101,
            "ptm_type": "ubiquitination",
            "organism": "human",
        },
    },
    "yap1_s127": {
        "label": "YAP1 p.Ser127 (Hippo localization switch)",
        "tags": ["core", "phospho", "site", "human", "llps"],
        "entities": {
            "query": "YAP1 S127 phosphorylation localization",
            "gene": "YAP1",
            "uniprot_ac": "P46937",
            "position": 127,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "kras_s39": {
        "label": "KRAS p.Ser39 / nearby disease variants",
        "tags": ["disease", "site", "human"],
        "entities": {
            "query": "KRAS S39 phosphorylation mutation",
            "gene": "KRAS",
            "uniprot_ac": "P01116",
            "position": 39,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "egfr_drug": {
        "label": "EGFR Y1197 drug–PTM / kinase context",
        "tags": ["drug", "site", "human", "membrane"],
        "entities": {
            "query": "EGFR phosphorylation erlotinib",
            "gene": "EGFR",
            "uniprot_ac": "P00533",
            "position": 1197,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "egfr_protein": {
        "label": "EGFR protein-level (no site) — drug / PPI fan-out",
        "tags": ["drug", "protein", "human", "membrane"],
        "entities": {
            "query": "EGFR inhibitors phosphorylation",
            "gene": "EGFR",
            "uniprot_ac": "P00533",
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "braf_v600e": {
        "label": "BRAF V600E kinase activity (KAKA)",
        "tags": ["mutation", "kinase", "human"],
        "entities": {
            "query": "BRAF V600E kinase activity",
            "gene": "BRAF",
            "uniprot_ac": "P15056",
            "mutation_label": "V600E",
            "organism": "human",
        },
    },
    "egfr_l858r": {
        "label": "EGFR L858R kinase-activity mutation (KAKA)",
        "tags": ["mutation", "kinase", "human"],
        "entities": {
            "query": "EGFR L858R kinase activity",
            "gene": "EGFR",
            "uniprot_ac": "P00533",
            "mutation_label": "L858R",
            "organism": "human",
        },
    },
    "ep300_ac": {
        "label": "EP300 histone acetyltransferase (WERAM writer)",
        "tags": ["acetyl", "writer", "human"],
        "entities": {
            "query": "EP300 acetylation writer",
            "gene": "EP300",
            "uniprot_ac": "Q09472",
            "ptm_type": "acetylation",
            "organism": "human",
        },
    },
    "hdac1_eraser": {
        "label": "HDAC1 histone deacetylase (WERAM eraser)",
        "tags": ["acetyl", "eraser", "human"],
        "entities": {
            "query": "HDAC1 deacetylation eraser",
            "gene": "HDAC1",
            "uniprot_ac": "Q13547",
            "ptm_type": "acetylation",
            "organism": "human",
        },
    },
    "fus_llps": {
        "label": "FUS phase separation",
        "tags": ["llps", "human"],
        "entities": {
            "query": "FUS LLPS phosphorylation",
            "gene": "FUS",
            "uniprot_ac": "P35637",
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "tardbp_llps": {
        "label": "TARDBP / TDP-43 phase separation",
        "tags": ["llps", "human"],
        "entities": {
            "query": "TARDBP TDP-43 LLPS phosphorylation",
            "gene": "TARDBP",
            "uniprot_ac": "Q13148",
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "sumo_tp53": {
        "label": "TP53 SUMOylation K386 (GPS-SUMO 2.0)",
        "tags": ["sumo", "site", "human"],
        "entities": {
            "query": "TP53 SUMOylation",
            "gene": "TP53",
            "uniprot_ac": "P04637",
            "position": 386,
            "ptm_type": "sumoylation",
            "organism": "human",
        },
    },
    "nfkbia_s32": {
        "label": "NFKBIA p.Ser32 (IκBα degron)",
        "tags": ["phospho", "site", "human", "degron"],
        "entities": {
            "query": "NFKBIA S32 phosphorylation degradation",
            "gene": "NFKBIA",
            "uniprot_ac": "P25963",
            "position": 32,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "ctnnb1_s33": {
        "label": "CTNNB1 p.Ser33 (β-catenin degron)",
        "tags": ["phospho", "site", "human", "degron"],
        "entities": {
            "query": "CTNNB1 S33 phosphorylation Wnt",
            "gene": "CTNNB1",
            "uniprot_ac": "P35222",
            "position": 33,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "stat3_y705": {
        "label": "STAT3 p.Tyr705 (canonical activation)",
        "tags": ["phospho", "site", "human", "tyrosine"],
        "entities": {
            "query": "STAT3 Y705 phosphorylation",
            "gene": "STAT3",
            "uniprot_ac": "P40763",
            "position": 705,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "akt1_s473": {
        "label": "AKT1 p.Ser473 (mTORC2 activation)",
        "tags": ["phospho", "site", "human"],
        "entities": {
            "query": "AKT1 S473 phosphorylation",
            "gene": "AKT1",
            "uniprot_ac": "P31749",
            "position": 473,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "myc_t58": {
        "label": "MYC p.Thr58 (GSK3 / stability)",
        "tags": ["phospho", "site", "human"],
        "entities": {
            "query": "MYC T58 phosphorylation degradation",
            "gene": "MYC",
            "uniprot_ac": "P01106",
            "position": 58,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "mapk1_y187": {
        "label": "MAPK1 p.Tyr187 (ERK2 activation loop)",
        "tags": ["phospho", "site", "human", "tyrosine"],
        "entities": {
            "query": "MAPK1 ERK2 Y187 phosphorylation",
            "gene": "MAPK1",
            "uniprot_ac": "P28482",
            "position": 187,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "src_y419": {
        "label": "SRC p.Tyr419 (kinase activation)",
        "tags": ["phospho", "site", "human", "tyrosine"],
        "entities": {
            "query": "SRC Y419 phosphorylation",
            "gene": "SRC",
            "uniprot_ac": "P12931",
            "position": 419,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "brca1_ub": {
        "label": "BRCA1 ubiquitination (DNA-damage E3)",
        "tags": ["ub", "protein", "human", "disease"],
        "entities": {
            "query": "BRCA1 ubiquitination DNA damage",
            "gene": "BRCA1",
            "uniprot_ac": "P38398",
            "ptm_type": "ubiquitination",
            "organism": "human",
        },
    },
    "h3_k27me": {
        "label": "Histone H3.1 K27 methylation (H3C1 / P68431)",
        "tags": ["methyl", "histone", "site", "human"],
        "entities": {
            "query": "H3C1 K27 methylation H3K27me3",
            "gene": "H3C1",
            "uniprot_ac": "P68431",
            "position": 27,
            "ptm_type": "methylation",
            "organism": "human",
        },
    },
    "gapdh_metabolic": {
        "label": "GAPDH metabolic / PathBank context",
        "tags": ["protein", "human", "pathway"],
        "entities": {
            "query": "GAPDH glycolysis PTM",
            "gene": "GAPDH",
            "uniprot_ac": "P04406",
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "ins_secreted": {
        "label": "INS secreted peptide (signal peptide / extracellular)",
        "tags": ["protein", "human", "secreted"],
        "entities": {
            "query": "INS insulin localization secretion",
            "gene": "INS",
            "uniprot_ac": "P01308",
            "organism": "human",
        },
    },
    "lmna_nuclear": {
        "label": "LMNA nuclear lamina (NLS / envelope)",
        "tags": ["protein", "human", "nuclear"],
        "entities": {
            "query": "LMNA lamin A nuclear envelope",
            "gene": "LMNA",
            "uniprot_ac": "P02545",
            "organism": "human",
        },
    },
    "pten_s380": {
        "label": "PTEN p.Ser380 (C-tail cluster)",
        "tags": ["phospho", "site", "human", "disease"],
        "entities": {
            "query": "PTEN S380 phosphorylation",
            "gene": "PTEN",
            "uniprot_ac": "P60484",
            "position": 380,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "gps6_rsph1": {
        "label": "RSPH1 S2 (present in GPS 6.0 local dump; TP53 is not)",
        "tags": ["phospho", "site", "human", "gps6"],
        "entities": {
            "query": "RSPH1 phosphorylation kinases",
            "gene": "RSPH1",
            "uniprot_ac": "Q8WYR4",
            "position": 2,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "dbptm_trfe": {
        "label": "TRFE / P02787 (present in dbPTM disease TSV)",
        "tags": ["disease", "human", "dbptm"],
        "entities": {
            "query": "transferrin P02787 S-nitrosylation disease",
            "gene": "TF",
            "uniprot_ac": "P02787",
            "position": 58,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "literature": {
        "label": "Literature: TP53 Ser15 + known PMIDs",
        "tags": ["literature"],
        "entities": {
            "query": "TP53 Ser15 phosphorylation ATM",
            "gene": "TP53",
            "uniprot_ac": "P04637",
            "position": 15,
            "ptm_type": "phosphorylation",
        },
        "pmids": ["11025664", "30445427"],
        "oa_pmids": ["29145615", "30445427"],
    },
    "literature_brca": {
        "label": "Literature: BRCA1 DNA-damage (different topic / PMIDs)",
        "tags": ["literature"],
        "entities": {
            "query": "BRCA1 ubiquitination DNA damage repair",
            "gene": "BRCA1",
            "uniprot_ac": "P38398",
            "ptm_type": "ubiquitination",
        },
        "pmids": ["10499589"],
        "oa_pmids": ["29145615"],
    },
    "literature_pmid_bad": {
        "label": "Literature: bogus PMID (should not crash)",
        "tags": ["literature", "adversarial"],
        "entities": {
            "query": "not-a-real-paper-zzzz",
        },
        "pmids": ["00000000", "99999999"],
        "oa_pmids": ["00000000"],
    },
    "mouse_trp53": {
        "label": "Mouse Trp53 / P02340 (non-human organism)",
        "tags": ["organism", "mouse", "protein"],
        "entities": {
            "query": "Trp53 phosphorylation mouse",
            "gene": "Trp53",
            "uniprot_ac": "P02340",
            "ptm_type": "phosphorylation",
            "organism": "mouse",
        },
    },
    "yeast_cdc28": {
        "label": "Yeast CDC28 / CDK1 (Saccharomyces cerevisiae)",
        "tags": ["organism", "yeast", "protein"],
        "entities": {
            "query": "CDC28 phosphorylation yeast",
            "gene": "CDC28",
            "uniprot_ac": "P00546",
            "ptm_type": "phosphorylation",
            "organism": "yeast",
        },
    },
    "isoform_tp53": {
        "label": "TP53 isoform accession P04637-2",
        "tags": ["isoform", "human", "adversarial"],
        "entities": {
            "query": "TP53 isoform delta40 phosphorylation",
            "gene": "TP53",
            "uniprot_ac": "P04637-2",
            "position": 15,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "alias_p53": {
        "label": "Alias / lowercase gene symbol p53 (no accession)",
        "tags": ["alias", "adversarial"],
        "entities": {
            "query": "p53 serine 15 phosphorylation",
            "gene": "p53",
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "accession_only": {
        "label": "UniProt-only P04637 (no gene symbol)",
        "tags": ["identity", "adversarial"],
        "entities": {
            "query": "P04637 phosphorylation",
            "uniprot_ac": "P04637",
            "position": 15,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "identity_mismatch": {
        "label": "Stale identity: gene=STAT3 + AC=P04637 (TP53)",
        "tags": ["identity", "adversarial"],
        "entities": {
            "query": "STAT3 P04637 S15",
            "gene": "STAT3",
            "uniprot_ac": "P04637",
            "position": 15,
            "ptm_type": "phosphorylation",
            "organism": "human",
        },
    },
    "position_only": {
        "label": "Site without protein (position=15 only)",
        "tags": ["adversarial"],
        "entities": {
            "query": "serine 15 phosphorylation",
            "position": 15,
            "ptm_type": "phosphorylation",
        },
    },
    "erlotinib_only": {
        "label": "Drug name only (no gene) — decryptM/PMADS routing",
        "tags": ["drug", "adversarial"],
        "entities": {
            "query": "erlotinib phosphorylation response",
            "ptm_type": "phosphorylation",
        },
    },
    "negative": {
        "label": "Negative control (non-gene)",
        "tags": ["adversarial"],
        "entities": {
            "query": "ZZZZNOTAGENE",
            "gene": "ZZZZNOTAGENE",
            "organism": "human",
        },
    },
}


def P(
    case: str,
    expect: str = "any",
    check: str | None = None,
    extra: dict[str, Any] | None = None,
    via: str | None = None,
    drop: list[str] | None = None,
) -> dict[str, Any]:
    spec: dict[str, Any] = {"case": case, "expect": expect}
    if check:
        spec["check"] = check
    if extra:
        spec["extra"] = extra
    if via:
        spec["via"] = via
    if drop:
        spec["drop"] = drop
    return spec

# expect: hit | empty_ok | any
# hit = this biology should have records if the source is deployed
# empty_ok = empty is scientifically plausible
# any = success without crash is enough

TOOL_PLAN: dict[str, list[dict[str, Any]]] = {
    "qptm_search": [
        P("tp53_s15", "hit", "gene_tp53"),
        P("yap1_s127", "hit", "gene_yap1"),
        P("akt1_s473", "hit", "gene_akt1"),
        P("mouse_trp53", "any"),
        P("yeast_cdc28", "any"),
        P("alias_p53", "any"),
        P("identity_mismatch", "mismatch"),
        P("negative", "empty_ok"),
    ],
    "qptm_site_conditions": [
        P("tp53_s15", "hit"),
        P("yap1_s127", "hit"),
        P("stat3_y705", "any"),
        P("isoform_tp53", "any"),
        P("position_only", "missing"),
    ],
    "qptm_kinases": [
        P("tp53_s15", "hit", "s15_writers"),
        P("yap1_s127", "hit", "lats_or_kinase"),
        P("akt1_s473", "any"),
        P("mapk1_y187", "any"),
        P("accession_only", "any"),
    ],
    "iptmnet_enzymes": [
        P("tp53_s15", "hit", "s15_writers"),
        P("yap1_s127", "any"),
        P("stat3_y705", "any"),
        P("mouse_trp53", "any"),
    ],
    "iptmnet_ptm_ppi": [
        P("tp53_s15", "hit"),
        P("yap1_s127", "any"),
        P("ctnnb1_s33", "any"),
        P("tp53_protein", "any"),
    ],
    "uniprot_annotation": [
        P("tp53_s15", "hit", "uniprot_tp53"),
        P("yap1_s127", "hit", "uniprot_yap1"),
        P("ins_secreted", "hit", "uniprot_ins"),
        P("mouse_trp53", "hit", "uniprot_trp53"),
        P("yeast_cdc28", "any"),
        P("isoform_tp53", "any"),
        P("identity_mismatch", "mismatch", via="invoke"),
    ],
    "interpro_domains": [
        P("tp53_s15", "hit", "has_domain"),
        P("egfr_protein", "hit", "has_domain"),
        P("ins_secreted", "any"),
        P("lmna_nuclear", "any"),
        P("accession_only", "hit", "has_domain"),
    ],
    "pfam_domains": [
        P("tp53_s15", "hit", "has_domain"),
        P("egfr_protein", "hit", "has_domain"),
        P("h3_k27me", "any"),
        P("gapdh_metabolic", "any"),
    ],
    "psp_kinase_substrate": [
        P("tp53_s15", "hit", "s15_writers"),
        P("yap1_s127", "hit", "lats_or_kinase"),
        P("stat3_y705", "any"),
        P("myc_t58", "any"),
        P("negative", "empty_ok"),
    ],
    "psp_regulatory": [
        P("tp53_s15", "hit"),
        P("yap1_s127", "hit"),
        P("nfkbia_s32", "any"),
        P("ctnnb1_s33", "any"),
        P("tp53_k382", "any"),
    ],
    "psp_disease_sites": [
        P("tp53_s15", "hit"),
        P("kras_s39", "any"),
        P("pten_s380", "any"),
        P("brca1_ub", "any"),
        P("mouse_trp53", "empty_ok"),
    ],
    "psp_ptmvar": [
        P("kras_s39", "hit", "mentions_kras"),
        P("tp53_s15", "any"),
        P("braf_v600e", "any"),
        P("egfr_l858r", "any"),
        P("alias_p53", "any"),
    ],
    "dbptm_functional": [
        P("dbptm_trfe", "hit"),
        P("tp53_s15", "empty_ok"),
        P("kras_s39", "any"),
        P("gapdh_metabolic", "any"),
        P("negative", "missing"),
    ],
    "ptm_stability": [
        P("tp53_s15", "any"),
        P("yap1_s127", "any"),
        P("ctnnb1_s33", "any"),
        P("myc_t58", "any"),
        P("h3_k27me", "any"),
    ],
    "activedriver_mutations": [
        P("kras_s39", "hit", "mentions_kras"),
        P("tp53_s15", "hit"),
        P("pten_s380", "any"),
        P("brca1_ub", "any"),
        P("braf_v600e", "any"),
    ],
    "activedriver_kinase_network": [
        P("tp53_s15", "hit"),
        P("egfr_protein", "any"),
        P("mapk1_y187", "any"),
        P("src_y419", "any"),
    ],
    "pmads_drug_ptm": [
        P("egfr_drug", "any"),
        P("tp53_s15", "any"),
        P("egfr_protein", "any"),
        P("erlotinib_only", "missing"),
    ],
    "drugbank_targets": [
        P("egfr_drug", "hit", "egfr_drugs"),
        P("tp53_s15", "hit"),
        P("braf_v600e", "any"),
        P("ins_secreted", "any"),
    ],
    "weram_regulators": [
        P("ep300_ac", "hit", "mentions_ep300"),
        P("hdac1_eraser", "hit", "mentions_hdac1"),
        P("h3_k27me", "any"),
        P("tp53_k382", "empty_ok"),
    ],
    "ubibrowser_interactions": [
        P("tp53_ub", "hit", "mentions_mdm2"),
        P("tp53_protein", "any"),
        P("brca1_ub", "any"),
        P("negative", "empty_ok"),
    ],
    "gpsuber_e3_sites": [
        P("tp53_ub_k101", "hit"),
        P("tp53_ub", "any"),
        P("tp53_protein", "any"),
        P("brca1_ub", "any"),
    ],
    "gps6_kinases": [
        P("tp53_s15", "empty_ok"),
        P("gps6_rsph1", "hit"),
        P("yap1_s127", "any"),
        P("mapk1_y187", "any"),
        P("mouse_trp53", "empty_ok"),
    ],
    "gpssumo2_sites": [
        P("sumo_tp53", "hit"),
        P("tp53_s15", "any"),
        P("tp53_protein", "any"),
        P("yap1_s127", "any"),
    ],
    "kaka_kinase_mutations": [
        P("braf_v600e", "hit", "mentions_braf"),
        P("egfr_l858r", "any"),
        P("tp53_s15", "empty_ok"),
        P("src_y419", "any"),
    ],
    "ekpi_kinases": [
        P("tp53_s15", "hit", "s15_writers"),
        P("yap1_s127", "any"),
        P("akt1_s473", "any"),
        P("stat3_y705", "any"),
    ],
    "ekpi_quantitative": [
        P("tp53_s15", "hit"),
        P("egfr_drug", "any"),
        P("akt1_s473", "any"),
        P("mapk1_y187", "any"),
    ],
    "ptmphase_llps": [
        P("fus_llps", "hit"),
        P("tardbp_llps", "any"),
        P("yap1_s127", "any"),
        P("tp53_s15", "any"),
    ],
    "ptmphase_phosllps": [
        P("fus_llps", "any"),
        P("tardbp_llps", "any"),
        P("yap1_s127", "any"),
        P("lmna_nuclear", "any"),
    ],
    "dscope_literature": [
        P("fus_llps", "hit"),
        P("tardbp_llps", "any"),
        P("tp53_s15", "any"),
        P("negative", "empty_ok"),
    ],
    "dscope_predictions": [
        P("fus_llps", "any"),
        P("tardbp_llps", "any"),
        P("yap1_s127", "any"),
        P("tp53_protein", "any"),
    ],
    "ptmd_disease": [
        P("tp53_s15", "hit"),
        P("kras_s39", "hit"),
        P("pten_s380", "any"),
        P("brca1_ub", "any"),
        P("mouse_trp53", "empty_ok"),
    ],
    "cancerproteome_disease": [
        P("tp53_s15", "hit"),
        P("egfr_protein", "any"),
        P("brca1_ub", "any"),
        P("akt1_s473", "any"),
        P("alias_p53", "any"),
    ],
    "ptmint_ppi": [
        P("yap1_s127", "hit"),
        P("tp53_s15", "hit"),
        P("ctnnb1_s33", "any"),
        P("stat3_y705", "any"),
        P("tp53_protein", "any"),
    ],
    "string_ppi": [
        P("tp53_s15", "hit", "mentions_mdm2"),
        P("yap1_s127", "hit"),
        P("egfr_protein", "hit"),
        P("gapdh_metabolic", "any"),
        P("yeast_cdc28", "hit"),
        P("identity_mismatch", "mismatch", via="invoke"),
    ],
    "biogrid_interactions": [
        P("tp53_s15", "hit"),
        P("egfr_protein", "hit"),
        P("brca1_ub", "any"),
        P("mouse_trp53", "any"),
        P("negative", "empty_ok"),
    ],
    "intact_interactions": [
        P("tp53_s15", "hit"),
        P("yap1_s127", "any"),
        P("ins_secreted", "any"),
        P("accession_only", "any"),
    ],
    "reactome_pathways": [
        P("tp53_s15", "hit", "has_pathway"),
        P("egfr_protein", "hit", "has_pathway"),
        P("gapdh_metabolic", "hit", "has_pathway"),
        P("ins_secreted", "any"),
    ],
    "kegg_pathways": [
        P("tp53_s15", "hit", "has_pathway"),
        P("egfr_protein", "hit", "has_pathway"),
        P("gapdh_metabolic", "hit", "has_pathway"),
        P("yeast_cdc28", "any"),
        P("mapk1_y187", "any"),
    ],
    "pathbank_pathways": [
        P("tp53_s15", "any"),
        P("egfr_protein", "any"),
        P("gapdh_metabolic", "any"),
        P("ins_secreted", "any"),
    ],
    "ptmcode_associations": [
        P("tp53_s15", "hit"),
        P("yap1_s127", "any"),
        P("tp53_k382", "any"),
        P("h3_k27me", "any"),
    ],
    "inuloc_nls_nes": [
        P("tp53_s15", "hit"),
        P("yap1_s127", "any"),
        P("lmna_nuclear", "any"),
        P("ins_secreted", "empty_ok"),
        P("accession_only", "any"),
    ],
    "inuloc_nuclear_prob": [
        P("tp53_s15", "hit"),
        P("yap1_s127", "any"),
        P("lmna_nuclear", "any"),
        P("ins_secreted", "any"),
    ],
    "funcscore_phosphosite": [
        P("yap1_s127", "hit"),
        P("tp53_s15", "hit"),
        P("akt1_s473", "any"),
        P("myc_t58", "any"),
        P("isoform_tp53", "any"),
    ],
    "decryptm_drug_ptm": [
        P("tp53_s15", "any"),
        P("egfr_drug", "any"),
        P("egfr_protein", "any"),
        P("erlotinib_only", "missing"),
    ],
    "compartments_localization": [
        P("tp53_s15", "hit", "nucleus"),
        P("yap1_s127", "hit", "nucleus"),
        P("ins_secreted", "hit", "secreted"),
        P("lmna_nuclear", "hit", "nucleus"),
        P("egfr_protein", "any"),
        P("yeast_cdc28", "any"),
    ],
    "subcell_scsi": [
        P("tp53_s15", "any"),
        P("yap1_s127", "any"),
        P("ins_secreted", "any"),
        P("lmna_nuclear", "any"),
        P("gapdh_metabolic", "any"),
    ],
    "pubtator_literature_search": [
        P("literature", "hit", "has_pmid"),
        P("literature_brca", "hit", "has_pmid"),
        P("literature_pmid_bad", "empty_ok"),
        P("alias_p53", "any"),
    ],
    "pubmed_esearch": [
        P("literature", "hit", "has_pmid"),
        P("literature_brca", "hit", "has_pmid"),
        P("literature_pmid_bad", "empty_ok"),
        P("h3_k27me", "any"),
    ],
    "europepmc_literature_search": [
        P("literature", "hit", "has_pmid"),
        P("literature_brca", "hit", "has_pmid"),
        P("literature_pmid_bad", "empty_ok"),
        P("tardbp_llps", "any"),
    ],
    "pubmed_fetch_abstracts": [
        P("literature", "hit", "has_pmid"),
        P("literature_brca", "any"),
        P("literature_pmid_bad", "empty_ok"),
    ],
    "pubmed_fetch_fulltext": [
        P("literature", "any"),
        P("literature_brca", "any"),
        P("literature_pmid_bad", "empty_ok"),
    ],
    "signalp_prediction": [
        P("ins_secreted", "any"),
        P("tp53_s15", "any"),
        P("egfr_protein", "any"),
    ],
}

ROW_KEYS = (
    "kinases",
    "conditions",
    "events",
    "entries",
    "items",
    "results",
    "sites",
    "papers",
    "abstracts",
    "interactions",
    "pathways",
    "localizations",
    "domains",
    "enzymes",
    "mutations",
    "curves",
    "associations",
    "disease_associations",
    "hits",
    "rows",
    "segments",
    "proteins",
    "predictions",
    "kinase_best",
)


def _blob(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str).upper()


def _rows(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        return []
    for key in ROW_KEYS:
        val = data.get(key)
        if isinstance(val, list) and val and isinstance(val[0], dict):
            return [r for r in val if isinstance(r, dict)]
    inner = data.get("data")
    if isinstance(inner, dict):
        return _rows(inner)
    return []


def row_count(data: Any) -> int:
    if not isinstance(data, dict):
        return 0
    for key in ("total", "count", "n", "total_conditions", "total_disease", "total_sites"):
        try:
            n = int(data.get(key))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if n >= 0:
            return n
    rows = _rows(data)
    if rows:
        return len(rows)
    for key in ROW_KEYS:
        val = data.get(key)
        if isinstance(val, list):
            return len(val)
    return 0


def _contains_any(data: Any, tokens: list[str]) -> bool:
    blob = _blob(data)
    return any(tok.upper() in blob for tok in tokens)


CHECKS: dict[str, Callable[[dict[str, Any]], bool]] = {
    "gene_tp53": lambda d: _contains_any(d, ["TP53", "P04637"]),
    "gene_yap1": lambda d: _contains_any(d, ["YAP1", "P46937"]),
    "gene_akt1": lambda d: _contains_any(d, ["AKT1", "P31749"]),
    "uniprot_tp53": lambda d: str(d.get("gene") or "").upper() == "TP53"
    or _contains_any(d, ["CELLULAR TUMOR ANTIGEN P53", "P04637"]),
    "uniprot_yap1": lambda d: "YAP" in _blob(d),
    "uniprot_ins": lambda d: _contains_any(d, ["INSULIN", "P01308", "INS"]),
    "uniprot_trp53": lambda d: _contains_any(d, ["P02340", "TRP53", "P53"]),
    "s15_writers": lambda d: _contains_any(
        d, ["ATM", "ATR", "CHEK1", "CHEK2", "CHK1", "CHK2", "PRKDC", "DNA-PK", "DNA-PKCS"]
    ),
    "lats_or_kinase": lambda d: _contains_any(d, ["LATS1", "LATS2", "STK3", "STK4", "MST", "NLK", "CK1"]),
    "has_domain": lambda d: (
        int(d.get("total") or 0) > 0 or row_count(d) > 0
    ) and _contains_any(d, ["DOMAIN", "FAMILY", "PFAM", "IPR", "P53", "KINASE"]),
    "mentions_kras": lambda d: _contains_any(d, ["KRAS", "P01116"]),
    "egfr_drugs": lambda d: _contains_any(
        d, ["ERLOTINIB", "GEFITINIB", "OSIMERTINIB", "AFATINIB", "LAPATINIB", "CETUXIMAB"]
    ),
    "mentions_ep300": lambda d: _contains_any(d, ["EP300", "P300", "Q09472", "HAT"]),
    "mentions_hdac1": lambda d: _contains_any(d, ["HDAC1", "Q13547", "HISTONE DEACETYLASE"]),
    "mentions_mdm2": lambda d: _contains_any(d, ["MDM2", "MDM4", "UBE3A"]),
    "mentions_braf": lambda d: _contains_any(d, ["BRAF", "V600E", "P15056"]),
    "has_pathway": lambda d: int(d.get("total") or 0) > 0 or row_count(d) > 0,
    "nucleus": lambda d: _contains_any(d, ["NUCLEUS", "NUCLEOPLASM", "NUCLEAR"]),
    "secreted": lambda d: _contains_any(
        d, ["EXTRACELLULAR", "SECRETED", "SECRETION", "VESICLE", "ER LUMEN", "ENDOPLASMIC"]
    ),
    "has_pmid": lambda d: bool(__import__("re").search(r"\b\d{6,8}\b", _blob(d))),
}


def refine_kind(classified: dict[str, Any], raw: dict[str, Any] | None) -> str:
    kind = classified.get("error_kind")
    summary = str(classified.get("summary") or "")
    err = ""
    if isinstance(raw, dict):
        err = str(raw.get("error") or "")
    text = f"{kind} {summary} {err}"
    low = text.lower()
    if "index missing" in low or "not built" in low:
        return "index_missing"
    if "biogrid" in low and ("access key" in low or "authentication" in low or "not configured" in low):
        return "auth_required"
    if "final_result" in low or "matrices not available" in low:
        return "data_unavailable"
    if "prepare_" in low or "dataset not loaded" in low or "not loaded" in low:
        return "data_unavailable"
    if isinstance(raw, dict) and raw.get("available") is False and not err:
        return "data_unavailable"
    if "missing_identifier" in low:
        return "missing_params"
    if kind in ("identity_mismatch", "http_error") or "identity_mismatch" in low or "not consistent with" in low:
        return kind if kind in ("identity_mismatch", "http_error") else "identity_mismatch"
    if classified.get("error_kind") == "http_error":
        return "http_error"
    if kind:
        return str(kind)
    if classified.get("success") and row_count(raw if isinstance(raw, dict) else {}) == 0:
        # classify_result misses many list keys
        if not any(isinstance((raw or {}).get(k), list) and (raw or {}).get(k) for k in ROW_KEYS):
            # may still be a rich annotation dict (UniProt)
            if isinstance(raw, dict) and (raw.get("gene") or raw.get("protein_name") or raw.get("function")):
                return "ok"
            return "empty_result"
        return "ok"
    if classified.get("success"):
        return "ok"
    return "tool_error"


def preflight() -> dict[str, Any]:
    catalog = get_catalog()
    indexes: list[dict[str, Any]] = []
    for src in catalog.all():
        for fmeta in src.files:
            path = index_path_for(src, fmeta)
            raw = src.resolve(fmeta.path) if src.root else None
            indexes.append(
                {
                    "source_id": src.id,
                    "file_id": fmeta.id,
                    "access": src.access.value,
                    "tools": list(src.tools),
                    "sqlite": str(path),
                    "sqlite_exists": path.exists(),
                    "raw_path": str(raw) if raw else None,
                    "raw_exists": bool(raw and (raw.exists() or raw.is_dir())),
                }
            )

    stability = Path(settings.stability_data_dir) / "ptm_stability_curated.tsv"
    dbptm = Path(settings.dbptm_data_dir)
    ekpi_dir = Path(settings.ekpi_final_result_dir)
    return {
        "tools_registered": sorted(registry.tool_names),
        "tool_count": len(registry.tool_names),
        "metadata_tools": sorted(TOOL_DATABASES),
        "signalp_registered": "signalp_prediction" in registry.tool_names,
        "biogrid_key_set": bool((settings.biogrid_access_key or "").strip()),
        "ncbi_api_key_set": bool((settings.ncbi_api_key or "").strip()),
        "qptm_api": settings.qptm_api_base_url,
        "stability_tsv": {"path": str(stability), "exists": stability.exists()},
        "dbptm_dir": {
            "path": str(dbptm),
            "exists": dbptm.is_dir(),
            "files": sorted(p.name for p in dbptm.glob("*") if p.is_file())[:20] if dbptm.is_dir() else [],
        },
        "ekpi_matrices": {"path": str(ekpi_dir), "exists": ekpi_dir.is_dir()},
        "indexes": indexes,
        "indexes_missing": [
            i
            for i in indexes
            if i["access"] != "api"
            and not i["sqlite_exists"]
            and not i.get("raw_exists")
            and i["file_id"]
        ],
    }


def build_args(
    tool: str,
    case: dict[str, Any],
    extra: dict[str, Any] | None = None,
    drop: list[str] | None = None,
) -> dict[str, Any]:
    entities = dict(case.get("entities") or {})
    if extra:
        entities.update(extra)
    for key in drop or []:
        entities.pop(key, None)
    extra = extra or {}
    if tool == "pubmed_fetch_abstracts":
        return {"pmids": extra.get("pmids") or case.get("pmids") or ["11025664"], "max_chars": 1200}
    if tool == "pubmed_fetch_fulltext":
        return {"pmids": extra.get("oa_pmids") or case.get("oa_pmids") or ["29145615"], "max_chars": 2000}
    args = infer_tool_arguments(tool, entities, None) or {}
    # Keep UbiBrowser health-check on local/known path; predicted TSV is 4×60s.
    if tool == "ubibrowser_interactions":
        args["include_predicted"] = False
    if tool in ("pubtator_literature_search", "pubmed_esearch", "europepmc_literature_search"):
        args.setdefault("limit", 8)
    if extra:
        args.update({k: v for k, v in extra.items() if k not in ("via", "pmids", "oa_pmids")})
    for key in drop or []:
        args.pop(key, None)
    if not args:
        args = {k: v for k, v in entities.items() if k in ("gene", "uniprot_ac", "position", "ptm_type", "query")}
    return args


def _call_with_timeout(fn: Callable[[], Any], timeout: float) -> Any:
    """Run fn with a hard timeout; do not block on hung worker shutdown."""
    pool = ThreadPoolExecutor(max_workers=1)
    fut = pool.submit(fn)
    try:
        result = fut.result(timeout=timeout)
    except (TimeoutError, FuturesTimeout):
        try:
            pool.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            pool.shutdown(wait=False)
        raise
    pool.shutdown(wait=True)
    return result


def run_one(tool: str, case_id: str, timeout: float) -> dict[str, Any]:
    case = CASES[case_id]
    started = time.perf_counter()
    args = build_args(tool, case)
    out: dict[str, Any] = {
        "tool": tool,
        "database": TOOL_DATABASES.get(tool, tool),
        "case": case_id,
        "case_label": case["label"],
        "args": {k: v for k, v in args.items() if k != "query" or len(str(v)) < 120},
    }
    if not args:
        out.update(
            {
                "status": "missing_params",
                "latency_ms": 0,
                "summary": "infer_tool_arguments returned empty",
                "rows": 0,
            }
        )
        return out

    try:
        raw = _call_with_timeout(lambda: registry.execute(tool, args), timeout)
    except (TimeoutError, FuturesTimeout):
        out.update(
            {
                "status": "timeout",
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "summary": f"Timed out after {timeout:.0f}s",
                "rows": 0,
            }
        )
        return out
    except Exception as exc:
        out.update(
            {
                "status": "call_bug",
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "summary": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc()[-1500:],
                "rows": 0,
            }
        )
        return out

    elapsed = int((time.perf_counter() - started) * 1000)
    classified = _classify_result(tool, raw if isinstance(raw, dict) else {"summary": str(raw)})
    raw_d = raw if isinstance(raw, dict) else {}
    status = refine_kind(classified, raw_d)
    rows = row_count(raw_d)
    if status in (None, "ok") and rows == 0 and not classified.get("success"):
        status = classified.get("error_kind") or "tool_error"
    if status == "ok" and rows == 0 and classified.get("error_kind") == "empty_result":
        status = "empty_result"
    # UniProt-style annotation objects
    if status == "empty_result" and raw_d.get("gene") and raw_d.get("protein_name"):
        status = "ok"
        rows = 1

    out.update(
        {
            "status": status,
            "latency_ms": elapsed,
            "summary": str(classified.get("summary") or raw_d.get("summary") or "")[:400],
            "rows": rows,
            "classified_error_kind": classified.get("error_kind"),
            "success_flag": bool(classified.get("success")),
        }
    )
    return out


def evaluate_probe(probe: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    expect = spec.get("expect", "any")
    check_name = spec.get("check")
    status = probe["status"]
    verdict = "pass"
    notes: list[str] = []

    if expect == "missing" and status == "missing_params":
        verdict = "pass"
        notes.append("expected missing_params")
    elif expect == "mismatch" and status == "identity_mismatch":
        verdict = "pass"
        notes.append("refused stale gene↔accession pair")
    elif expect == "mismatch" and status == "tool_error" and probe.get("classified_error_kind") == "identity_mismatch":
        verdict = "pass"
        probe["status"] = "identity_mismatch"
        notes.append("refused stale gene↔accession pair (classified)")
    elif status in ("timeout", "call_bug", "http_error", "tool_error", "index_missing", "auth_required", "data_unavailable"):
        verdict = "fail"
        notes.append(f"infrastructure/error: {status}")
    elif status == "missing_params":
        verdict = "fail"
        notes.append("missing_params — probe or infer_tool_arguments gap")
    elif expect == "mismatch":
        verdict = "fail"
        notes.append(f"expected identity_mismatch, got {status}")
    elif expect == "missing":
        verdict = "fail"
        notes.append(f"expected missing_params, got {status}")
    elif expect == "hit" and status == "empty_result":
        verdict = "unexpected_empty"
        notes.append("expected records for this biology if the source is deployed")
    elif expect == "empty_ok" and status == "ok" and probe["rows"] > 0:
        verdict = "pass"
        notes.append("hits are extra, still ok")
    elif status == "ok":
        verdict = "pass"
    elif status == "empty_result" and expect in ("empty_ok", "any"):
        verdict = "pass"
        notes.append("empty is acceptable for this case")
    else:
        verdict = "fail"
        notes.append(status)

    if verdict in ("pass",) and check_name and probe["status"] == "ok":
        fn = CHECKS.get(check_name)
        # Re-run execute is expensive; reasonableness uses summary+args only here.
        # Full check applied in main after attaching a compact preview.
        probe["_check"] = check_name

    probe["expect"] = expect
    probe["verdict"] = verdict
    probe["notes"] = notes
    return probe


def apply_reasonableness(probe: dict[str, Any], raw_preview: dict[str, Any] | None) -> None:
    check_name = probe.pop("_check", None)
    if not check_name or probe.get("status") != "ok":
        return
    fn = CHECKS.get(check_name)
    if not fn:
        return
    payload = {
        "summary": probe.get("summary"),
        "total": probe.get("rows") or 0,
        **(raw_preview or {}),
    }
    try:
        ok = fn(payload)
    except Exception:
        ok = False
    if not ok:
        probe["verdict"] = "unreasonable"
        probe["notes"] = list(probe.get("notes") or []) + [f"failed check `{check_name}`"]
        probe["check"] = check_name
    else:
        probe["check"] = check_name


def compact_raw(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    keep = {}
    for k in ("gene", "uniprot_ac", "protein_name", "summary", "available", "error", "http_status"):
        if raw.get(k) not in (None, ""):
            keep[k] = raw[k]
    rows = _rows(raw)[:15]
    if rows:
        keep["sample_rows"] = rows
    return keep or None


def run_one_with_raw(
    tool: str, spec: dict[str, Any], timeout: float
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Like run_one but retains a compact raw preview for reasonableness checks."""
    case_id = spec["case"]
    case = CASES[case_id]
    started = time.perf_counter()
    extra = spec.get("extra")
    drop = spec.get("drop")
    via = spec.get("via") or "registry"
    entities = dict(case.get("entities") or {})
    if extra:
        entities.update(extra)
    for key in drop or []:
        entities.pop(key, None)

    args = build_args(tool, case, extra=extra, drop=drop)
    probe: dict[str, Any] = {
        "tool": tool,
        "database": TOOL_DATABASES.get(tool, tool),
        "case": case_id,
        "case_label": case["label"],
        "via": via,
        "args": {k: v for k, v in args.items() if not (k == "query" and len(str(v)) > 120)},
    }
    raw: Any = None
    if via != "invoke" and not args:
        probe.update(status="missing_params", latency_ms=0, summary="no args", rows=0)
        return probe, None
    try:
        if via == "invoke":
            wrapped = _call_with_timeout(lambda: _invoke_one(tool, entities), timeout)
            elapsed = int((time.perf_counter() - started) * 1000)
            if not isinstance(wrapped, dict):
                probe.update(
                    status="call_bug",
                    latency_ms=elapsed,
                    summary=f"invoke returned {type(wrapped).__name__}",
                    rows=0,
                )
                return probe, None
            raw_d = wrapped.get("data") if isinstance(wrapped.get("data"), dict) else {}
            status = wrapped.get("error_kind") or (
                "ok" if wrapped.get("success") else "tool_error"
            )
            if status in (None, "ok") and raw_d:
                classified = _classify_result(tool, raw_d)
                status = refine_kind(classified, raw_d)
            rows = row_count(raw_d)
            if status == "ok" and rows == 0 and wrapped.get("error_kind") == "empty_result":
                status = "empty_result"
            if status == "empty_result" and raw_d.get("gene") and (
                raw_d.get("protein_name") or raw_d.get("function")
            ):
                status = "ok"
                rows = max(rows, 1)
            probe.update(
                status=status,
                latency_ms=elapsed,
                summary=str(wrapped.get("summary") or raw_d.get("summary") or "")[:400],
                rows=rows,
                classified_error_kind=wrapped.get("error_kind"),
                success_flag=bool(wrapped.get("success")),
            )
            return probe, compact_raw(raw_d) if raw_d else compact_raw(wrapped)

        raw = _call_with_timeout(lambda: registry.execute(tool, args), timeout)
    except (TimeoutError, FuturesTimeout):
        probe.update(status="timeout", latency_ms=int((time.perf_counter() - started) * 1000), summary=f"Timed out after {timeout:.0f}s", rows=0)
        return probe, None
    except Exception as exc:
        probe.update(
            status="call_bug",
            latency_ms=int((time.perf_counter() - started) * 1000),
            summary=f"{type(exc).__name__}: {exc}",
            rows=0,
        )
        return probe, None

    elapsed = int((time.perf_counter() - started) * 1000)
    classified = _classify_result(tool, raw if isinstance(raw, dict) else {"summary": str(raw)})
    raw_d = raw if isinstance(raw, dict) else {}
    status = refine_kind(classified, raw_d)
    rows = row_count(raw_d)
    if status == "ok" and rows == 0 and classified.get("error_kind") == "empty_result":
        status = "empty_result"
    if status == "empty_result" and raw_d.get("gene") and (raw_d.get("protein_name") or raw_d.get("function")):
        status = "ok"
        rows = max(rows, 1)
    probe.update(
        status=status,
        latency_ms=elapsed,
        summary=str(classified.get("summary") or raw_d.get("summary") or "")[:400],
        rows=rows,
        classified_error_kind=classified.get("error_kind"),
        success_flag=bool(classified.get("success")),
    )
    return probe, compact_raw(raw_d)


def tool_rollup(probes: list[dict[str, Any]]) -> dict[str, Any]:
    statuses = [p["status"] for p in probes]
    verdicts = [p["verdict"] for p in probes]
    if any(v == "fail" and p["status"] in ("index_missing", "data_unavailable", "auth_required") for p, v in zip(probes, verdicts)):
        configured = False
    elif all(p["status"] in ("ok", "empty_result") for p in probes):
        configured = True
    elif any(p["status"] == "ok" for p in probes):
        configured = True
    else:
        configured = False

    infra_fail = {"timeout", "http_error", "index_missing", "auth_required", "data_unavailable"}
    if "unreasonable" in verdicts:
        overall = "unreasonable"
    elif all(v == "pass" for v in verdicts):
        overall = "ok"
    elif (
        any(v == "fail" for v in verdicts)
        and not any(p["status"] == "ok" for p in probes)
        and all(p["status"] in infra_fail for p in probes if p.get("verdict") == "fail")
    ):
        overall = "partial"
    elif any(v == "fail" for v in verdicts) and not any(p["status"] == "ok" for p in probes):
        overall = "broken"
    elif "unexpected_empty" in verdicts and not any(p["status"] == "ok" for p in probes):
        overall = "unexpected_empty"
    elif any(v == "fail" for v in verdicts):
        overall = "partial"
    elif "unexpected_empty" in verdicts:
        overall = "partial"
    else:
        overall = "ok"

    return {
        "tool": probes[0]["tool"],
        "database": probes[0]["database"],
        "configured": configured,
        "overall": overall,
        "n_cases": len(probes),
        "ok_cases": sum(1 for p in probes if p["status"] == "ok"),
        "max_rows": max(p["rows"] for p in probes),
        "max_latency_ms": max(p["latency_ms"] for p in probes),
        "statuses": statuses,
        "verdicts": verdicts,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# Database tool health check",
        f"",
        f"- Time: `{report['started']}`",
        f"- Tools registered: **{report['preflight']['tool_count']}**",
        f"- Case library: **{report.get('n_cases', 0)}** biological / adversarial cases",
        f"- Probes: **{report['n_probes']}** in {report['elapsed_s']}s",
        f"- Workers: {report['workers']}, timeout: {report['timeout_s']}s/call",
        f"",
        f"## Rollup",
        f"",
        f"| Overall | Count |",
        f"|---|---:|",
    ]
    counts = report["overall_counts"]
    for k in ("ok", "partial", "unexpected_empty", "unreasonable", "broken", "untested"):
        lines.append(f"| {k} | {counts.get(k, 0)} |")
    lines += [
        f"",
        f"## Per-tool summary",
        f"",
        f"| Tool | Database | Configured | Overall | OK cases | Max rows | Max ms | Statuses |",
        f"|---|---|---|---|---:|---:|---:|---|",
    ]
    for t in report["tools"]:
        lines.append(
            f"| `{t['tool']}` | {t['database']} | {'yes' if t['configured'] else 'NO'} | "
            f"**{t['overall']}** | {t['ok_cases']}/{t['n_cases']} | {t['max_rows']} | "
            f"{t['max_latency_ms']} | {', '.join(t['statuses'])} |"
        )

    pf = report["preflight"]
    missing = pf.get("indexes_missing") or []
    cases = report.get("cases") or {}
    if cases:
        lines += [
            f"",
            f"## Case library",
            f"",
            f"| Id | Label | Tags |",
            f"|---|---|---|",
        ]
        for cid, meta in cases.items():
            if isinstance(meta, dict):
                lines.append(
                    f"| `{cid}` | {meta.get('label', '')} | {', '.join(meta.get('tags') or [])} |"
                )
            else:
                lines.append(f"| `{cid}` | {meta} | |")
        lines.append("")
    lines += [
        f"",
        f"## Preflight",
        f"",
        f"- BioGRID key: {'set' if pf['biogrid_key_set'] else 'MISSING'}",
        f"- NCBI API key: {'set' if pf['ncbi_api_key_set'] else 'not set (rate-limit risk)'}",
        f"- SignalP registered: {pf['signalp_registered']}",
        f"- Stability TSV: {'yes' if pf['stability_tsv']['exists'] else 'NO'} (`{pf['stability_tsv']['path']}`)",
        f"- eKPI matrices dir: {'yes' if pf['ekpi_matrices']['exists'] else 'NO'} (`{pf['ekpi_matrices']['path']}`)",
        f"- dbPTM dir exists: {pf['dbptm_dir']['exists']} files={pf['dbptm_dir']['files'][:8]}",
        f"- Local indexes missing: **{len(missing)}**",
        f"",
    ]
    if missing:
        lines.append("| Source | File | Tools |")
        lines.append("|---|---|---|")
        for i in missing:
            lines.append(f"| `{i['source_id']}` | `{i['file_id']}` | {', '.join(i['tools'])} |")
        lines.append("")

    lines += [f"## Failed / unexpected probes", f""]
    bad = [p for p in report["probes"] if p["verdict"] != "pass"]
    if not bad:
        lines.append("None.")
    else:
        lines.append("| Tool | Case | Status | Verdict | Rows | ms | Summary |")
        lines.append("|---|---|---|---|---:|---:|---|")
        for p in bad:
            sm = (p.get("summary") or "").replace("|", "/").replace("\n", " ")[:160]
            lines.append(
                f"| `{p['tool']}` | {p['case']} | {p['status']} | {p['verdict']} | "
                f"{p['rows']} | {p['latency_ms']} | {sm} |"
            )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe all 51 registry tools with multiple cases")
    parser.add_argument("--timeout", type=float, default=40.0, help="Per-call timeout seconds")
    parser.add_argument("--workers", type=int, default=3, help="Parallel probes")
    parser.add_argument("--tool", action="append", default=[], help="Restrict to these tools")
    parser.add_argument("--case", action="append", default=[], help="Restrict to these case ids")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "runtime" / "eval")
    args = parser.parse_args()

    register_all_tools()
    pf = preflight()
    wanted = set(args.tool) if args.tool else set(registry.tool_names)
    wanted_cases = set(args.case) if args.case else None

    jobs: list[tuple[str, dict[str, Any]]] = []
    untested: list[str] = []
    for tool in sorted(registry.tool_names):
        if tool not in wanted:
            continue
        plan = TOOL_PLAN.get(tool)
        if not plan:
            untested.append(tool)
            continue
        for spec in plan:
            if wanted_cases and spec.get("case") not in wanted_cases:
                continue
            jobs.append((tool, spec))

    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    t0 = time.perf_counter()
    probes: list[dict[str, Any]] = []

    print(f"Registered {len(registry.tool_names)} tools; running {len(jobs)} probes (timeout={args.timeout}s, workers={args.workers})", flush=True)

    def _job(item: tuple[str, dict[str, Any]]) -> dict[str, Any]:
        tool, spec = item
        probe, preview = run_one_with_raw(tool, spec, args.timeout)
        evaluate_probe(probe, spec)
        apply_reasonableness(probe, preview)
        if preview and preview.get("sample_rows"):
            probe["sample"] = preview["sample_rows"][:2]
        return probe

    if args.workers <= 1:
        for i, item in enumerate(jobs, 1):
            probe = _job(item)
            probes.append(probe)
            print(
                f"[{i}/{len(jobs)}] {probe['tool']} / {probe['case']}: "
                f"{probe['status']} {probe['verdict']} rows={probe['rows']} {probe['latency_ms']}ms",
                flush=True,
            )
    else:
        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = {pool.submit(_job, item): item for item in jobs}
            for fut in as_completed(futs):
                done += 1
                try:
                    probe = fut.result()
                except Exception as exc:
                    tool, spec = futs[fut]
                    probe = {
                        "tool": tool,
                        "database": TOOL_DATABASES.get(tool, tool),
                        "case": spec["case"],
                        "status": "call_bug",
                        "verdict": "fail",
                        "rows": 0,
                        "latency_ms": 0,
                        "summary": str(exc),
                        "notes": ["executor failure"],
                        "expect": spec.get("expect"),
                    }
                probes.append(probe)
                print(
                    f"[{done}/{len(jobs)}] {probe['tool']} / {probe['case']}: "
                    f"{probe.get('status')} {probe.get('verdict')} rows={probe.get('rows')} {probe.get('latency_ms')}ms",
                    flush=True,
                )

    probes.sort(key=lambda p: (p["tool"], p["case"]))
    by_tool: dict[str, list[dict[str, Any]]] = {}
    for p in probes:
        by_tool.setdefault(p["tool"], []).append(p)

    tools_out = [tool_rollup(by_tool[t]) for t in sorted(by_tool)]
    overall_counts: dict[str, int] = {}
    for t in tools_out:
        overall_counts[t["overall"]] = overall_counts.get(t["overall"], 0) + 1
    for name in untested:
        overall_counts["untested"] = overall_counts.get("untested", 0) + 1
        tools_out.append(
            {
                "tool": name,
                "database": TOOL_DATABASES.get(name, name),
                "configured": False,
                "overall": "untested",
                "n_cases": 0,
                "ok_cases": 0,
                "max_rows": 0,
                "max_latency_ms": 0,
                "statuses": [],
                "verdicts": [],
            }
        )

    elapsed_s = round(time.perf_counter() - t0, 1)
    report = {
        "started": started,
        "elapsed_s": elapsed_s,
        "workers": args.workers,
        "timeout_s": args.timeout,
        "n_probes": len(probes),
        "n_cases": len(CASES),
        "cases": {
            cid: {"label": c["label"], "tags": list(c.get("tags") or [])}
            for cid, c in CASES.items()
        },
        "preflight": {
            **{k: v for k, v in pf.items() if k != "indexes"},
            "indexes_missing": pf["indexes_missing"],
            "index_total": len(pf["indexes"]),
            "index_present": sum(1 for i in pf["indexes"] if i["sqlite_exists"]),
        },
        "overall_counts": overall_counts,
        "tools": tools_out,
        "probes": probes,
        "untested": untested,
    }

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "db_health_latest.json"
    md_path = out_dir / "db_health_latest.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    print(f"\nWrote {json_path}")
    print(f"Wrote {md_path}")
    print("Overall:", json.dumps(overall_counts, sort_keys=True))
    broken = [t["tool"] for t in tools_out if t["overall"] in ("broken", "unreasonable")]
    if broken:
        print("Broken/unreasonable:", ", ".join(broken))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

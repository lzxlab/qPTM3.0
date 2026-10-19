"""qPTM site-condition contrast_type filter (Condition type)."""

from __future__ import annotations

from app.tools.qptm_tools import (
    _qptm_site_conditions,
    filter_site_conditions,
)
from app.mcp.tool_args import infer_tool_arguments, parse_query_entities

MIXED = [
    {
        "condition_name": "drug-A",
        "contrast_type": "pharmacological",
        "log2_range": {"avg": 5.0, "min": 4.0, "max": 6.0},
        "event_count": 100,
    },
    {
        "condition_name": "tumor-low",
        "contrast_type": "disease",
        "log2_range": {"avg": 0.2, "min": 0.1, "max": 0.3},
        "event_count": 80,
    },
    {
        "condition_name": "tumor-high",
        "contrast_type": "disease",
        "log2_range": {"avg": -2.5, "min": -3.0, "max": -2.0},
        "event_count": 3,
    },
    {
        "condition_name": "cell",
        "contrast_type": "cell_state",
        "log2_range": {"avg": 1.0, "min": 0.5, "max": 1.5},
        "event_count": 50,
    },
]


def test_filter_disease_drops_other_types_and_sorts_by_abs_log2():
    rows = filter_site_conditions(MIXED, "disease")
    assert [r["condition_name"] for r in rows] == ["tumor-high", "tumor-low"]


def test_filter_none_keeps_api_order():
    rows = filter_site_conditions(MIXED, "")
    assert [r["condition_name"] for r in rows] == [
        "drug-A",
        "tumor-low",
        "tumor-high",
        "cell",
    ]


def test_qptm_site_conditions_filters_before_limit(monkeypatch):
    def fake_get(path, params=None):
        assert path == "/protein.php"
        return {
            "gene": "YAP1",
            "total_conditions": len(MIXED),
            "conditions": MIXED,
        }

    monkeypatch.setattr("app.tools.qptm_tools._get", fake_get)
    out = _qptm_site_conditions(
        "P46937",
        127,
        contrast_type="disease",
        limit=1,
    )
    assert out["total_conditions"] == 2
    assert out["total_conditions_all"] == 4
    assert [c["condition_name"] for c in out["conditions"]] == ["tumor-high"]
    assert "disease-type" in out["summary"]
    assert out["by_type"]["disease"] == 2
    assert out["by_type"]["drug_treatment"] == 1


def test_build_entities_llm_semantic_slots_win():
    from mcp_tools import _build_entities

    ents = _build_entities(
        {
            "query": "HDGF 165 UCEC log2ratio",
            "gene": "HDGF",
            "position": 165,
            "condition_query": "BRCA",
            "cancer": "BRCA",
            "drug": "Gefitinib",
            "disease": "lung adenocarcinoma",
        }
    )
    assert ents["condition_query"] == "BRCA"
    assert ents["cancer"] == "BRCA"
    assert ents["drug"] == "Gefitinib"
    assert ents["disease"] == "lung adenocarcinoma"
    args = infer_tool_arguments(
        "qptm_site_conditions",
        {"uniprot_ac": "P46937", "position": 127, "contrast_type": "disease"},
    )
    assert args["condition_type"] == "disease"
    assert args["uniprot_ac"] == "P46937"
    assert args["position"] == 127


def test_parse_akt1_s473_and_infer_registry_args():
    entities = parse_query_entities("Which kinases phosphorylate AKT1 S473?")
    assert entities["gene"] == "AKT1"
    assert entities["position"] == 473

    kinase_args = infer_tool_arguments(
        "qptm_kinases",
        {**entities, "uniprot_ac": "P31749"},
    )
    assert kinase_args == {"uniprot_ac": "P31749", "position": 473}

    condition_args = infer_tool_arguments(
        "qptm_site_conditions",
        {**entities, "uniprot_ac": "P31749"},
    )
    assert condition_args["uniprot_ac"] == "P31749"
    assert condition_args["position"] == 473
    assert condition_args["ptm_type"] == entities["ptm_type"]


def test_filter_condition_query_keeps_named_row():
    rows = filter_site_conditions(
        MIXED
        + [
            {
                "condition_name": "BRCA PT (133)/Normal (18)",
                "contrast_type": "disease",
                "log2_range": {"avg": 2.64, "min": 2.64, "max": 2.64},
                "event_count": 1,
            }
        ],
        "disease",
        "BRCA",
    )
    assert [r["condition_name"] for r in rows] == ["BRCA PT (133)/Normal (18)"]


def test_qptm_site_conditions_condition_query_before_limit(monkeypatch):
    buried = {
        "condition_name": "BRCA PT (133)/Normal (18)",
        "contrast_type": "disease",
        "log2_range": {"avg": 2.64, "min": 2.64, "max": 2.64},
        "event_count": 2,
    }
    padded = [
        {
            "condition_name": f"other-{i}",
            "contrast_type": "pharmacological",
            "log2_range": {"avg": 9.0},
            "event_count": 100,
        }
        for i in range(40)
    ]

    def fake_get(path, params=None):
        assert path == "/protein.php"
        return {"gene": "HDGF", "total_conditions": 41, "conditions": padded + [buried]}

    monkeypatch.setattr("app.tools.qptm_tools._get", fake_get)
    out = _qptm_site_conditions(
        "P51858",
        165,
        ptm_type="all",
        contrast_type="disease",
        condition_query="BRCA",
        limit=50,
    )
    assert out["conditions"][0]["condition_name"].startswith("BRCA")
    assert out["conditions"][0]["log2_range"]["avg"] == 2.64


def test_parse_hdgf_165_brca_and_myh9_number_site():
    hdgf = parse_query_entities("HDGF 165 BRCA log2ratio")
    assert hdgf["gene"] == "HDGF"
    assert hdgf["position"] == 165
    assert hdgf["condition_query"] == "BRCA"
    assert hdgf["cancer"] == "BRCA"
    assert hdgf["ptm_type"] == "all"

    myh9 = parse_query_entities("MYH9 1445 tumor vs normal")
    assert myh9["gene"] == "MYH9"
    assert myh9["position"] == 1445
    assert myh9["ptm_type"] == "all"

    site = parse_query_entities("What is the fold change at site 165 of HDGF?")
    assert site["gene"] == "HDGF"
    assert site["position"] == 165


def test_breast_cancer_is_not_gene_cancer():
    entities = parse_query_entities("breast cancer PTM changes")
    assert entities.get("gene") != "CANCER"
    assert entities.get("gene") is None or entities["gene"] != "CANCER"
    assert entities.get("disease") == "breast cancer"
    assert entities.get("cancer")


def test_infer_cross_db_filters_and_pmid():
    ents = parse_query_entities(
        "EGFR breast cancer drug Gefitinib PMID 37823596"
    )
    cp = infer_tool_arguments(
        "cancerproteome_disease",
        {**ents, "uniprot_ac": "P00533"},
    )
    assert cp["cancer"]
    pmads = infer_tool_arguments("pmads_drug_ptm", {**ents, "uniprot_ac": "P00533"})
    assert pmads.get("drug")
    abs_args = infer_tool_arguments("pubmed_fetch_abstracts", ents)
    assert "37823596" in [str(x) for x in abs_args["pmids"]]

    cond = infer_tool_arguments(
        "qptm_condition_sites",
        parse_query_entities("UCEC phosphorylation largest change"),
    )
    assert cond["query"] == "UCEC"
    assert cond["sort"] == "abs_log2"
    assert cond["ptm_type"] == "phosphorylation"


def test_infer_psp_regulatory_without_position():
    args = infer_tool_arguments(
        "psp_regulatory",
        {"gene": "AKT1", "uniprot_ac": "P31749"},
    )
    assert args["uniprot_ac"] == "P31749"
    assert "position" not in args


def test_qptm_condition_sites_sort_passthrough(monkeypatch):
    from app.tools.qptm_tools import _qptm_condition_sites

    captured: dict = {}

    def fake_get(path, params=None):
        captured.update(params or {})
        assert path == "/conditions.php"
        return {
            "matched_conditions": 1,
            "total": 2,
            "events": [
                {"gene": "A", "log2_ratio": 0.2, "position": 10},
                {"gene": "B", "log2_ratio": -3.01, "position": 20},
            ],
            "conditions": [{"condition_name": "UCEC"}],
        }

    monkeypatch.setattr("app.tools.qptm_tools._get", fake_get)
    out = _qptm_condition_sites("UCEC", ptm_type="phosphorylation", limit=50)
    assert captured.get("sort") == "abs_log2"
    assert captured.get("q") == "UCEC"
    assert out["total"] == 2


def test_hdgf_165_brca_live_log2():
    import pytest

    out = _qptm_site_conditions(
        "P51858",
        165,
        ptm_type="all",
        contrast_type="disease",
        condition_query="BRCA",
        limit=50,
    )
    if out.get("http_status") or out.get("error"):
        pytest.skip(f"qPTM API unavailable: {out.get('error') or out.get('http_status')}")
    avgs = []
    for row in out.get("conditions") or []:
        rng = row.get("log2_range") or {}
        try:
            avgs.append(float(rng.get("avg")))
        except (TypeError, ValueError):
            continue
    assert any(abs(v - 2.64) < 0.05 for v in avgs), avgs


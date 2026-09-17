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
    assert out["by_type"]["pharmacological"] == 1


def test_infer_tool_arguments_passes_contrast_type():
    args = infer_tool_arguments(
        "qptm_site_conditions",
        {"uniprot_ac": "P46937", "position": 127, "contrast_type": "disease"},
    )
    assert args["contrast_type"] == "disease"
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

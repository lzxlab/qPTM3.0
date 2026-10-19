"""Per-source MCP block formatters."""

from __future__ import annotations

from app.mcp.formatters import format_tool_block


def test_gps6_marked_predicted():
    block = format_tool_block(
        "gps6_kinases",
        {
            "success": True,
            "summary": "GPS predictions",
            "data": {"kinases": [{"kinase": "AKT1", "GPS_Score": 0.92}]},
        },
        limit=5,
    )
    assert block["evidence_level"] == "predicted"
    assert "prediction" in (block.get("legend") or "").lower()
    assert block["rows"][0]["GPS_Score"] == 0.92


def test_psp_kinase_in_vivo_sorts_first():
    block = format_tool_block(
        "psp_kinase_substrate",
        {
            "success": True,
            "summary": "PSP",
            "data": {
                "kinases": [
                    {"KINASE": "MTOR", "IN_VIVO_RXN": "", "IN_VITRO_RXN": "X"},
                    {"KINASE": "PDK1", "IN_VIVO_RXN": "X", "IN_VITRO_RXN": ""},
                ]
            },
        },
        limit=5,
    )
    assert block["rows"][0]["KINASE"] == "PDK1"


def test_ptmd_disease_legend():
    block = format_tool_block(
        "ptmd_disease",
        {"success": True, "summary": "PTMD", "data": {"entries": []}},
    )
    assert "U/D" in block.get("legend", "")


def test_cancerproteome_pdc_not_pmid():
    block = format_tool_block(
        "cancerproteome_disease",
        {"success": True, "summary": "CancerProteome", "data": {"rows": []}},
    )
    legend = block.get("legend", "")
    assert "PDC" in legend or "37823596" in legend


def test_qptm_kinases_mixed_evidence():
    block = format_tool_block(
        "qptm_kinases",
        {
            "success": True,
            "summary": "qPTM kinases",
            "data": {"kinases": [{"kinase": "MTOR", "score": 0.8}]},
        },
        limit=5,
    )
    assert block["evidence_level"] == "mixed"


def test_qptm_kinases_limit_200_keeps_99():
    kinases = [{"kinase_gene": f"K{i}", "evidence_type": "experimental"} for i in range(99)]
    block = format_tool_block(
        "qptm_kinases",
        {
            "success": True,
            "summary": "Found 99 kinase(s)/enzyme(s) for P31749 position 473.",
            "data": {"kinases": kinases, "total": 99},
        },
        limit=200,
    )
    assert block["shown"] == 99
    assert block["total"] == 99
    assert block["truncated"] is False


def test_gps_predictions_extracted_as_rows():
    block = format_tool_block(
        "gps6_kinases",
        {
            "success": True,
            "summary": "GPS predictions",
            "data": {
                "predictions": [
                    {"kinase_gene": "MTOR", "score": 0.9},
                    {"kinase_gene": "AKT1", "score": 0.8},
                ]
            },
        },
        limit=15,
    )
    assert len(block["rows"]) == 2
    assert block["total"] == 2


def test_truncated_preview_keeps_total_from_summary():
    block = format_tool_block(
        "qptm_kinases",
        {
            "success": True,
            "summary": "Found 99 kinase(s)/enzyme(s) for P31749 position 473.",
            "data": {"truncated": True, "preview": '{"kinases":['},
        },
        limit=15,
    )
    assert block["rows"] == []
    assert block["total"] == 99
    assert block["truncated"] is True
    assert block["summary"].endswith("…") or "99" in block["summary"]


def test_default_limit_is_50():
    rows = [{"kinase_gene": f"K{i}"} for i in range(60)]
    block = format_tool_block(
        "qptm_kinases",
        {"success": True, "summary": "60 kinases", "data": {"kinases": rows}},
    )
    assert block["shown"] == 50
    assert block["total"] == 60
    assert block["truncated"] is True


def test_extracts_ptm_hits_and_regulators_as_rows():
    cp = format_tool_block(
        "cancerproteome_disease",
        {
            "success": True,
            "summary": "CancerProteome",
            "data": {
                "ptm_hits": [
                    {"gene": "MYH9", "position": 1445, "qratio": 0.553, "cancer": "UCEC"},
                    {"gene": "MYH9", "position": 1445, "qratio": 1.2, "cancer": "BRCA"},
                ],
                "protein_hits": [{"gene": "MYH9", "fc": 1.1}],
            },
        },
        limit=50,
    )
    assert len(cp["rows"]) == 3
    assert any(r.get("qratio") == 0.553 for r in cp["rows"])

    weram = format_tool_block(
        "weram_regulators",
        {
            "success": True,
            "summary": "WERAM",
            "data": {
                "regulators": [
                    {"enzyme": "HAT1"},
                    {"enzyme": "KAT2A"},
                ]
            },
        },
        limit=50,
    )
    assert len(weram["rows"]) == 2


def test_qptm_condition_sites_sort_by_abs_log2():
    block = format_tool_block(
        "qptm_condition_sites",
        {
            "success": True,
            "summary": "UCEC events",
            "data": {
                "events": [
                    {"gene": "A", "log2_ratio": 0.2},
                    {"gene": "B", "log2_ratio": -3.01},
                    {"gene": "C", "log2_ratio": 1.26},
                ]
            },
        },
        limit=50,
    )
    assert block["rows"][0]["gene"] == "B"
    assert block["rows"][1]["gene"] == "C"


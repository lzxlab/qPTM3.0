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

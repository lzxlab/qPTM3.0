"""Canonical error_kind taxonomy and intent rollup."""

from app.mcp.classify import classify_tool_result, rollup_intent_status
from app.mcp.formatters import format_intent_response


def test_classify_http_error():
    out = classify_tool_result(
        "iptmnet_enzymes",
        {"error": "iPTMnet API HTTP 503", "http_status": 503, "summary": "down"},
    )
    assert out["success"] is False
    assert out["error_kind"] == "http_error"


def test_classify_missing_and_mismatch():
    miss = classify_tool_result("dbptm_functional", {"error": "missing_identifier"})
    assert miss["error_kind"] == "missing_params"
    mm = classify_tool_result(
        "qptm_search",
        {"error": "gene=STAT3 is not consistent with UniProt P04637", "error_kind": "identity_mismatch"},
    )
    assert mm["error_kind"] == "identity_mismatch"
    assert mm["success"] is False


def test_classify_infra_kinds():
    assert classify_tool_result("x", {"error": "GPS 6.0 index missing"})["error_kind"] == "index_missing"
    assert classify_tool_result("x", {"error": "BioGRID access key not configured"})["error_kind"] == "auth_required"
    assert classify_tool_result("x", {"error": "timed out after 25s"})["error_kind"] == "timeout"
    assert classify_tool_result("x", {"available": False, "summary": "dump not loaded"})["error_kind"] == "data_unavailable"


def test_classify_empty_vs_hit():
    empty = classify_tool_result("gps6_kinases", {"summary": "no hits", "total": 0, "kinases": []})
    assert empty["success"] is True
    assert empty["error_kind"] == "empty_result"
    hit = classify_tool_result("qptm_search", {"summary": "712 events", "total": 712, "events": [{}]})
    assert hit["success"] is True
    assert hit["error_kind"] is None


def test_rollup_hits_win():
    ok, kind = rollup_intent_status(
        [
            {"success": True, "error_kind": None},
            {"success": False, "error_kind": "http_error"},
        ]
    )
    assert ok is True
    assert kind is None


def test_rollup_infra_without_hits():
    ok, kind = rollup_intent_status(
        [
            {"success": True, "error_kind": "empty_result"},
            {"success": False, "error_kind": "http_error"},
        ]
    )
    assert ok is False
    assert kind == "http_error"


def test_rollup_only_empty():
    ok, kind = rollup_intent_status(
        [
            {"success": True, "error_kind": "empty_result"},
            {"success": True, "error_kind": "empty_result"},
        ]
    )
    assert ok is True
    assert kind == "empty_result"


def test_format_intent_uses_rollup():
    payload = format_intent_response(
        intent="get_upstream_enzymes",
        resolved={"gene": "TP53"},
        blocks=[
            {"success": True, "error_kind": "empty_result", "rows": [{}], "summary": "empty"},
            {"success": False, "error_kind": "http_error", "rows": [], "summary": "503"},
        ],
        summary="x",
        success=True,
        error_kind="empty_result",
    )
    assert payload["success"] is False
    assert payload["error_kind"] == "http_error"

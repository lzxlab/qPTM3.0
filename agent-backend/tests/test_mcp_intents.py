"""MCP intent tool surface."""

from __future__ import annotations

import json

from app.mcp.intents import (
    INTENT_HANDLERS,
    INTENT_TOOL_MAP,
    MCP_SERVER_INSTRUCTIONS,
    clamp_limit,
    intent_tool_definitions,
    parse_source_filter,
)


def test_intent_tool_list_excludes_invoke():
    names = {t["name"] for t in intent_tool_definitions()}
    assert "qptm_invoke" not in names
    assert "resolve_ptm_target" in names
    assert "get_upstream_enzymes" in names
    assert len(names) == 10


def test_handlers_match_definitions():
    defs = {t["name"] for t in intent_tool_definitions()}
    assert set(INTENT_HANDLERS.keys()) == defs


def test_server_instructions_mention_intent_tools():
    assert "get_upstream_enzymes" in MCP_SERVER_INSTRUCTIONS
    assert "GPS" in MCP_SERVER_INSTRUCTIONS
    assert "experimental" in MCP_SERVER_INSTRUCTIONS.lower()
    assert "predicted" in MCP_SERVER_INSTRUCTIONS.lower()


def test_resolve_akt1():
    raw = INTENT_HANDLERS["resolve_ptm_target"](gene="AKT1", query="AKT1 S473")
    payload = json.loads(raw)
    assert payload["intent"] == "resolve_ptm_target"
    assert payload.get("resolved", {}).get("gene") == "AKT1"
    assert payload.get("resolved", {}).get("uniprot_ac")


def test_sources_param_on_intent_schema():
    up = next(t for t in intent_tool_definitions() if t["name"] == "get_upstream_enzymes")
    props = up["inputSchema"]["properties"]
    assert "sources" in props
    assert "limit" in props


def test_qptm_source_filter_only_qptm_kinases():
    filt = parse_source_filter("qptm")
    assert filt is not None
    tools = [t for t, _ in INTENT_TOOL_MAP["get_upstream_enzymes"] if filt(t)]
    assert tools == ["qptm_kinases"]


def test_gps_source_filter_excludes_gpsuber():
    filt = parse_source_filter("gps")
    assert filt is not None
    tools = [t for t, _ in INTENT_TOOL_MAP["get_upstream_enzymes"] if filt(t)]
    assert tools == ["gps6_kinases"]


def test_clamp_limit():
    assert clamp_limit(200) == 200
    assert clamp_limit(999) == 200
    assert clamp_limit(0) == 1


def test_function_disease_includes_qptm():
    tools = [t for t, _ in INTENT_TOOL_MAP["get_function_disease"]]
    assert "qptm_site_conditions" in tools
    assert "ptm_stability" in tools


def test_function_disease_cancer_skips_stability_and_filters_qptm(monkeypatch):
    captured: list[tuple[str, object]] = []

    def fake_invoke(tool_name, entities):
        captured.append((tool_name, entities.get("contrast_type")))
        return {
            "success": True,
            "summary": tool_name,
            "data": {"rows": [{"x": 1}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    raw = INTENT_HANDLERS["get_function_disease"](
        gene="YAP1",
        uniprot_ac="P46937",
        position=127,
        query="how is YAP1 at Ser127 linked to cancer?",
    )
    payload = json.loads(raw)
    tools = [name for name, _ in captured]
    assert "qptm_site_conditions" in tools
    assert "ptm_stability" not in tools
    assert "ptmd_disease" in tools
    qptm = [ct for name, ct in captured if name == "qptm_site_conditions"]
    assert qptm == ["disease"]
    assert payload["intent"] == "get_function_disease"


def test_function_disease_stability_keeps_ptm_stability(monkeypatch):
    captured: list[str] = []

    def fake_invoke(tool_name, entities):
        captured.append(tool_name)
        return {
            "success": True,
            "summary": tool_name,
            "data": {"rows": [{"x": 1}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    INTENT_HANDLERS["get_function_disease"](
        gene="YAP1",
        uniprot_ac="P46937",
        position=127,
        query="Does YAP1 S127 phosphorylation stabilize the protein?",
    )
    assert "ptm_stability" in captured
    assert "qptm_site_conditions" in captured


def test_intent_passes_limit_and_sources(monkeypatch):
    captured: list[tuple[str, object]] = []

    def fake_invoke(tool_name, entities):
        captured.append((tool_name, entities.get("limit")))
        return {
            "success": True,
            "summary": "Found 2 kinase(s)",
            "data": {"kinases": [{"kinase_gene": "TBK1"}, {"kinase_gene": "ILK"}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    raw = INTENT_HANDLERS["get_upstream_enzymes"](
        gene="AKT1",
        uniprot_ac="P31749",
        position=473,
        limit=200,
        sources="qptm",
    )
    payload = json.loads(raw)
    assert captured == [("qptm_kinases", 200)]
    assert payload["blocks"][0]["shown"] == 2
    assert payload["blocks"][0]["total"] == 2


def test_default_intent_limit_schema_is_50():
    up = next(t for t in intent_tool_definitions() if t["name"] == "get_site_conditions")
    assert up["inputSchema"]["properties"]["limit"]["default"] == 50


def test_site_conditions_wires_condition_sites_and_disease(monkeypatch):
    captured: list[tuple[str, object, object]] = []

    def fake_invoke(tool_name, entities):
        captured.append(
            (tool_name, entities.get("contrast_type"), entities.get("condition_query"))
        )
        return {
            "success": True,
            "summary": tool_name,
            "data": {"rows": [{"x": 1}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    INTENT_HANDLERS["get_site_conditions"](
        query="UCEC phosphorylation largest change",
    )
    names = [n for n, _, _ in captured]
    assert "qptm_condition_sites" in names
    assert any(ct == "disease" for _, ct, _ in captured)

    captured.clear()
    INTENT_HANDLERS["get_site_conditions"](
        gene="HDGF",
        uniprot_ac="P51858",
        position=165,
        query="HDGF 165 BRCA",
    )
    names = [n for n, _, _ in captured]
    assert "qptm_site_conditions" in names
    assert "qptm_condition_sites" not in names
    qptm = [row for row in captured if row[0] == "qptm_site_conditions"]
    assert qptm[0][1] == "disease"


def test_sumo_query_calls_gpssumo2(monkeypatch):
    captured: list[str] = []

    def fake_invoke(tool_name, entities):
        captured.append(tool_name)
        return {
            "success": True,
            "summary": tool_name,
            "data": {"rows": [{"x": 1}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    INTENT_HANDLERS["get_upstream_enzymes"](
        gene="TP53",
        uniprot_ac="P04637",
        query="SUMO sites on TP53",
    )
    assert "gpssumo2_sites" in captured
    assert "activedriver_kinase_network" in captured

    captured.clear()
    INTENT_HANDLERS["get_upstream_enzymes"](
        gene="AKT1",
        uniprot_ac="P31749",
        position=473,
        query="Which kinases phosphorylate AKT1 S473?",
    )
    assert "gpssumo2_sites" not in captured
    assert "activedriver_kinase_network" in captured


def test_localization_includes_signalp(monkeypatch):
    captured: list[str] = []

    def fake_invoke(tool_name, entities):
        captured.append(tool_name)
        return {
            "success": True,
            "summary": tool_name,
            "data": {"rows": [{"x": 1}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    INTENT_HANDLERS["get_localization"](
        gene="EGFR",
        uniprot_ac="P00533",
        query="signal peptide of EGFR",
    )
    assert "signalp_prediction" in captured


def test_orphan_tools_on_existing_intents():
    enzymes = [t for t, _ in INTENT_TOOL_MAP["get_upstream_enzymes"]]
    assert "gpssumo2_sites" in enzymes
    assert "activedriver_kinase_network" in enzymes
    loc = [t for t, _ in INTENT_TOOL_MAP["get_localization"]]
    assert "signalp_prediction" in loc
    cond = [t for t, _ in INTENT_TOOL_MAP["get_site_conditions"]]
    assert "qptm_condition_sites" in cond


def test_semantic_slots_on_intent_schema_and_descriptions():
    defs = {t["name"]: t for t in intent_tool_definitions()}
    props = defs["get_site_conditions"]["inputSchema"]["properties"]
    for key in ("condition_query", "condition_type", "drug", "disease", "cancer"):
        assert key in props
    desc = defs["get_site_conditions"]["description"]
    assert "log2" in desc.lower() or "fold" in desc.lower()
    assert "BRCA" in desc
    assert "condition_query" in desc
    assert "log2" in defs["search_ptm_sites"]["description"].lower() or "fold" in defs[
        "search_ptm_sites"
    ]["description"].lower()
    assert "Gefitinib" in defs["get_drug_ptm"]["description"]
    assert "disease" in defs["get_function_disease"]["description"].lower()
    assert "condition_query" in MCP_SERVER_INSTRUCTIONS
    assert "do not invent mappings" in MCP_SERVER_INSTRUCTIONS.lower()


def test_llm_semantic_slots_passthrough_overrides_regex(monkeypatch):
    captured: list[tuple[str, dict]] = []

    def fake_invoke(tool_name, entities):
        captured.append((tool_name, dict(entities)))
        return {
            "success": True,
            "summary": tool_name,
            "data": {"rows": [{"x": 1}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    INTENT_HANDLERS["get_site_conditions"](
        gene="HDGF",
        uniprot_ac="P51858",
        position=165,
        query="HDGF 165 UCEC in breast cancer",
        condition_query="BRCA",
        contrast_type="pharmacological",
        cancer="BRCA",
    )
    qptm = [ent for name, ent in captured if name == "qptm_site_conditions"]
    assert qptm
    assert qptm[0].get("condition_query") == "BRCA"
    assert qptm[0].get("contrast_type") == "pharmacological"
    assert qptm[0].get("cancer") == "BRCA"

    captured.clear()
    INTENT_HANDLERS["get_drug_ptm"](
        gene="EGFR",
        uniprot_ac="P00533",
        query="EGFR breast cancer PTM changes",
        drug="Gefitinib",
        disease="lung adenocarcinoma",
        cancer="LUAD",
    )
    rows = [ent for _, ent in captured]
    assert rows
    assert all(ent.get("drug") == "Gefitinib" for ent in rows)
    assert all(ent.get("disease") == "lung adenocarcinoma" for ent in rows)
    assert all(ent.get("cancer") == "LUAD" for ent in rows)


def test_breast_cancer_query_without_llm_slot_does_not_invent_brca(monkeypatch):
    captured: list[object] = []

    def fake_invoke(tool_name, entities):
        captured.append(entities.get("condition_query"))
        return {
            "success": True,
            "summary": tool_name,
            "data": {"rows": [{"x": 1}]},
        }

    monkeypatch.setattr("app.mcp.intents._invoke_one", fake_invoke)
    INTENT_HANDLERS["get_site_conditions"](
        gene="HDGF",
        uniprot_ac="P51858",
        position=165,
        query="What is the quantitative log2ratio of HDGF S165 in breast cancer in qPTM",
    )
    assert "BRCA" not in [c for c in captured if c]


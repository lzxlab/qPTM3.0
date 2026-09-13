"""MCP intent tool surface."""

from __future__ import annotations

import json

from app.mcp.intents import INTENT_HANDLERS, MCP_SERVER_INSTRUCTIONS, intent_tool_definitions


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

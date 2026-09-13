"""MCP stdio handshake, tools/list, and tools/call integration."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from app.mcp.protocol import encode_mcp_message, read_message

ROOT = Path(__file__).resolve().parents[1]


def _rpc(proc: subprocess.Popen, msg: dict) -> dict:
    proc.stdin.write(encode_mcp_message(msg))
    proc.stdin.flush()
    out = read_message(proc.stdout)
    assert out is not None
    return out


def test_stdio_initialize_list_and_resolve():
    cmd = [sys.executable, str(ROOT / "mcp_stdio_server.py")]
    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        init = _rpc(
            proc,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest", "version": "1.0"},
                },
            },
        )
        assert init.get("result", {}).get("serverInfo", {}).get("name") == "qptm-mcp"
        instructions = init["result"]["serverInfo"].get("instructions", "")
        assert "get_upstream_enzymes" in instructions

        listed = _rpc(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        tools = listed["result"]["tools"]
        names = {t["name"] for t in tools}
        assert "qptm_invoke" not in names
        assert "resolve_ptm_target" in names

        called = _rpc(
            proc,
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "resolve_ptm_target",
                    "arguments": {"gene": "AKT1", "query": "AKT1"},
                },
            },
        )
        text = called["result"]["content"][0]["text"]
        payload = json.loads(text)
        assert payload["intent"] == "resolve_ptm_target"
        assert payload.get("resolved", {}).get("uniprot_ac")
    finally:
        proc.terminate()
        proc.wait(timeout=10)

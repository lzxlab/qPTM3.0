"""MCP stdio Content-Length framing (and NDJSON fallback)."""

from __future__ import annotations

import io
import json

from app.mcp.protocol import (
    decode_mcp_message,
    encode_mcp_message,
    encode_ndjson_message,
    read_message as _read_message,
)


def test_encode_ndjson_roundtrip():
    msg = {"jsonrpc": "2.0", "id": 0, "method": "initialize"}
    raw = encode_ndjson_message(msg)
    assert raw.endswith(b"\n")
    assert not raw.startswith(b"Content-Length:")
    buf = io.BytesIO(raw)
    parsed = _read_message(buf)
    assert parsed == msg


def test_encode_content_length_roundtrip():
    msg = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    raw = encode_mcp_message(msg)
    assert raw.startswith(b"Content-Length:")
    assert b"\r\n\r\n" in raw
    buf = io.BytesIO(raw)
    parsed = _read_message(buf)
    assert parsed == msg


def test_ndjson_fallback():
    line = json.dumps({"jsonrpc": "2.0", "id": 2, "method": "ping"}) + "\n"
    buf = io.BytesIO(line.encode("utf-8"))
    parsed = _read_message(buf)
    assert parsed["id"] == 2


def test_decode_headers_with_content_type():
    body = json.dumps({"jsonrpc": "2.0", "id": 3, "result": {}})
    payload = body.encode("utf-8")
    raw = (
        f"Content-Length: {len(payload)}\r\n"
        "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n"
        "\r\n"
    ).encode("ascii") + payload
    buf = io.BytesIO(raw)
    first = buf.readline()

    def read_more(n=None):
        if n is None:
            return buf.readline()
        return buf.read(n)

    parsed = decode_mcp_message(first, read_more)
    assert parsed == {"jsonrpc": "2.0", "id": 3, "result": {}}

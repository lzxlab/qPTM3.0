"""MCP stdio JSON-RPC framing (NDJSON wire format; Content-Length read fallback)."""

from __future__ import annotations

import json
import logging
import sys
from typing import Any, BinaryIO, Callable

logger = logging.getLogger(__name__)

PROTO_VERSION = "2024-11-05"


def encode_ndjson_message(msg: dict[str, Any]) -> bytes:
    """Wire format used by @modelcontextprotocol/sdk stdio transport (one JSON line)."""
    return (json.dumps(msg, ensure_ascii=False) + "\n").encode("utf-8")


def encode_mcp_message(msg: dict[str, Any]) -> bytes:
    """Legacy Content-Length framing — kept for tests and manual debugging."""
    raw = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    header = f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii")
    return header + raw


def _read_exact(read_more: Callable[..., bytes], length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining > 0:
        chunk = read_more(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def decode_mcp_message(
    first_line: bytes,
    read_more: Callable[..., bytes],
) -> dict[str, Any] | None:
    if not first_line:
        return None
    stripped = first_line.strip()
    if stripped.lower().startswith(b"content-length:"):
        try:
            length = int(stripped.split(b":", 1)[1].strip())
        except ValueError:
            logger.warning("invalid Content-Length: %s", stripped[:80])
            return None
        while True:
            extra = read_more()
            if extra in (b"", b"\n", b"\r\n", None):
                break
            if extra.lower().startswith(b"content-length:"):
                try:
                    length = int(extra.split(b":", 1)[1].strip())
                except ValueError:
                    pass
        body = _read_exact(read_more, length) if length else b"{}"
        if not body:
            return None
        try:
            data = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            logger.warning("invalid JSON-RPC body: %s", body[:200])
            return None
        return data if isinstance(data, dict) else None

    if not stripped:
        return None
    try:
        data = json.loads(stripped.decode("utf-8"))
    except json.JSONDecodeError:
        logger.warning("invalid JSON-RPC line: %s", stripped[:200])
        return None
    return data if isinstance(data, dict) else None


def send_message(msg: dict[str, Any], out: BinaryIO | None = None) -> None:
    dest = out or sys.stdout.buffer
    dest.write(encode_ndjson_message(msg))
    dest.flush()


def read_message(inp: BinaryIO | None = None) -> dict[str, Any] | None:
    src = inp or sys.stdin.buffer

    def read_more(n: int | None = None) -> bytes:
        if n is None:
            return src.readline()
        return src.read(n)

    first = src.readline()
    if not first:
        return None
    parsed = decode_mcp_message(first, read_more)
    if parsed is None and first.strip() == b"":
        return read_message(src)
    return parsed

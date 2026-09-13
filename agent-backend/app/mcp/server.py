"""MCP stdio server — SDK-style tool registration (Python 3.9 compatible)."""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

from app.mcp.intents import INTENT_HANDLERS, MCP_SERVER_INSTRUCTIONS, intent_tool_definitions
from app.mcp.protocol import PROTO_VERSION, read_message, send_message
from app.sources.catalog import get_catalog
from app.tools.register_all import register_all_tools

logger = logging.getLogger(__name__)


def _handle(msg: dict[str, Any]) -> None:
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}

    if req_id is None and isinstance(method, str) and method.startswith("notifications/"):
        return

    if method == "initialize":
        send_message(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": PROTO_VERSION,
                    "capabilities": {"tools": {}, "resources": {}},
                    "serverInfo": {
                        "name": "qptm-mcp",
                        "version": "2.0.0",
                        "instructions": MCP_SERVER_INSTRUCTIONS,
                    },
                },
            }
        )
        return

    if method == "ping":
        send_message({"jsonrpc": "2.0", "id": req_id, "result": {}})
        return

    if method == "tools/list":
        send_message(
            {"jsonrpc": "2.0", "id": req_id, "result": {"tools": intent_tool_definitions()}}
        )
        return

    if method == "resources/list":
        send_message(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "resources": [
                        {
                            "uri": "qptm://sources",
                            "name": "qPTM source catalog",
                            "mimeType": "text/plain",
                        }
                    ]
                },
            }
        )
        return

    if method == "resources/read":
        uri = params.get("uri")
        text = get_catalog().llm_catalog_text() if uri == "qptm://sources" else ""
        send_message(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"contents": [{"uri": uri, "mimeType": "text/plain", "text": text}]},
            }
        )
        return

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        handler = INTENT_HANDLERS.get(name or "")
        if not handler:
            send_message(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(
                                    {"success": False, "summary": f"Unknown tool {name}"}
                                ),
                            }
                        ],
                        "isError": True,
                    },
                }
            )
            return
        try:
            text = handler(**{k: v for k, v in args.items() if v is not None})
            try:
                payload = json.loads(text)
                is_error = payload.get("success") is False and not payload.get("blocks")
            except json.JSONDecodeError:
                is_error = False
            send_message(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": text}],
                        "isError": bool(is_error),
                    },
                }
            )
        except Exception as exc:
            logger.exception("tools/call failed: %s", name)
            send_message(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(
                                    {
                                        "success": False,
                                        "error_kind": "call_bug",
                                        "summary": str(exc),
                                    }
                                ),
                            }
                        ],
                        "isError": True,
                    },
                }
            )
        return

    if req_id is not None:
        send_message(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown method {method}"},
            }
        )


def run_stdio() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    register_all_tools()
    logger.info("qPTM MCP stdio server ready (intent tools v2)")
    while True:
        msg = read_message()
        if msg is None:
            break
        try:
            _handle(msg)
        except Exception:
            logger.exception("unhandled MCP message: %s", msg.get("method"))


def main() -> None:
    run_stdio()


if __name__ == "__main__":
    main()

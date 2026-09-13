"""qPTM MCP stdio entry — delegates to app.mcp.server (intent tools v2).

Note: Official ``mcp`` PyPI package requires Python >=3.10. This deployment uses
Python 3.9 with an SDK-compatible stdio server in ``app.mcp``.
"""

from app.mcp.server import main, run_stdio

# Re-export protocol helpers for tests that imported the legacy module.
from app.mcp.protocol import decode_mcp_message, encode_mcp_message, read_message

__all__ = ["main", "run_stdio", "decode_mcp_message", "encode_mcp_message", "read_message"]


if __name__ == "__main__":
    main()

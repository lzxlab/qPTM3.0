"""Tool registry — defines JSON schemas for DeepSeek function calling.

Each tool has:
- A JSON schema (sent to DeepSeek as a function definition)
- A Python handler (called when DeepSeek invokes the tool)

The registry maps tool names to their schemas and handlers.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

# Type for tool handler functions
ToolHandler = Callable[..., dict[str, Any]]


class ToolRegistry:
    """Registry of tools available to the LLM agent."""

    def __init__(self) -> None:
        self._schemas: list[dict[str, Any]] = []
        self._handlers: dict[str, ToolHandler] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: ToolHandler,
    ) -> None:
        """Register a tool with its JSON schema and handler."""
        schema = {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            },
        }
        self._schemas.append(schema)
        self._handlers[name] = handler
        logger.debug(f"Registered tool: {name}")

    @property
    def schemas(self) -> list[dict[str, Any]]:
        """JSON schemas to pass to DeepSeek's tools parameter."""
        return self._schemas

    def get_handler(self, name: str) -> ToolHandler | None:
        return self._handlers.get(name)

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool by name with the given arguments."""
        handler = self._handlers.get(name)
        if not handler:
            return {"error": f"Unknown tool: {name}"}
        try:
            from app.tools.identity_guard import check_gene_accession_mismatch

            args = _normalize_tool_arguments(arguments)
            mismatch = check_gene_accession_mismatch(
                args.get("gene"),
                args.get("uniprot_ac"),
                tool_name=name,
            )
            if mismatch:
                return mismatch
            args = _filter_handler_kwargs(handler, args)
            result = handler(**args)
            logger.info(f"Tool {name} executed successfully")
            return result
        except TypeError as e:
            logger.error(f"Tool {name} argument error: {e}", exc_info=True)
            return {"error": f"Tool argument error: {e}"}
        except Exception as e:
            logger.error(f"Tool {name} failed: {e}", exc_info=True)
            return {"error": f"Tool execution failed: {e}"}

    @property
    def tool_names(self) -> list[str]:
        return list(self._handlers.keys())

    def schemas_for_tools(self, tool_names: list[str]) -> list[dict[str, Any]]:
        """Return JSON schemas for a subset of tools (plan-step scoped)."""
        allowed = set(tool_names)
        return [
            schema for schema in self._schemas
            if schema["function"]["name"] in allowed
        ]

    def catalog(self) -> list[dict[str, str]]:
        """Tool catalog for the planning layer (no handlers exposed)."""
        return [
            {
                "tool": schema["function"]["name"],
                "description": schema["function"]["description"],
            }
            for schema in self._schemas
        ]


_ARG_ALIASES = {
    "uniprot": "uniprot_ac",
    "accession": "uniprot_ac",
    "uniprot_id": "uniprot_ac",
    "uniprotid": "uniprot_ac",
    "up": "uniprot_ac",
    "pos": "position",
    "residue": "position",
    "residue_position": "position",
}


def _normalize_tool_arguments(arguments: dict[str, Any] | None) -> dict[str, Any]:
    """Map common alias keys onto canonical tool parameter names."""
    out: dict[str, Any] = dict(arguments or {})
    for alias, canon in _ARG_ALIASES.items():
        if alias not in out:
            continue
        val = out.pop(alias)
        empty = val in (None, "", 0, "0")
        if empty:
            continue
        current = out.get(canon)
        if current in (None, "", 0, "0"):
            out[canon] = val
    return out


def _filter_handler_kwargs(handler: ToolHandler, arguments: dict[str, Any]) -> dict[str, Any]:
    """Drop extra keys so handlers do not raise ``unexpected keyword argument``."""
    try:
        sig = inspect.signature(handler)
    except (TypeError, ValueError):
        return arguments
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return arguments
    allowed = {
        name
        for name, p in sig.parameters.items()
        if p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }
    return {k: v for k, v in arguments.items() if k in allowed}


# Global registry
registry = ToolRegistry()

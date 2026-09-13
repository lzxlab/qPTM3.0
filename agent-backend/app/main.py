"""FastAPI application for qPTM collection pipeline and tool registry.

Chat, classify, and conversations are served by agent-runtime (TypeScript) on port 8101.
This service (port 8100) handles /collection, /health, /tools, and /export.
"""

import logging
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.collection.routes import router as collection_router
from app.export.routes import router as export_router
from app.tools.registry import registry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="qPTM Agent API",
    description="Collection pipeline and tool registry for qPTM Agent",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(collection_router)
app.include_router(export_router)


@app.on_event("startup")
def _startup() -> None:
    from app.tools.register_all import register_all_tools

    register_all_tools()
    logger.info("Registered %d tools: %s", len(registry.tool_names), registry.tool_names)

    try:
        from app.sources.catalog import get_catalog

        n = len(get_catalog().all())
        logger.info("Preloaded %d source manifests", n)
    except Exception:
        logger.exception("source catalog preload failed")

    try:
        from app.collection.runner import mark_interrupted_jobs

        mark_interrupted_jobs()
    except Exception:
        logger.exception("mark_interrupted_jobs failed")


@app.get("/health")
async def health() -> dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "ok",
        "tools_registered": len(registry.tool_names),
        "tool_names": registry.tool_names,
    }


@app.get("/tools")
async def list_tools() -> dict[str, Any]:
    """List all registered tools and their schemas."""
    return {
        "tools": [
            {
                "name": s["function"]["name"],
                "description": s["function"]["description"],
                "parameters": s["function"]["parameters"],
            }
            for s in registry.schemas
        ]
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )

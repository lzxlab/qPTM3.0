"""HTTP export endpoints (answer PDF)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/export", tags=["export"])


class AnswerPdfRequest(BaseModel):
    markdown: str = Field(default="")
    content: str = Field(default="")


@router.post("/answer-pdf")
def export_answer_pdf(body: AnswerPdfRequest) -> Response:
    text = (body.markdown or body.content or "").strip()
    if not text:
        raise HTTPException(400, "markdown or content is required")
    from app.export.pdf import build_answer_pdf

    try:
        pdf = build_answer_pdf(text)
    except Exception as exc:
        raise HTTPException(500, f"PDF export failed: {exc}") from exc
    return Response(content=pdf, media_type="application/pdf")

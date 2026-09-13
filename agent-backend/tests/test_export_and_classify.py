"""HTTP routes that stay on FastAPI after chat moved to agent-runtime."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_classify_not_on_fastapi():
    res = client.post("/classify", json={"message": "Collect from PMID 39732660"})
    assert res.status_code == 404


def test_export_answer_pdf_requires_body():
    res = client.post("/export/answer-pdf", json={})
    assert res.status_code == 400


def test_export_answer_pdf_returns_pdf():
    res = client.post("/export/answer-pdf", json={"markdown": "# TP53\nShort answer."})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/pdf")
    assert res.content[:4] == b"%PDF"

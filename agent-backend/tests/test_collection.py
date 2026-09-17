"""Tests for Collection Agent job API."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.collection.store import extract_pmid, extract_pmid_from_filename, job_dir, resolve_pmid
from app.main import app

client = TestClient(app)


def test_extract_pmid():
    assert extract_pmid("请处理 PMID 38101750") == "38101750"
    assert extract_pmid("38101750") == "38101750"
    assert extract_pmid("no id here") is None


def test_extract_accessions_and_resolve_urls_intent():
    from app.collection.store import extract_accessions, looks_like_resolve_urls_request

    assert extract_accessions("请获取 PXD037009 的下载链接") == ["PXD037009"]
    # CJK immediately before accession (no space) must still match.
    assert extract_accessions("帮我获取 PRIDE 中PXD005871 的质谱下载链接") == ["PXD005871"]
    assert extract_accessions("PXD1; IPX0004109000, JPST000123") == [
        "PXD1",
        "IPX0004109000",
        "JPST000123",
    ]
    assert looks_like_resolve_urls_request("获取 PRIDE 中 PXD037009 的质谱下载链接")
    assert looks_like_resolve_urls_request("帮我获取 PRIDE 中PXD005871 的质谱下载链接")
    assert looks_like_resolve_urls_request("PXD037009")
    assert not looks_like_resolve_urls_request("Collect from PMID 38101750")
    assert extract_accessions("fooPXD005871") == []


def test_extract_pmid_from_filename():
    assert extract_pmid_from_filename("39732660.pdf") == "39732660"
    assert extract_pmid_from_filename("pmid_39732660_fulltext.pdf") == "39732660"
    assert extract_pmid_from_filename("table.xlsx") is None


def test_resolve_pmid_from_upload_only():
    assert resolve_pmid(filenames=["39732660.pdf"]) == "39732660"
    assert resolve_pmid(message="", filenames=["39732660.pdf"]) == "39732660"


def test_collection_jobs_need_pmid():
    res = client.post("/collection/jobs", data={"message": "hello"})
    assert res.status_code == 200
    body = res.json()
    assert body["needs_pmid"] is True


def test_extract_pmid_from_xml_content():
    from app.collection.pmid_from_files import extract_pmid_from_xml

    xml = (
        '<?xml version="1.0"?><article>'
        '<front><article-meta>'
        '<article-id pub-id-type="pmid">38101750</article-id>'
        "</article-meta></front></article>"
    )
    assert extract_pmid_from_xml(xml.encode()) == "38101750"


def test_extract_pmid_from_csv_content():
    from app.collection.pmid_from_files import extract_pmid_from_tabular

    csv_text = "PMID,Gene,Ratio\n38101750,TP53,1.2\n"
    assert extract_pmid_from_tabular(csv_text.encode()) == "38101750"


def test_create_job_from_csv_content():
    csv_body = "PMID,UniProtID,Position\n39732660,P04637,15\n"
    res = client.post(
        "/collection/jobs",
        files={"supplementary": ("table.csv", csv_body.encode(), "text/csv")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("needs_pmid") is not True
    assert body["pmid"] == "39732660"


def test_create_job_from_pdf_bytes():
    pdf_body = b"%PDF-1.4\n(PMID: 38101750) published in Nature\n"
    res = client.post(
        "/collection/jobs",
        files={"fulltext": ("article.pdf", pdf_body, "application/pdf")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("needs_pmid") is not True
    assert body["pmid"] == "38101750"


def test_ingest_fulltext_cli(tmp_path: Path):
    """Smoke test manual fulltext ingest via collection-agent CLI."""
    import asyncio
    import subprocess

    from app.config import settings

    pdf = tmp_path / "mini.pdf"
    pdf.write_bytes(b"%PDF-1.4 minimal test\n")
    out_dir = tmp_path / "job"
    out_dir.mkdir()
    cmd = [
        str(Path(settings.collection_node_bin).parent / "npx"),
        "tsx",
        str(Path(settings.collection_agent_dir) / "src" / "index.ts"),
        "ingest-fulltext",
        "--pmid",
        "12345678",
        "--file",
        str(pdf),
        "--out-dir",
        str(out_dir),
    ]
    env = {"PATH": f"{Path(settings.collection_node_bin).parent}:" + __import__("os").environ.get("PATH", "")}
    proc = subprocess.run(cmd, cwd=settings.collection_agent_dir, env=env, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr or proc.stdout
    meta = out_dir / "stage2" / "fulltext" / "12345678" / "meta.json"
    assert meta.is_file()
    data = json.loads(meta.read_text())
    assert data["hasPdf"] is True
    assert data["status"] in ("ok", "partial")


def test_get_url_scripts_exist():
    from app.config import settings

    scripts_dir = Path(settings.qptm3_get_url_dir)
    for name in (
        "1_html_pride_extract.py",
        "2_xml_iprox_extract.py",
        "3_html_jpost_extract.py",
    ):
        assert (scripts_dir / name).is_file(), f"missing {name}"


def test_ingest_supp_cli(tmp_path: Path):
    import subprocess
    from app.config import settings

    csv_file = tmp_path / "table.csv"
    csv_file.write_text("UniProtID,Position,Log2Ratio\nP04637,15,1.2\n", encoding="utf-8")
    out_dir = tmp_path / "job2"
    out_dir.mkdir()
    cmd = [
        str(Path(settings.collection_node_bin).parent / "npx"),
        "tsx",
        str(Path(settings.collection_agent_dir) / "src" / "index.ts"),
        "ingest-supp",
        "--pmid",
        "12345678",
        "--file",
        str(csv_file),
        "--out-dir",
        str(out_dir),
    ]
    env = {"PATH": f"{Path(settings.collection_node_bin).parent}:" + __import__("os").environ.get("PATH", "")}
    proc = subprocess.run(cmd, cwd=settings.collection_agent_dir, env=env, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr or proc.stdout
    zip_path = out_dir / "stage4" / "supp" / "12345678" / "supplementary.zip"
    assert zip_path.is_file()
    jobs_path = out_dir / "stage4" / "supp_jobs.jsonl"
    assert jobs_path.is_file()
    assert "12345678" in jobs_path.read_text()
    assert "likely_qptm_table" in jobs_path.read_text()


def test_stage5_qratio_download(tmp_path: Path, monkeypatch):
    from app.collection import store as store_mod

    job_id = "test-job-qratio-dl"
    root = tmp_path / "jobs" / job_id
    (root / "stage5").mkdir(parents=True)
    (root / "stage5" / "qratio.csv").write_text(
        "PMID,Sample\n39732660,tissue\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(store_mod.settings, "collection_jobs_dir", str(tmp_path / "jobs"))
    resolved = store_mod.stage5_artifact(job_id, "qratio.csv")
    assert resolved is not None
    assert "39732660" in resolved.read_text(encoding="utf-8")


def test_classify_upload_filename():
    from app.collection.uploads import classify_upload_filename

    assert classify_upload_filename("data.xlsx") == "supplementary"
    assert classify_upload_filename("full.pdf") == "fulltext"
    assert classify_upload_filename("notes.txt") == "unknown"

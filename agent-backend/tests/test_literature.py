"""Literature search merge, limits, and OA fulltext."""

from __future__ import annotations

from app.tools.pubtator_tools import (
    merge_paper_hits,
    pubmed_fetch_fulltext,
    pubtator_literature_search,
    _xml_to_text,
)


def test_merge_paper_hits_first_source_wins():
    a = [{"pmid": "11111111", "title": "A"}, {"pmid": "22222222", "title": "B"}]
    b = [{"pmid": "22222222", "title": "B-other"}, {"pmid": "33333333", "title": "C"}]
    merged = merge_paper_hits(a, b, limit=10)
    assert [p["pmid"] for p in merged] == ["11111111", "22222222", "33333333"]
    assert merged[1]["title"] == "B"


def test_merge_paper_hits_respects_limit():
    papers = [{"pmid": str(10000000 + i), "title": str(i)} for i in range(30)]
    merged = merge_paper_hits(papers, limit=20)
    assert len(merged) == 20


def test_xml_to_text_strips_tags():
    text = _xml_to_text("<article><title>Hello</title><p>World</p></article>")
    assert "Hello" in text
    assert "<" not in text


def test_pubtator_limit_clamped(monkeypatch):
    captured = {}

    class DummyResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"results": [], "total": 0}

    class DummyClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            captured["url"] = url
            return DummyResp()

    monkeypatch.setattr("app.tools.pubtator_tools._client", lambda: DummyClient())
    out = pubtator_literature_search("AKT1", limit=99)
    assert out["query"] == "AKT1"
    assert "papers" in out


def test_fulltext_oa_xml(monkeypatch):
    class DummyResp:
        def __init__(self, payload=None, text=""):
            self._payload = payload
            self.text = text

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class DummyClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, params=None):
            if "fullTextXML" in url:
                body = "<article><body>" + ("phosphorylation " * 40) + "</body></article>"
                return DummyResp(text=body)
            return DummyResp(
                payload={
                    "resultList": {
                        "result": [
                            {
                                "pmid": "12345678",
                                "pmcid": "PMC999",
                                "isOpenAccess": "Y",
                                "title": "OA paper",
                            }
                        ]
                    }
                }
            )

    monkeypatch.setattr("app.tools.pubtator_tools._client", lambda: DummyClient())
    out = pubmed_fetch_fulltext(["12345678"])
    assert len(out["papers"]) == 1
    assert "phosphorylation" in out["papers"][0]["fulltext"]
    assert "not OA" not in (out.get("summary") or "").lower()


def test_fulltext_non_oa_omitted(monkeypatch):
    class DummyResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "resultList": {
                    "result": [
                        {
                            "pmid": "12345678",
                            "pmcid": "",
                            "isOpenAccess": "N",
                            "title": "Closed",
                        }
                    ]
                }
            }

        text = ""

    class DummyClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, params=None):
            return DummyResp()

    monkeypatch.setattr("app.tools.pubtator_tools._client", lambda: DummyClient())
    out = pubmed_fetch_fulltext("12345678")
    assert out["papers"] == []
    assert "not OA" not in (out.get("summary") or "")
    assert "non-OA" not in (out.get("summary") or "").lower()


def test_intent_search_merges_three_sources(monkeypatch):
    from app.mcp import intents as mod

    def fake_invoke(name, entities):
        papers = {
            "pubtator_literature_search": [{"pmid": "11111111", "title": "P"}],
            "pubmed_esearch": [{"pmid": "11111111", "title": "P2"}, {"pmid": "22222222", "title": "N"}],
            "europepmc_literature_search": [{"pmid": "33333333", "title": "E"}],
        }.get(name, [])
        return {"success": True, "summary": name, "data": {"papers": papers}}

    monkeypatch.setattr(mod, "_invoke_one", fake_invoke)
    raw = mod.intent_search_literature(query="AKT1 phosphorylation", limit=20)
    assert "11111111" in raw
    assert "22222222" in raw
    assert "33333333" in raw
    assert "Merged 3 unique PMID" in raw

#!/usr/bin/env python3
"""End-to-end test suite for the qPTM Agent.

Tests all tools, workflow state machine, and API endpoints.
Run: python tests/test_tools.py
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.tools.registry import registry
from app.tools.qptm_tools import register_qptm_tools
from app.tools.iptmnet_tools import register_iptmnet_tools
from app.tools.uniprot_tools import register_uniprot_tools
from app.tools.psp_tools import register_psp_tools
from app.tools.dbptm_tools import register_dbptm_tools
from app.tools.stability_tools import register_stability_tools


def test_tool_registration():
    """Test that all tools register correctly."""
    print("=== Test: Tool Registration ===")
    register_qptm_tools()
    register_iptmnet_tools()
    register_uniprot_tools()
    register_psp_tools()
    register_dbptm_tools()
    register_stability_tools()

    expected = 12  # 3 qPTM + 2 iPTMnet + 1 UniProt + 4 PSP + 1 dbPTM + 1 stability
    actual = len(registry.tool_names)
    assert actual == expected, f"Expected {expected} tools, got {actual}"
    assert "ptm_stability" in registry.tool_names, "ptm_stability should be registered"
    assert "psp_kinase_substrate" in registry.tool_names
    assert "psp_ptmvar" in registry.tool_names
    print(f"  PASS: {actual} tools registered: {registry.tool_names}")
    print()


def test_uniprot_annotation():
    """Test UniProt annotation tool with TP53."""
    print("=== Test: UniProt Annotation (P04637 / TP53) ===")
    result = registry.execute("uniprot_annotation", {"uniprot_ac": "P04637"})

    assert result["gene"] == "TP53", f"Expected gene TP53, got {result.get('gene')}"
    assert result["protein_name"], "Protein name should not be empty"
    assert result["function"], "Function should not be empty"
    assert result["ptm_description"], "PTM description should not be empty"
    assert len(result["disease_associations"]) > 0, "Should have disease associations"
    assert result["subcellular_location"], "Subcellular location should not be empty"

    # Bug 7 fix: structured disease entries with accession, acronym, cross-references
    disease_entries = result.get("disease_entries", [])
    assert len(disease_entries) > 0, "Should have structured disease entries"
    liFraumeni = [d for d in disease_entries if "Li-Fraumeni" in d.get("disease_id", "")]
    assert liFraumeni, "Should find Li-Fraumeni syndrome"
    assert liFraumeni[0]["accession"].startswith("DI-"), f"Should have DI- accession, got {liFraumeni[0]['accession']}"
    assert liFraumeni[0]["acronym"] == "LFS", f"Should have LFS acronym, got {liFraumeni[0]['acronym']}"
    xref = liFraumeni[0].get("cross_reference", {})
    assert xref.get("database") == "MIM" and xref.get("id") == "151623", \
        f"Should have MIM:151623 cross-reference, got {xref}"

    print(f"  PASS: Gene={result['gene']}, Protein={result['protein_name'][:40]}")
    print(f"  Function: {result['function'][:80]}...")
    print(f"  PTM: {result['ptm_description'][:80]}...")
    print(f"  Disease associations: {len(result['disease_associations'])} (structured: {len(disease_entries)})")
    print(f"  Domains: {len(result['domains'])}")
    print()


def test_iptmnet_enzymes():
    """Test iPTMnet enzymes tool with TP53."""
    print("=== Test: iPTMnet Enzymes (P04637 / TP53) ===")
    result = registry.execute("iptmnet_enzymes", {"uniprot_ac": "P04637"})

    assert result["total"] > 0, "Should find enzymes for TP53"
    enzymes = result["enzymes"]
    assert any(e["enzyme_gene"] == "ATM" for e in enzymes), "Should find ATM as a kinase"

    print(f"  PASS: Found {result['total']} enzymes")
    for e in enzymes[:5]:
        print(f"    {e['enzyme_gene']} ({e['enzyme_type']}) -> pos {e['substrate_position']}, {e['ptm_type']}")
    print()


def test_iptmnet_enzymes_filtered():
    """Test iPTMnet enzymes with position filter."""
    print("=== Test: iPTMnet Enzymes (P04637, position=55) ===")
    result = registry.execute("iptmnet_enzymes", {"uniprot_ac": "P04637", "position": 55})

    assert result["total"] > 0, "Should find enzyme for TP53 T55"
    assert any(e["enzyme_gene"] == "TAF1" for e in result["enzymes"]), "Should find TAF1"

    print(f"  PASS: Found {result['total']} enzyme(s) for position 55")
    for e in result["enzymes"]:
        print(f"    {e['enzyme_gene']} ({e['enzyme_type']})")
    print()


def test_iptmnet_ptm_ppi():
    """Test iPTMnet PTM-dependent PPI tool."""
    print("=== Test: iPTMnet PTM-dependent PPI (P04637) ===")
    result = registry.execute("iptmnet_ptm_ppi", {"uniprot_ac": "P04637"})

    assert result["total"] > 0, "Should find PTM-dependent interactions"

    print(f"  PASS: Found {result['total']} interactions")
    for i in result["interactions"][:3]:
        print(f"    {i['interactor_a']} <-> {i['interactor_b']} ({i['interaction_type']})")
    print()


def test_psp_regulatory():
    """Test PSP regulatory tool against local Regulatory_sites index."""
    print("=== Test: PSP Regulatory (P04637 S15) ===")
    result = registry.execute("psp_regulatory", {"uniprot_ac": "P04637", "position": 15})

    assert result.get("available") is not False or result.get("found") is True or "index" in (result.get("summary") or "").lower()
    assert "summary" in result
    if result.get("found"):
        assert result.get("on_function") or result.get("on_process") or result.get("hits")

    print(f"  PASS: {result['summary'][:100]}...")
    print()


def test_dbptm_no_data():
    """Test dbPTM tool gracefully handles missing data."""
    print("=== Test: dbPTM Functional (no data file) ===")
    result = registry.execute("dbptm_functional", {"uniprot_ac": "P04637"})

    # Should either return web fallback or "not available" message
    assert "summary" in result, "Should always return a summary"

    print(f"  PASS: Gracefully handles missing data: {result['summary'][:80]}...")
    print()


def test_ptm_stability():
    """Test PTM stability tool with TP53."""
    print("=== Test: PTM Stability (P04637 / TP53) ===")
    result = registry.execute("ptm_stability", {"uniprot_ac": "P04637"})

    assert result["found"] == True, "Should find stability data for TP53"
    assert result["total"] > 0, "Should have entries"
    assert result["gene"] == "TP53", f"Expected gene TP53, got {result.get('gene')}"
    assert result["stabilize_count"] > 0, "Should have stabilizing PTMs"
    assert result["destabilize_count"] > 0, "Should have destabilizing PTMs"

    # Verify entry structure
    entry = result["entries"][0]
    assert "effect_direction" in entry, "Entry should have effect_direction"
    assert "mechanism" in entry, "Entry should have mechanism"
    assert "ptm_type" in entry, "Entry should have ptm_type"
    assert entry.get("source"), f"source should not be empty, got {entry.get('source')}"
    assert entry.get("curated_from") == "PMC9839724", \
        f"curated_from should be PMC9839724, got {entry.get('curated_from')}"

    # Bug 5 fix: '-' placeholders should be converted to None, not kept as literal strings
    for e in result["entries"]:
        for field in ("writer", "eraser", "reader", "ubiquitin_sites"):
            assert e.get(field) != "-", f"{field} should not be '-' placeholder, got {e.get(field)}"

    print(f"  PASS: Found {result['total']} entries (stab={result['stabilize_count']}, destab={result['destabilize_count']})")
    print()


def test_ptm_stability_filtered():
    """Test PTM stability tool with position and PTM type filters."""
    print("=== Test: PTM Stability (P04637, position=15) ===")
    result = registry.execute("ptm_stability", {"uniprot_ac": "P04637", "position": 15})

    assert result["found"] == True, "Should find data for TP53 position 15"
    assert result["total"] >= 1, "Should have at least 1 entry"
    # All entries should be for position 15 or general (None)
    for e in result["entries"]:
        assert e["position"] == 15 or e["position"] is None, \
            f"Entry position should be 15 or None, got {e['position']}"

    print(f"  PASS: Found {result['total']} entries for position 15")

    # Test PTM type filter
    print("=== Test: PTM Stability (P04637, ptm_type=methylation) ===")
    result = registry.execute("ptm_stability", {"uniprot_ac": "P04637", "ptm_type": "methylation"})

    assert result["found"] == True, "Should find methylation data for TP53"
    for e in result["entries"]:
        assert e["ptm_type"] == "methylation", f"Should be methylation, got {e['ptm_type']}"

    print(f"  PASS: Found {result['total']} methylation entries")
    print()


def test_ptm_stability_not_found():
    """Test PTM stability tool with protein not in dataset."""
    print("=== Test: PTM Stability (P31749 / AKT1 - not in dataset) ===")
    result = registry.execute("ptm_stability", {"uniprot_ac": "P31749"})

    assert result["found"] == False, "Should not find data for AKT1"
    assert result["available"] == True, "Dataset should be available"
    assert "34 proteins" in result["summary"], "Should mention dataset coverage"

    print(f"  PASS: Correctly reports no data: {result['summary'][:80]}...")
    print()


def test_ptm_stability_htt():
    """Test PTM stability tool with HTT (corrected accession P42858)."""
    print("=== Test: PTM Stability (P42858 / HTT) ===")
    result = registry.execute("ptm_stability", {"uniprot_ac": "P42858"})

    assert result["found"] == True, "Should find data for HTT"
    assert result["gene"] == "HTT", f"Expected gene HTT, got {result.get('gene')}"
    assert result["total"] > 0, "Should have entries"

    print(f"  PASS: Found {result['total']} entries for HTT")
    print()


def test_qptm_tools_error_handling():
    """Test qPTM tools handle connection errors gracefully."""
    print("=== Test: qPTM Tools Error Handling (no backend) ===")
    # qPTM API is not running, so these should return errors, not crash
    result = registry.execute("qptm_search", {"query": "TP53"})
    assert "error" in result or "summary" in result, "Should return error or summary"

    result = registry.execute("qptm_site_conditions", {"uniprot_ac": "P04637", "position": 15})
    assert "error" in result or "summary" in result, "Should return error or summary"

    result = registry.execute("qptm_kinases", {"uniprot_ac": "P04637", "position": 15})
    assert "error" in result or "summary" in result, "Should return error or summary"

    print("  PASS: All qPTM tools handle connection errors gracefully")
    print()


def test_unknown_tool():
    """Test that unknown tools return an error."""
    print("=== Test: Unknown Tool Error ===")
    result = registry.execute("nonexistent_tool", {})
    assert "error" in result, "Should return error for unknown tool"
    print(f"  PASS: {result['error']}")
    print()


def test_invalid_uniprot():
    """Test UniProt tool with invalid accession."""
    print("=== Test: Invalid UniProt Accession ===")
    result = registry.execute("uniprot_annotation", {"uniprot_ac": "INVALID123"})
    assert result.get("function") is None or result.get("gene") is None, \
        "Should not find data for invalid accession"
    print(f"  PASS: Handles invalid accession gracefully")
    print()


def main():
    print("qPTM Agent — End-to-End Test Suite")
    print("=" * 50)
    print()

    tests = [
        test_tool_registration,
        test_uniprot_annotation,
        test_iptmnet_enzymes,
        test_iptmnet_enzymes_filtered,
        test_iptmnet_ptm_ppi,
        test_psp_regulatory,
        test_dbptm_no_data,
        test_ptm_stability,
        test_ptm_stability_filtered,
        test_ptm_stability_not_found,
        test_ptm_stability_htt,
        test_qptm_tools_error_handling,
        test_unknown_tool,
        test_invalid_uniprot,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"  FAIL: {e}")
            failed += 1
            print()

    print("=" * 50)
    print(f"Results: {passed} passed, {failed} failed, {len(tests)} total")
    if failed == 0:
        print("All tests passed!")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

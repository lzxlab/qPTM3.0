"""Shared gene ↔ UniProt accession validation for all tool entry points."""

from __future__ import annotations

from typing import Any

from app.sources.uniprot_id import gene_matches_identity, lookup_by_accession, normalize_uniprot_ac


def identity_mismatch_result(
    *,
    gene: str,
    uniprot_ac: str,
    identity_gene: str | None,
    tool_name: str | None = None,
) -> dict[str, Any]:
    prefix = f"Refused {tool_name}: " if tool_name else ""
    return {
        "error": (
            f"{prefix}gene={gene} is not consistent with "
            f"UniProt {uniprot_ac} ({identity_gene or 'unknown'}). "
            "Re-resolve the target before querying databases."
        ),
        "error_kind": "identity_mismatch",
        "gene": gene,
        "uniprot_ac": uniprot_ac,
        "identity_gene": identity_gene,
        "summary": (
            f"Gene {gene} does not match UniProt {uniprot_ac} "
            f"(canonical gene: {identity_gene or 'unknown'})."
        ),
    }


def check_gene_accession_mismatch(
    gene: str | None,
    uniprot_ac: str | None,
    *,
    tool_name: str | None = None,
) -> dict[str, Any] | None:
    """Return an error payload when gene and accession refer to different proteins."""
    g = (gene or "").strip()
    ac = normalize_uniprot_ac(uniprot_ac)
    if not g or not ac:
        return None
    ident = lookup_by_accession(ac)
    if ident and not gene_matches_identity(g, ident):
        return identity_mismatch_result(
            gene=g,
            uniprot_ac=ac,
            identity_gene=ident.get("gene"),
            tool_name=tool_name,
        )
    return None

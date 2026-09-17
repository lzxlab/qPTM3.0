# qPTM research dimensions → MCP intent tools

Use this map to **choose databases** and **judge evidence gaps for the next tool call**. It is NOT an answer outline and must not be copied into the user-visible reply.

## Dimension map

| Research question | User may ask | MCP intent | How to read results |
|-------------------|--------------|------------|---------------------|
| Who regulates the modification | kinases, E3, writers/erasers, drug-induced PTM | `get_upstream_enzymes`; PMADS upstream via `get_drug_ptm` | PSP in vivo before in vitro; qPTM/eKPI quantitative; GPS is **predicted** only |
| Under what conditions | treatment, fold-change, tumor vs normal | `get_site_conditions`, `search_ptm_sites` | qPTM log2fc/qratio; CancerProteome `pmid` column is PDC id not PubMed |
| Downstream: PPI / pathways | binding partners, pathways | `get_ppi_pathways` | PTMint Enhance/Inhibit; STRING channel scores |
| Downstream: disease / mutation | cancer, ClinVar | `get_function_disease` | PTMD U/D/A/P/C/N codes; PSP disease/PTMVar separate blocks |
| Downstream: drug sensitivity | inhibitors, therapy | `get_drug_ptm` | PMADS Curated vs Inferred; DrugBank is protein-level not site PTM |
| Downstream: stability | stabilize/destabilize | `get_function_disease` (`ptm_stability` block) | experimental; Funcscore ≠ proven mechanism |
| Downstream: localization / LLPS | compartment, phase separation | `get_localization`, `get_llps` | PTMPhaSe experimental vs PhosLLPS/dSCOPE predicted |
| Where modification occurs | compartment, domain | `get_localization` | InterPro/Pfam = domain context not subcellular location |

## When is a dimension satisfied?

- **Regulation**: at least one experimental or curated kinase/enzyme row (not GPS-only).
- **Conditions**: quantitative fold-change or clear condition labels from qPTM/eKPI.
- **Downstream**: non-empty blocks for the aspect the user asked (disease vs PPI vs drug).
- **Localization**: compartment or domain evidence relevant to the question.
- `empty_result` = no records in that database (not missing UniProt).
- `call_bug` = call failed (retry once internally; then try literature or another intent).
- Do **not** re-call an intent that returned `empty_result`.
- Do **not** re-call an intent that already succeeded with non-predicted rows — unless expanding truncated hits with a higher `limit` or a `sources` filter (e.g. `qptm`).

## Literature

If the user asked for mechanism or papers and databases did not cover it, call `search_literature` with gene + site + a specific query. Never generic `GENE phosphorylation review` unless the user asked for a review.

## Rules

- Prefer qPTM for quantitative human PTM.
- Label GPS / PhosLLPS / dSCOPE predictions as predicted when using those rows to answer.
- Empty DB → try another intent or literature internally; do not turn empty lookups into a user-facing gap catalog.

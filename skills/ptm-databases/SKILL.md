# qPTM research dimensions → MCP intent tools

Use this map to **choose databases** and **judge evidence gaps**. It is NOT a fixed report outline — only include dimensions the user asked about in the final answer.

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
- Do **not** re-call an intent that already succeeded with non-predicted rows.

## Depth search (literature)

- `focus` must match a gap dimension: kinase, condition, function, disease, drug, localization, llps.
- Query examples: `{GENE} S{pos} MTOR kinase phosphorylation` (regulation); `{GENE} S{pos} DNA damage treatment` (conditions).
- Never use vague `GENE phosphorylation review` unless the user asked for a review.
- Follow kinase names from database blocks when digging deeper.

## Rules

- Prefer qPTM for quantitative human PTM.
- Label GPS / PhosLLPS / dSCOPE predictions as predicted in synthesis.
- Empty DB → state limitation; do not fabricate.

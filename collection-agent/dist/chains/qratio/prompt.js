/**
 * Stage 5 — LLM column mapping prompt.
 */
export const QRATIO_MAP_SYSTEM = `You are a qPTM Stage-5 curator.
Map spreadsheet columns to quantitative PTM site-ratio fields.
Return ONLY a single JSON object (no markdown fences, no commentary).`;
export const QRATIO_MAP_RULES = `Target qratio fields:
- UniProt ID
- Position (residue number)
- Amino acid (S/T/Y/K/… single letter when possible)
- Log2Ratio (site) — site-level log2 fold-change (NOT raw intensity)
- P value (site)
- Log2Ratio (protein) / P value (protein) — optional

Hard rules (from QC):
1) Prefer site-level ratio columns over protein-level when both exist.
2) If multiple condition ratios exist, list EACH as a separate ratioColumns entry — but ONLY when they are genuinely different contrasts. Redundant variants of the SAME biological comparison (e.g. "diGly Log(ASB2/MCS)" vs "diGly Normalized to Total Log(ASB2/MCS)") must NOT both become ratioColumns: keep ONLY ONE (prefer the primary / non-normalized one; use the "Normalized to Total" column only when it is the only option). Giving the duplicate a "… (normalized)" condition label still creates two rows for the same site — users reject that. Different sub-experiments on one sheet (e.g. "C2C12 IP Log(ASB2/MCS)" beside the main "diGly Log(ASB2/MCS)") ARE distinct contrasts and may each be listed with a distinct condition.
3) valueType must be one of: "log2_ratio" | "fold_change" | "intensity" | "other".
   - intensity / abundance / peak area / bare timepoint channels (e.g. "0/5","5/5") → valueType="intensity" and do NOT put them in ratioColumns.
   - Bare sample / developmental-day labels with NO ratio/FC/log2 wording are intensities, NOT ratios — e.g. "P1","P5","P7","D1","Day7","Sample1", or "Lactylation sites quantitation P1". Values near 1.0 do NOT make them fold-changes.
   - Only columns that express a contrast (A/B, treatment/control, H/L, log2FC, fold-change) belong in ratioColumns.
   - PTM shorthand with parenthesized contrasts count as ratios — e.g. "log2 Kac(ATN/Ctrl)", "Kac(ATN/Ctrl)" (log2 fold-change; condition ATN/Ctrl).
4) If the sheet ONLY has intensities (no ratio/log2FC/fold-change), set skip=true, intensityOnly=true, and list intensityColumns.
5) If there is NO site-level Position/siteCombined column AND no mod-sequence/probability column from which AA can be inferred (e.g. "Lactylation Probabilities", "Modified sequence"), set skip=true (reason: no_site_level). Amino acid column is optional — Position alone is enough; AA may be filled from sequence later. When AA is only in a probability column, set modSeqCol and leave aminoAcidCol null.
6) If site is encoded as S123 / T45 / K31 in one column, set siteCombinedCol.
   - Prefer columns like "Modified lysine", "Modification position", "Site position" for Position.
   - NEVER use UniProt/Accession as Position.
   - NEVER use "Positions in Master Proteins" / peptide span columns (values like "P32783 [357-382]") as Position or siteCombinedCol — those are peptide ranges, not modification sites.
   - COMBINED ACC_AA### columns bundle the UniProt accession, amino acid and position in ONE cell — e.g. a column named "Uniprot_diGly position" / "mod_sites" (or similar) with values like "E9Q1G8_K235", "Q80UG5_K488". Map such a column as siteCombinedCol, NOT positionCol, so the accession+residue parse as one unit. When one exists, do NOT use the Gene name column as the protein ID.
   - When USER CURATION FEEDBACK says to SPLIT a column (e.g. "mod_sites column is UniProt_Amino acid Position, should split this column"), you MUST set siteCombinedCol to that named column and leave positionCol/aminoAcidCol null for that sheet.
7) If UniProt/accession is missing but Gene name/symbol exists with site+ratio, set geneCol (Stage5 will map gene→UniProt). Prefer uniprotCol when both exist. MaxQuant "Proteins" holding accessions → uniprotCol.
   - Columns that list residue-level proteins — "Protein Accessions", "Accession", "UniProtKB", "Proteins" — are the best uniprotCol; prefer them over Gene name so each site row keeps its exact protein (e.g. "E9Q1G8") instead of a gene-level mapping.
   - User curation feedback may NAME the protein-level columns explicitly (e.g. "proteome data should be collected from total proteome Log(ASB2/MCS) | total proteome p-value"). When it does, you MUST map the named ratio column as a protein-level ratioColumns entry and the named p-value column as a protein-level pValueColumns entry — do not drop them, and do not treat them as optional.
8) Prefer normalized / "nomolized" ratio (H/L) over raw Ratio H/L or 1/ratio inverse when both exist; treat as fold_change (not intensity).
9) SILAC MaxQuant columns named "Ratio H/L …" or "Ratio M/L …" are linear heavy/light ratios (fold_change, isLog2=false), NOT log2FC. When paired genotype columns exist at the same time (e.g. WT_10min vs ARH3ko_10min), the biological contrast is Treatment/Control (e.g. "ARH3ko/WT (10 min)") — not the per-sample H/L channel ratio stored as log2FC.
9) condition labels: map each ratio column to a Stage3 Condition fragment when possible
   (e.g. "EGF 5 min/Ctr"), using Stage3 sample/condition/detailCondition. Do NOT leave meaningless labels like ".1" or bare "M/L" if Stage3 has clearer comparisons.
9b) LONG-FORMAT tables: when there is ONE shared logFC/ratio column PLUS a column named condition/contrast/comparison whose CELLS hold different contrasts (preview shows distinct labels like "IGF1.10 - control.10", "Insulin.60 - control.60"), set conditionCol to that column and keep a single ratioColumns entry. Do NOT invent multiple ratioColumns for the same logFC header. Per-row condition values will be read from conditionCol.
10) Do NOT invent column names — only use names from the provided headers.
11) confidence: 0–1.

JSON schema:
{
  "skip": boolean,
  "intensityOnly": boolean,
  "confidence": number,
  "reason": string,
  "uniprotCol": string | null,
  "geneCol": string | null,
  "positionCol": string | null,
  "aminoAcidCol": string | null,
  "siteCombinedCol": string | null,
  "conditionCol": string | null,
  "modSeqCol": string | null,
  "intensityColumns": string[],
  "ratioColumns": [
    { "column": string, "condition": string, "isLog2": boolean, "level": "peptide" | "protein", "valueType": "log2_ratio" | "fold_change" | "other" }
  ],
  "pValueColumns": [
    { "column": string, "condition": string, "level": "peptide" | "protein" }
  ]
}`;
export function buildQratioMapUserPrompt(input) {
    const previewLines = input.preview
        .slice(0, 5)
        .map((r, i) => `row${i + 1}: ${JSON.stringify(r.slice(0, 40))}`)
        .join("\n");
    return `${QRATIO_MAP_RULES}

PMID: ${input.pmid}
Title: ${input.title}
PTMs (Stage3): ${input.ptms || "(unknown)"}
Sample (Stage3): ${input.sample || "(unknown)"}
Conditions (Stage3): ${input.condition || "(unknown)"}
Detail condition (Stage3): ${input.detailCondition || "(unknown)"}
File: ${input.entryPath}
Sheet: ${input.sheetName}
${input.userGuidance
        ? `
User curation feedback (follow this when mapping columns/conditions):
${input.userGuidance}
`
        : ""}
Headers (${input.headers.length}):
${JSON.stringify(input.headers)}

Preview (up to 5 rows, truncated columns):
${previewLines || "(empty)"}
`;
}

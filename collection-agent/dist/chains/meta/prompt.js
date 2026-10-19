/**
 * Stage 3 meta prompt — extract literature_info fields from paper text.
 * Target schema: files/qPTM3_109pmids.csv
 */
export const META_SYSTEM = `You are a qPTM Stage-3 curator.
Extract experimental metadata for quantitative PTMomics papers into a fixed schema.
Return ONLY a single JSON object (no markdown fences, no commentary).`;
export const META_RULES = `Schema fields (all strings; use "" if unknown — never invent repository IDs):
- sample: ONLY the biological material(s) that underwent PTM site-level quantitative MS (the samples behind the PTM ratio / site table). Cell line, tissue, or strain short name.
  - Do NOT list materials used only for phenotype, western blot, RNA-seq, proteome-only (non-PTM), or other non-PTM-quant assays.
  - Prefer a single sample string when one material is the source of the main PTM quant table.
  - Multiple materials each with their own PTM site quant → join with "; " (rare); never paste an inventory of every cell line mentioned in the paper.
- sampleType: one of Cell | Tissue | Biofluid (or "Cell; Tissue" if mixed) — must match the PTM-quant sample(s) above
- organism: scientific + common if known, e.g. "Mus musculus (Mouse)", "Homo sapiens (Human)", "Saccharomyces cerevisiae (Baker's yeast)", "Rattus norvegicus (Rat)"
- ptms: PTM type(s). Prefer: Phosphorylation, Acetylation, Ubiquitylation, Glycosylation, Methylation, SUMOylation, etc. Multiple → "; "
- labelMethod: quantification labeling, e.g. Label-free, SILAC, TMT, TMT 10-plex, TMTpro 16-plex, iTRAQ, Dimethyl labeling, DIA
- condition: compact treatment/control comparisons as "Treatment/Ctr" (or A/B) for the PTM quant design. Multiple comparisons → "; "
  Prefer biologically descriptive labels that match Detail condition (e.g. "6 h cerebral ischemia/Sham", not cryptic sheet titles like "Is 6 h vs. sham"). Include time points/doses when those are the quantified contrasts (e.g. "MI_30/SHAM; MI_6h/SHAM"). Do not invent contrasts not supported by the PTM MS design.
  For SILAC: list biological treatment/timepoint contrasts (e.g. "0.5 hours H2O2/Ctr; 1 hours H2O2/Ctr"), NOT channel labels like "H/L" or "M/L".
- conditionSampleMap: map each Condition fragment to the focal Sample that comparison is about (usually the numerator / treatment material).
  Format exactly: "ConditionA=>SampleX; ConditionB=>SampleY" (use "=>", join with "; ").
  - Required whenever sample lists multiple materials OR condition lists multiple comparisons.
  - Single-sample studies: either "" or "Cond=>that sample" for each condition.
  - Example: sample "HCC tissue; normal liver tissue; lung metastasis tissue" with conditions "HCC/Normal; Lung metastasis/Normal; Lung metastasis/HCC"
    → "HCC/Normal=>HCC tissue; Lung metastasis/Normal=>lung metastasis tissue; Lung metastasis/HCC=>lung metastasis tissue"
- detailCondition: 1–3 sentences describing the PTM quantitative design / treatments / time points (and which sample was quantified if multiple materials appear in the paper). Should support rewriting Condition into clear Treatment/Baseline labels.
- enrichmentMethod: PTM enrichment (TiO2, IMAC, Fe-NTA, anti-K-ε-GG, anti-acetyl-lysine, HILIC, …)
- massSpectrometer: instrument model (+ vendor if known)
- msDataSource: repository name — PRIDE | iProX | MassIVE | jPOST | ProteomeXchange | CPTAC | ""
- identifier: repository accession(s) like PXD… / IPX… / MSV… / JPST… / PDC…; multiple → "; "
- confidence: 0–1 how complete/reliable the extraction is
- notes: short caveat (e.g. "abstract-only; enrichment unclear; sample ambiguous which line used for PTM quant")

Rules:
1) Prefer Methods / Experimental Procedures / figure legends for the PTM MS experiment over Abstract when both exist.
2) Condition must encode quantitative comparisons used for PTM ratios, not every wet-lab step.
3) Sample must be scoped to the PTM quantitative dataset (same scope as Condition / site tables), not the whole study's sample zoo.
4) If KnownIdentifiers are provided, use them for identifier / msDataSource unless the text clearly lists additional accessions — then merge uniquely.
5) Do NOT invent PXD/IPX/MSV IDs. If unknown, leave identifier "".
6) If text is abstract-only, still fill what you can; lower confidence.
7) iProX partner / ProteomeXchange: many Chinese deposits say "via the iProX partner repository" with PXD… identifiers. In that case msDataSource MUST be "iProX" (not PRIDE). Prefer KnownIdentifiers that are IPX… over PXD mirrors when both exist. Never rewrite IPX… into PXD… or replace iProX with PRIDE.

JSON schema:
{
  "sample": string,
  "sampleType": string,
  "organism": string,
  "ptms": string,
  "labelMethod": string,
  "condition": string,
  "conditionSampleMap": string,
  "detailCondition": string,
  "enrichmentMethod": string,
  "massSpectrometer": string,
  "msDataSource": string,
  "identifier": string,
  "confidence": number,
  "notes": string
}`;
export const META_FEW_SHOTS = `
Example 1
Title: Dissecting Ubiquitylation and DNA Damage Response Pathways in the Yeast Saccharomyces cerevisiae Using a Proteome-Wide Approach.
Text: SILAC-labeled yeast treated with MMS 1 h vs control. Ubiquitylated peptides enriched with anti-K-ε-GG. Orbitrap Fusion. Data in PRIDE PXD043291.
KnownIdentifiers: PXD043291 (PRIDE)
JSON:
{"sample":"scMLB2 strain","sampleType":"Cell","organism":"Saccharomyces cerevisiae (strain ATCC 204508 / S288c) (Baker's yeast)","ptms":"Ubiquitylation","labelMethod":"SILAC","condition":"MMS 1 h/Ctr","conditionSampleMap":"MMS 1 h/Ctr=>scMLB2 strain","detailCondition":"Saccharomyces cerevisiae was treated with DNA alkylating agent methyl methanesulfonate (MMS) for 1 hour.","enrichmentMethod":"anti-K-ε-GG antibody","massSpectrometer":"Orbitrap Fusion mass spectrometer (Thermo Fisher Scientific)","msDataSource":"PRIDE","identifier":"PXD043291","confidence":0.92,"notes":""}

Example 2
Title: Quantitative Acetylomics Reveals Dynamics of Protein Lysine Acetylation in Mouse Livers During Aging and Upon the Treatment of Nicotinamide Mononucleotide.
Text: Mouse liver acetylome, label-free, aging 2 vs 12 months and NMN treatment vs control. anti-acetyl-lysine. Q Exactive HF-X. iProX IPX0004109000. (Also mentions HEK293 for antibody validation only — do not put HEK293 in sample.)
KnownIdentifiers: IPX0004109000 (iProX)
JSON:
{"sample":"Liver","sampleType":"Tissue","organism":"Mus musculus (Mouse)","ptms":"Acetylation","labelMethod":"Label-free","condition":"2-month-old/12-month-old; NMN/Ctr","conditionSampleMap":"2-month-old/12-month-old=>Liver; NMN/Ctr=>Liver","detailCondition":"Liver tissues from C57BL/6 male mice at 2 and 12 months; additionally 9-month-old mice received NMN until 12 months vs age-matched controls. PTM quant is on liver only.","enrichmentMethod":"anti-acetyl-lysine antibodies","massSpectrometer":"Q Exactive HF-X mass spectrometer (Thermo Fisher Scientific)","msDataSource":"iProX","identifier":"IPX0004109000","confidence":0.9,"notes":""}

Example 3
Title: Bayesian analysis of dynamic phosphoproteomic data identifies protein kinases mediating GPCR responses.
Text: Rat IMCD suspensions, TMT phosphoproteomics after dDAVP at 1/2/5/15 min vs vehicle. Fe-NTA. Orbitrap Fusion Lumos. PRIDE PXD031332.
KnownIdentifiers: PXD031332 (PRIDE)
JSON:
{"sample":"IMCD","sampleType":"Tissue","organism":"Rattus norvegicus (Rat)","ptms":"Phosphorylation","labelMethod":"TMT","condition":"1 min dDAVP/Ctr; 2 min dDAVP/Ctr; 5 min dDAVP/Ctr; 15 min dDAVP/Ctr","conditionSampleMap":"1 min dDAVP/Ctr=>IMCD; 2 min dDAVP/Ctr=>IMCD; 5 min dDAVP/Ctr=>IMCD; 15 min dDAVP/Ctr=>IMCD","detailCondition":"Rat kidney IMCD suspensions treated with dDAVP (1 nM) or vehicle for 1, 2, 5, and 15 minutes.","enrichmentMethod":"Fe-NTA","massSpectrometer":"Orbitrap Fusion Lumos mass spectrometer (Thermo Fisher Scientific)","msDataSource":"PRIDE","identifier":"PXD031332","confidence":0.91,"notes":""}
`;
export function buildMetaUserPrompt(input) {
    return `${META_RULES}

${META_FEW_SHOTS}

Now extract metadata for this paper. Return ONLY JSON.

PMID: ${input.pmid}
Title: ${input.title}
KnownIdentifiers: ${input.knownIdentifiers || "(none)"}

Paper text:
${input.excerpt.slice(0, 16_000)}

JSON:`;
}

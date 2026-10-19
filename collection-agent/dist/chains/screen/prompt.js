/**
 * Stage 1 screening prompt — specialized classification chain (L2M3-inspired).
 * One abstract in → one structured JSON decision out.
 */
export const SCREEN_SYSTEM = `You are a qPTM Stage-1 classifier for quantitative PTMomics literature.
Decide whether a PubMed abstract should enter the qPTM curation pipeline.

Return ONLY a single JSON object (no markdown fences, no commentary).`;
export const SCREEN_RULES = `Labels (exactly one of):
- "include": PTMome-scale MS study, proteogenomic/multi-omic study, or other high-throughput quantitative PTMomics likely to yield site-level ratios
- "exclude": review without new data, non-MS omics only, qualitative single-site ID (WB/IP/mutagenesis only), pure bioinformatics reanalysis without new PTMome quantification
- "uncertain": PTM proteomics mentioned but scope/quantification unclear, OR confidence < 0.7

Strong INCLUDE signals (any one is usually enough — do NOT exclude just because the paper also discusses mechanism or highlights specific substrates):
1) PTMome terminology: phosphoproteomics/phosphoproteome, acetylome, ubiquitylome, SUMO proteome, glycoproteome, methylome, lactylome, crotonylome, Kla proteome/profiling, Khib, etc.
2) Proteogenomic / proteogenomics / integrated proteogenomic characterization
3) Multi-omic / multi-omics with proteomics or phosphoproteomics component
4) High-throughput quantitative MS PTM profiling with condition comparison (TMT/iTRAQ/SILAC/label-free/DIA/LFQ, ratios, fold-changes, differential modification, etc.)

Important: If the abstract says "phosphoproteomics analysis" / "lactylome" / "global Kla profiling" (or similar PTMome-scale term), treat it as PTMome-scale work → include, even when a specific substrate is named as a finding. Mechanistic follow-up on one protein does NOT downgrade a PTMome screen to exclude.

Important: MS **identification** alone is NOT enough for include. LC-MS/MS or HPLC-MS/MS that only identifies one/few PTM sites or modified proteins (no PTMome terminology, no quantification, no condition comparison) → exclude or uncertain, not include.

Important: When PTMome terminology or clear high-throughput MS PTM profiling is present, do NOT exclude merely because the quantification method is unspecified — prefer include or uncertain (not exclude). Without PTMome-scale scope, unspecified quantification → uncertain.

Proteogenomic and multi-omic studies → include by default (PTM layers are often in supplementary even if the abstract emphasizes proteomics/genomics).

EXCLUDE only when PTM work is clearly NOT PTMome-scale, e.g.:
- Co-IP / immunoblot / kinase assay / mutagenesis on one or two sites with no MS PTM profiling and no PTMome terminology
- Review or perspective without new MS dataset
- Pure method/chemistry paper that only validates antibodies or isomer separation without MS-based PTM site/protein discovery dataset

Preferred organisms: human, mouse, rat, yeast. Other organisms → uncertain unless clearly quantitative PTMomics.

JSON schema:
{
  "decision": "include" | "exclude" | "uncertain",
  "confidence": 0.0-1.0,
  "ptmTypes": string[],
  "organisms": string[],
  "isQuantitativeMs": boolean,
  "hasSiteLevelDataHint": boolean,
  "quantificationMethods": string[],
  "dataSourceHint": "supplementary" | "proteomexchange" | "main_text" | "unknown",
  "reason": "one concise sentence"
}`;
/** Few-shot examples (abbreviated abstracts) */
export const SCREEN_FEW_SHOTS = `
Example 1 — INCLUDE
Title: Quantitative proteome and phosphoproteome datasets of DNA replication and mitosis in Saccharomyces cerevisiae.
Abstract: Cells were synchronized and phosphoproteomes quantified with TMT across early S-phase, late S-phase and mitotic arrest. Site-level phosphopeptide ratios were deposited in PRIDE.
JSON:
{"decision":"include","confidence":0.95,"ptmTypes":["Phosphorylation"],"organisms":["Yeast"],"isQuantitativeMs":true,"hasSiteLevelDataHint":true,"quantificationMethods":["TMT"],"dataSourceHint":"proteomexchange","reason":"Quantitative TMT phosphoproteomics with site-level ratios across cell-cycle conditions."}

Example 2 — INCLUDE (proteogenomic)
Title: Integrated Proteogenomic Characterization of HBV-Related Hepatocellular Carcinoma.
Abstract: We performed proteogenomic characterization using paired tumor and adjacent liver tissues from 159 patients. Integrated proteogenomic analyses revealed signaling pathway activation and metabolic reprogramming. Proteomic profiling identified clinical subgroups.
JSON:
{"decision":"include","confidence":0.92,"ptmTypes":["Phosphorylation"],"organisms":["Human"],"isQuantitativeMs":true,"hasSiteLevelDataHint":true,"quantificationMethods":[],"dataSourceHint":"supplementary","reason":"Proteogenomic study with paired tumor/normal MS profiling; PTM layers typically available in integrated datasets."}

Example 3 — INCLUDE (phosphoproteomics screen with mechanistic follow-up)
Title: The BCKDH Kinase and Phosphatase Integrate BCAA and Lipid Metabolism via Regulation of ATP-Citrate Lyase.
Abstract: BDK/PPM1K regulate BCAA catabolism and hepatic steatosis in rats. Phosphoproteomics analysis identified ATP-citrate lyase (ACL) as an alternate substrate of BDK and PPM1K. BDK overexpression increased ACL phosphorylation and de novo lipogenesis.
JSON:
{"decision":"include","confidence":0.90,"ptmTypes":["Phosphorylation"],"organisms":["Rat"],"isQuantitativeMs":true,"hasSiteLevelDataHint":true,"quantificationMethods":[],"dataSourceHint":"supplementary","reason":"Phosphoproteomics screen performed; ACL identified as a substrate — PTMome-scale work despite mechanistic focus."}

Example 4 — UNCERTAIN (MS identifies modification; no PTMome scale or quantification)
Title: Astrocyte-derived lactate aggravates brain injury by promoting protein lactylation.
Abstract: Pharmacological inhibition of lactate production attenuated ischemic injury. Increased protein lysine lactylation (Kla) was found mainly in neurons by HPLC-MS/MS analysis and immunofluorescent staining. Blocking Kla formation with a p300 antagonist reduced infarction.
JSON:
{"decision":"uncertain","confidence":0.62,"ptmTypes":["Lactylation"],"organisms":["Mouse"],"isQuantitativeMs":false,"hasSiteLevelDataHint":false,"quantificationMethods":[],"dataSourceHint":"main_text","reason":"HPLC-MS/MS detects Kla but no lactylome/proteome-scale profiling or site-level quantification is described."}

Example 5 — EXCLUDE
Title: March2 Alleviates Aortic Aneurysm by Regulating PKM2 Polymerization.
Abstract: March2 promotes K33-linked polyubiquitination of PKM2. Methods use Co-IP, CUT&Tag-qPCR and mouse genetics; no proteome-wide quantitative PTMomics dataset.
JSON:
{"decision":"exclude","confidence":0.92,"ptmTypes":["Ubiquitylation"],"organisms":["Mouse","Human"],"isQuantitativeMs":false,"hasSiteLevelDataHint":false,"quantificationMethods":[],"dataSourceHint":"unknown","reason":"Single-protein ubiquitination mechanism study without PTMome terminology or MS PTM profiling."}

Example 6 — EXCLUDE
Title: MAFA: A Master Regulator of β-Cell Maturation and Function.
Abstract: This review summarizes MAFA transcription factor biology and post-translational modifications; no new mass spectrometry dataset.
JSON:
{"decision":"exclude","confidence":0.96,"ptmTypes":[],"organisms":["Human","Mouse"],"isQuantitativeMs":false,"hasSiteLevelDataHint":false,"quantificationMethods":[],"dataSourceHint":"unknown","reason":"Review article without new quantitative PTMomics data."}

Example 7 — EXCLUDE (single-site mechanism; no MS PTMome)
Title: NBS1 lactylation is required for efficient DNA repair and chemotherapy resistance.
Abstract: Lactate-driven lactylation of NBS1 at K388 promotes HR repair. TIP60 writes and HDAC3 erases this mark. No proteome-wide MS PTM profiling is described.
JSON:
{"decision":"exclude","confidence":0.9,"ptmTypes":["Lactylation"],"organisms":["Human"],"isQuantitativeMs":false,"hasSiteLevelDataHint":false,"quantificationMethods":[],"dataSourceHint":"unknown","reason":"Single-site lactylation mechanism without MS PTMome or PTMome terminology."}

Example 8 — UNCERTAIN
Title: Proteomic analysis reveals phosphorylation changes in stressed cells.
Abstract: LC-MS/MS was used to study phosphorylation after stress. Differentially modified proteins are discussed, but quantification method and site-level reporting are not specified.
JSON:
{"decision":"uncertain","confidence":0.55,"ptmTypes":["Phosphorylation"],"organisms":[],"isQuantitativeMs":true,"hasSiteLevelDataHint":false,"quantificationMethods":[],"dataSourceHint":"unknown","reason":"Mentions MS phosphorylation work but lacks PTMome terminology or clear quantitative site-level evidence."}
`;
export function buildScreenUserPrompt(title, abstract) {
    return `${SCREEN_RULES}

${SCREEN_FEW_SHOTS}

Now classify this abstract. Return ONLY JSON.

Title: ${title}
Abstract: ${abstract.slice(0, 4500)}
JSON:`;
}

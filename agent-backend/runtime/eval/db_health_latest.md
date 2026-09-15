# Database tool health check

- Time: `2026-09-14T14:21:23Z`
- Tools registered: **52**
- Case library: **43** biological / adversarial cases
- Probes: **6** in 11.8s
- Workers: 1, timeout: 40.0s/call

## Rollup

| Overall | Count |
|---|---:|
| ok | 1 |
| partial | 0 |
| unexpected_empty | 0 |
| unreasonable | 0 |
| broken | 0 |
| untested | 0 |

## Per-tool summary

| Tool | Database | Configured | Overall | OK cases | Max rows | Max ms | Statuses |
|---|---|---|---|---:|---:|---:|---|
| `string_ppi` | STRING | yes | **ok** | 5/6 | 20 | 3497 | ok, ok, identity_mismatch, ok, ok, ok |

## Case library

| Id | Label | Tags |
|---|---|---|
| `tp53_s15` | TP53 p.Ser15 phosphorylation (human) | core, phospho, site, human, kinase |
| `tp53_protein` | TP53 protein-level (no site) — typical agent fan-out | core, protein, human |
| `tp53_k382` | TP53 p.Lys382 acetylation | acetyl, site, human |
| `tp53_ub` | TP53 ubiquitination K120 (MDM2 axis; site often missing in GPS-Uber) | ub, site, human |
| `tp53_ub_k101` | TP53 ubiquitination K101 (present in GPS-Uber dump) | ub, site, human |
| `yap1_s127` | YAP1 p.Ser127 (Hippo localization switch) | core, phospho, site, human, llps |
| `kras_s39` | KRAS p.Ser39 / nearby disease variants | disease, site, human |
| `egfr_drug` | EGFR Y1197 drug–PTM / kinase context | drug, site, human, membrane |
| `egfr_protein` | EGFR protein-level (no site) — drug / PPI fan-out | drug, protein, human, membrane |
| `braf_v600e` | BRAF V600E kinase activity (KAKA) | mutation, kinase, human |
| `egfr_l858r` | EGFR L858R kinase-activity mutation (KAKA) | mutation, kinase, human |
| `ep300_ac` | EP300 histone acetyltransferase (WERAM writer) | acetyl, writer, human |
| `hdac1_eraser` | HDAC1 histone deacetylase (WERAM eraser) | acetyl, eraser, human |
| `fus_llps` | FUS phase separation | llps, human |
| `tardbp_llps` | TARDBP / TDP-43 phase separation | llps, human |
| `sumo_tp53` | TP53 SUMOylation K386 (GPS-SUMO 2.0) | sumo, site, human |
| `nfkbia_s32` | NFKBIA p.Ser32 (IκBα degron) | phospho, site, human, degron |
| `ctnnb1_s33` | CTNNB1 p.Ser33 (β-catenin degron) | phospho, site, human, degron |
| `stat3_y705` | STAT3 p.Tyr705 (canonical activation) | phospho, site, human, tyrosine |
| `akt1_s473` | AKT1 p.Ser473 (mTORC2 activation) | phospho, site, human |
| `myc_t58` | MYC p.Thr58 (GSK3 / stability) | phospho, site, human |
| `mapk1_y187` | MAPK1 p.Tyr187 (ERK2 activation loop) | phospho, site, human, tyrosine |
| `src_y419` | SRC p.Tyr419 (kinase activation) | phospho, site, human, tyrosine |
| `brca1_ub` | BRCA1 ubiquitination (DNA-damage E3) | ub, protein, human, disease |
| `h3_k27me` | Histone H3.1 K27 methylation (H3C1 / P68431) | methyl, histone, site, human |
| `gapdh_metabolic` | GAPDH metabolic / PathBank context | protein, human, pathway |
| `ins_secreted` | INS secreted peptide (signal peptide / extracellular) | protein, human, secreted |
| `lmna_nuclear` | LMNA nuclear lamina (NLS / envelope) | protein, human, nuclear |
| `pten_s380` | PTEN p.Ser380 (C-tail cluster) | phospho, site, human, disease |
| `gps6_rsph1` | RSPH1 S2 (present in GPS 6.0 local dump; TP53 is not) | phospho, site, human, gps6 |
| `dbptm_trfe` | TRFE / P02787 (present in dbPTM disease TSV) | disease, human, dbptm |
| `literature` | Literature: TP53 Ser15 + known PMIDs | literature |
| `literature_brca` | Literature: BRCA1 DNA-damage (different topic / PMIDs) | literature |
| `literature_pmid_bad` | Literature: bogus PMID (should not crash) | literature, adversarial |
| `mouse_trp53` | Mouse Trp53 / P02340 (non-human organism) | organism, mouse, protein |
| `yeast_cdc28` | Yeast CDC28 / CDK1 (Saccharomyces cerevisiae) | organism, yeast, protein |
| `isoform_tp53` | TP53 isoform accession P04637-2 | isoform, human, adversarial |
| `alias_p53` | Alias / lowercase gene symbol p53 (no accession) | alias, adversarial |
| `accession_only` | UniProt-only P04637 (no gene symbol) | identity, adversarial |
| `identity_mismatch` | Stale identity: gene=STAT3 + AC=P04637 (TP53) | identity, adversarial |
| `position_only` | Site without protein (position=15 only) | adversarial |
| `erlotinib_only` | Drug name only (no gene) — decryptM/PMADS routing | drug, adversarial |
| `negative` | Negative control (non-gene) | adversarial |


## Preflight

- BioGRID key: set
- NCBI API key: not set (rate-limit risk)
- SignalP registered: True
- Stability TSV: yes (`data/stability/curated/ptm_stability_curated.tsv`)
- eKPI matrices dir: yes (`/var/www/html/ekpi/final_result`)
- dbPTM dir exists: True files=['SOURCE.yaml', 'disease_associated_ptms.tsv']
- Local indexes missing: **0**

## Failed / unexpected probes

None.

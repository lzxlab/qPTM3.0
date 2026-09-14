const DB_NAMES: Record<string, string> = {
  resolve_ptm_target: "qPTM",
  search_ptm_sites: "qPTM",
  get_site_conditions: "qPTM",
  get_upstream_enzymes: "qPTM / PhosphoSitePlus",
  get_function_disease: "PhosphoSitePlus / PTMD",
  get_llps: "PTMPhaSe",
  get_drug_ptm: "PMADS / DrugBank",
  get_localization: "COMPARTMENTS / UniProt",
  get_ppi_pathways: "STRING / Reactome",
  search_literature: "PubTator3 / PubMed / Europe PMC",
  qptm_search: "qPTM",
  qptm_site_conditions: "qPTM",
  qptm_kinases: "qPTM",
  iptmnet_enzymes: "iPTMnet",
  psp_kinase_substrate: "PhosphoSitePlus",
  gps6_kinases: "GPS 6.0",
  pubtator_literature_search: "PubTator3",
  pubmed_esearch: "PubMed",
  europepmc_literature_search: "Europe PMC",
  pubmed_fetch_abstracts: "PubMed",
  pubmed_fetch_fulltext: "Europe PMC",
};

export interface Citation {
  id: string;
  database: string;
  label: string;
  url?: string;
}

export function toolDatabase(tool: string): string {
  return DB_NAMES[tool] || tool;
}

export function mergeCitation(
  citations: Citation[],
  tool: string,
  url?: string,
): Citation[] {
  const db = toolDatabase(tool);
  const existing = citations.find((c) => c.database === db);
  if (existing) return citations;
  const id = `S${citations.length + 1}`;
  citations.push({
    id,
    database: db,
    label: db,
    url: url || undefined,
  });
  return citations;
}

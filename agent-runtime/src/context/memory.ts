export interface ParsedEntities {
  gene?: string;
  uniprot_ac?: string;
  position?: number;
  ptm_type?: string;
  organism?: string;
  pmid?: string;
  mutation_label?: string;
}

export interface InvestigationMemory {
  gene: string | null;
  uniprot_ac: string | null;
  position: number | null;
  ptm_type: string;
  organism: string;
  pmid: string | null;
  mutation_label: string | null;
  query_mode: string | null;
  findings_summary: string;
  entities: ParsedEntities;
}

export function emptyMemory(): InvestigationMemory {
  return {
    gene: null,
    uniprot_ac: null,
    position: null,
    ptm_type: "all",
    organism: "human",
    pmid: null,
    mutation_label: null,
    query_mode: null,
    findings_summary: "",
    entities: {},
  };
}

const GENE_RE = /\b([A-Z][A-Z0-9]{1,9})\b/g;
const UNIPROT_RE = /\b([OPQ][0-9][A-Z0-9]{3}[0-9](?:-\d+)?|[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9](?:-\d+)?)\b/i;
const PMID_RE = /\b(?:PMID[:\s#]*)?(\d{7,8})\b/i;
const SAME_SITE_RE = /同上|同样的位点|该位点|这个位点|same\s+(site|protein|target)|this\s+site|同上位点/i;

export function parseEntities(message: string): ParsedEntities {
  const out: ParsedEntities = {};
  const pmidM = PMID_RE.exec(message);
  if (pmidM) out.pmid = pmidM[1];

  const uniM = UNIPROT_RE.exec(message);
  if (uniM) out.uniprot_ac = uniM[1].toUpperCase();

  // Prefer the first explicit residue; also accept "Ser15" / "丝氨酸15".
  const sty = message.match(/\b([STYKR])(\d{2,5})\b/i);
  const named = message.match(
    /\b(?:Ser|Thr|Tyr|Lys|Arg|丝氨酸|苏氨酸|酪氨酸)\s*[- ]?(\d{2,5})\b/i,
  );
  if (sty) {
    out.position = Number(sty[2]);
    if (/phosph|磷酸化/i.test(message) || /[STY]/i.test(sty[1])) {
      out.ptm_type = "phosphorylation";
    }
  } else if (named) {
    out.position = Number(named[1]);
    out.ptm_type = "phosphorylation";
  } else {
    const siteN = message.match(/\bsite\s+(\d{2,5})\b/i);
    const geneNum = message.match(/\b([A-Z][A-Z0-9]{1,9})\s+(\d{2,5})\b/);
    if (siteN) out.position = Number(siteN[1]);
    else if (geneNum) out.position = Number(geneNum[2]);
  }

  const genes = [...message.matchAll(GENE_RE)].map((m) => m[1]);
  const common = new Set([
    "DNA", "RNA", "PTM", "WHO", "WHEN", "WHERE", "WHY", "PMID", "HTTP", "HTTPS",
    "CANCER", "SIGNAL", "TUMOR", "TUMOUR", "CONTROL", "BRCA", "UCEC",
  ]);
  for (const g of genes) {
    // Never treat residue tokens like S15 / Y394 as gene symbols.
    if (/^[STYKR]\d{2,5}$/i.test(g)) continue;
    if (!common.has(g) && g.length >= 2) {
      out.gene = g;
      break;
    }
  }

  // Colloquial p53 / Trp53 (case-insensitive) — GENE_RE misses lowercase "p53".
  if (!out.gene && /\btrp53\b/i.test(message)) out.gene = "Trp53";
  if (!out.gene && /\bp53\b/i.test(message)) {
    out.gene = /mouse|小鼠|mus\s*musculus|\btrp53\b/i.test(message) ? "Trp53" : "TP53";
  }
  if (out.gene && /^p53$/i.test(out.gene)) {
    out.gene = /mouse|小鼠|mus\s*musculus/i.test(message) ? "Trp53" : "TP53";
  }

  if (/mouse|小鼠|mus\s*musculus/i.test(message)) out.organism = "mouse";
  else if (/human|人|智人|homo\s*sapiens/i.test(message)) out.organism = "human";
  return out;
}

/** Pull a residue number out of clarification option labels like "S18（小鼠）/ S15（人）". */
export function extractPositionFromText(text: string): number | null {
  if (!text) return null;
  // Prefer mouse residue when both are listed: "S18（小鼠）/ S15（人）"
  const mouseSite = text.match(/\b([STYKR])(\d{2,5})\s*[（(]?\s*小鼠/i);
  if (mouseSite) return Number(mouseSite[2]);
  const humanSite = text.match(/\b([STYKR])(\d{2,5})\s*[（(]?\s*人/i);
  if (humanSite) return Number(humanSite[2]);
  const any = text.match(/\b([STYKR])(\d{2,5})\b/i);
  return any ? Number(any[2]) : null;
}

function isResidueToken(token: string | null | undefined): boolean {
  return Boolean(token && /^[STYKR]\d{2,5}$/i.test(token.trim()));
}

/** Normalize organism / p53-family gene symbols. Does NOT invent a site. */
export function normalizeTargetIdentity(memory: InvestigationMemory, contextText = ""): void {
  const blob = `${contextText}\n${memory.gene || ""}\n${memory.organism || ""}`;
  if (/mouse|小鼠/i.test(blob)) memory.organism = "mouse";
  else if (/human|人|智人|homo\s*sapiens/i.test(blob) && memory.organism !== "mouse") {
    memory.organism = "human";
  }

  // Drop residue tokens mis-assigned as genes (S15, Y394…).
  if (isResidueToken(memory.gene)) {
    memory.gene = null;
  }

  if (memory.gene && /^(p53|TP53|Trp53)$/i.test(memory.gene)) {
    memory.gene = memory.organism === "mouse" ? "Trp53" : "TP53";
  }
  if (!memory.gene && /\btrp53\b/i.test(blob)) {
    memory.gene = "Trp53";
  }
  if (!memory.gene && /\bp53\b/i.test(blob)) {
    memory.gene = memory.organism === "mouse" ? "Trp53" : "TP53";
  }
}

export function mergeEntities(memory: InvestigationMemory, parsed: ParsedEntities, query = ""): void {
  const reuse = Boolean(query && SAME_SITE_RE.test(query));
  const parsedGene = parsed.gene && !isResidueToken(parsed.gene) ? parsed.gene : "";
  const geneChanged =
    Boolean(parsedGene && memory.gene && parsedGene.toUpperCase() !== memory.gene.toUpperCase());
  const pmidOnly = Boolean(parsed.pmid && !parsedGene && !parsed.uniprot_ac && !parsed.position);

  if (!reuse) {
    if (geneChanged) {
      // New gene must not keep the previous accession (STAT3 must not inherit P04637).
      memory.uniprot_ac = parsed.uniprot_ac || null;
    }
    if (pmidOnly) {
      memory.gene = null;
      memory.uniprot_ac = null;
      memory.position = null;
      memory.ptm_type = "all";
    }
  }

  memory.entities = { ...memory.entities, ...parsed };
  // Never let a residue token overwrite a real gene (common after site clarification).
  if (parsedGene) memory.gene = parsedGene;
  if (parsed.uniprot_ac) memory.uniprot_ac = parsed.uniprot_ac;
  if (parsed.position) memory.position = parsed.position;
  if (parsed.ptm_type) memory.ptm_type = parsed.ptm_type;
  if (parsed.organism) memory.organism = parsed.organism;
  if (parsed.pmid) memory.pmid = parsed.pmid;
  if (parsed.mutation_label) memory.mutation_label = parsed.mutation_label;
}

export function sameGene(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export function wantsSameSite(query: string): boolean {
  return SAME_SITE_RE.test(query || "");
}

export function memoryPromptBlock(memory: InvestigationMemory): string {
  const parts: string[] = [];
  if (memory.gene) parts.push(`gene=${memory.gene}`);
  if (memory.uniprot_ac) parts.push(`UniProt=${memory.uniprot_ac}`);
  if (memory.position) parts.push(`site=${memory.position}`);
  if (memory.ptm_type) parts.push(`ptm_type=${memory.ptm_type}`);
  if (memory.pmid) parts.push(`PMID=${memory.pmid}`);
  if (memory.findings_summary) parts.push(`\nPrior findings:\n${memory.findings_summary}`);
  return parts.length ? parts.join(" · ") : "(no target yet)";
}

export function addFinding(memory: InvestigationMemory, tool: string, summary: string): void {
  const line = `- [${tool}] ${summary.slice(0, 300)}`;
  if (!memory.findings_summary.includes(line)) {
    memory.findings_summary += memory.findings_summary ? `\n${line}` : line;
  }
}

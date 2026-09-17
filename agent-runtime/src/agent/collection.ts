import { ParsedEntities } from "../context/memory.js";

/** Phrases that mean literature-collection, not biology (avoid "import"/"parse"/"extract"). */
const COLLECTION_RE =
  /\bcollect\b|\bcurat(?:e|ing)\b|\bingest\b|qratio|quantitative\s+table|supplementary\s+table|literature\s+collection|data\s+collect|\u6570\u636e\u6536\u96c6|\u6587\u732e\u6536\u96c6|\u62bd\u53d6|\u5165\u5e93|\u5b9a\u91cf\u8868|\u8865\u5145\u8868|\u7b56\u5c55/i;

const ACCESSION_RE = /(?<![A-Za-z0-9_])((?:PXD|IPX|JPST|MSV|PDC)\d+)(?![A-Za-z0-9_])/gi;

const RESOLVE_URLS_RE =
  /download\s*url|download\s*link|ftp\s*link|raw\s*file|ms\s*url|pride|iprox|jpost|massive|cptac|proteomexchange|resolve[- ]?url|get[- ]?url|\u4e0b\u8f7d\u94fe\u63a5|\u4e0b\u8f7d\u5730\u5740|\u8d28\u8c31.*\u4e0b\u8f7d|\u539f\u59cb\u6570\u636e|\u83b7\u53d6.*\u94fe\u63a5|\u89e3\u6790.*\u94fe\u63a5/i;

const PMID_COLLECT_RE = /collect|extract|curat|ingest|qratio|\u6536\u96c6|\u62bd\u53d6|\u5165\u5e93/i;

const FULLTEXT_EXT = /\.(pdf|xml)$/i;
const SUPP_EXT = /\.(zip|xlsx|xls|csv|tsv)$/i;

export function extractAccessions(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(ACCESSION_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const acc = m[1].toUpperCase();
    if (seen.has(acc)) continue;
    seen.add(acc);
    out.push(acc);
  }
  return out;
}

export function looksLikeResolveUrlsRequest(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  const accessions = extractAccessions(text);
  if (!accessions.length) return false;
  if (RESOLVE_URLS_RE.test(text)) return true;
  const stripped = text.replace(new RegExp(ACCESSION_RE.source, "gi"), " ").replace(/[\s,;:/|=#\-]+/g, "");
  return stripped.length === 0;
}

export function isCollectionUpload(filenames: string[] | undefined | null): boolean {
  if (!filenames?.length) return false;
  return filenames.some((name) => FULLTEXT_EXT.test(name) || SUPP_EXT.test(name));
}

export function isCollectionRequest(
  message: string,
  entities: ParsedEntities,
  uploadFilenames: string[] = [],
): boolean {
  if (isCollectionUpload(uploadFilenames)) return true;
  const text = (message || "").trim();
  if (looksLikeResolveUrlsRequest(text)) return true;
  if (COLLECTION_RE.test(text)) return true;
  if (entities.pmid && PMID_COLLECT_RE.test(text)) return true;
  return false;
}

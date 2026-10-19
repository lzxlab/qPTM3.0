/**
 * User-provided hints for which supplementary tables/sheets to parse.
 * Written when auto-detection finds no usable quantitative tables,
 * or when the user intervenes after Stage5 via Teach UI / free-text guidance.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { stage4SuppDir } from "../utils/io.js";
export function userHintsPath(pmid) {
    return join(stage4SuppDir(), pmid.trim(), "user_hints.json");
}
export function loadUserTableHints(pmid) {
    const path = userHintsPath(pmid);
    if (!existsSync(path))
        return null;
    try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        if (!raw || !Array.isArray(raw.selections))
            return null;
        return raw;
    }
    catch {
        return null;
    }
}
export function saveUserTableHints(pmid, selections, note, preferProteinLog2, derivedRatios, proteomeColumns) {
    const hints = {
        selections: selections
            .map((s) => ({
            entryPath: String(s.entryPath || "").trim(),
            sheetName: s.sheetName != null ? String(s.sheetName).trim() : undefined,
        }))
            .filter((s) => s.entryPath),
        note: note?.trim() || undefined,
        preferProteinLog2: preferProteinLog2 || undefined,
        derivedRatios: derivedRatios?.length ? derivedRatios : undefined,
        ...(proteomeColumns?.ratioCol || proteomeColumns?.pValueCol
            ? {
                proteomeColumns: {
                    ...(proteomeColumns?.ratioCol
                        ? { ratioCol: String(proteomeColumns.ratioCol).trim() }
                        : {}),
                    ...(proteomeColumns?.pValueCol
                        ? { pValueCol: String(proteomeColumns.pValueCol).trim() }
                        : {}),
                },
            }
            : {}),
        updatedAt: new Date().toISOString(),
    };
    const path = userHintsPath(pmid);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(hints, null, 2) + "\n", "utf8");
    return hints;
}
export function selectionKey(entryPath, sheetName) {
    const sheet = (sheetName || "").trim();
    return sheet ? `${entryPath}#${sheet}` : entryPath;
}
/** Normalize for fuzzy path / filename matching. */
export function normalizeEntryKey(path) {
    return (path || "").trim().replace(/\\/g, "/").toLowerCase();
}
/** True when hint path equals, ends with, or shares basename with actual ZIP entry. */
export function entryPathMatches(hintPath, actualPath) {
    const h = normalizeEntryKey(hintPath);
    const a = normalizeEntryKey(actualPath);
    if (!h || !a)
        return false;
    if (h === a)
        return true;
    if (a.endsWith("/" + h) || h.endsWith("/" + a))
        return true;
    const hb = basename(h);
    const ab = basename(a);
    return Boolean(hb && ab && hb === ab);
}
/** True if this sheet is explicitly selected (or file selected without sheet filter). */
export function isHintedSheet(hints, entryPath, sheetName) {
    if (!hints?.selections?.length)
        return false;
    for (const s of hints.selections) {
        if (!entryPathMatches(s.entryPath, entryPath))
            continue;
        if (!s.sheetName || !s.sheetName.trim())
            return true;
        if (s.sheetName.trim() === sheetName)
            return true;
    }
    return false;
}
const TABLE_NAME_RE = /([A-Za-z0-9][\w.\-]*(?:\([\w.\- ]+\))?[\w.\-]*\.(?:xlsx|xls|csv|tsv|txt))(?![A-Za-z0-9])/gi;
/** Detect protein-level Log2Ratio intent from free text. */
export function noteWantsProteinLog2(note) {
    const t = (note || "").toLowerCase();
    if (!t)
        return false;
    if (/log2?\s*ratio\s*\(\s*protein\s*\)/i.test(t))
        return true;
    if (/missing\s+log2?\s*ratio\s*\(\s*protein\s*\)/i.test(t))
        return true;
    if (/protein[-\s_]*(?:level\s+)?(?:log2?\s*)?(?:ratio|fc|fold)/i.test(t))
        return true;
    if (/protein[- ]level\s+data/i.test(t))
        return true;
    if (/蛋白质/.test(note || "") && /(定量|log|ratio|比值)/i.test(t))
        return true;
    if (/蛋白/.test(note || "") && /(log2?ratio|定量值|定量表)/i.test(t))
        return true;
    return false;
}
/**
 * Sheet names the user says hold whole-proteome / protein-level ratios
 * (e.g. "'pro' contains only protein-level data", 'do not skip "pro"').
 */
export function extractProteomeSheetNames(note) {
    const t = note || "";
    if (!t)
        return [];
    const out = [];
    const seen = new Set();
    const add = (raw) => {
        const s = (raw || "").trim().replace(/[.,;:]+$/, "");
        if (!s || /^(sheet|file|table|the|this|that|use)$/i.test(s))
            return;
        const key = s.toLowerCase();
        if (seen.has(key))
            return;
        seen.add(key);
        out.push(s);
    };
    const patterns = [
        /['"“‘]([A-Za-z][\w .\-]{0,40}?)['"”’]\s*contains?\s+(?:only\s+)?protein/gi,
        /do\s+not\s+skip\s+['"“‘]([^'"”’]{1,40})['"”’]/gi,
        /do\s+not\s+skip\s+([A-Za-z][\w.\-]{1,40})\b/gi,
        /\bsheets?\s+['"“‘]([^'"”’]{1,40})['"”’]\s+(?:is|has|contains?|holds?)\s+(?:only\s+)?(?:protein|proteome)/gi,
        /\bsheets?\s+([A-Za-z][\w.\-]{1,40})\s+(?:is|has|contains?|holds?)\s+(?:only\s+)?(?:protein|proteome)/gi,
    ];
    for (const re of patterns) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(t)))
            add(m[1]);
    }
    return out;
}
/** User asks to treat each Excel sheet as a distinct Sample. */
export function noteWantsSheetAsSample(note) {
    const t = (note || "").toLowerCase();
    if (!t)
        return false;
    if (/mismatch\s*sample/i.test(t))
        return true;
    if (/sheet.+as.+(?:different\s+)?samples?/i.test(t))
        return true;
    if (/(?:different|separate|distinct)\s+samples?/i.test(t) && /sheet/i.test(t))
        return true;
    if (/each\s+sheet.+(?:sample|cell\s*line)/i.test(t))
        return true;
    if (/use.+sheets?.+as.+samples?/i.test(t))
        return true;
    if (/三个|不同/.test(note || "") && /sample|样品|细胞系|sheet/i.test(t))
        return true;
    if (/样品不对|样品错|sample\s*(?:wrong|mismatch|incorrect)/i.test(t))
        return true;
    return false;
}
const COLUMN_NAME_STOP = new Set([
    "use",
    "the",
    "this",
    "that",
    "sheet",
    "file",
    "table",
    "column",
    "columns",
    "example",
    "for",
    "means",
    "please",
    "should",
    "into",
    "with",
    "from",
    "into",
    "split",
    "parse",
    "phos",
    "proteome",
    "by",
    "and",
    "or",
    "as",
    "is",
    "are",
    "a",
    "an",
].map((s) => s.toLowerCase()));
function isPlausibleColumnName(col) {
    const c = (col || "").trim();
    if (!c || c.length < 2 || c.length > 80)
        return false;
    if (COLUMN_NAME_STOP.has(c.toLowerCase()))
        return false;
    if (/^(use|the|this|that|sheet|file|table)$/i.test(c))
        return false;
    // Example site tokens mistaken as column names: 1433S_S74 / P04637_S15 / CIC-S739
    if (/[_-]([STYKR])\d{1,5}$/i.test(c) || /^\d/.test(c))
        return false;
    return true;
}
/** True when a role phrase describes a bundled UniProt/gene + AA + position column. */
function looksLikeCombinedSiteRole(role) {
    const r = (role || "").toLowerCase().replace(/[_\-+/|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!r)
        return false;
    if (/phosphosite|combined\s*site|site\s*id|mod(?:ification)?\s*sites?/.test(r))
        return true;
    if (/split/.test(r))
        return true;
    const hasId = /uniprot|accession|protein\s*id|gene/.test(r);
    const hasAa = /amino|acide|acid|residue|aa\b/.test(r);
    const hasPos = /position|pos\b|site|位点|位置/.test(r);
    // "UniProt Amino acid Position" / "UniProt_Amino acide Position"
    if (hasId && (hasAa || hasPos))
        return true;
    if (hasAa && hasPos)
        return true;
    return false;
}
function roleKeyFromText(role) {
    const raw = role || "";
    const r = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (!r)
        return null;
    // Combined / split descriptions must win before bare "uniprot" / "position"
    if (looksLikeCombinedSiteRole(raw))
        return "siteCombinedCol";
    if (/氨基酸|残基类型/.test(raw) || (/amino/.test(r) && !/position/.test(r)))
        return "aminoAcidCol";
    if (/^aa$/.test(r) || /^residue(\s*types?)?$/.test(r))
        return "aminoAcidCol";
    if (/位点|位置/.test(raw) || /position|^pos$|site\s*number/.test(r))
        return "positionCol";
    if (/uniprot|protein\s*ids?|accession/.test(r))
        return "uniprotCol";
    if (/^conditions?$|^contrasts?$|^comparisons?$/.test(r) ||
        (/condition/.test(r) && !/gene|amino|site/.test(r))) {
        return "conditionCol";
    }
    if (/^gene(\s*names?)?$/.test(r) || (/gene/.test(r) && !/amino|position|site/.test(r))) {
        return "geneCol";
    }
    return null;
}
function assignRole(out, role, col) {
    if (!isPlausibleColumnName(col))
        return;
    // Prefer first explicit assignment; siteCombined may overwrite weaker singles later.
    if (role === "siteCombinedCol") {
        out.siteCombinedCol = col;
        return;
    }
    if (!out[role])
        out[role] = col;
}
/**
 * Parse free-text column role hints, e.g.
 * "column AA is Amino acid", "STY is the position", "ProteinID = UniProt",
 * "mod_sites column is UniProt_Amino acid Position, should split this column".
 */
export function extractColumnRoleHints(text) {
    const out = {};
    if (!text)
        return out;
    let m;
    // 1) Combined / split columns first (most common Teach failure mode).
    const combinedRes = [
        // "mod_sites column is UniProt_Amino acid Position" / "X column contains gene+AA+pos"
        /\b([A-Za-z][\w.\-]{1,60})\s+columns?\s*(?:is|are|=|means?|contains?|holds?|stores?|has|includes?)\s+([^.!?\n,]{3,120}?)(?=,|\.|$|should|please|and\s+then)/gi,
        // "column mod_sites is UniProt + Amino acid + Position"
        /\bcolumns?\s+["']?([A-Za-z][\w.\-+ ]{1,60}?)["']?\s*(?:is|are|=|means?|contains?|holds?|stores?|has)\s+([^.!?\n,]{3,120}?)(?=,|\.|$|should)/gi,
        // "split column mod_sites" / "split this column mod_sites"
        /\bsplit\s+(?:this\s+)?columns?\s+["']?([A-Za-z][\w.\-]{1,60})["']?/gi,
        // "column 'mod_sites' should be split" / "column mod_sites should split"
        /\bcolumns?\s+["']?([A-Za-z][\w.\-]{1,60})["']?[^.!?\n]{0,40}?\b(?:should\s+(?:be\s+)?)?split\b/gi,
        // "mod_sites should be split into UniProt, amino acid and position"
        /\b([A-Za-z][\w.\-]{1,60})\s+columns?\s+(?:should\s+(?:be\s+)?)?split\b/gi,
        /\b([A-Za-z][\w.\-]{1,60})\b[^.!?\n]{0,40}?\bshould\s+(?:be\s+)?split\s+into\b/gi,
        // quoted column near split
        /\bcolumns?\s+["']([^"']{2,80})["'][^.!?\n]{0,120}?\b(?:split|parse)\b/gi,
        /\bsplit\b[^.!?\n]{0,60}?\bcolumns?\s+["']([^"']{2,80})["']/gi,
        /\bsplit\b[^.!?\n]{0,40}?["']([^"']{2,80})["']/gi,
        // unquoted: use feature_names … split
        /\b(?:use\s+)?([A-Za-z][\w.\-]{1,40})\b[^.!?\n]{0,80}?\b(?:should\s+be\s+)?split\b/gi,
    ];
    for (const cre of combinedRes) {
        cre.lastIndex = 0;
        while ((m = cre.exec(text))) {
            const col = (m[1] || "").trim();
            const rolePhrase = (m[2] || "").trim();
            if (!isPlausibleColumnName(col))
                continue;
            // If a role phrase is present, only treat as combined when it looks like one
            // (or when the pattern had no role group — pure split instructions).
            if (rolePhrase && !looksLikeCombinedSiteRole(rolePhrase) && !/\bsplit\b/i.test(text)) {
                continue;
            }
            out.siteCombinedCol = col;
            break;
        }
        if (out.siteCombinedCol)
            break;
    }
    if (!out.siteCombinedCol &&
        /split|site[- ]level|amino\s*acids?.*position|position.*amino|uniprot.*(?:amino|position)/i.test(text)) {
        const named = text.match(/["']([^"']*(?:phosphosite|protein\s*\+\s*phosphosite|gene\s*\+\s*site|modification\s*sites?|mod[_\s-]?sites?|feature[_\s-]?names?)[^"']*)["']/i);
        if (named?.[1] && isPlausibleColumnName(named[1])) {
            out.siteCombinedCol = named[1].trim();
        }
    }
    // 2) Explicit single-role mappings: "column AA is Amino acid"
    const re = /(?:\bcolumns?\s+)["']?([A-Za-z][\w.\-+ ]{0,60}?)["']?\s*(?:is|are|=|means?|等于|是)\s*(?:the\s+|an?\s+)?["']?(amino\s*acids?|residue(?:\s*types?)?|positions?|sites?|uniprot(?:\s*ids?)?|protein\s*ids?|accessions?|gene(?:\s*names?)?|氨基酸|位点|残基(?:类型)?|位置)["']?/gi;
    while ((m = re.exec(text))) {
        const col = (m[1] || "").trim();
        const role = roleKeyFromText(m[2] || "");
        if (!role)
            continue;
        // Don't let "column mod_sites is UniProt…" become uniprotCol — combined already handled.
        if (role === "siteCombinedCol" || (out.siteCombinedCol && col === out.siteCombinedCol)) {
            if (role === "siteCombinedCol")
                assignRole(out, "siteCombinedCol", col);
            continue;
        }
        if (out.siteCombinedCol && looksLikeCombinedSiteRole(m[2] || ""))
            continue;
        assignRole(out, role, col);
    }
    // "<name> column is <role>" (column name before the word "column")
    const nameBeforeColRe = /\b([A-Za-z][\w.\-]{1,60})\s+columns?\s*(?:is|are|=|means?|等于|是)\s*(?:the\s+|an?\s+)?["']?(amino\s*acids?|residue(?:\s*types?)?|positions?|sites?|uniprot(?:\s*ids?)?|protein\s*ids?|accessions?|gene(?:\s*names?)?|氨基酸|位点|残基(?:类型)?|位置)["']?/gi;
    while ((m = nameBeforeColRe.exec(text))) {
        const col = (m[1] || "").trim();
        const rolePhrase = m[2] || "";
        const role = roleKeyFromText(rolePhrase);
        if (!role)
            continue;
        if (looksLikeCombinedSiteRole(rolePhrase)) {
            assignRole(out, "siteCombinedCol", col);
            continue;
        }
        if (out.siteCombinedCol && col === out.siteCombinedCol)
            continue;
        assignRole(out, role, col);
    }
    // Short headers without "column": "STY is the position", "AA = amino acid"
    const shortRe = /\b([A-Za-z][\w.\-]{0,24})\s*(?:is|are|=|means?|等于|是)\s*(?:the\s+|an?\s+)?["']?(amino\s*acids?|residue(?:\s*types?)?|positions?|sites?|uniprot(?:\s*ids?)?|protein\s*ids?|accessions?|gene(?:\s*names?)?|氨基酸|位点|残基(?:类型)?|位置)["']?/gi;
    while ((m = shortRe.exec(text))) {
        const col = (m[1] || "").trim();
        const role = roleKeyFromText(m[2] || "");
        if (!role || !isPlausibleColumnName(col))
            continue;
        if (out.siteCombinedCol && (col === out.siteCombinedCol || looksLikeCombinedSiteRole(m[2] || "")))
            continue;
        assignRole(out, role, col);
    }
    // "use feature_names as gene name_amino acid position"
    const useAsRe = /\buse\s+["']?([A-Za-z][\w.\-]{1,60})["']?\s+as\s+([^.!?\n,]{3,100}?)(?=,|\.|$|for\s+example|e\.g\.|should)/gi;
    while ((m = useAsRe.exec(text))) {
        const col = (m[1] || "").trim();
        const rolePhrase = (m[2] || "").trim();
        if (!isPlausibleColumnName(col))
            continue;
        const role = roleKeyFromText(rolePhrase);
        if (role === "siteCombinedCol" || looksLikeCombinedSiteRole(rolePhrase)) {
            out.siteCombinedCol = col;
        }
        else if (role) {
            assignRole(out, role, col);
        }
    }
    // If we identified a combined site column, drop conflicting singles that often
    // come from misreading "UniProt_Amino acid Position" as uniprot-only.
    if (out.siteCombinedCol) {
        for (const key of ["uniprotCol", "geneCol", "positionCol", "aminoAcidCol"]) {
            if (out[key] && (out[key] === out.siteCombinedCol || !isPlausibleColumnName(out[key]))) {
                delete out[key];
            }
            // Drop accidental captures like uniprotCol="column"
            if (out[key] && COLUMN_NAME_STOP.has(String(out[key]).toLowerCase())) {
                delete out[key];
            }
        }
    }
    return out;
}
/** User says a sheet holds site-level PTM rows (override proteome misclassification). */
export function noteWantsSiteLevelSheet(note) {
    const t = (note || "").toLowerCase();
    if (!t)
        return false;
    if (/\bptm\s+table\b/.test(t))
        return true;
    if (/not\s+proteome/.test(t))
        return true;
    if (/site[- ]level/.test(t))
        return true;
    if (/stores?\s+site/.test(t))
        return true;
    if (/split\s+(?:this\s+)?column/.test(t) && /(?:amino|acide|acid|position|phosphosite|site|uniprot)/i.test(t)) {
        return true;
    }
    if (/\bsplit\b/.test(t) && /(?:amino|acide|acid|position|feature[_\s-]?names?|mod[_\s-]?sites?|cic-|gene|uniprot)/i.test(t)) {
        return true;
    }
    if (/contains?\s+amino\s*acids?\s+and\s+position/.test(t))
        return true;
    if (/phosphosite|mod[_\s-]?sites?/.test(t) && /split|amino|acide|acid|position|uniprot/i.test(t)) {
        return true;
    }
    if (/use\s+\w+.+\bas\b.+(?:gene|amino|position)/i.test(t) && /split|amino|position/i.test(t)) {
        return true;
    }
    if (/feature[_\s-]?names?/.test(t) && /(?:gene|amino|position|split)/i.test(t))
        return true;
    if (/columns?\s+\w+.+(?:uniprot|gene).+(?:amino|position)/i.test(t))
        return true;
    if (/\w+\s+columns?\s+is\s+uniprot/i.test(t) && /(?:amino|acide|acid|position)/i.test(t))
        return true;
    return false;
}
/** Pull table filenames mentioned in a note / chat message. */
export function extractTableFilenamesFromText(text) {
    const out = [];
    const seen = new Set();
    const t = text || "";
    let m;
    const re = new RegExp(TABLE_NAME_RE.source, "gi");
    while ((m = re.exec(t))) {
        const name = m[1].trim();
        const key = name.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}
/**
 * Extract "file → SheetName" / "sheet Quantified" pairs from free-text guidance.
 * Returns Map<entryOrFile, sheetName>.
 */
export function extractSheetHintsFromText(text) {
    const out = new Map();
    const t = text || "";
    // filename → Sheet / filename -> Sheet / filename => Sheet
    const arrowRe = /([A-Za-z0-9][\w.\-]*(?:\([\w.\- ]+\))?[\w.\-]*\.(?:xlsx|xls|csv|tsv|txt))\s*(?:→|->|=>|—)\s*["']?([A-Za-z][\w .\-]{0,80}?)["']?(?=\s|$|[,;:]|to\s)/gi;
    let m;
    while ((m = arrowRe.exec(t))) {
        const file = m[1].trim();
        const sheet = m[2].trim().replace(/[.,;:]+$/, "");
        if (file && sheet)
            out.set(file, sheet);
    }
    // file#SheetName
    const hashRe = /([A-Za-z0-9][\w.\-]*(?:\([\w.\- ]+\))?[\w.\-]*\.(?:xlsx|xls|csv|tsv|txt))\s*#\s*([A-Za-z][\w .\-]{0,80})/gi;
    while ((m = hashRe.exec(t))) {
        const file = m[1].trim();
        const sheet = m[2].trim().replace(/[.,;:]+$/, "");
        if (file && sheet && !out.has(file))
            out.set(file, sheet);
    }
    // sheet "Quantified" / sheet=Quantified (applies to first/only file if one file named)
    const sheetRe = /\bsheets?\s*[=:]\s*["']?([A-Za-z][\w .\-]{0,80}?)["']?(?=\s|$|[,;])/gi;
    const genericSheets = [];
    while ((m = sheetRe.exec(t))) {
        genericSheets.push(m[1].trim().replace(/[.,;:]+$/, ""));
    }
    if (genericSheets.length === 1 && out.size === 0) {
        const files = extractTableFilenamesFromText(t);
        if (files.length === 1)
            out.set(files[0], genericSheets[0]);
    }
    return out;
}
/**
 * Resolve force-include ZIP entry paths from hint selections + filenames in note,
 * matched against available ZIP entry paths.
 */
export function resolveForceIncludePaths(hints, availableEntryPaths) {
    if (!availableEntryPaths.length)
        return [];
    const wanted = [];
    const seenWant = new Set();
    const pushWant = (w) => {
        const k = normalizeEntryKey(w);
        if (!k || seenWant.has(k))
            return;
        seenWant.add(k);
        wanted.push(w);
    };
    for (const s of hints?.selections || []) {
        if (s.entryPath)
            pushWant(s.entryPath);
    }
    for (const name of extractTableFilenamesFromText(hints?.note || "")) {
        pushWant(name);
    }
    if (!wanted.length)
        return [];
    const out = [];
    const seen = new Set();
    for (const w of wanted) {
        for (const actual of availableEntryPaths) {
            if (!entryPathMatches(w, actual))
                continue;
            const key = normalizeEntryKey(actual);
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(actual);
        }
    }
    return out;
}

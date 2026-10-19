export interface UserTableSelection {
    /** Path inside the supplementary ZIP (or bare filename for single-file uploads). */
    entryPath: string;
    /** Sheet name for Excel; omit / empty for csv/tsv. */
    sheetName?: string;
}
export interface UserTableHints {
    selections: UserTableSelection[];
    note?: string;
    /** Prefer joining / keeping protein-level Log2Ratio columns. */
    preferProteinLog2?: boolean;
    /** User-requested contrasts from intensity channels, e.g. log2(P5/P1). */
    derivedRatios?: Array<{
        numerator: string;
        denominator: string;
        isLog2: boolean;
        condition: string;
    }>;
    /** User-named columns for protein-level Log2Ratio / P value. */
    proteomeColumns?: {
        ratioCol?: string;
        pValueCol?: string;
    };
    updatedAt: string;
}
export declare function userHintsPath(pmid: string): string;
export declare function loadUserTableHints(pmid: string): UserTableHints | null;
export declare function saveUserTableHints(pmid: string, selections: UserTableSelection[], note?: string, preferProteinLog2?: boolean, derivedRatios?: UserTableHints["derivedRatios"], proteomeColumns?: UserTableHints["proteomeColumns"]): UserTableHints;
export declare function selectionKey(entryPath: string, sheetName?: string): string;
/** Normalize for fuzzy path / filename matching. */
export declare function normalizeEntryKey(path: string): string;
/** True when hint path equals, ends with, or shares basename with actual ZIP entry. */
export declare function entryPathMatches(hintPath: string, actualPath: string): boolean;
/** True if this sheet is explicitly selected (or file selected without sheet filter). */
export declare function isHintedSheet(hints: UserTableHints | null | undefined, entryPath: string, sheetName: string): boolean;
/** Detect protein-level Log2Ratio intent from free text. */
export declare function noteWantsProteinLog2(note: string | undefined | null): boolean;
/**
 * Sheet names the user says hold whole-proteome / protein-level ratios
 * (e.g. "'pro' contains only protein-level data", 'do not skip "pro"').
 */
export declare function extractProteomeSheetNames(note: string | undefined | null): string[];
/** User asks to treat each Excel sheet as a distinct Sample. */
export declare function noteWantsSheetAsSample(note: string | undefined | null): boolean;
export interface ColumnRoleHints {
    uniprotCol?: string;
    geneCol?: string;
    positionCol?: string;
    aminoAcidCol?: string;
    /** Combined gene/protein + site column to split (e.g. "Protein + Phosphosite"). */
    siteCombinedCol?: string;
    /** Long-format per-row contrast column (e.g. "condition"). */
    conditionCol?: string;
}
/**
 * Parse free-text column role hints, e.g.
 * "column AA is Amino acid", "STY is the position", "ProteinID = UniProt",
 * "mod_sites column is UniProt_Amino acid Position, should split this column".
 */
export declare function extractColumnRoleHints(text: string): ColumnRoleHints;
/** User says a sheet holds site-level PTM rows (override proteome misclassification). */
export declare function noteWantsSiteLevelSheet(note: string | undefined | null): boolean;
/** Pull table filenames mentioned in a note / chat message. */
export declare function extractTableFilenamesFromText(text: string): string[];
/**
 * Extract "file → SheetName" / "sheet Quantified" pairs from free-text guidance.
 * Returns Map<entryOrFile, sheetName>.
 */
export declare function extractSheetHintsFromText(text: string): Map<string, string>;
/**
 * Resolve force-include ZIP entry paths from hint selections + filenames in note,
 * matched against available ZIP entry paths.
 */
export declare function resolveForceIncludePaths(hints: UserTableHints | null | undefined, availableEntryPaths: string[]): string[];

/** Domain types for Stage 1 abstract screening */
export type ScreenDecision = "include" | "exclude" | "uncertain";
export interface AbstractRecord {
    pmid: string;
    title: string;
    abstract: string;
    sourceFile: string;
}
export interface ScreenResult {
    pmid: string;
    title: string;
    decision: ScreenDecision;
    confidence: number;
    ptmTypes: string[];
    organisms: string[];
    isQuantitativeMs: boolean;
    hasSiteLevelDataHint: boolean;
    quantificationMethods: string[];
    dataSourceHint: "supplementary" | "proteomexchange" | "main_text" | "unknown";
    reason: string;
    sourceFile: string;
    screenedAt: string;
    /** Set when decision was overridden by manual review */
    manualReviewedAt?: string;
}
export interface ScreenBatchItem {
    pmid: string;
    title: string;
    abstract: string;
}
export interface PipelineStats {
    totalAbstracts: number;
    uniquePmids: number;
    alreadyScreened: number;
    pending: number;
    include: number;
    exclude: number;
    uncertain: number;
    goldOverlapPending: number;
}
/** Stage 3 — literature_info row (aligned with files/qPTM3_109pmids.csv) */
export type MetaStatus = "ok" | "partial" | "error";
export type MetaTextSource = "xml" | "pdf" | "abstract" | "none";
export interface LiteratureInfoRow {
    pmid: string;
    title: string;
    sample: string;
    sampleType: string;
    organism: string;
    ptms: string;
    labelMethod: string;
    condition: string;
    detailCondition: string;
    /**
     * Per-condition focal sample map for Stage5 qratio.Sample.
     * Format: "CondA=>SampleX; CondB=>SampleY"
     */
    conditionSampleMap: string;
    enrichmentMethod: string;
    massSpectrometer: string;
    msDataSource: string;
    identifier: string;
    /** Extraction quality */
    status: MetaStatus;
    confidence: number;
    textSource: MetaTextSource;
    notes: string;
    extractedAt: string;
    error?: string;
}
/** Stage 5 — parse status per paper */
export type Stage5Status = "ok" | "partial" | "manual" | "unavailable" | "error" | "intensity";
export interface Stage5Result {
    pmid: string;
    title: string;
    status: Stage5Status;
    confidence: number;
    rowCount: number;
    /** Site qratio rows whose Log2Ratio(protein)/P were filled from proteome tables */
    proteomeRowCount?: number;
    sheetsUsed: string;
    proteomeSheetsUsed?: string;
    mappingSource: "heuristic" | "llm" | "none";
    notes: string;
    /** Table-derived conditions from ratio columns (Stage5 only; does not mutate Stage3) */
    conditionRefined?: string;
    parsedAt: string;
    error?: string;
}
/** Stage 6 — MS raw data download URL extraction */
export type Stage6Status = "ok" | "partial" | "skipped" | "error";
export type MsRepoKind = "PRIDE" | "iProX" | "jPOST" | "MassIVE" | "PDC" | "unknown";
export interface Stage6AccessionResult {
    accession: string;
    repo: MsRepoKind;
    status: Stage6Status;
    urlCount: number;
    rawUrlCount: number;
    sourceFile: string;
    urlsFile: string;
    organism: string;
    modification: string;
    notes: string;
    error?: string;
}
export interface Stage6Result {
    pmid: string;
    title: string;
    msDataSource: string;
    identifier: string;
    status: Stage6Status;
    accessionResults: Stage6AccessionResult[];
    totalUrls: number;
    totalRawUrls: number;
    extractedAt: string;
    error?: string;
}

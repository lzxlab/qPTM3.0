/**
 * Normalize Greek letters and common mojibake to ASCII for CSV exports (Excel-safe).
 */
const GREEK_TO_ASCII = [
    // GBK / LLM mojibake (already corrupted in source text)
    [/蔚/g, "e"], // ε misread as 蔚
    [/伪/g, "alpha"], // α misread as 伪
    [/尾/g, "beta"], // β misread as 尾
    // Greek letters — longer names before single-char replacements where relevant
    [/β/g, "beta"],
    [/α/g, "alpha"],
    [/γ/g, "gamma"],
    [/δ/g, "delta"],
    [/θ/g, "theta"],
    [/λ/g, "lambda"],
    [/π/g, "pi"],
    [/σ/g, "sigma"],
    [/φ/g, "phi"],
    [/ω/g, "omega"],
    [/μ/g, "u"],
    [/ɛ/g, "e"], // U+025B latin small epsilon
    [/ε/g, "e"],
    // Typographic punctuation
    [/‰/g, " per mille "],
    [/‒/g, "-"],
    [/–/g, "-"],
    [/—/g, "-"],
];
export function normalizeScientificAscii(text) {
    if (!text)
        return text;
    let out = text;
    for (const [pattern, replacement] of GREEK_TO_ASCII) {
        out = out.replace(pattern, replacement);
    }
    return out;
}
export function normalizeScientificAsciiRow(row) {
    return row.map(normalizeScientificAscii);
}

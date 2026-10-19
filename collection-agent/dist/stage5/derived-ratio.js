const LOG2_PAIR_RE = /log\s*2\s*\(\s*([A-Za-z0-9][\w.\-]*)\s*[\/÷]\s*([A-Za-z0-9][\w.\-]*)\s*\)/gi;
const BARE_PAIR_RE = /(?:^|[\s,;:]|count\s+)\(?\s*([A-Za-z0-9][\w.\-]*)\s*[\/÷]\s*([A-Za-z0-9][\w.\-]*)\s*\)?(?=\s|$|[,;])/gi;
/** Parse contrast formulas from Teach / chat guidance. */
export function parseDerivedRatioSpecs(note) {
    const t = (note || "").trim();
    if (!t)
        return [];
    const out = [];
    const seen = new Set();
    const push = (num, den, isLog2) => {
        const numerator = num.trim();
        const denominator = den.trim();
        if (!numerator || !denominator)
            return;
        if (numerator.toLowerCase() === denominator.toLowerCase())
            return;
        // Skip obvious non-channel tokens
        if (/^(log|ratio|fc|fold|sheet|use|file)$/i.test(numerator))
            return;
        if (/^(log|ratio|fc|fold|sheet|use|file)$/i.test(denominator))
            return;
        const condition = `${numerator}/${denominator}`;
        const key = condition.toLowerCase();
        if (seen.has(key))
            return;
        seen.add(key);
        out.push({ numerator, denominator, isLog2, condition });
    };
    let m;
    const logRe = new RegExp(LOG2_PAIR_RE.source, "gi");
    while ((m = logRe.exec(t))) {
        push(m[1], m[2], true);
    }
    // Bare A/B only when the note clearly asks for log2 / ratio computation
    const wantsCompute = /log\s*2|fold\s*change|\bratio\b|count\s+log|compute|calculate|extract\s+ptm/i.test(t);
    if (wantsCompute && out.length === 0) {
        const bareRe = new RegExp(BARE_PAIR_RE.source, "gi");
        while ((m = bareRe.exec(t))) {
            push(m[1], m[2], /log\s*2/i.test(t));
        }
    }
    return out;
}
function normKey(s) {
    return (s || "").toLowerCase().replace(/__\d+$/, "").replace(/[\s_\-]+/g, "").trim();
}
function channelKey(s) {
    return normKey(s);
}
/**
 * Score how well a header matches a bare channel label (P5, Day1, …).
 * Prefer site-level quantitation over protein-level when both exist.
 */
export function scoreChannelHeader(header, channel) {
    const h = (header || "").trim();
    const c = (channel || "").trim();
    if (!h || !c)
        return 0;
    const hn = normKey(h);
    const cn = channelKey(c);
    if (!cn)
        return 0;
    let s = 0;
    // Exact header == channel (or channel__2)
    if (hn === cn)
        s = 100;
    else if (hn.endsWith(cn) && (hn.length === cn.length || /[^a-z0-9]/.test(h.slice(0, -c.length).slice(-1) || " "))) {
        // "... P5" / "quantitation P5"
        s = 80;
    }
    else if (new RegExp(`(?:^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i").test(h)) {
        s = 70;
    }
    else {
        return 0;
    }
    const lower = h.toLowerCase();
    if (/protein\s*quant/.test(lower) && !/site|lactyl|phospho|acetyl|modif|normalized/.test(lower)) {
        s -= 40; // de-prioritize protein abundance for site ratios
    }
    if (/normalized/.test(lower) && /(site|lactyl|phospho|acetyl|modif)/.test(lower))
        s += 15;
    else if (/(site|lactyl|phospho|acetyl|modif).*(quant|abundance|intensity)|(quant|abundance|intensity).*(site|lactyl)/.test(lower)) {
        s += 12;
    }
    if (/\bintensity\b|\babundance\b|\bquantitation\b/.test(lower))
        s += 5;
    return s;
}
/** Pick best header for a channel label. */
export function resolveChannelColumn(headers, channel, opts) {
    let best = null;
    let bestScore = 0;
    for (const h of headers) {
        let s = scoreChannelHeader(h, channel);
        if (opts?.preferProtein) {
            if (/protein\s*quant/i.test(h))
                s += 30;
            else
                s -= 10;
        }
        if (s > bestScore) {
            bestScore = s;
            best = h;
        }
    }
    return bestScore >= 50 ? best : null;
}
export function buildDerivedIntensityContrasts(headers, specs) {
    const out = [];
    for (const spec of specs) {
        const numeratorCol = resolveChannelColumn(headers, spec.numerator);
        const denominatorCol = resolveChannelColumn(headers, spec.denominator);
        if (!numeratorCol || !denominatorCol)
            continue;
        if (numeratorCol === denominatorCol)
            continue;
        out.push({
            condition: spec.condition,
            numeratorCol,
            denominatorCol,
            isLog2: spec.isLog2,
            level: "peptide",
        });
    }
    return out;
}
/**
 * When user asks for log2(A/B) on an intensity-only sheet, attach derived contrasts
 * and clear intensityOnly so Stage5 can parse.
 */
export function applyDerivedRatiosToMapping(mapping, headers, specs) {
    if (!specs.length)
        return mapping;
    const contrasts = buildDerivedIntensityContrasts(headers, specs);
    if (!contrasts.length) {
        return {
            ...mapping,
            notes: mapping.notes
                ? `${mapping.notes}; derived_ratio_unresolved`
                : "derived_ratio_unresolved",
        };
    }
    const note = `derived_ratios=${contrasts.map((c) => c.condition).join("|")}`;
    return {
        ...mapping,
        intensityOnly: false,
        derivedContrasts: contrasts,
        // Keep ratioColumns empty — parse-rows drives from derivedContrasts
        ratioColumns: mapping.ratioColumns.filter((r) => r.valueType !== "intensity"),
        confidence: Math.max(mapping.confidence, 0.75),
        notes: mapping.notes ? `${mapping.notes}; ${note}` : note,
    };
}
/** log2(num/den) or num/den from linear intensities. */
export function derivedIntensityLog2Fc(numerator, denominator, isLog2) {
    if (!(numerator > 0) || !(denominator > 0))
        return null;
    const fc = numerator / denominator;
    if (!(fc > 0))
        return null;
    return isLog2 ? Math.log2(fc) : fc;
}

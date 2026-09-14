import { detectLang } from "./gate.js";
import {
  InvestigationMemory,
  extractPositionFromText,
  memoryPromptBlock,
  mergeEntities,
  parseEntities,
} from "../context/memory.js";
import { getLlm } from "../llm/client.js";
import type { AgentEvent } from "../sse.js";

export interface ClarificationOption {
  label: string;
  description?: string;
}

export interface ClarificationField {
  id: string;
  label: string;
  /** Short question under the field title. */
  prompt?: string;
  options: ClarificationOption[];
  allow_custom?: boolean;
  placeholder?: string;
}

export interface ClarificationPayload {
  needs_clarification: boolean;
  intro?: string;
  fields?: ClarificationField[];
  free_text?: { label: string; placeholder: string };
  submit_label?: string;
  skip_label?: string;
}

function opt(label: string, description = ""): ClarificationOption {
  return { label, description };
}

/** User wants to discover/rank sites — do not ask for a residue number. */
function isSiteDiscoveryIntent(message: string): boolean {
  return /哪些位点|哪些磷酸化位点|值得研究.{0,8}位点|位点.{0,8}值得研究|研究得[比多].{0,8}位点|位点.{0,8}研究得|热点位点|hotspots?|which sites|sites worth|worth studying|most[- ]studied sites|research(ed)? (a lot|most).{0,20}sites?/i.test(
    message,
  );
}

/** Question is about one specific residue (kinase/regulation/function of that site). */
function isSingleSiteMechanismIntent(message: string): boolean {
  if (isSiteDiscoveryIntent(message)) return false;
  return /哪个激酶|哪些上游激酶|上游激酶|激酶修饰|修饰了|该位点|这个位点|这个残基|which kinase|upstream kinase|phosphorylat/i.test(
    message,
  );
}

function hasGene(memory: InvestigationMemory): boolean {
  return Boolean(memory.gene || memory.uniprot_ac);
}

/** No protein identity and the question needs a specific site — empty-DB investigation is useless. */
export function cannotInvestigateSiteLevel(
  memory: Pick<InvestigationMemory, "gene" | "uniprot_ac">,
  message: string,
): boolean {
  return !memory.gene && !memory.uniprot_ac && isSingleSiteMechanismIntent(message);
}

function hasSite(memory: InvestigationMemory): boolean {
  return Boolean(memory.position);
}

function fallbackFreeText(lang: "zh" | "en"): { label: string; placeholder: string } {
  return lang === "zh"
    ? { label: "补充说明（可选）", placeholder: "物种/细胞系、比较条件、疾病背景等" }
    : { label: "Additional context (optional)", placeholder: "Organism/cell line, comparison, disease background…" };
}

function fallbackGeneClarification(lang: "zh" | "en"): ClarificationPayload {
  if (lang === "zh") {
    return {
      needs_clarification: true,
      intro: "需要先确定研究的蛋白，才能继续深度调研（可跳过）：",
      fields: [
        {
          id: "gene",
          label: "请指定蛋白 / 基因",
          prompt: "可只填基因名，位点级问题也可写成「AKT1 S473」。",
          options: [
            opt("TP53", "肿瘤抑制蛋白，常用研究靶点"),
            opt("AKT1", "常见磷酸化研究靶点"),
            opt("EGFR", "受体酪氨酸激酶"),
          ],
          allow_custom: true,
          placeholder: "例如 AKT1 或 AKT1 S473",
        },
      ],
      free_text: fallbackFreeText("zh"),
      submit_label: "开始深度调研",
      skip_label: "跳过，直接调研",
    };
  }
  return {
    needs_clarification: true,
    intro: "Please specify the protein before deep research (optional — you can skip):",
    fields: [
      {
        id: "gene",
        label: "Which protein / gene?",
        prompt: "Gene name is enough; for a site-level question you can type “AKT1 S473”.",
        options: [
          opt("TP53", "Common tumor-suppressor research target"),
          opt("AKT1", "Common phosphorylation research target"),
          opt("EGFR", "Receptor tyrosine kinase"),
        ],
        allow_custom: true,
        placeholder: "e.g. AKT1 or AKT1 S473",
      },
    ],
    free_text: fallbackFreeText("en"),
    submit_label: "Start deep research",
    skip_label: "Skip and research",
  };
}

function fallbackSiteClarification(memory: InvestigationMemory, lang: "zh" | "en"): ClarificationPayload {
  const gene = memory.gene || "该蛋白";
  if (lang === "zh") {
    return {
      needs_clarification: true,
      intro: `「${gene}」的位点级问题需要先确定残基（可跳过）：`,
      fields: [
        {
          id: "site",
          label: "请指定修饰位点",
          prompt: "填写残基编号，例如 S473；物种不同位点可能不同。",
          options: [
            opt("我来指定残基", "在下方输入如 S473、S15"),
            opt("先按文献最常见位点调研", "不确定编号时可用"),
          ],
          allow_custom: true,
          placeholder: "例如 S473",
        },
      ],
      free_text: fallbackFreeText("zh"),
      submit_label: "开始深度调研",
      skip_label: "跳过，直接调研",
    };
  }
  return {
    needs_clarification: true,
    intro: `A site-level question about ${memory.gene || "this protein"} needs a residue (optional — you can skip):`,
    fields: [
      {
        id: "site",
        label: "Which modification site?",
        prompt: "Residue number such as S473; numbering can differ by species.",
        options: [
          opt("I’ll specify the residue", "Type e.g. S473 or S15 below"),
          opt("Use the most-studied site for now", "If you don’t know the number"),
        ],
        allow_custom: true,
        placeholder: "e.g. S473",
      },
    ],
    free_text: fallbackFreeText("en"),
    submit_label: "Start deep research",
    skip_label: "Skip and research",
  };
}

/** Existing four-dimension priority card — used when a residue is not required. */
function fallbackPriorityClarification(message: string, memory: InvestigationMemory): ClarificationPayload {
  const lang = detectLang(message);
  const target = [memory.gene, memory.position ? `S${memory.position}` : "", memory.ptm_type]
    .filter(Boolean)
    .join(" ")
    .trim();
  const subject = target || (lang === "zh" ? "该 PTM 问题" : "this PTM question");

  if (lang === "zh") {
    return {
      needs_clarification: true,
      intro: `在深入调研「${subject}」前，请先确认最关键的一点（可跳过）：`,
      fields: [
        {
          id: "priority",
          label: "本次优先弄清什么？",
          prompt: "选一项最贴近你当前目标的方向，或在下方手输。",
          options: [
            opt("上游如何调控", "激酶、酶或刺激如何修饰该位点"),
            opt("何时 / 何种条件变化", "定量动力学、处理条件与比较"),
            opt("功能与疾病意义", "功能后果、稳定性或疾病关联"),
            opt("文献机制", "已有机制链条与争议"),
          ],
          allow_custom: true,
          placeholder: "也可直接写你的目标…",
        },
      ],
      free_text: fallbackFreeText("zh"),
      submit_label: "开始深度调研",
      skip_label: "跳过，直接调研",
    };
  }

  return {
    needs_clarification: true,
    intro: `Before deep research on “${subject}”, confirm the main priority (optional — you can skip):`,
    fields: [
      {
        id: "priority",
        label: "What should we prioritize?",
        prompt: "Pick the closest goal, or type your own below.",
        options: [
          opt("Upstream regulation", "Kinases/enzymes/stimuli acting on the site"),
          opt("Conditions & dynamics", "Quantitative changes and experimental conditions"),
          opt("Function & disease", "Functional consequences, stability, disease links"),
          opt("Literature mechanisms", "Known mechanistic chains and debates"),
        ],
        allow_custom: true,
        placeholder: "Or type your goal…",
      },
    ],
    free_text: fallbackFreeText("en"),
    submit_label: "Start deep research",
    skip_label: "Skip and research",
  };
}

/**
 * Fallback when LLM clarification fails. Ask gene/site only if the question
 * needs a specific target that is missing — never treat missing position as
 * an automatic site question (site-discovery / protein-level must not ask residue).
 */
function fallbackClarification(message: string, memory: InvestigationMemory): ClarificationPayload {
  const lang = detectLang(message);
  if (!hasGene(memory)) {
    return fallbackGeneClarification(lang);
  }
  if (!hasSite(memory) && isSingleSiteMechanismIntent(message) && !isSiteDiscoveryIntent(message)) {
    return fallbackSiteClarification(memory, lang);
  }
  return fallbackPriorityClarification(message, memory);
}

function normalizeOption(raw: unknown): ClarificationOption | null {
  if (typeof raw === "string" && raw.trim()) return { label: raw.trim() };
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = String(o.label || o.value || "").trim();
  if (!label) return null;
  return {
    label,
    description: String(o.description || o.desc || "").trim() || undefined,
  };
}

/** Valid LLM payload, or null if JSON/fields were unusable (caller may retry). */
function normalizePayload(raw: unknown, message: string): ClarificationPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  if (data.needs_clarification === false) {
    return { needs_clarification: false };
  }

  const lang = detectLang(message);
  const fieldsIn = Array.isArray(data.fields) ? data.fields : [];
  const fields: ClarificationField[] = [];

  for (let i = 0; i < fieldsIn.length && fields.length < 3; i += 1) {
    const f = fieldsIn[i];
    if (!f || typeof f !== "object") continue;
    const fr = f as Record<string, unknown>;
    const options = (Array.isArray(fr.options) ? fr.options : [])
      .map(normalizeOption)
      .filter((x): x is ClarificationOption => Boolean(x))
      .slice(0, 6);
    if (options.length < 2) continue;
    const id = String(fr.id || `q${fields.length + 1}`).replace(/[^\w-]/g, "_").slice(0, 40) || `q${fields.length + 1}`;
    fields.push({
      id,
      label: String(fr.label || (lang === "zh" ? `问题 ${fields.length + 1}` : `Question ${fields.length + 1}`)).slice(0, 80),
      prompt: String(fr.prompt || fr.question || "").slice(0, 200) || undefined,
      options,
      allow_custom: fr.allow_custom !== false,
      placeholder: String(fr.placeholder || (lang === "zh" ? "其他：直接输入…" : "Other: type here…")).slice(0, 160),
    });
  }

  if (!fields.length) return null;

  const free = (data.free_text && typeof data.free_text === "object"
    ? (data.free_text as Record<string, unknown>)
    : null);

  return {
    needs_clarification: true,
    intro: String(
      data.intro ||
        (lang === "zh"
          ? "开始深度调研前，我想先确认以下几点（均可跳过）："
          : "Before deep research, I’d like to confirm a few points (all optional):"),
    ).slice(0, 300),
    fields,
    free_text: {
      label: String(free?.label || (lang === "zh" ? "补充说明（可选）" : "Additional context (optional)")).slice(0, 80),
      placeholder: String(
        free?.placeholder ||
          (lang === "zh"
            ? "物种/细胞系、比较条件、疾病背景等"
            : "Organism/cell line, comparison, disease background…"),
      ).slice(0, 160),
    },
    submit_label: String(data.submit_label || (lang === "zh" ? "开始深度调研" : "Start deep research")).slice(0, 40),
    skip_label: String(data.skip_label || (lang === "zh" ? "跳过，直接调研" : "Skip and research")).slice(0, 40),
  };
}

export interface ClarifyRoundOpts {
  /** Completed clarification rounds so far (0 = first ask). */
  round?: number;
  maxRounds?: number;
}

const CLARIFY_MAX_ATTEMPTS = 3;

function clarificationSystemPrompt(lang: "zh" | "en", round: number, maxRounds: number): string {
  const copyLang =
    lang === "zh"
      ? "Write all user-visible copy (intro, labels, prompts, option labels, placeholders, submit/skip) in Chinese."
      : "Write all user-visible copy (intro, labels, prompts, option labels, placeholders, submit/skip) in English.";
  return `You are the qPTM deep-research assistant. Decide from the user's intent whether clarification is needed and what to ask.
Rules:
1. Multi-round clarification is allowed. Completed ${round}/${maxRounds} rounds. Ask ONLY what is still ambiguous and material; do not re-ask answered points.
2. Judge intent — do NOT require gene AND residue as a hard gate:
   - Site-level: one residue (kinase/conditions/function), e.g. "which kinase modifies this", "AKT1 upstream kinases". If the target is unspecified: ask id=gene if the protein is missing, id=site if the residue is missing; do not ask research-dimension priorities this round.
   - Site-discovery / protein-level: which sites, hotspots, sites worth studying (e.g. "which TP53 sites are worth studying"). Even without a position, do NOT ask for a residue; ask a research priority or return needs_clarification=false.
   - Ask gene only when the protein is unspecified and the question is clearly about a protein.
3. Examples:
   - "which kinase modified it" → ask protein+site
   - "AKT1 upstream kinases" → ask residue
   - "which TP53 sites are worth studying" → do not ask residue
   - "AKT1 S473 tumor regulation" → priority or needs_clarification=false
4. No WHO/WHEN/WHERE/WHY template; 1–3 fields, 2–5 tailored options each.
5. If information is sufficient, return needs_clarification=false. Do not invent questions.
6. Field ids snake_case. Output JSON only.
7. ${copyLang}

JSON schema:
{
  "needs_clarification": true|false,
  "intro": "...",
  "fields": [{"id":"gene|site|priority","label":"...","prompt":"...","options":[{"label":"...","description":"..."}],"allow_custom":true,"placeholder":"..."}],
  "free_text": {"label":"...","placeholder":"..."},
  "submit_label": "Start deep research",
  "skip_label": "Skip and research"
}`;
}

function clarificationRetryHint(): string {
  return `Previous output was invalid or empty fields. Output valid JSON only.
Ask only what the user question still needs: gene if the protein is unspecified;
a residue only if the question is about one specific site.
Never ask for a residue when the user wants to find/rank sites.`;
}

/**
 * Agent-generated clarification: judge what is still ambiguous,
 * then propose 1–3 targeted questions — may run across multiple rounds.
 */
export async function buildDeepResearchClarification(
  message: string,
  memory?: InvestigationMemory,
  roundOpts: ClarifyRoundOpts = {},
): Promise<ClarificationPayload> {
  const mem = memory || ({ ...parseEntities(message) } as InvestigationMemory);
  const lang = detectLang(message);
  const round = roundOpts.round ?? 0;
  const maxRounds = roundOpts.maxRounds ?? 4;
  const system = clarificationSystemPrompt(lang, round, maxRounds);
  const user = [
    `User question / accumulated context:\n${message}`,
    memoryPromptBlock(mem),
    `Parsed entities: gene=${mem.gene || ""} position=${mem.position || ""} ptm=${mem.ptm_type || ""} organism=${mem.organism || ""}`,
    `Decide from the user question whether a specific residue is required.`,
    `Do not ask for a site if the user wants to discover or rank sites on a gene.`,
    `Clarification round: ${round} (0=first ask). Max rounds: ${maxRounds}.`,
  ].join("\n");

  const llm = getLlm();
  for (let attempt = 1; attempt <= CLARIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const userContent =
        attempt === 1 ? user : `${user}\n\n${clarificationRetryHint()}`;
      const { content } = await llm.chatCompletion(
        [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        { maxTokens: 1200, temperature: 0.2 },
      );
      const text = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(text) as unknown;
      const payload = normalizePayload(parsed, message);
      if (payload) return payload;
    } catch {
      /* retry */
    }
  }

  if (round > 0) return { needs_clarification: false };
  return fallbackClarification(message, mem);
}

export function mergeClarification(
  original: string,
  selections: Record<string, string>,
  freeText: string,
): string {
  const parts = [original];
  for (const [k, v] of Object.entries(selections)) {
    if (!v) continue;
    parts.push(`${k}: ${v}`);
  }
  if (freeText.trim()) parts.push(freeText.trim());
  return parts.join("\n");
}

/** Fold clarification choices into memory (site labels, organism, etc.). */
export function applyClarificationToMemory(
  memory: InvestigationMemory,
  selections: Record<string, string>,
  freeText: string,
): void {
  const texts = [...Object.values(selections), freeText].filter(Boolean);
  for (const t of texts) {
    mergeEntities(memory, parseEntities(t), t);
    const pos = extractPositionFromText(t);
    if (pos && !memory.position) memory.position = pos;
    if (/小鼠|mouse/i.test(t)) memory.organism = "mouse";
    if (/人源|人类|human/i.test(t) && memory.organism !== "mouse") memory.organism = "human";
  }
}

export function clarificationEvent(payload: ClarificationPayload): AgentEvent {
  return { type: "clarification_request", ...payload };
}

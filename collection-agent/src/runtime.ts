import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ModelRuntime } from "@earendil-works/pi-coding-agent"
import { getModel } from "@earendil-works/pi-ai/compat"
import type { Model } from "@earendil-works/pi-ai"
import { projectRoot } from "./utils/io.js"

export interface LlmRuntime {
  cwd: string
  agentDir: string
  modelRuntime: ModelRuntime
  model: Model<any>
  /** Resolved models in preference order (primary first). */
  models: Model<any>[]
  modelId: string
}

/** Known bare model ids → provider when MODEL has no "provider/" prefix */
const BARE_MODEL_PROVIDER: Record<string, string> = {
  "deepseek-flash": "opencode-go",
  "deepseek-v4-flash": "opencode-go",
  "deepseek-v4-pro": "opencode-go",
  "deepseek-chat": "deepseek",
  "deepseek-reasoner": "deepseek",
  "glm-5.2": "opencode-go",
  "gpt-5": "opencode",
  "gemini-3.6-flash": "opencode",
  "gemini-3.5-flash": "opencode",
  "kimi-k3": "opencode-go",
  "claude-sonnet-5": "opencode",
  "qwen3.7-max": "opencode-go",
  "qwen3.6-plus": "opencode-go",
  "qwen3.7-plus": "opencode-go",
}

/** Models available on OpenCode Go that share the same id as DeepSeek official */
const OPENCODE_GO_DEEPSEEK_IDS = new Set(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"])

const DEFAULT_FALLBACKS = [
  "opencode-go/deepseek-v4-flash",
  "opencode-go/glm-5.2",
  "opencode-go/deepseek-v4-pro",
]

const BLOCKED_MODELS = new Set([
  "qwen3.7-max",
  "opencode-go/qwen3.7-max",
  "opencode/qwen3.7-max",
])

export function loadDotEnv(cwd: string = projectRoot()): void {
  const envPath = join(cwd, ".env")
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq < 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

/** Parse "opencode-go/deepseek-v4-flash" or bare "deepseek-v4-flash" */
export function parseModelId(modelId: string): { provider: string; modelName: string } {
  const trimmed = modelId.trim()
  if (trimmed.includes("/")) {
    const [provider, ...rest] = trimmed.split("/")
    return { provider, modelName: rest.join("/") }
  }
  if (BARE_MODEL_PROVIDER[trimmed]) {
    return { provider: BARE_MODEL_PROVIDER[trimmed], modelName: trimmed }
  }
  if (trimmed.startsWith("deepseek-")) {
    return { provider: "deepseek", modelName: trimmed }
  }
  // Legacy default: bare ids without slash were treated as Anthropic
  return { provider: "anthropic", modelName: trimmed }
}

/**
 * True when we should avoid re-fetching provider model catalogs over the network.
 * If a local models-store.json cache already exists (the normal case for deployed
 * agents), ModelRuntime.create is told to refresh from the cache only. This guards
 * against ModelRuntime.create hanging forever when pi.dev is unreachable: its
 * internal 15s AbortSignal does not cancel the underlying catalog fetch.
 */
function shouldUseOfflineModelCatalog(cwd: string): boolean {
  if (process.env.PI_OFFLINE !== undefined) return true
  try {
    const storePath = join(cwd, ".pi", "agent", "models-store.json")
    if (!existsSync(storePath)) return false
    const raw = readFileSync(storePath, "utf8")
    const store = JSON.parse(raw) as Record<string, { models?: unknown[] }>
    return Object.values(store).some((v) => Array.isArray(v?.models) && v.models.length > 0)
  } catch {
    return false
  }
}

/**
 * Prefer OpenCode Go when:
 * - MODEL already says opencode-go/…, or
 * - OPENCODE_API_KEY is set and DEEPSEEK_API_KEY is not (for DeepSeek V4 ids)
 */
export function resolveModelId(rawModelId: string): string {
  const { provider, modelName } = parseModelId(rawModelId)
  if (provider === "opencode-go" || provider === "opencode") {
    return `${provider}/${modelName}`
  }
  const hasOpenCode = Boolean(process.env.OPENCODE_API_KEY?.trim())
  const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  if (
    hasOpenCode &&
    !hasDeepseek &&
    provider === "deepseek" &&
    OPENCODE_GO_DEEPSEEK_IDS.has(modelName)
  ) {
    return `opencode-go/${modelName}`
  }
  if (BARE_MODEL_PROVIDER[modelName] && !rawModelId.includes("/")) {
    return `${BARE_MODEL_PROVIDER[modelName]}/${modelName}`
  }
  return `${provider}/${modelName}`
}

function parseFallbackList(raw: string | undefined): string[] {
  const src = !raw?.trim() ? [...DEFAULT_FALLBACKS] : raw.split(",").map((s) => s.trim()).filter(Boolean)
  return src.filter((id) => {
    const bare = id.includes("/") ? id.split("/").pop() || id : id
    return !BLOCKED_MODELS.has(id) && !BLOCKED_MODELS.has(bare)
  })
}

/** Primary MODEL plus MODEL_FALLBACKS (deduped, resolved). */
export function modelCandidateIds(primaryRaw?: string): string[] {
  const primary =
    primaryRaw?.trim() ||
    process.env.MODEL?.trim() ||
    "opencode-go/deepseek-flash"
  const fallbacks = parseFallbackList(process.env.MODEL_FALLBACKS)
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [primary, ...fallbacks]) {
    const id = resolveModelId(raw)
    const bare = id.includes("/") ? id.split("/").pop() || id : id
    if (BLOCKED_MODELS.has(id) || BLOCKED_MODELS.has(bare)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function hasAnyApiKey(): boolean {
  return Boolean(
    process.env.OPENCODE_API_KEY?.trim() ||
      process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim(),
  )
}

function hasProviderApiKey(provider: string): boolean {
  switch (provider) {
    case "opencode-go":
    case "opencode":
      return Boolean(process.env.OPENCODE_API_KEY?.trim())
    case "deepseek":
      return Boolean(process.env.DEEPSEEK_API_KEY?.trim())
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY?.trim())
    case "google":
      return Boolean(process.env.GOOGLE_API_KEY?.trim())
    default:
      return hasAnyApiKey()
  }
}

function lookupModel(
  modelRuntime: ModelRuntime,
  provider: string,
  modelName: string,
): Model<any> | undefined {
  let model = modelRuntime.getModel(provider, modelName)
  if (!model) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model = getModel(provider as any, modelName)
  }
  return model || undefined
}

export async function createLlmRuntime(options: {
  model?: string
  cwd?: string
} = {}): Promise<LlmRuntime> {
  const cwd = options.cwd ?? projectRoot()
  loadDotEnv(cwd)

  const agentDir = join(cwd, ".pi", "agent")
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })

  // Use the cached model catalog when one exists instead of re-fetching it from
  // pi.dev on every invocation (fetch there can hang indefinitely).
  if (shouldUseOfflineModelCatalog(cwd)) {
    process.env.PI_OFFLINE = "1"
  }

  const runtimeTimeoutMs =
    Number.parseInt(process.env.LLM_RUNTIME_TIMEOUT_MS ?? "90000", 10) || 90_000

  const init = (async (): Promise<LlmRuntime> => {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    })

    // OpenCode Go (OpenAI-compatible: https://opencode.ai/zen/go/v1)
    if (process.env.OPENCODE_API_KEY?.trim()) {
      await modelRuntime.setRuntimeApiKey("opencode-go", process.env.OPENCODE_API_KEY.trim())
      // Zen free/other models use provider id "opencode" with the same key
      await modelRuntime.setRuntimeApiKey("opencode", process.env.OPENCODE_API_KEY.trim())
    }
    if (process.env.DEEPSEEK_API_KEY?.trim()) {
      await modelRuntime.setRuntimeApiKey("deepseek", process.env.DEEPSEEK_API_KEY.trim())
    }
    if (process.env.ANTHROPIC_API_KEY) {
      await modelRuntime.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY)
    }
    if (process.env.OPENAI_API_KEY) {
      await modelRuntime.setRuntimeApiKey("openai", process.env.OPENAI_API_KEY)
    }
    if (process.env.GOOGLE_API_KEY) {
      await modelRuntime.setRuntimeApiKey("google", process.env.GOOGLE_API_KEY)
    }

    if (!hasAnyApiKey()) {
      throw new Error(
        "No LLM API key found. Set OPENCODE_API_KEY (OpenCode Go) or DEEPSEEK_API_KEY in .env — see .env.example.",
      )
    }

    const candidates = modelCandidateIds(options.model)
    const models: Model<any>[] = []
    const missing: string[] = []

    for (const candidate of candidates) {
      const { provider, modelName } = parseModelId(candidate)
      if (!hasProviderApiKey(provider)) {
        missing.push(`${candidate} (no ${provider} key)`)
        continue
      }
      const model = lookupModel(modelRuntime, provider, modelName)
      if (!model) {
        missing.push(`${candidate} (not in catalog)`)
        continue
      }
      models.push(model)
    }

    if (models.length === 0) {
      const available = await modelRuntime.getAvailable()
      const hint =
        available.length > 0
          ? available
              .slice(0, 12)
              .map((m) => `${m.provider}/${m.id}`)
              .join(", ")
          : "(none — set OPENCODE_API_KEY or another provider key in .env)"
      throw new Error(
        `No usable LLM models from candidates [${candidates.join(", ")}]. ` +
          `Skipped: ${missing.join("; ") || "n/a"}. Available: ${hint}`,
      )
    }

    if (missing.length > 0) {
      console.error(
        `  llm: using ${models.map((m) => `${m.provider}/${m.id}`).join(" → ")}; ` +
          `skipped ${missing.join("; ")}`,
      )
    }

    const primary = models[0]
    return {
      cwd,
      agentDir,
      modelRuntime,
      model: primary,
      models,
      modelId: `${primary.provider}/${primary.id}`,
    }
  })()

  // Hard safety net: ModelRuntime catalog refresh should never block a job forever.
  const timer = setTimeout(() => {
    // No-op: the pending init keeps running; we simply stop waiting for it.
  }, runtimeTimeoutMs)
  timer.unref()

  const runtime = await Promise.race([
    init,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `llm_runtime_init_timeout_${runtimeTimeoutMs}ms (provider catalog refresh unreachable; set PI_OFFLINE=1 to use the cached catalog)`,
            ),
          ),
        runtimeTimeoutMs,
      ),
    ),
  ])
  return runtime
}

type CompleteSimpleArgs = Parameters<ModelRuntime["completeSimple"]>

let defaultOpenCodeSession: string | undefined

function getOpenCodeSessionId(): string {
  const fromEnv = process.env.OPENCODE_SESSION?.trim()
  if (fromEnv) return fromEnv
  if (!defaultOpenCodeSession) defaultOpenCodeSession = randomUUID()
  return defaultOpenCodeSession
}

function openCodeRequestHeaders(model: Model<any>): Record<string, string> {
  if (model.provider !== "opencode-go" && model.provider !== "opencode") return {}
  return {
    "x-opencode-session": getOpenCodeSessionId(),
    "x-opencode-client": "pi",
  }
}

/**
 * Call completeSimple on the primary model, then fallbacks on failure.
 */
export async function completeSimpleWithFallback(
  runtime: LlmRuntime,
  context: CompleteSimpleArgs[1],
  options?: CompleteSimpleArgs[2],
): Promise<Awaited<ReturnType<ModelRuntime["completeSimple"]>>> {
  const callTimeoutMs =
    Number.parseInt(process.env.LLM_CALL_TIMEOUT_MS ?? "180000", 10) || 180_000

  const errors: string[] = []
  for (let i = 0; i < runtime.models.length; i++) {
    const model = runtime.models[i]
    const label = `${model.provider}/${model.id}`
    try {
      if (i > 0) {
        console.error(`  llm: falling back to ${label}`)
      }
      const sessionHeaders = openCodeRequestHeaders(model)
      const callOptions =
        Object.keys(sessionHeaders).length > 0
          ? { ...options, headers: { ...options?.headers, ...sessionHeaders } }
          : options
      const result = await Promise.race([
        runtime.modelRuntime.completeSimple(model, context, callOptions),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `llm_call_timeout_${callTimeoutMs}ms (model ${label} did not respond within ${callTimeoutMs / 1000}s)`,
                ),
              ),
            callTimeoutMs,
          ),
        ),
      ])
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${label}: ${msg}`)
      console.error(`  llm: ${label} failed (${msg})`)
    }
  }
  throw new Error(`All LLM models failed. ${errors.join(" | ")}`)
}

export function assistantText(message: {
  content: Array<{ type: string; text?: string }>
  errorMessage?: string
  stopReason?: string
}): string {
  if (message.errorMessage) {
    throw new Error(`LLM error (${message.stopReason}): ${message.errorMessage}`)
  }
  const parts = message.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
  const text = parts.join("\n").trim()
  if (!text) throw new Error("LLM returned empty text content")
  return text
}

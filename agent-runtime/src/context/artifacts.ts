export type ArtifactKind =
  | "literature_search"
  | "paper"
  | "db_result"
  | "web_search"
  | "plan"
  | "clarification";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  query: string;
  summary: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  pmids?: string[];
  rawRef?: string;
  createdAt: string;
}

export class ArtifactStore {
  private artifacts: Artifact[] = [];
  private counter = 0;

  add(
    kind: ArtifactKind,
    query: string,
    summary: string,
    extra: Partial<Artifact> = {},
  ): Artifact {
    this.counter += 1;
    const artifact: Artifact = {
      id: `a${this.counter}`,
      kind,
      query,
      summary: summary.slice(0, 2000),
      createdAt: new Date().toISOString(),
      ...extra,
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  list(): Artifact[] {
    return [...this.artifacts];
  }

  get(id: string): Artifact | undefined {
    return this.artifacts.find((a) => a.id === id);
  }

  findLiterature(): Artifact[] {
    return this.artifacts.filter((a) => a.kind === "literature_search" || a.kind === "paper");
  }

  findDbResults(): Artifact[] {
    return this.artifacts.filter((a) => a.kind === "db_result");
  }

    catalogForPrompt(max = 20, opts: { skipEmpty?: boolean } = {}): string {
    let items = this.artifacts.slice(-max);
    if (opts.skipEmpty) {
      items = items.filter((a) => !/\[empty_result\]/i.test(a.summary));
    }
    if (!items.length) return "(no artifacts yet)";
    return items
      .map(
        (a) =>
          `[${a.id}] ${a.kind}: ${a.query.slice(0, 120)} → ${a.summary.slice(0, 200)}${a.pmids?.length ? ` (PMIDs: ${a.pmids.slice(0, 5).join(",")})` : ""}`,
      )
      .join("\n");
  }

  load(list: Artifact[]): void {
    this.artifacts = Array.isArray(list) ? list.map((a) => ({ ...a })) : [];
    this.counter = this.artifacts.reduce((max, a) => {
      const n = Number(String(a.id || "").replace(/^a/i, ""));
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
  }

  toJSON(): Artifact[] {
    return this.list();
  }

  clear(): void {
    this.artifacts = [];
    this.counter = 0;
  }

  shouldSkipLiteratureSearch(message: string): boolean {
    const lower = message.toLowerCase();
    const refers =
      /这些文献|上述文献|刚才的文献|those papers|these papers|the papers above|summarize.*literature|文献讲了|上面.*文献/i.test(
        message,
      );
    if (!refers) return false;
    return this.findLiterature().length > 0;
  }

  getLiteratureContext(): string {
    const lit = this.findLiterature();
    if (!lit.length) return "";
    return lit
      .map((a) => `${a.query}\n${a.summary}`)
      .join("\n---\n")
      .slice(0, 12000);
  }
}

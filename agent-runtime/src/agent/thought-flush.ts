/** Coalesce reasoning tokens so Studio is not redrawn on every model token. */
export class ThoughtFlusher {
  private buf = "";
  private last = 0;

  constructor(
    private readonly minChars = 200,
    private readonly minMs = 200,
  ) {
    this.last = Date.now();
  }

  push(chunk: string): string | null {
    if (!chunk) return null;
    this.buf += chunk;
    const now = Date.now();
    if (this.buf.length >= this.minChars || now - this.last >= this.minMs) {
      return this.take(now);
    }
    return null;
  }

  flush(): string | null {
    if (!this.buf) return null;
    return this.take(Date.now());
  }

  private take(now: number): string {
    const out = this.buf;
    this.buf = "";
    this.last = now;
    return out;
  }
}

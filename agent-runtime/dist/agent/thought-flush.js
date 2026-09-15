/** Coalesce reasoning tokens so Studio is not redrawn on every model token. */
export class ThoughtFlusher {
    minChars;
    minMs;
    buf = "";
    last = 0;
    constructor(minChars = 200, minMs = 200) {
        this.minChars = minChars;
        this.minMs = minMs;
        this.last = Date.now();
    }
    push(chunk) {
        if (!chunk)
            return null;
        this.buf += chunk;
        const now = Date.now();
        if (this.buf.length >= this.minChars || now - this.last >= this.minMs) {
            return this.take(now);
        }
        return null;
    }
    flush() {
        if (!this.buf)
            return null;
        return this.take(Date.now());
    }
    take(now) {
        const out = this.buf;
        this.buf = "";
        this.last = now;
        return out;
    }
}

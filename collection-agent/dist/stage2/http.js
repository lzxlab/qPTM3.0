/** Small fetch helper with timeout + JSON/text */
export class HttpError extends Error {
    status;
    url;
    constructor(message, status, url) {
        super(message);
        this.status = status;
        this.url = url;
        this.name = "HttpError";
    }
}
export async function fetchText(url, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            redirect: "follow",
            headers: {
                "User-Agent": "qPTM-CollectionAgent/0.1 (literature mining; mailto:local)",
                Accept: opts.accept ?? "*/*",
                ...opts.headers,
            },
        });
        if (!res.ok)
            throw new HttpError(`HTTP ${res.status}`, res.status, url);
        return await res.text();
    }
    finally {
        clearTimeout(t);
    }
}
export async function fetchJson(url, opts = {}) {
    const text = await fetchText(url, {
        ...opts,
        accept: "application/json",
        headers: { Accept: "application/json", ...opts.headers },
    });
    return JSON.parse(text);
}
export async function fetchBinary(url, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            redirect: "follow",
            headers: {
                "User-Agent": "qPTM-CollectionAgent/0.1 (literature mining; mailto:local)",
                Accept: opts.accept ?? "*/*",
                ...opts.headers,
            },
        });
        if (!res.ok)
            throw new HttpError(`HTTP ${res.status}`, res.status, url);
        const ab = await res.arrayBuffer();
        return {
            buffer: Buffer.from(ab),
            contentType: res.headers.get("content-type"),
        };
    }
    finally {
        clearTimeout(t);
    }
}

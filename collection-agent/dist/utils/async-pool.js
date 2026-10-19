/** Bounded-concurrency map over an array (preserves result order). */
export async function mapPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function runner() {
        while (true) {
            const i = next++;
            if (i >= items.length)
                return;
            results[i] = await worker(items[i], i);
        }
    }
    const n = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: n }, () => runner()));
    return results;
}

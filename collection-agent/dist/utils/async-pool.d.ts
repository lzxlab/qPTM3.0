/** Bounded-concurrency map over an array (preserves result order). */
export declare function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>;

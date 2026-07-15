/**
 * ESM entry point for nope-redis.
 *
 * Thin static wrapper over the CommonJS implementation (index.js) so that
 * `import` and `require` consumers share the exact same singleton cache
 * state and background sweep service.
 */
import cjs from './index.js';

export const config = cjs.config;
export const setItem = cjs.setItem;
export const getItem = cjs.getItem;
export const deleteItem = cjs.deleteItem;
export const itemStats = cjs.itemStats;
export const setItems = cjs.setItems;
export const getItems = cjs.getItems;
export const deleteItems = cjs.deleteItems;
export const flushAll = cjs.flushAll;
export const stats = cjs.stats;
export const SERVICE_KILL = cjs.SERVICE_KILL;
export const SERVICE_START = cjs.SERVICE_START;

export default cjs;

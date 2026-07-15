/**
 * ESM consumer fixture — spawned as a child process by esm-cjs-interop.test.js.
 *
 * Verifies named imports, the default export, shared singleton state between
 * the two, and (by exiting without SERVICE_KILL) that the unref'd background
 * interval never keeps the process alive through the ESM entry point.
 */
import assert from 'node:assert';
import nopeRedis, { getItem, setItem, stats } from '../../index.mjs';

// Named import and default export must be the same functions (one singleton).
assert.strictEqual(setItem, nopeRedis.setItem, 'named/default setItem mismatch');
assert.strictEqual(getItem, nopeRedis.getItem, 'named/default getItem mismatch');

// Round-trip through named exports, read back through the default export.
assert.strictEqual(setItem('esm:key', { from: 'esm' }, 30), true, 'setItem failed');
assert.deepStrictEqual(nopeRedis.getItem('esm:key'), { from: 'esm' }, 'shared state broken');

const s = stats({ showKeys: true });
assert.ok(s.keys.includes('esm:key'), 'stats missing key');

console.log('ESM_OK');
// Intentionally NO SERVICE_KILL: the process must exit on its own (unref'd timer).

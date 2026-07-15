/**
 * CommonJS consumer fixture — spawned as a child process by esm-cjs-interop.test.js.
 * Verifies require() usage and clean process exit without SERVICE_KILL.
 */
const assert = require('node:assert');
const path = require('node:path');
const nopeRedis = require(path.resolve(__dirname, '..', '..', 'index.js'));

assert.strictEqual(nopeRedis.setItem('cjs:key', { from: 'cjs' }, 30), true, 'setItem failed');
assert.deepStrictEqual(nopeRedis.getItem('cjs:key'), { from: 'cjs' }, 'round-trip broken');

console.log('CJS_OK');
// Intentionally NO SERVICE_KILL: the process must exit on its own (unref'd timer).

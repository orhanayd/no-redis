const { execFile } = require('node:child_process');
const path = require('node:path');
const nopeRedis = require('../index');

const INDEX_PATH = path.resolve(__dirname, '..', 'index.js');

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Heap churn — the "millions of operations" scenarios.
 *
 * The heavy same-key churn runs in a child process with --expose-gc so the heap
 * measurement is exact regardless of how jest itself was launched.
 */
describe('Heap churn - sustained operation load', () => {
	test('1M set/get/overwrite ops over 1k fixed keys → bounded heap growth', (done) => {
		const script = [
			`const r = require(${JSON.stringify(INDEX_PATH)});`,
			'const KEYS = 1000;',
			'function payload(i) {',
			'	return { id: i, name: "user_" + i, tags: ["a", "b", "c"], meta: { ts: 1752537600000 + i, ok: i % 2 === 0 } };',
			'}',
			'for (let i = 0; i < KEYS; i++) r.setItem("c_" + i, payload(i), 3600);',
			'global.gc(); global.gc();',
			'const h0 = process.memoryUsage().heapUsed;',
			'let seed = 12345;',
			'function rand(n) { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; }',
			'for (let op = 0; op < 1000000; op++) {',
			'	const k = "c_" + rand(KEYS);',
			'	const r100 = rand(100);',
			'	if (r100 < 70) r.getItem(k);',
			'	else if (r100 < 90) r.setItem(k, payload(op), 3600);',
			'	else { r.deleteItem(k); r.setItem(k, payload(op), 3600); }',
			'}',
			'global.gc(); global.gc();',
			'const growth = process.memoryUsage().heapUsed - h0;',
			'console.log(JSON.stringify({ growthMB: growth / 1048576, total: r.stats().total }));',
			'r.SERVICE_KILL();',
		].join('\n');

		execFile(process.execPath, ['--expose-gc', '-e', script], { timeout: 120000 }, (err, stdout) => {
			try {
				expect(err).toBeNull();
				const result = JSON.parse(stdout.trim().split('\n').pop());
				expect(result.total).toBe(1000);
				// 1M ops over a fixed working set must not grow the heap materially.
				// 2.0.4 fails here: pending size-calculation timers pile up.
				expect(result.growthMB).toBeLessThan(50);
				done();
			} catch (e) {
				done(e);
			}
		});
	}, 130000);

	test('burst heap equals steady heap — no deferred-work pile-up after 300k sets', (done) => {
		const script = [
			`const r = require(${JSON.stringify(INDEX_PATH)});`,
			'function payload(i) {',
			'	return { id: i, name: "user_" + i, tags: ["a", "b", "c"] };',
			'}',
			'global.gc(); global.gc();',
			'const h0 = process.memoryUsage().heapUsed;',
			'for (let i = 0; i < 300000; i++) r.setItem("b_" + i, payload(i), 120);',
			'global.gc(); global.gc();',
			'const burst = process.memoryUsage().heapUsed - h0;',
			'setTimeout(() => {',
			'	global.gc(); global.gc();',
			'	const steady = process.memoryUsage().heapUsed - h0;',
			'	console.log(JSON.stringify({ burstMB: burst / 1048576, steadyMB: steady / 1048576 }));',
			'	r.SERVICE_KILL();',
			'}, 2000);',
		].join('\n');

		execFile(process.execPath, ['--expose-gc', '-e', script], { timeout: 120000 }, (err, stdout) => {
			try {
				expect(err).toBeNull();
				const result = JSON.parse(stdout.trim().split('\n').pop());
				// On 2.0.4 burst/steady is ~2x (measured 181MB vs 88MB) because pending
				// timer closures survive gc. Fixed engine: ratio ~1.
				expect(result.burstMB / result.steadyMB).toBeLessThan(1.25);
				done();
			} catch (e) {
				done(e);
			}
		});
	}, 130000);

	describe('in-process churn', () => {
		beforeEach(async () => {
			await nopeRedis.SERVICE_START();
			nopeRedis.flushAll();
			nopeRedis.config({ maxMemorySize: 500, evictionPolicy: 'lru' });
		});

		afterEach(async () => {
			nopeRedis.config({ maxMemorySize: 100 });
			nopeRedis.flushAll();
			await nopeRedis.SERVICE_KILL();
		});

		test('100k distinct short-TTL keys fully reclaimed right after expiry reads', async () => {
			const N = 100000;
			for (let i = 0; i < N; i++) {
				nopeRedis.setItem(`churn_${i}`, { id: i, data: `payload_${i}` }, 1);
			}
			expect(nopeRedis.stats().total).toBe(N);

			await sleep(1150);

			for (let i = 0; i < N; i++) {
				nopeRedis.getItem(`churn_${i}`);
			}

			// Every read of an expired key freed it immediately
			expect(nopeRedis.stats().total).toBe(0);
			expect(nopeRedis.stats({ showSize: true }).size).toBe('0 MB');
		}, 60000);

		test('accounting returns to exactly zero after full random churn cleanup', () => {
			let seed = 424242;
			function rand(n) {
				seed = (seed * 1664525 + 1013904223) >>> 0;
				return seed % n;
			}
			const KEYS = 500;
			for (let op = 0; op < 100000; op++) {
				const k = `acct_${rand(KEYS)}`;
				const r = rand(10);
				if (r < 6) nopeRedis.setItem(k, { op, blob: 'x'.repeat(rand(500)) }, 3600);
				else if (r < 8) nopeRedis.deleteItem(k);
				else nopeRedis.getItem(k);
			}
			for (let i = 0; i < KEYS; i++) {
				nopeRedis.deleteItem(`acct_${i}`);
			}
			expect(nopeRedis.stats().total).toBe(0);
			// Integer-byte accounting must land on EXACTLY zero — any drift is a bug.
			expect(nopeRedis.stats({ showSize: true }).size).toBe('0 MB');
		}, 60000);
	});
});

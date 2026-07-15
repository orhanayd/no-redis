const nopeRedis = require('../index');

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Expired keys — eager delete on read + killer backstop
 *
 * 2.0.4 behavior: reading an expired key only queued it into expiredKeysPool and the
 * entry (value included) stayed in memory until the next killer cycle (up to 5s later,
 * capped at maxChecksPerCycle keys per cycle). Under high insert rates the killer could
 * never catch up. Now: an expired entry is removed the moment any read touches it.
 */
describe('Expired keys - eager delete on read', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
		nopeRedis.config({ maxMemorySize: 500, maxChecksPerCycle: 100000, evictionPolicy: 'lru' });
	});

	afterEach(async () => {
		nopeRedis.config({ maxMemorySize: 100, maxChecksPerCycle: 100000 });
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	test('getItem on expired key removes the entry immediately', async () => {
		nopeRedis.setItem('gone', { big: 'x'.repeat(1000) }, 1);
		expect(nopeRedis.stats().total).toBe(1);

		await sleep(1100);

		expect(nopeRedis.getItem('gone')).toBeNull();
		// Immediately gone — no waiting for the 5s killer cycle
		expect(nopeRedis.stats().total).toBe(0);
		expect(nopeRedis.stats({ showSize: true }).size).toBe('0 MB');
	}, 10000);

	test('getItems on expired keys removes them immediately', async () => {
		nopeRedis.setItem('exp1', 'v1', 1);
		nopeRedis.setItem('exp2', 'v2', 1);
		nopeRedis.setItem('alive', 'v3', 60);

		await sleep(1100);

		const results = nopeRedis.getItems(['exp1', 'exp2', 'alive']);
		expect(results.exp1).toBeNull();
		expect(results.exp2).toBeNull();
		expect(results.alive).toBe('v3');
		expect(nopeRedis.stats().total).toBe(1);
	}, 10000);

	test('itemStats on expired key removes the entry immediately', async () => {
		nopeRedis.setItem('stat-exp', 'v', 1);
		await sleep(1100);

		expect(nopeRedis.itemStats('stat-exp')).toBeNull();
		expect(nopeRedis.stats().total).toBe(0);
	}, 10000);

	test('memory accounting drops immediately on eager delete', async () => {
		nopeRedis.setItem('mem1', 'x'.repeat(100000), 1); // ~200KB
		nopeRedis.setItem('mem2', 'y'.repeat(100000), 1);
		const before = nopeRedis.stats({ showSize: true }).size;
		expect(before).not.toBe('0 MB');

		await sleep(1100);
		nopeRedis.getItem('mem1');
		nopeRedis.getItem('mem2');

		expect(nopeRedis.stats({ showSize: true }).size).toBe('0 MB');
	}, 10000);

	test('killer backstop still cleans never-read expired keys', async () => {
		for (let i = 0; i < 200; i++) {
			nopeRedis.setItem(`bk_${i}`, `v${i}`, 1);
		}
		expect(nopeRedis.stats().total).toBe(200);

		// No reads at all — only the background sweep (5s interval) may clean these.
		await sleep(6500);

		expect(nopeRedis.stats().total).toBe(0);
	}, 15000);

	test('sweep cursor advances across cycles — no starvation behind long-lived keys', async () => {
		// 2.0.4 regression: the killer restarted its scan from the front every cycle and
		// checked only maxChecksPerCycle keys, so expired keys sitting behind a wall of
		// long-lived keys were NEVER cleaned unless read. The rotating cursor fixes this.
		nopeRedis.config({ maxChecksPerCycle: 10 });

		for (let i = 0; i < 20; i++) {
			nopeRedis.setItem(`wall_${i}`, 'long-lived', 300);
		}
		for (let i = 0; i < 20; i++) {
			nopeRedis.setItem(`victim_${i}`, 'short-lived', 1);
		}
		expect(nopeRedis.stats().total).toBe(40);

		// Expired after ~1s. With 10 checks per 5s cycle the cursor needs 4 cycles
		// (40 keys / 10) to complete a full rotation: ~20s + scheduling margin.
		await sleep(22000);

		const stats = nopeRedis.stats();
		expect(stats.total).toBe(20); // only the long-lived wall remains
		for (let i = 0; i < 20; i++) {
			expect(stats.keys).toContain(`wall_${i}`);
		}
	}, 30000);
});

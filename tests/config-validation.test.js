const nopeRedis = require('../index');

/**
 * Config validation & API-contract pinning
 *
 * Guards the config/API hardening fixes:
 * - config() rejects non-finite numeric values (Infinity/NaN) that previously
 *   disabled eviction entirely or made the sweep scan the whole store in one
 *   synchronous cycle.
 * - config(null) is rejected cleanly instead of throwing internally.
 * - setItems() reports malformed elements per-item instead of discarding the
 *   whole batch result after some items were already written.
 * - itemStats()/deleteItem() validate key type like getItem()/setItem() do.
 * - Falsy stored values collide with the false/null sentinels — documented
 *   limitation, pinned here so a change is always deliberate.
 */
describe('Config validation & API contract', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
		nopeRedis.config({ defaultTtl: 30, maxMemorySize: 100, evictionPolicy: 'lru', maxChecksPerCycle: 100000 });
	});

	afterEach(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	describe('config() input validation', () => {
		test('rejects null without throwing and returns false', () => {
			expect(nopeRedis.config(null)).toBe(false);
		});

		test('ignores non-finite maxMemorySize (Infinity/NaN keep the previous limit)', () => {
			nopeRedis.config({ maxMemorySize: 50 });
			nopeRedis.config({ maxMemorySize: Number.POSITIVE_INFINITY });
			nopeRedis.config({ maxMemorySize: Number.NaN });
			const stats = nopeRedis.stats({ showKeys: false });
			expect(stats.maxMemorySize).toBe('50.00 MB');
		});

		test('ignores non-finite maxChecksPerCycle', () => {
			expect(nopeRedis.config({ maxChecksPerCycle: Number.POSITIVE_INFINITY })).toBe(true);
			// Still fully operational afterwards; the sweep stays bounded.
			nopeRedis.setItem('after-config', 1, 30);
			expect(nopeRedis.getItem('after-config')).toBe(1);
		});

		test('ignores non-finite defaultTtl', () => {
			nopeRedis.config({ defaultTtl: 45 });
			nopeRedis.config({ defaultTtl: Number.POSITIVE_INFINITY });
			expect(nopeRedis.stats({ showKeys: false }).defaultTtl).toBe(45);
		});

		test('valid values are still applied', () => {
			expect(nopeRedis.config({ maxMemorySize: 64, defaultTtl: 10, maxChecksPerCycle: 5000 })).toBe(true);
			const stats = nopeRedis.stats({ showKeys: false });
			expect(stats.maxMemorySize).toBe('64.00 MB');
			expect(stats.defaultTtl).toBe(10);
		});
	});

	describe('setItems() partial-failure semantics', () => {
		test('malformed elements yield false without discarding valid ones', () => {
			const results = nopeRedis.setItems([
				{ key: 'ok1', value: 1, ttl: 30 },
				null,
				{ key: 'ok2', value: 2, ttl: 30 },
				'not-an-object',
				{ key: 'ok3', value: 3, ttl: 30 },
			]);
			expect(results).toEqual([true, false, true, false, true]);
			expect(nopeRedis.getItem('ok1')).toBe(1);
			expect(nopeRedis.getItem('ok2')).toBe(2);
			expect(nopeRedis.getItem('ok3')).toBe(3);
		});

		test('all-valid batch still returns all true', () => {
			expect(
				nopeRedis.setItems([
					{ key: 'a', value: 'x' },
					{ key: 'b', value: 'y' },
				]),
			).toEqual([true, true]);
		});
	});

	describe('key-type validation consistency', () => {
		test('itemStats(non-string) returns false like getItem', () => {
			expect(nopeRedis.itemStats(123)).toBe(false);
			expect(nopeRedis.itemStats(null)).toBe(false);
			expect(nopeRedis.itemStats(undefined)).toBe(false);
		});

		test('deleteItem(non-string) returns false like setItem', () => {
			expect(nopeRedis.deleteItem(123)).toBe(false);
			expect(nopeRedis.deleteItem(null)).toBe(false);
			expect(nopeRedis.deleteItem({})).toBe(false);
		});

		test('string keys keep working for both', () => {
			nopeRedis.setItem('real', 'v', 30);
			expect(nopeRedis.itemStats('real')).toMatchObject({ hit: 0 });
			expect(nopeRedis.deleteItem('real')).toBe(true);
		});
	});

	describe('falsy value sentinels (documented limitation, pinned)', () => {
		test('stored false is indistinguishable from the service-stopped sentinel', () => {
			nopeRedis.setItem('bool', false, 30);
			expect(nopeRedis.getItem('bool')).toBe(false);
		});

		test('stored null is indistinguishable from missing/expired', () => {
			nopeRedis.setItem('nul', null, 30);
			expect(nopeRedis.getItem('nul')).toBeNull();
			expect(nopeRedis.getItem('never-set')).toBeNull();
		});

		test('0, empty string and NaN round-trip unambiguously', () => {
			nopeRedis.setItem('zero', 0, 30);
			nopeRedis.setItem('empty', '', 30);
			nopeRedis.setItem('nan', Number.NaN, 30);
			expect(nopeRedis.getItem('zero')).toBe(0);
			expect(nopeRedis.getItem('empty')).toBe('');
			expect(Number.isNaN(nopeRedis.getItem('nan'))).toBe(true);
		});

		test('getItems distinguishes stored false from missing (null)', () => {
			nopeRedis.setItem('bool', false, 30);
			const out = nopeRedis.getItems(['bool', 'missing']);
			expect(out.bool).toBe(false);
			expect(out.missing).toBeNull();
		});
	});

	describe('size-estimation lower bound', () => {
		test('huge flat array is not under-counted to ~32 bytes', () => {
			// 500k-element array exhausts the 2000-node scan budget immediately;
			// the estimator must extrapolate a sane minimum instead of ~0.
			const huge = new Array(500000).fill(7);
			nopeRedis.config({ maxMemorySize: 100 });
			expect(nopeRedis.setItem('huge', huge, 30)).toBe(true);
			const stats = nopeRedis.stats({ showKeys: false, showSize: true });
			// 500k numbers ≥ ~2MB real; anything below 1MB means the estimator collapsed.
			const size = stats.size;
			expect(size.endsWith(' MB') || size.endsWith(' GB')).toBe(true);
			if (size.endsWith(' MB')) {
				expect(Number.parseFloat(size)).toBeGreaterThan(1);
			}
		});
	});
});

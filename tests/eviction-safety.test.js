const nopeRedis = require('../index');

/**
 * Eviction Safety
 *
 * 2.0.4 bugs pinned here:
 * - evictKeys() used falsy checks (`if (lruKey)`), so an empty-string key at the LRU
 *   front blocked eviction forever and made config({maxMemorySize}) loop infinitely.
 * - Object sizes were estimated as a flat 100 bytes until an async correction ran,
 *   so the memory limit was not actually enforced under load.
 */
describe('Eviction Safety', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
		nopeRedis.config({ maxMemorySize: 100, evictionPolicy: 'lru' });
	});

	afterEach(async () => {
		nopeRedis.config({ maxMemorySize: 100, evictionPolicy: 'lru' });
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	test('config with tiny limit returns even when an empty-string key is at the LRU front', () => {
		// On 2.0.4 this test hangs forever (killed only by the jest timeout).
		nopeRedis.setItem('', 'x'.repeat(5000), 300);
		const ok = nopeRedis.config({ maxMemorySize: 0.0001 }); // 100 bytes
		expect(ok).toBe(true);
		// The oversized empty-string entry must have been evictable
		expect(nopeRedis.getItem('')).toBeNull();
	}, 5000);

	test.each(['lru', 'lfu', 'ttl'])(
		'empty-string key is evictable under set pressure with %s policy',
		(policy) => {
			nopeRedis.config({ maxMemorySize: 0.0005, evictionPolicy: policy }); // 512 bytes
			nopeRedis.setItem('', 'x'.repeat(100), 60);
			for (let i = 0; i < 20; i++) {
				nopeRedis.setItem(`pressure_${i}`, 'y'.repeat(200), 60);
			}
			const stats = nopeRedis.stats();
			expect(stats.evictionCount).toBeGreaterThan(0);
			expect(stats.total).toBeLessThan(21); // no unbounded growth, no eviction lockup
		},
		5000,
	);

	test('memory limit is actually enforced for object/buffer floods', () => {
		nopeRedis.config({ maxMemorySize: 10, evictionPolicy: 'lru' }); // 10 MB
		for (let i = 0; i < 1000; i++) {
			nopeRedis.setItem(`flood_${i}`, Buffer.alloc(50 * 1024), 600); // 1000 x 50KB = ~49MB offered
		}
		const stats = nopeRedis.stats({ showSize: true });
		expect(stats.evictionCount).toBeGreaterThan(0);
		// ~10MB / ~50KB => ~204 entries can fit; allow slack but prove boundedness
		expect(stats.total).toBeLessThanOrEqual(210);
		expect(stats.total).toBeGreaterThan(150);
	}, 30000);

	test('sized objects are accounted synchronously — limit holds without waiting', () => {
		nopeRedis.config({ maxMemorySize: 1, evictionPolicy: 'lru' }); // 1 MB
		// Each entry ~100KB of string data inside an object; 50 offered = ~5MB
		for (let i = 0; i < 50; i++) {
			nopeRedis.setItem(`obj_${i}`, { payload: 'z'.repeat(50 * 1024) }, 600);
		}
		const stats = nopeRedis.stats();
		// On 2.0.4 all 50 survive (each counted as ~100 bytes until async correction).
		expect(stats.total).toBeLessThanOrEqual(11);
		expect(stats.evictionCount).toBeGreaterThan(0);
	}, 10000);

	test('single item larger than the limit is still stored (documented behavior)', () => {
		nopeRedis.config({ maxMemorySize: 0.001 }); // 1KB
		expect(nopeRedis.setItem('huge', 'x'.repeat(10000), 60)).toBe(true);
		expect(nopeRedis.getItem('huge')).toBe('x'.repeat(10000));
		expect(nopeRedis.stats().total).toBe(1);
	}, 5000);

	test('lfu policy evicts the least frequently used candidate', () => {
		nopeRedis.config({ maxMemorySize: 0.002, evictionPolicy: 'lfu' }); // 2KB
		nopeRedis.setItem('cold', 'v1', 60);
		nopeRedis.setItem('hot', 'v2', 60);
		for (let i = 0; i < 5; i++) {
			nopeRedis.getItem('hot');
		}
		// Push enough data to force at least one eviction
		for (let i = 0; i < 10; i++) {
			nopeRedis.setItem(`filler_${i}`, 'f'.repeat(150), 60);
		}
		expect(nopeRedis.getItem('cold')).toBeNull();
	}, 5000);

	test('ttl policy evicts the soonest-expiring candidate', () => {
		nopeRedis.config({ maxMemorySize: 0.002, evictionPolicy: 'ttl' }); // 2KB
		nopeRedis.setItem('soon', 'v1', 5);
		nopeRedis.setItem('later', 'v2', 600);
		for (let i = 0; i < 10; i++) {
			nopeRedis.setItem(`filler_${i}`, 'f'.repeat(150), 120);
		}
		expect(nopeRedis.getItem('soon')).toBeNull();
	}, 5000);

	test('eviction storm completes in bounded time', () => {
		nopeRedis.config({ maxMemorySize: 2, evictionPolicy: 'lru' }); // 2MB
		const start = Date.now();
		for (let i = 0; i < 20000; i++) {
			nopeRedis.setItem(`storm_${i}`, 'x'.repeat(500), 600);
		}
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(5000);
		expect(nopeRedis.stats().evictionCount).toBeGreaterThan(0);
	}, 10000);
});

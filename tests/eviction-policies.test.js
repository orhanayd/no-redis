const nopeRedis = require('../index');

describe('Eviction Policies', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
	});

	afterEach(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	describe('Memory limit enforcement', () => {
		test('should evict keys when memory limit is exceeded', () => {
			// Set very small memory limit
			nopeRedis.config({
				maxMemorySize: 0.001, // 1KB in MB
				evictionPolicy: 'lru',
			});

			// Add multiple items that will exceed the limit
			const largeString = 'x'.repeat(100);

			for (let i = 0; i < 20; i++) {
				nopeRedis.setItem(`key${i}`, largeString);
			}

			const stats = nopeRedis.stats();
			expect(stats.evictionCount).toBeGreaterThan(0);
		});
	});

	describe('LRU eviction', () => {
		test('should evict least recently used keys', () => {
			nopeRedis.config({
				maxMemorySize: 0.001, // 1KB in MB
				evictionPolicy: 'lru',
			});

			// Set initial keys
			nopeRedis.setItem('old1', 'value1');
			nopeRedis.setItem('old2', 'value2');
			nopeRedis.setItem('old3', 'value3');

			// Access old2 to make it recently used
			nopeRedis.getItem('old2');

			// Add more items to trigger eviction
			const largeData = 'x'.repeat(200);
			for (let i = 0; i < 10; i++) {
				nopeRedis.setItem(`new${i}`, largeData);
			}

			const stats = nopeRedis.stats();
			expect(stats.evictionCount).toBeGreaterThan(0);

			// old1 should be evicted first (least recently used)
			const old1 = nopeRedis.getItem('old1');
			expect(old1).toBeNull();

			// old2 was accessed recently, so it should survive longer than old1
			// (though it may also be evicted if memory is very tight)
		});
	});

	describe('LFU eviction', () => {
		test('should evict least frequently used keys', () => {
			nopeRedis.config({
				maxMemorySize: 0.001, // 1KB in MB
				evictionPolicy: 'lfu',
			});

			// Set initial keys
			nopeRedis.setItem('freq1', 'value1');
			nopeRedis.setItem('freq2', 'value2');
			nopeRedis.setItem('freq3', 'value3');

			// Access freq2 multiple times
			nopeRedis.getItem('freq2');
			nopeRedis.getItem('freq2');
			nopeRedis.getItem('freq2');

			// Access freq3 once
			nopeRedis.getItem('freq3');

			// Add more items to trigger eviction
			const largeData = 'x'.repeat(200);
			for (let i = 0; i < 10; i++) {
				nopeRedis.setItem(`new${i}`, largeData);
			}

			const stats = nopeRedis.stats();
			expect(stats.evictionCount).toBeGreaterThan(0);

			// freq1 had 0 hits, so it should be evicted first
			const freq1 = nopeRedis.getItem('freq1');
			expect(freq1).toBeNull();
		});
	});

	describe('TTL eviction', () => {
		test('should evict keys with shortest TTL first', () => {
			nopeRedis.config({
				maxMemorySize: 0.001, // 1KB in MB
				evictionPolicy: 'ttl',
			});

			// Set keys with different TTLs
			nopeRedis.setItem('short', 'value1', 10);
			nopeRedis.setItem('medium', 'value2', 60);
			nopeRedis.setItem('long', 'value3', 300);

			// Add more items to trigger eviction
			const largeData = 'x'.repeat(200);
			for (let i = 0; i < 10; i++) {
				nopeRedis.setItem(`new${i}`, largeData, 120);
			}

			const stats = nopeRedis.stats();
			expect(stats.evictionCount).toBeGreaterThan(0);

			// 'short' had the shortest TTL, so it should be evicted first
			const short = nopeRedis.getItem('short');
			expect(short).toBeNull();
		});
	});

	describe('Eviction statistics', () => {
		test('should track eviction count correctly', () => {
			nopeRedis.config({
				maxMemorySize: 0.0005, // 0.5KB in MB
				evictionPolicy: 'lru',
			});

			const initialStats = nopeRedis.stats();
			const initialEvictionCount = initialStats.evictionCount;

			// Add items to trigger evictions
			const largeData = 'x'.repeat(100);
			for (let i = 0; i < 20; i++) {
				nopeRedis.setItem(`evict${i}`, largeData);
			}

			const finalStats = nopeRedis.stats();
			expect(finalStats.evictionCount).toBeGreaterThan(initialEvictionCount);
		});
	});

	describe('Memory size tracking', () => {
		test('should track current memory size', () => {
			const stats1 = nopeRedis.stats({ showSize: true });
			expect(stats1.size).toBeDefined();

			nopeRedis.setItem('test1', 'x'.repeat(100));
			nopeRedis.setItem('test2', 'y'.repeat(200));

			const stats2 = nopeRedis.stats({ showSize: true });
			expect(stats2.size).toBeDefined();

			// Flush should reset memory size
			nopeRedis.flushAll();
			const stats3 = nopeRedis.stats({ showSize: true });
			expect(stats3.size).toBe('0 MB');
		});
	});
});

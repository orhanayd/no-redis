const nopeRedis = require('../index');

describe('Performance Comparison: Sync vs Async Size Calculation', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
	});

	afterEach(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	test('performance with simple values', () => {
		const iterations = 50000;

		// Test with simple strings
		const stringStart = Date.now();
		for (let i = 0; i < iterations; i++) {
			nopeRedis.setItem(`str${i}`, `value${i}`);
		}
		const stringTime = Date.now() - stringStart;

		nopeRedis.flushAll();

		// Test with numbers
		const numberStart = Date.now();
		for (let i = 0; i < iterations; i++) {
			nopeRedis.setItem(`num${i}`, i * 1000);
		}
		const numberTime = Date.now() - numberStart;

		nopeRedis.flushAll();

		// Test with booleans
		const boolStart = Date.now();
		for (let i = 0; i < iterations; i++) {
			nopeRedis.setItem(`bool${i}`, i % 2 === 0);
		}
		const boolTime = Date.now() - boolStart;

		// Performance metrics (removed console.log for cleaner output)
		// Strings: ~${stringTime}ms (${Math.round((iterations / stringTime) * 1000)} ops/sec)
		// Numbers: ~${numberTime}ms (${Math.round((iterations / numberTime) * 1000)} ops/sec)
		// Booleans: ~${boolTime}ms (${Math.round((iterations / boolTime) * 1000)} ops/sec)

		// All should be extremely fast
		expect(stringTime).toBeLessThan(500);
		expect(numberTime).toBeLessThan(500);
		expect(boolTime).toBeLessThan(500);
	});

	test('performance with complex objects', () => {
		const iterations = 10000;

		// Complex objects with nested structures
		const complexStart = Date.now();
		for (let i = 0; i < iterations; i++) {
			const obj = {
				id: i,
				user: {
					name: `User ${i}`,
					email: `user${i}@example.com`,
					profile: {
						avatar: Buffer.alloc(100),
						bio: 'x'.repeat(200),
						settings: {
							theme: 'dark',
							notifications: true,
						},
					},
				},
				timestamps: {
					created: new Date(),
					updated: new Date(),
				},
				data: new Array(20).fill({ value: i }),
			};

			nopeRedis.setItem(`complex${i}`, obj);
		}
		const complexTime = Date.now() - complexStart;

		// Complex objects: ~${complexTime}ms (${Math.round((iterations / complexTime) * 1000)} ops/sec)

		// Should still be fast due to async size calculation
		expect(complexTime).toBeLessThan(1000);

		// Verify all items were stored
		const stats = nopeRedis.stats();
		expect(stats.total).toBe(iterations);
	});

	test('performance with mixed operations', () => {
		const iterations = 5000;
		const startTime = Date.now();

		// Mix of set and get operations
		for (let i = 0; i < iterations; i++) {
			// Set different types
			if (i % 4 === 0) {
				nopeRedis.setItem(`key${i}`, { complex: true, data: 'x'.repeat(100) });
			} else if (i % 4 === 1) {
				nopeRedis.setItem(`key${i}`, Buffer.alloc(50));
			} else if (i % 4 === 2) {
				nopeRedis.setItem(`key${i}`, `string${i}`);
			} else {
				nopeRedis.setItem(`key${i}`, i);
			}

			// Occasional reads
			if (i % 10 === 0 && i > 0) {
				nopeRedis.getItem(`key${i - 1}`);
			}
		}

		const mixedTime = Date.now() - startTime;
		expect(mixedTime).toBeLessThan(1000);
	});

	test('memory size accuracy after async calculations', (done) => {
		const items = [];
		const count = 100;

		// Add items with known sizes
		for (let i = 0; i < count; i++) {
			const item = {
				string: 'x'.repeat(100), // ~200 bytes
				buffer: Buffer.alloc(100), // 100 bytes
				number: 42, // 8 bytes
			};
			items.push(item);
			nopeRedis.setItem(`item${i}`, item);
		}

		// Initial memory size (quick estimates)
		nopeRedis.stats();

		// Wait for async calculations to complete
		setTimeout(() => {
			const finalStats = nopeRedis.stats({ showSize: true });

			// Memory size updates asynchronously
			// Items: ${finalStats.total}

			// Size should be updated and more accurate
			expect(finalStats.total).toBe(count);
			expect(finalStats.size).not.toBe('0 MB');

			done();
		}, 500);
	});

	test('eviction still works with async size calculation', () => {
		// Set very small memory limit
		nopeRedis.config({
			maxMemorySize: 0.01, // 10KB in MB
			evictionPolicy: 'lru',
		});

		// Add many items that will exceed limit
		for (let i = 0; i < 1000; i++) {
			nopeRedis.setItem(`evict${i}`, {
				data: 'x'.repeat(100),
				buffer: Buffer.alloc(50),
			});
		}

		const stats = nopeRedis.stats();

		// Should have evicted items
		expect(stats.evictionCount).toBeGreaterThan(0);
		expect(stats.total).toBeLessThan(1000);

		// Evicted ${stats.evictionCount} items, ${stats.total} remaining
	});
});

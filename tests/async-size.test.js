const nopeRedis = require('../index');

describe('Async Size Calculation Performance', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
	});

	afterEach(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	test('should handle setItem faster with async size calculation', () => {
		const startTime = Date.now();
		const iterations = 10000;

		// Complex objects that would take time to calculate size
		for (let i = 0; i < iterations; i++) {
			const complexObj = {
				id: i,
				nested: {
					deep: {
						value: 'x'.repeat(100),
						array: new Array(10).fill(i),
					},
				},
				buffer: Buffer.alloc(100),
				date: new Date(),
				map: new Map([['key', 'value']]),
			};

			const result = nopeRedis.setItem(`complex${i}`, complexObj);
			expect(result).toBe(true);
		}

		const setTime = Date.now() - startTime;
		// Async size calc: Set ${iterations} complex objects in ${setTime}ms

		// Should be very fast since size calculation is async
		expect(setTime).toBeLessThan(1000); // Less than 1 second for 10k complex objects
	});

	test('should maintain accurate memory size after async calculation', (done) => {
		const largeObj = {
			data: 'x'.repeat(1000),
			nested: {
				array: new Array(100).fill({ test: 'value' }),
			},
		};

		nopeRedis.setItem('large', largeObj);

		// Initial size should be quick estimate
		const _initialStats = nopeRedis.stats();

		// Wait for async size calculation
		setTimeout(() => {
			const finalStats = nopeRedis.stats({ showSize: true });

			// Size should be updated after async calculation
			expect(finalStats.size).toBeDefined();
			expect(finalStats.size).not.toBe('0 MB');

			done();
		}, 100);
	});

	test('should handle rapid succession with accurate size tracking', (done) => {
		const items = [];

		// Rapidly add items
		for (let i = 0; i < 100; i++) {
			const item = {
				id: i,
				data: Buffer.alloc(Math.floor(Math.random() * 1000)),
				text: 'x'.repeat(Math.floor(Math.random() * 500)),
			};
			items.push(item);
			nopeRedis.setItem(`item${i}`, item);
		}

		// Wait for all async calculations
		setTimeout(() => {
			const stats = nopeRedis.stats({ showSize: true });

			// All items should be stored
			expect(stats.total).toBe(100);

			// Memory size should be reasonable
			expect(stats.size).toBeDefined();

			// Verify items are retrievable
			for (let i = 0; i < 100; i++) {
				const retrieved = nopeRedis.getItem(`item${i}`);
				expect(retrieved).toBeDefined();
				expect(retrieved.id).toBe(i);
			}

			done();
		}, 200);
	});

	test('should handle updates with async size recalculation', (done) => {
		const initial = { small: 'data' };
		const large = {
			huge: 'x'.repeat(10000),
			buffer: Buffer.alloc(5000),
		};

		nopeRedis.setItem('key', initial);

		setTimeout(() => {
			// Update with larger object
			nopeRedis.setItem('key', large);

			setTimeout(() => {
				const retrieved = nopeRedis.getItem('key');
				expect(retrieved.huge.length).toBe(10000);
				expect(Buffer.isBuffer(retrieved.buffer)).toBe(true);

				done();
			}, 100);
		}, 50);
	});
});

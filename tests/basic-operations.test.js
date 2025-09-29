const nopeRedis = require('../index');

describe('Basic Operations', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
	});

	afterEach(() => {
		nopeRedis.flushAll();
	});

	afterAll(async () => {
		await nopeRedis.SERVICE_KILL();
	});

	describe('setItem and getItem', () => {
		test('should set and get a string value', () => {
			const result = nopeRedis.setItem('test-key', 'test-value');
			expect(result).toBe(true);

			const value = nopeRedis.getItem('test-key');
			expect(value).toBe('test-value');
		});

		test('should set and get an object value', () => {
			const obj = { name: 'test', value: 123 };
			const result = nopeRedis.setItem('obj-key', obj);
			expect(result).toBe(true);

			const value = nopeRedis.getItem('obj-key');
			expect(value).toEqual(obj);
		});

		test('should set and get array value', () => {
			const arr = [1, 2, 3, 'test'];
			const result = nopeRedis.setItem('arr-key', arr);
			expect(result).toBe(true);

			const value = nopeRedis.getItem('arr-key');
			expect(value).toEqual(arr);
		});

		test('should return false for non-string keys', () => {
			const result = nopeRedis.setItem(123, 'value');
			expect(result).toBe(false);

			const result2 = nopeRedis.setItem({}, 'value');
			expect(result2).toBe(false);
		});

		test('should return null for non-existent key', () => {
			const value = nopeRedis.getItem('non-existent');
			expect(value).toBe(null);
		});

		test('should overwrite existing key', () => {
			nopeRedis.setItem('key', 'value1');
			nopeRedis.setItem('key', 'value2');

			const value = nopeRedis.getItem('key');
			expect(value).toBe('value2');
		});

		test('should handle custom TTL', () => {
			nopeRedis.setItem('ttl-key', 'value', 1);

			const value1 = nopeRedis.getItem('ttl-key');
			expect(value1).toBe('value');

			// Wait for TTL to expire (1 second)
			return new Promise((resolve) => {
				setTimeout(() => {
					const value2 = nopeRedis.getItem('ttl-key');
					expect(value2).toBe(null);
					resolve();
				}, 1100); // 1 second + small buffer
			});
		});
	});

	describe('deleteItem', () => {
		test('should delete existing item', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();
			nopeRedis.setItem('delete-key', 'value');
			const result = nopeRedis.deleteItem('delete-key');
			expect(result).toBe(true);

			const value = nopeRedis.getItem('delete-key');
			expect(value).toBe(null);
		});

		test('should return true even for non-existent key', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();
			const result = nopeRedis.deleteItem('non-existent');
			expect(result).toBe(true);
		});
	});

	describe('itemStats', () => {
		test('should return stats for existing key', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();
			nopeRedis.setItem('stats-key', 'value', 10);
			const stats = nopeRedis.itemStats('stats-key');

			expect(stats).toHaveProperty('expires_at');
			expect(stats).toHaveProperty('remaining_seconds');
			expect(stats).toHaveProperty('hit');
			expect(stats.hit).toBe(0);
			expect(stats.remaining_seconds).toBeLessThanOrEqual(10);
		});

		test('should return null for non-existent key', () => {
			const stats = nopeRedis.itemStats('non-existent');
			expect(stats).toBe(null);
		});

		test('should increment hit counter', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();
			nopeRedis.setItem('hit-key', 'value');
			nopeRedis.getItem('hit-key');
			nopeRedis.getItem('hit-key');

			const stats = nopeRedis.itemStats('hit-key');
			expect(stats.hit).toBe(2);
		});
	});

	describe('flushAll', () => {
		test('should clear all items', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();
			nopeRedis.setItem('key1', 'value1');
			nopeRedis.setItem('key2', 'value2');
			nopeRedis.setItem('key3', 'value3');

			const result = nopeRedis.flushAll();
			expect(result).toBe(true);

			expect(nopeRedis.getItem('key1')).toBe(null);
			expect(nopeRedis.getItem('key2')).toBe(null);
			expect(nopeRedis.getItem('key3')).toBe(null);

			const stats = nopeRedis.stats();
			expect(stats.total).toBe(0);
		});
	});

	describe('stats', () => {
		test('should return correct statistics', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();
			nopeRedis.setItem('key1', 'value1');
			nopeRedis.setItem('key2', 'value2');

			const stats = nopeRedis.stats();

			expect(stats.status).toBe(true);
			expect(stats.total).toBe(2);
			expect(stats.keys).toContain('key1');
			expect(stats.keys).toContain('key2');
			expect(stats.defaultTtl).toBe(30);
			expect(stats).toHaveProperty('totalHits');
			expect(stats).toHaveProperty('evictionCount');
			expect(stats).toHaveProperty('evictionPolicy');
			// Size is not shown by default unless showSize:true or isMemoryStatsEnabled:true
			expect(stats).toHaveProperty('maxMemorySize');
		});

		test('should respect config options', () => {
			nopeRedis.setItem('key1', 'value1');

			const stats = nopeRedis.stats({
				showKeys: false,
				showTotal: false,
				showSize: true,
			});

			expect(stats.keys).toBeUndefined();
			expect(stats.total).toBeUndefined();
			expect(stats.size).toBeDefined();
		});
	});
});

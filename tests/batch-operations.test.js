const nopeRedis = require('../index');

describe('Batch Operations', () => {
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

	describe('setItems', () => {
		test('should set multiple items at once', () => {
			const items = [
				{ key: 'batch1', value: 'value1', ttl: 30 },
				{ key: 'batch2', value: 'value2', ttl: 60 },
				{ key: 'batch3', value: { test: true }, ttl: 90 },
			];

			const results = nopeRedis.setItems(items);
			expect(results).toEqual([true, true, true]);

			expect(nopeRedis.getItem('batch1')).toBe('value1');
			expect(nopeRedis.getItem('batch2')).toBe('value2');
			expect(nopeRedis.getItem('batch3')).toEqual({ test: true });
		});

		test('should handle invalid items in batch', () => {
			const items = [
				{ key: 'valid', value: 'value', ttl: 30 },
				{ key: 123, value: 'invalid key', ttl: 30 },
				{ key: 'valid2', value: 'value2', ttl: 30 },
			];

			const results = nopeRedis.setItems(items);
			expect(results).toEqual([true, false, true]);

			expect(nopeRedis.getItem('valid')).toBe('value');
			expect(nopeRedis.getItem('valid2')).toBe('value2');
		});

		test('should return false for non-array input', () => {
			const result = nopeRedis.setItems('not-an-array');
			expect(result).toBe(false);
		});
	});

	describe('getItems', () => {
		beforeEach(() => {
			nopeRedis.setItem('get1', 'value1');
			nopeRedis.setItem('get2', 'value2');
			nopeRedis.setItem('get3', { test: 'object' });
		});

		test('should get multiple items at once', () => {
			const results = nopeRedis.getItems(['get1', 'get2', 'get3']);

			expect(results).toEqual({
				get1: 'value1',
				get2: 'value2',
				get3: { test: 'object' },
			});
		});

		test('should return null for non-existent keys', () => {
			const results = nopeRedis.getItems(['get1', 'non-existent', 'get3']);

			expect(results).toEqual({
				get1: 'value1',
				'non-existent': null,
				get3: { test: 'object' },
			});
		});

		test('should handle expired keys', () => {
			nopeRedis.setItem('expired', 'value', 1);

			return new Promise((resolve) => {
				setTimeout(() => {
					const results = nopeRedis.getItems(['get1', 'expired']);
					expect(results).toEqual({
						get1: 'value1',
						expired: null,
					});
					resolve();
				}, 1100); // 1 second + small buffer
			});
		});

		test('should increment hit counters', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();

			// Set items first
			nopeRedis.setItem('get1', 'value1');
			nopeRedis.setItem('get2', 'value2');

			nopeRedis.getItems(['get1', 'get2']);
			nopeRedis.getItems(['get1']);

			const stats1 = nopeRedis.itemStats('get1');
			const stats2 = nopeRedis.itemStats('get2');

			expect(stats1.hit).toBe(2);
			expect(stats2.hit).toBe(1);
		});

		test('should return false for non-array input', () => {
			const result = nopeRedis.getItems('not-an-array');
			expect(result).toBe(false);
		});
	});

	describe('deleteItems', () => {
		beforeEach(async () => {
			await nopeRedis.SERVICE_START();
			nopeRedis.setItem('del1', 'value1');
			nopeRedis.setItem('del2', 'value2');
			nopeRedis.setItem('del3', 'value3');
		});

		test('should delete multiple items at once', async () => {
			await nopeRedis.SERVICE_START();
			const result = nopeRedis.deleteItems(['del1', 'del3']);
			expect(result).toBe(true);

			expect(nopeRedis.getItem('del1')).toBe(null);
			expect(nopeRedis.getItem('del2')).toBe('value2');
			expect(nopeRedis.getItem('del3')).toBe(null);
		});

		test('should handle non-existent keys gracefully', async () => {
			await nopeRedis.SERVICE_START();
			const result = nopeRedis.deleteItems(['del1', 'non-existent', 'del2']);
			expect(result).toBe(true);

			expect(nopeRedis.getItem('del1')).toBe(null);
			expect(nopeRedis.getItem('del2')).toBe(null);
		});

		test('should skip non-string keys', async () => {
			await nopeRedis.SERVICE_START();
			const result = nopeRedis.deleteItems(['del1', 123, 'del2', {}]);
			expect(result).toBe(true);

			expect(nopeRedis.getItem('del1')).toBe(null);
			expect(nopeRedis.getItem('del2')).toBe(null);
		});

		test('should return false for non-array input', () => {
			const result = nopeRedis.deleteItems('not-an-array');
			expect(result).toBe(false);
		});
	});
});

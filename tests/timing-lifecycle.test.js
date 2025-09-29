const nopeRedis = require('../index');

describe('Timing and Service Lifecycle Tests', () => {
	// Ensure service is killed after all tests
	afterAll(async () => {
		await nopeRedis.SERVICE_KILL();
	});

	describe('Service Lifecycle Management', () => {
		afterEach(async () => {
			// Always ensure service is killed after each test
			await nopeRedis.SERVICE_KILL();
			// Service stops immediately now, no wait needed
		});

		test('service auto-starts on module load', () => {
			// Service should already be running from module initialization
			const stats = nopeRedis.stats();
			expect(stats.status).toBe(true);
		});

		test('service kill and restart cycle', async () => {
			// Initial state - service should be running
			let stats = nopeRedis.stats();
			const _wasRunning = stats.status;

			// Kill the service
			const killResult = await nopeRedis.SERVICE_KILL();
			expect(killResult).toBe(true);

			// Service stops immediately
			stats = nopeRedis.stats();
			expect(stats.status).toBe(false);

			// Try to use service when stopped
			const setResult = nopeRedis.setItem('test', 'value');
			expect(setResult).toBe(false);

			// Restart the service
			const startResult = await nopeRedis.SERVICE_START();
			expect(startResult).toBe(true);

			// Now operations should work
			const setResult2 = nopeRedis.setItem('test', 'value');
			expect(setResult2).toBe(true);

			const getValue = nopeRedis.getItem('test');
			expect(getValue).toBe('value');
		}); // No extended timeout needed

		test('service refuses to start multiple times', async () => {
			// Ensure service is running
			await nopeRedis.SERVICE_START();

			// Try to start again - should return false
			const startAgain = await nopeRedis.SERVICE_START();
			expect(startAgain).toBe(false);

			const stats = nopeRedis.stats();
			expect(stats.status).toBe(true);
		});

		test('killer process timing', async () => {
			await nopeRedis.SERVICE_START();

			const stats = nopeRedis.stats();
			const initialLastKiller = stats.lastKiller;
			const _nextKiller = stats.nextKiller;

			// Wait for killer to run (5 second interval)
			await new Promise((resolve) => setTimeout(resolve, 5100));

			const newStats = nopeRedis.stats();

			// Killer should have run
			expect(newStats.lastKiller).toBeGreaterThan(initialLastKiller);
			expect(newStats.killerIsFinished).toBe(true);
		}, 7000);
	});

	describe('TTL Expiration Timing', () => {
		beforeEach(async () => {
			await nopeRedis.SERVICE_START();
			nopeRedis.flushAll();
		});

		afterEach(async () => {
			nopeRedis.flushAll();
			await nopeRedis.SERVICE_KILL();
		});

		test('immediate expiration check', () => {
			// Set with 0 TTL should expire immediately
			nopeRedis.setItem('instant', 'value', 0);

			// Should be expired on next get
			const value = nopeRedis.getItem('instant');
			expect(value).toBe(null);
		});

		test('1 second TTL expiration', (done) => {
			nopeRedis.setItem('ttl1', 'value', 1);

			// Should exist immediately
			expect(nopeRedis.getItem('ttl1')).toBe('value');

			// Check at 500ms - should still exist
			setTimeout(() => {
				expect(nopeRedis.getItem('ttl1')).toBe('value');
			}, 500);

			// Check at 1100ms - should be expired
			setTimeout(() => {
				expect(nopeRedis.getItem('ttl1')).toBe(null);
				done();
			}, 1100);
		});

		test('multiple TTL expirations', (done) => {
			nopeRedis.setItem('ttl1', 'value1', 1);
			nopeRedis.setItem('ttl2', 'value2', 2);
			nopeRedis.setItem('ttl3', 'value3', 3);

			// Check at 1.5 seconds
			setTimeout(() => {
				expect(nopeRedis.getItem('ttl1')).toBe(null);
				expect(nopeRedis.getItem('ttl2')).toBe('value2');
				expect(nopeRedis.getItem('ttl3')).toBe('value3');
			}, 1000);

			// Check at 2.5 seconds
			setTimeout(() => {
				expect(nopeRedis.getItem('ttl1')).toBe(null);
				expect(nopeRedis.getItem('ttl2')).toBe(null);
				expect(nopeRedis.getItem('ttl3')).toBe('value3');
			}, 2000);

			// Check at 3.5 seconds
			setTimeout(() => {
				expect(nopeRedis.getItem('ttl1')).toBe(null);
				expect(nopeRedis.getItem('ttl2')).toBe(null);
				expect(nopeRedis.getItem('ttl3')).toBe(null);
				done();
			}, 3500);
		}, 5000);

		test('TTL update on overwrite', (done) => {
			// Set initial with 1 second TTL
			nopeRedis.setItem('update', 'value1', 1);

			// After 500ms, update with new 2 second TTL
			setTimeout(() => {
				nopeRedis.setItem('update', 'value2', 2);

				// Check immediately after update
				expect(nopeRedis.getItem('update')).toBe('value2');
			}, 500);

			// At 1.5 seconds from start (1 second after update)
			setTimeout(() => {
				// Should still exist because of new TTL
				expect(nopeRedis.getItem('update')).toBe('value2');
			}, 1500);

			// At 2.6 seconds from start (2.1 seconds after update)
			setTimeout(() => {
				// Should be expired now
				expect(nopeRedis.getItem('update')).toBe(null);
				done();
			}, 2600);
		}, 4000);
	});

	describe('Killer Process Cleanup', () => {
		beforeEach(async () => {
			await nopeRedis.SERVICE_START();
			nopeRedis.flushAll();
		});

		afterEach(async () => {
			nopeRedis.flushAll();
			await nopeRedis.SERVICE_KILL();
		});

		test('expired keys cleanup by killer', async () => {
			// Add items with short TTL
			for (let i = 0; i < 100; i++) {
				nopeRedis.setItem(`expire${i}`, `value${i}`, 1);
			}

			// Check initial count
			let stats = nopeRedis.stats();
			expect(stats.total).toBe(100);

			// Wait for items to expire (1s) and killer to run (5s interval)
			await new Promise((resolve) => setTimeout(resolve, 6000));

			// All items should be cleaned up
			stats = nopeRedis.stats();
			expect(stats.total).toBe(0);
			expect(stats.killerIsFinished).toBe(true);
		}, 8000);

		test('killer runs every 5 seconds', async () => {
			const stats1 = nopeRedis.stats();
			const firstKillerTime = stats1.lastKiller;

			// Wait for exactly 5 seconds
			await new Promise((resolve) => setTimeout(resolve, 5100));

			const stats2 = nopeRedis.stats();
			const secondKillerTime = stats2.lastKiller;

			// Killer should have run
			expect(secondKillerTime).toBeGreaterThan(firstKillerTime);

			// Wait for another 5 seconds
			await new Promise((resolve) => setTimeout(resolve, 5100));

			const stats3 = nopeRedis.stats();
			const thirdKillerTime = stats3.lastKiller;

			// Killer should have run again
			expect(thirdKillerTime).toBeGreaterThan(secondKillerTime);

			// Time difference should be approximately 5 seconds
			const diff = thirdKillerTime - secondKillerTime;
			expect(diff).toBeGreaterThanOrEqual(4);
			expect(diff).toBeLessThanOrEqual(6);
		}, 12000);

		test('killer handles mixed TTLs correctly', async () => {
			// Add items with various TTLs
			nopeRedis.setItem('short', 'value', 1);
			nopeRedis.setItem('medium', 'value', 10);
			nopeRedis.setItem('long', 'value', 100);

			// Wait for short TTL to expire
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Short should be null, others should exist
			expect(nopeRedis.getItem('short')).toBe(null);
			expect(nopeRedis.getItem('medium')).toBe('value');
			expect(nopeRedis.getItem('long')).toBe('value');

			// Wait for killer to run once
			await new Promise((resolve) => setTimeout(resolve, 5100));

			// Check stats - should have 2 items left
			const stats = nopeRedis.stats();
			expect(stats.total).toBe(2);
		}, 8000);
	});

	describe('Async Size Calculation Timing', () => {
		beforeEach(async () => {
			await nopeRedis.SERVICE_START();
			nopeRedis.flushAll();
		});

		afterEach(async () => {
			nopeRedis.flushAll();
			await nopeRedis.SERVICE_KILL();
		});

		test('size updates asynchronously', (done) => {
			const complexObj = {
				data: 'x'.repeat(1000),
				nested: {
					array: new Array(100).fill({ test: 'value' }),
				},
			};

			nopeRedis.setItem('async', complexObj);

			// Wait for async size calculation
			setTimeout(() => {
				const finalStats = nopeRedis.stats({ showSize: true });
				const finalSize = finalStats.size;

				// Size should be updated
				expect(finalSize).toBeDefined();
				// Size update: ${initialSize} -> ${finalSize}

				done();
			}, 100);
		});

		test('rapid updates handle size correctly', (done) => {
			// Rapidly update the same key
			for (let i = 0; i < 10; i++) {
				nopeRedis.setItem('rapid', { count: i, data: 'x'.repeat(i * 100) });
			}

			// Wait for all async calculations
			setTimeout(() => {
				const stats = nopeRedis.stats({ showSize: true });
				expect(stats.size).not.toBe('0 MB');

				// Should only have one key
				expect(stats.total).toBe(1);

				// Value should be the last one
				const value = nopeRedis.getItem('rapid');
				expect(value.count).toBe(9);

				done();
			}, 200);
		});
	});

	describe('Batch Operations Timing', () => {
		beforeEach(async () => {
			await nopeRedis.SERVICE_START();
			nopeRedis.flushAll();
		});

		afterEach(async () => {
			nopeRedis.flushAll();
			await nopeRedis.SERVICE_KILL();
		});

		test('batch operations with TTL', (done) => {
			const items = [
				{ key: 'batch1', value: 'value1', ttl: 1 },
				{ key: 'batch2', value: 'value2', ttl: 2 },
				{ key: 'batch3', value: 'value3', ttl: 3 },
			];

			const results = nopeRedis.setItems(items);
			expect(results).toEqual([true, true, true]);

			// Check after 1.5 seconds
			setTimeout(() => {
				const batchResults = nopeRedis.getItems(['batch1', 'batch2', 'batch3']);
				expect(batchResults.batch1).toBe(null);
				expect(batchResults.batch2).toBe('value2');
				expect(batchResults.batch3).toBe('value3');
				done();
			}, 1500);
		});

		test('batch delete timing', () => {
			// Add items
			for (let i = 0; i < 10; i++) {
				nopeRedis.setItem(`del${i}`, `value${i}`);
			}

			// Delete half in batch
			const keysToDelete = ['del0', 'del2', 'del4', 'del6', 'del8'];
			const result = nopeRedis.deleteItems(keysToDelete);
			expect(result).toBe(true);

			// Check immediately
			for (let i = 0; i < 10; i++) {
				if (i % 2 === 0) {
					expect(nopeRedis.getItem(`del${i}`)).toBe(null);
				} else {
					expect(nopeRedis.getItem(`del${i}`)).toBe(`value${i}`);
				}
			}
		});
	});

	describe('Memory Stats Timing', () => {
		beforeEach(async () => {
			await nopeRedis.SERVICE_START();
			nopeRedis.flushAll();
		});

		afterEach(async () => {
			nopeRedis.flushAll();
			await nopeRedis.SERVICE_KILL();
		});

		test('memory stats collection timing', async () => {
			// Enable memory stats
			nopeRedis.config({
				isMemoryStatsEnabled: true,
			});

			// Add some data
			for (let i = 0; i < 100; i++) {
				nopeRedis.setItem(`stat${i}`, `value${i}`);
			}

			const stats = nopeRedis.stats();
			expect(stats.isMemoryStatsEnabled).toBe(true);
			expect(stats.nextMemoryStatsTime).toBeGreaterThan(0);

			// Memory stats are collected hourly, so we can't wait
			// Just check that the structure is set up correctly
			expect(stats.memoryStats).toBeDefined();
		});
	});
});

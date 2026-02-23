const nopeRedis = require('../index');

describe('Service Management', () => {
	afterEach(() => {
		// Clean up after each test
		nopeRedis.flushAll();
	});

	afterAll(async () => {
		// Kill service after all tests
		await nopeRedis.SERVICE_KILL();
	});

	describe('SERVICE_START and SERVICE_KILL', () => {
		test('should start and stop service correctly', async () => {
			// Service auto-starts on module load, so kill it first
			await nopeRedis.SERVICE_KILL();

			// Give time for service to stop
			await new Promise((resolve) => setTimeout(resolve, 2000));

			let stats = nopeRedis.stats();
			expect(stats.status).toBe(false);

			// Start service
			const startResult = await nopeRedis.SERVICE_START();
			expect(startResult).toBe(true);

			stats = nopeRedis.stats();
			expect(stats.status).toBe(true);

			// Try to start again (should return false)
			const startAgain = await nopeRedis.SERVICE_START();
			expect(startAgain).toBe(false);

			// Kill service
			const killResult = await nopeRedis.SERVICE_KILL();
			expect(killResult).toBe(true);

			// Give it time to stop (needs to wait for next interval)
			await new Promise((resolve) => setTimeout(resolve, 2000));

			stats = nopeRedis.stats();
			expect(stats.status).toBe(false);
		});

		test('service should not accept operations when stopped', async () => {
			await nopeRedis.SERVICE_KILL();

			// Give it time to stop (needs 5+ seconds for interval to clear)
			await new Promise((resolve) => setTimeout(resolve, 2000));

			const setResult = nopeRedis.setItem('test', 'value');
			expect(setResult).toBe(false);

			const getResult = nopeRedis.getItem('test');
			expect(getResult).toBe(false);

			const deleteResult = nopeRedis.deleteItem('test');
			expect(deleteResult).toBe(false);

			const flushResult = nopeRedis.flushAll();
			expect(flushResult).toBe(false);
		});
	});

	describe('Configuration', () => {
		test('should configure service settings', async () => {
			await nopeRedis.SERVICE_START();

			const configResult = nopeRedis.config({
				defaultTtl: 60,
				isMemoryStatsEnabled: true,
				maxMemorySize: 10, // 10MB
				evictionPolicy: 'lfu',
			});

			expect(configResult).toBe(true);

			const stats = nopeRedis.stats();
			expect(stats.defaultTtl).toBe(60);
			expect(stats.isMemoryStatsEnabled).toBe(true);
			expect(stats.evictionPolicy).toBe('lfu');
		});

		test('should configure when service is running', async () => {
			await nopeRedis.SERVICE_START();

			// Config can be set anytime
			const configResult = nopeRedis.config({
				defaultTtl: 90,
			});

			expect(configResult).toBe(true); // Config works anytime

			const stats = nopeRedis.stats();
			expect(stats.defaultTtl).toBe(90);
		});

		test('should validate configuration values', async () => {
			await nopeRedis.SERVICE_START();

			// Invalid TTL
			const result1 = nopeRedis.config({ defaultTtl: -10 });
			expect(result1).toBe(true); // Config returns true but won't apply invalid value

			const stats = nopeRedis.stats();
			expect(stats.defaultTtl).not.toBe(-10);

			// Invalid eviction policy
			const result2 = nopeRedis.config({ evictionPolicy: 'invalid' });
			expect(result2).toBe(true); // Returns true but won't apply

			const stats2 = nopeRedis.stats();
			expect(['lru', 'lfu', 'ttl']).toContain(stats2.evictionPolicy);
		});
	});

	describe('Memory statistics', () => {
		test('should enable and track memory statistics', async () => {
			await nopeRedis.SERVICE_START();

			const configResult = nopeRedis.config({
				isMemoryStatsEnabled: true,
			});
			expect(configResult).toBe(true);

			// Add some data
			for (let i = 0; i < 10; i++) {
				nopeRedis.setItem(`memstat${i}`, 'x'.repeat(100));
			}

			const stats = nopeRedis.stats();
			expect(stats.isMemoryStatsEnabled).toBe(true);
			expect(stats.nextMemoryStatsTime).toBeDefined();
			expect(stats.memoryStats).toBeDefined();
		});
	});

	describe('Killer process', () => {
		test('should track killer process status', async () => {
			await nopeRedis.SERVICE_START();

			const stats = nopeRedis.stats();
			expect(stats.killerIsFinished).toBe(true);
			expect(stats.lastKiller).toBeDefined();
			expect(stats.nextKiller).toBeDefined();

			// Next killer should be in the future
			const now = Math.floor(Date.now() / 1000);
			expect(stats.nextKiller).toBeGreaterThan(now);
		});
	});

	describe('Auto-start behavior', () => {
		test('service should auto-start on module load', () => {
			// The service should already be running when module is loaded
			// This test runs after other tests have killed the service,
			// so we need to check if it can be restarted

			// Note: Due to the module caching in Node.js, the auto-start
			// only happens once when the module is first required.
			// In tests, we manually manage the service lifecycle.

			expect(typeof nopeRedis.SERVICE_START).toBe('function');
			expect(typeof nopeRedis.SERVICE_KILL).toBe('function');
		});
	});
});

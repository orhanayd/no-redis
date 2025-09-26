const nopeRedis = require('../index');

describe('Performance Optimizations', () => {
    beforeEach(async () => {
        await nopeRedis.SERVICE_START();
        nopeRedis.flushAll();
    });

    afterEach(async () => {
        nopeRedis.flushAll();
        await nopeRedis.SERVICE_KILL();
    });

    describe('Date pooling', () => {
        test('should handle rapid set/get operations efficiently', () => {
            const startTime = Date.now();
            const iterations = 10000;

            for (let i = 0; i < iterations; i++) {
                nopeRedis.setItem(`perf${i}`, `value${i}`, 30);
            }

            const setTime = Date.now() - startTime;
            // Set ${iterations} items in ${setTime}ms

            const getStartTime = Date.now();
            for (let i = 0; i < iterations; i++) {
                nopeRedis.getItem(`perf${i}`);
            }

            const getTime = Date.now() - getStartTime;
            // Get ${iterations} items in ${getTime}ms

            // Should be reasonably fast
            expect(setTime).toBeLessThan(1000); // Less than 1 second for 10k ops
            expect(getTime).toBeLessThan(1000);
        });
    });

    describe('Killer function optimization', () => {
        test('should handle expired keys efficiently', () => {
            // Set many keys with short TTL
            for (let i = 0; i < 1000; i++) {
                nopeRedis.setItem(`expire${i}`, `value${i}`, 1);
            }

            return new Promise((resolve) => {
                setTimeout(() => {
                    const startTime = Date.now();

                    // Wait for killer to run (runs every 5 seconds)
                    setTimeout(() => {
                        const stats = nopeRedis.stats();
                        expect(stats.killerIsFinished).toBe(true);
                        expect(stats.total).toBe(0); // All keys should be expired

                        const cleanupTime = Date.now() - startTime;
                        // Cleanup time for 1000 expired keys: ~${cleanupTime}ms

                        resolve();
                    }, 6000);
                }, 1500);
            });
        }, 10000);
    });

    describe('Memory size estimation', () => {
        test('should estimate memory size quickly', () => {
            // Add various types of data
            for (let i = 0; i < 100; i++) {
                nopeRedis.setItem(`str${i}`, 'x'.repeat(100));
                nopeRedis.setItem(`num${i}`, i * 1000);
                nopeRedis.setItem(`obj${i}`, {
                    prop1: 'value',
                    prop2: i,
                    nested: { data: 'test' }
                });
                nopeRedis.setItem(`arr${i}`, [1, 2, 3, 4, 5]);
            }

            const startTime = Date.now();
            const stats = nopeRedis.stats({ showSize: true });
            const calcTime = Date.now() - startTime;

            expect(stats.size).toBeDefined();
            expect(calcTime).toBeLessThan(50); // Should be very fast
            // Memory calculation for 400 items: ${calcTime}ms, Size: ${stats.size}
        });
    });

    describe('LRU tracking performance', () => {
        test('should maintain LRU order efficiently', () => {
            nopeRedis.config({ evictionPolicy: 'lru' });

            // Add many items
            for (let i = 0; i < 1000; i++) {
                nopeRedis.setItem(`lru${i}`, `value${i}`);
            }

            // Access items in specific pattern
            const startTime = Date.now();
            for (let i = 0; i < 1000; i++) {
                nopeRedis.getItem(`lru${i % 100}`); // Access first 100 repeatedly
            }
            const accessTime = Date.now() - startTime;

            expect(accessTime).toBeLessThan(100);
            // LRU tracking for 1000 accesses: ${accessTime}ms
        });
    });
});
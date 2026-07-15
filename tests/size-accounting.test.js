const nopeRedis = require('../index');

/**
 * Size Accounting (synchronous, integer-byte based)
 *
 * Replaces the old async-size tests: 2.0.4 calculated accurate sizes in a deferred
 * setTimeout per setItem (the primary memory-leak source). Sizes are now computed
 * synchronously at set time with a budgeted deep scan, and tracked as integer bytes.
 */
describe('Size Accounting', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
	});

	afterEach(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	test('setItem stays fast with complex objects despite synchronous sizing', () => {
		const startTime = Date.now();
		const iterations = 10000;

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
		expect(setTime).toBeLessThan(1000); // 10k complex objects, sizing included
	});

	test('size is accurate immediately — no deferred recalculation', () => {
		const largeObj = {
			data: 'x'.repeat(1000),
			nested: {
				array: new Array(100).fill({ test: 'value' }),
			},
		};

		nopeRedis.setItem('large', largeObj);

		const first = nopeRedis.stats({ showSize: true }).size;
		const second = nopeRedis.stats({ showSize: true }).size;

		expect(first).toBeDefined();
		expect(first).not.toBe('0 MB');
		// Synchronous accounting: the value is final at set time and never drifts later.
		expect(second).toBe(first);
	});

	test('buffers are accounted exactly', () => {
		nopeRedis.setItem('buf', Buffer.alloc(1024 * 1024)); // exactly 1 MiB payload
		const size = nopeRedis.stats({ showSize: true }).size;
		// 1 MiB + ~126 bytes entry overhead → still formats as 1.00 MB
		expect(size).toBe('1.00 MB');
	});

	test('rapid succession keeps totals and sizes correct with no async settling', () => {
		for (let i = 0; i < 100; i++) {
			const item = {
				id: i,
				data: Buffer.alloc(500),
				text: 'x'.repeat(250),
			};
			nopeRedis.setItem(`item${i}`, item);
		}

		const stats = nopeRedis.stats({ showSize: true });
		expect(stats.total).toBe(100);
		expect(stats.size).toBeDefined();
		expect(stats.size).not.toBe('0 MB');

		for (let i = 0; i < 100; i++) {
			const retrieved = nopeRedis.getItem(`item${i}`);
			expect(retrieved).toBeDefined();
			expect(retrieved.id).toBe(i);
		}
	});

	test('overwriting a large value with a small one shrinks the size immediately', () => {
		nopeRedis.setItem('key', { huge: 'x'.repeat(100000), buffer: Buffer.alloc(50000) });
		const bigSize = nopeRedis.stats({ showSize: true }).size;

		nopeRedis.setItem('key', { small: 'data' });
		const smallSize = nopeRedis.stats({ showSize: true }).size;

		expect(bigSize).not.toBe(smallSize);
		expect(nopeRedis.getItem('key')).toEqual({ small: 'data' });
		// Only one entry left; deleting it must return the accounting to exactly zero.
		nopeRedis.deleteItem('key');
		expect(nopeRedis.stats({ showSize: true }).size).toBe('0 MB');
	});

	test('set/overwrite/delete churn always returns accounting to exactly 0 MB', () => {
		let seed = 777;
		function rand(n) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed % n;
		}

		const KEYS = 200;
		for (let op = 0; op < 10000; op++) {
			const k = `churn_${rand(KEYS)}`;
			const r = rand(3);
			if (r === 0) nopeRedis.setItem(k, 'x'.repeat(rand(1000)), 60);
			else if (r === 1) nopeRedis.setItem(k, { nested: { arr: new Array(rand(20)).fill('y') } }, 60);
			else nopeRedis.deleteItem(k);
		}
		for (let i = 0; i < KEYS; i++) {
			nopeRedis.deleteItem(`churn_${i}`);
		}

		expect(nopeRedis.stats().total).toBe(0);
		expect(nopeRedis.stats({ showSize: true }).size).toBe('0 MB');
	});

	test('hostile values (throwing getters) never break setItem', () => {
		const hostile = {};
		Object.defineProperty(hostile, 'boom', {
			enumerable: true,
			get() {
				throw new Error('gotcha');
			},
		});

		expect(nopeRedis.setItem('hostile', hostile)).toBe(true);
		expect(nopeRedis.getItem('hostile')).toBe(hostile);
		nopeRedis.deleteItem('hostile');
		expect(nopeRedis.stats({ showSize: true }).size).toBe('0 MB');
	});

	test('deeply nested and huge-array values are size-capped, not CPU bombs', () => {
		// 1M-element array: budgeted scan must extrapolate instead of walking every slot
		const hugeArray = new Array(1000000).fill(12345);
		const t0 = Date.now();
		expect(nopeRedis.setItem('huge-array', hugeArray)).toBe(true);
		expect(Date.now() - t0).toBeLessThan(200);

		// Circular structure: depth cap terminates the walk safely
		const circular = { name: 'root' };
		circular.self = circular;
		expect(nopeRedis.setItem('circular', circular)).toBe(true);
		expect(nopeRedis.getItem('circular')).toBe(circular);
	});
});

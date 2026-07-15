const nopeRedis = require('../index');

/**
 * Security — dangerous key names
 *
 * The store is Map-based so any string key must be safe, including prototype-related
 * names. 2.0.4 vulnerability: getItems() assigned results["__proto__"] on a plain object,
 * which REPLACED the result object's prototype instead of creating an own property.
 */
describe('Security - dangerous key names', () => {
	const DANGEROUS_KEYS = ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf', ''];

	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
	});

	afterEach(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	test.each(DANGEROUS_KEYS)('full round-trip works for key %j', (key) => {
		const value = { marker: `value-for-${key}`, num: 42 };

		expect(nopeRedis.setItem(key, value, 30)).toBe(true);
		expect(nopeRedis.getItem(key)).toEqual(value);

		const stats = nopeRedis.itemStats(key);
		expect(stats).not.toBeNull();
		expect(stats.remaining_seconds).toBeGreaterThan(0);

		expect(nopeRedis.deleteItem(key)).toBe(true);
		expect(nopeRedis.getItem(key)).toBeNull();
	});

	test('getItems returns __proto__ as an OWN property, prototype untouched', () => {
		nopeRedis.setItem('__proto__', { hacked: true }, 30);
		nopeRedis.setItem('normal', 'value', 30);

		const results = nopeRedis.getItems(['__proto__', 'normal']);

		// Result object must be a regular object with its original prototype
		expect(Object.getPrototypeOf(results)).toBe(Object.prototype);

		// __proto__ must be an own enumerable data property
		const desc = Object.getOwnPropertyDescriptor(results, '__proto__');
		expect(desc).toBeDefined();
		expect(desc.enumerable).toBe(true);
		expect(desc.value).toEqual({ hacked: true });

		// Nothing may leak through the prototype chain
		expect(results.hacked).toBeUndefined();
		expect(results.normal).toBe('value');
		expect(Object.keys(results).sort()).toEqual(['__proto__', 'normal']);
	});

	test('getItems returns __proto__ as own property even for missing/expired keys', async () => {
		nopeRedis.setItem('__proto__', { temp: true }, 1);
		await new Promise((resolve) => setTimeout(resolve, 1100));

		const results = nopeRedis.getItems(['__proto__', 'never-existed']);
		const desc = Object.getOwnPropertyDescriptor(results, '__proto__');
		expect(desc).toBeDefined();
		expect(desc.value).toBeNull();
		expect(results['never-existed']).toBeNull();
		expect(Object.getPrototypeOf(results)).toBe(Object.prototype);
	});

	test('storing under __proto__ never pollutes Object.prototype globally', () => {
		nopeRedis.setItem('__proto__', { polluted: true, isAdmin: true }, 30);
		nopeRedis.getItem('__proto__');
		nopeRedis.getItems(['__proto__']);

		expect({}.polluted).toBeUndefined();
		expect({}.isAdmin).toBeUndefined();
		expect(Object.prototype.polluted).toBeUndefined();
		expect(Object.prototype.isAdmin).toBeUndefined();
	});

	test('constructor/toString keys as functions round-trip without prototype damage', () => {
		const fn = function customFn() {
			return 'called';
		};
		nopeRedis.setItem('constructor', fn, 30);
		nopeRedis.setItem('toString', 'just a string', 30);

		expect(nopeRedis.getItem('constructor')).toBe(fn);
		expect(nopeRedis.getItem('toString')).toBe('just a string');

		const results = nopeRedis.getItems(['constructor', 'toString']);
		expect(Object.getOwnPropertyDescriptor(results, 'constructor').value).toBe(fn);
		expect(Object.getOwnPropertyDescriptor(results, 'toString').value).toBe('just a string');
		expect(Object.getPrototypeOf(results)).toBe(Object.prototype);
	});

	test('dangerous keys appear in stats().keys as plain strings', () => {
		for (const key of DANGEROUS_KEYS) {
			nopeRedis.setItem(key, 'v', 30);
		}
		const stats = nopeRedis.stats();
		for (const key of DANGEROUS_KEYS) {
			expect(stats.keys).toContain(key);
		}
		expect(stats.total).toBe(DANGEROUS_KEYS.length);
	});

	test('non-string keys are rejected without side effects', () => {
		expect(nopeRedis.setItem(123, 'v', 30)).toBe(false);
		expect(nopeRedis.setItem(null, 'v', 30)).toBe(false);
		expect(nopeRedis.setItem(undefined, 'v', 30)).toBe(false);
		expect(nopeRedis.setItem({ toString: () => 'sneaky' }, 'v', 30)).toBe(false);
		expect(nopeRedis.getItem(123)).toBe(false);
		expect(nopeRedis.stats().total).toBe(0);
	});

	test('invalid TTL values are rejected', () => {
		expect(nopeRedis.setItem('k', 'v', -1)).toBe(false);
		expect(nopeRedis.setItem('k', 'v', Number.NaN)).toBe(false);
		expect(nopeRedis.setItem('k', 'v', Number.POSITIVE_INFINITY)).toBe(false);
		expect(nopeRedis.setItem('k', 'v', '30')).toBe(false);
		expect(nopeRedis.stats().total).toBe(0);
	});
});

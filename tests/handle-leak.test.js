const { execFile } = require('node:child_process');
const path = require('node:path');
const nopeRedis = require('../index');

const INDEX_PATH = path.resolve(__dirname, '..', 'index.js');

/**
 * Handle & Timer Leak Regression
 *
 * 2.0.4 regression: every setItem scheduled a setTimeout(0) for async size calculation.
 * Under sustained load (millions of sets) the timer queue grew faster than it drained,
 * bloating the heap with pending timers + closures. These tests pin the fix.
 */
describe('Handle & Timer Leak Regression', () => {
	beforeEach(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
	});

	afterEach(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	test('setItem must never schedule per-operation timers', () => {
		const timeoutSpy = jest.spyOn(global, 'setTimeout');
		const immediateSpy = jest.spyOn(global, 'setImmediate');

		for (let i = 0; i < 1000; i++) {
			nopeRedis.setItem(`obj_${i}`, { id: i, nested: { deep: { arr: [1, 2, 3], text: 'x'.repeat(50) } } }, 30);
			nopeRedis.setItem(`str_${i}`, `string value ${i}`, 30);
			nopeRedis.setItem(`buf_${i}`, Buffer.alloc(64), 30);
		}

		expect(timeoutSpy).not.toHaveBeenCalled();
		expect(immediateSpy).not.toHaveBeenCalled();

		timeoutSpy.mockRestore();
		immediateSpy.mockRestore();
	});

	test('get/delete/batch operations must never schedule timers', () => {
		for (let i = 0; i < 500; i++) {
			nopeRedis.setItem(`k_${i}`, { v: i }, 30);
		}

		const timeoutSpy = jest.spyOn(global, 'setTimeout');
		const immediateSpy = jest.spyOn(global, 'setImmediate');

		for (let i = 0; i < 500; i++) {
			nopeRedis.getItem(`k_${i}`);
			nopeRedis.itemStats(`k_${i}`);
		}
		nopeRedis.getItems(['k_1', 'k_2', 'k_3', 'missing']);
		nopeRedis.setItems([
			{ key: 'b1', value: 'v1', ttl: 30 },
			{ key: 'b2', value: { nested: true }, ttl: 30 },
		]);
		nopeRedis.deleteItems(['k_10', 'k_11']);
		for (let i = 0; i < 500; i++) {
			nopeRedis.deleteItem(`k_${i}`);
		}

		expect(timeoutSpy).not.toHaveBeenCalled();
		expect(immediateSpy).not.toHaveBeenCalled();

		timeoutSpy.mockRestore();
		immediateSpy.mockRestore();
	});

	test("process exits naturally with service running — interval is unref'd", (done) => {
		// NOTE: the child never calls SERVICE_KILL. On 2.0.4 this hangs forever
		// (the 5s interval keeps the event loop alive); execFile's timeout would kill it.
		const script = [
			`const r = require(${JSON.stringify(INDEX_PATH)});`,
			'for (let i = 0; i < 100000; i++) { r.setItem("k" + i, { a: i, b: "payload_" + i }, 60); }',
			'if (r.getItem("k0") === null) { process.exitCode = 3; }',
		].join('\n');

		execFile(process.execPath, ['-e', script], { timeout: 15000 }, (err) => {
			try {
				expect(err).toBeNull();
				done();
			} catch (e) {
				done(e);
			}
		});
	}, 20000);

	test('repeated SERVICE_KILL/SERVICE_START cycles do not accumulate intervals', (done) => {
		const script = [
			`const r = require(${JSON.stringify(INDEX_PATH)});`,
			'(async () => {',
			'	for (let c = 0; c < 3; c++) {',
			'		await r.SERVICE_KILL();',
			'		await r.SERVICE_START();',
			'		r.setItem("cycle", c, 30);',
			'	}',
			'	if (r.getItem("cycle") !== 2) { process.exitCode = 3; }',
			'})();',
		].join('\n');

		execFile(process.execPath, ['-e', script], { timeout: 15000 }, (err) => {
			try {
				expect(err).toBeNull();
				done();
			} catch (e) {
				done(e);
			}
		});
	}, 20000);
});

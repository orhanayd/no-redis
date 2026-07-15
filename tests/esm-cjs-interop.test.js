const { execFile } = require('node:child_process');
const path = require('node:path');

const FIXTURES = path.resolve(__dirname, 'fixtures');
const ESM_ENTRY = path.resolve(__dirname, '..', 'index.mjs');
const CJS_ENTRY = path.resolve(__dirname, '..', 'index.js');

const EXPECTED_EXPORTS = [
	'config',
	'setItem',
	'getItem',
	'deleteItem',
	'itemStats',
	'setItems',
	'getItems',
	'deleteItems',
	'flushAll',
	'stats',
	'SERVICE_KILL',
	'SERVICE_START',
];

function runNode(args) {
	return new Promise((resolve) => {
		execFile(process.execPath, args, { timeout: 15000 }, (error, stdout, stderr) => {
			resolve({ error, stdout, stderr });
		});
	});
}

/**
 * ESM / CommonJS Interop
 *
 * The package must work identically via `import` (index.mjs wrapper) and
 * `require` (index.js). Both entry points share one singleton, and neither
 * may keep an otherwise-idle process alive (unref'd background interval),
 * which is proven by the fixtures exiting WITHOUT calling SERVICE_KILL.
 */
describe('ESM / CommonJS interop', () => {
	test('ESM consumer: named + default imports work, state is shared, process exits cleanly', async () => {
		const { error, stdout, stderr } = await runNode([path.join(FIXTURES, 'esm-consumer.mjs')]);
		expect(stderr).toBe('');
		expect(error).toBeNull();
		expect(stdout).toContain('ESM_OK');
	});

	test('CJS consumer: require works, process exits cleanly', async () => {
		const { error, stdout, stderr } = await runNode([path.join(FIXTURES, 'cjs-consumer.cjs')]);
		expect(stderr).toBe('');
		expect(error).toBeNull();
		expect(stdout).toContain('CJS_OK');
	});

	test('ESM named export surface matches the CommonJS export surface exactly', async () => {
		const script = `
			import * as esm from ${JSON.stringify(ESM_ENTRY)};
			import { createRequire } from 'node:module';
			const cjs = createRequire(import.meta.url)(${JSON.stringify(CJS_ENTRY)});
			const esmNames = Object.keys(esm).filter((k) => k !== 'default').sort();
			const cjsNames = Object.keys(cjs).sort();
			console.log(JSON.stringify({ esmNames, cjsNames, sameRef: esm.setItem === cjs.setItem }));
		`;
		const { error, stdout } = await runNode(['--input-type=module', '-e', script]);
		expect(error).toBeNull();
		const { esmNames, cjsNames, sameRef } = JSON.parse(stdout.trim());
		expect(esmNames).toEqual([...EXPECTED_EXPORTS].sort());
		expect(cjsNames).toEqual([...EXPECTED_EXPORTS].sort());
		expect(sameRef).toBe(true);
	});

	test('package.json exports map routes import/require to the right files', () => {
		const pkg = require('../package.json');
		expect(pkg.exports['.'].import).toBe('./index.mjs');
		expect(pkg.exports['.'].require).toBe('./index.js');
		expect(pkg.exports['.'].types).toBe('./index.d.ts');
		expect(pkg.files).toEqual(expect.arrayContaining(['index.js', 'index.mjs', 'index.d.ts']));
	});
});

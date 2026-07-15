#!/usr/bin/env node

/**
 * nope-redis benchmark suite.
 *
 * Usage:
 *   node benchmarks/benchmark.js           # human-readable table
 *   node benchmarks/benchmark.js --json    # machine-readable JSON on stdout (progress on stderr)
 *
 * Scenarios mirror the categories documented in docs/README.md#performance.
 * Eviction and expiry are disabled (high maxMemorySize, long TTL) so results
 * reflect pure operation cost. Access patterns use a seeded LCG so runs are
 * deterministic and comparable between machines and CI runs.
 */

const os = require('node:os');
const nopeRedis = require('../index');
const pkg = require('../package.json');

const JSON_OUTPUT = process.argv.includes('--json');
const TTL = 3600;

let seed = 123456789;
function rand() {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed;
}

function buildKeys(prefix, count) {
	const keys = new Array(count);
	for (let i = 0; i < count; i++) {
		keys[i] = `${prefix}:${i}`;
	}
	return keys;
}

function buildPayload(i) {
	return {
		id: i,
		name: `user-${i}`,
		active: (i & 1) === 0,
		score: i * 0.5,
		tags: ['alpha', 'beta', 'gamma', `tag-${i % 100}`],
		address: { street: `street ${i % 1000}`, city: 'istanbul', zip: 34000 + (i % 1000), geo: { lat: 41.01, lng: 28.97 } },
		orders: [
			{ sku: `sku-${i % 50}`, qty: (i % 5) + 1, price: 9.99 },
			{ sku: `sku-${(i + 7) % 50}`, qty: (i % 3) + 1, price: 19.99 },
		],
		meta: { created: 1700000000 + i, updated: 1700000000 + i, source: 'benchmark' },
	};
}

function resetCache() {
	nopeRedis.flushAll();
	if (typeof globalThis.gc === 'function') {
		globalThis.gc();
	}
}

function measure(name, count, fn) {
	const start = process.hrtime.bigint();
	fn();
	const elapsedNs = Number(process.hrtime.bigint() - start);
	const result = {
		name,
		count,
		opsPerSec: Math.round(count / (elapsedNs / 1e9)),
		nsPerOp: Math.round(elapsedNs / count),
	};
	console.error(`  ${name}: ${result.opsPerSec.toLocaleString('en-US')} ops/sec`);
	return result;
}

function benchSetFresh() {
	const COUNT = 300000;
	const keys = buildKeys('set-fresh', COUNT);
	const values = new Array(COUNT);
	for (let i = 0; i < COUNT; i++) {
		values[i] = `value-${i}`;
	}
	resetCache();
	return measure('SET (fresh string keys)', COUNT, () => {
		for (let i = 0; i < COUNT; i++) {
			nopeRedis.setItem(keys[i], values[i], TTL);
		}
	});
}

function benchSetJson() {
	const COUNT = 150000;
	const PAYLOADS = 1000;
	const keys = buildKeys('set-json', COUNT);
	const payloads = new Array(PAYLOADS);
	for (let i = 0; i < PAYLOADS; i++) {
		payloads[i] = buildPayload(i);
	}
	resetCache();
	return measure('SET (nested JSON, ~30 nodes)', COUNT, () => {
		for (let i = 0; i < COUNT; i++) {
			nopeRedis.setItem(keys[i], payloads[i % PAYLOADS], TTL);
		}
	});
}

function benchSetOverwrite() {
	const COUNT = 300000;
	const KEYSPACE = 50000;
	const keys = buildKeys('set-ow', KEYSPACE);
	resetCache();
	for (let i = 0; i < KEYSPACE; i++) {
		nopeRedis.setItem(keys[i], `initial-${i}`, TTL);
	}
	return measure('SET (overwrite existing keys)', COUNT, () => {
		for (let i = 0; i < COUNT; i++) {
			nopeRedis.setItem(keys[i % KEYSPACE], `overwrite-${i}`, TTL);
		}
	});
}

function benchGetHit() {
	const COUNT = 1000000;
	const KEYSPACE = 100000;
	const keys = buildKeys('get-hit', KEYSPACE);
	resetCache();
	for (let i = 0; i < KEYSPACE; i++) {
		nopeRedis.setItem(keys[i], `value-${i}`, TTL);
	}
	return measure('GET hit (100k keyspace)', COUNT, () => {
		for (let i = 0; i < COUNT; i++) {
			nopeRedis.getItem(keys[rand() % KEYSPACE]);
		}
	});
}

function benchGetMiss() {
	const COUNT = 500000;
	const KEYSPACE = 100000;
	const keys = buildKeys('get-miss', KEYSPACE);
	resetCache();
	return measure('GET miss', COUNT, () => {
		for (let i = 0; i < COUNT; i++) {
			nopeRedis.getItem(keys[i % KEYSPACE]);
		}
	});
}

function benchDelete() {
	const COUNT = 300000;
	const keys = buildKeys('delete', COUNT);
	resetCache();
	for (let i = 0; i < COUNT; i++) {
		nopeRedis.setItem(keys[i], `value-${i}`, TTL);
	}
	return measure('DELETE', COUNT, () => {
		for (let i = 0; i < COUNT; i++) {
			nopeRedis.deleteItem(keys[i]);
		}
	});
}

function benchMixed() {
	const COUNT = 500000;
	const KEYSPACE = 100000;
	const keys = buildKeys('mixed', KEYSPACE);
	resetCache();
	for (let i = 0; i < KEYSPACE; i++) {
		nopeRedis.setItem(keys[i], `value-${i}`, TTL);
	}
	return measure('Mixed (70% get / 20% set / 10% delete)', COUNT, () => {
		for (let i = 0; i < COUNT; i++) {
			const key = keys[rand() % KEYSPACE];
			const op = rand() % 10;
			if (op < 7) {
				nopeRedis.getItem(key);
			} else if (op < 9) {
				nopeRedis.setItem(key, `mixed-${i}`, TTL);
			} else {
				nopeRedis.deleteItem(key);
			}
		}
	});
}

function benchBatch() {
	const BATCH_SIZE = 100;
	const SET_BATCHES = 2000;
	const GET_BATCHES = 3000;
	const keys = buildKeys('batch', BATCH_SIZE * SET_BATCHES);
	const setBatches = new Array(SET_BATCHES);
	for (let b = 0; b < SET_BATCHES; b++) {
		const items = new Array(BATCH_SIZE);
		for (let i = 0; i < BATCH_SIZE; i++) {
			items[i] = { key: keys[b * BATCH_SIZE + i], value: `value-${i}`, ttl: TTL };
		}
		setBatches[b] = items;
	}
	const getBatches = new Array(GET_BATCHES);
	for (let b = 0; b < GET_BATCHES; b++) {
		const chunk = new Array(BATCH_SIZE);
		for (let i = 0; i < BATCH_SIZE; i++) {
			chunk[i] = keys[rand() % keys.length];
		}
		getBatches[b] = chunk;
	}
	resetCache();
	const setResult = measure('BATCH setItems (100 items/call)', BATCH_SIZE * SET_BATCHES, () => {
		for (let b = 0; b < SET_BATCHES; b++) {
			nopeRedis.setItems(setBatches[b]);
		}
	});
	const getResult = measure('BATCH getItems (100 keys/call)', BATCH_SIZE * GET_BATCHES, () => {
		for (let b = 0; b < GET_BATCHES; b++) {
			nopeRedis.getItems(getBatches[b]);
		}
	});
	return [setResult, getResult];
}

function warmup() {
	const keys = buildKeys('warmup', 20000);
	for (let round = 0; round < 3; round++) {
		for (let i = 0; i < keys.length; i++) {
			nopeRedis.setItem(keys[i], buildPayload(i), TTL);
		}
		for (let i = 0; i < keys.length; i++) {
			nopeRedis.getItem(keys[i]);
		}
		nopeRedis.getItems(keys.slice(0, 100));
		for (let i = 0; i < keys.length; i++) {
			nopeRedis.deleteItem(keys[i]);
		}
	}
	resetCache();
}

async function main() {
	nopeRedis.config({ defaultTtl: TTL, maxMemorySize: 2048, evictionPolicy: 'lru' });
	console.error(`nope-redis ${pkg.version} benchmark — node ${process.version}, ${os.cpus()[0] ? os.cpus()[0].model : 'unknown CPU'}`);
	console.error('warming up...');
	warmup();

	const results = [benchSetFresh(), benchSetJson(), benchSetOverwrite(), benchGetHit(), benchGetMiss(), benchDelete(), benchMixed(), ...benchBatch()];
	resetCache();
	await nopeRedis.SERVICE_KILL();

	const output = {
		meta: {
			library: 'nope-redis',
			version: pkg.version,
			node: process.version,
			v8: process.versions.v8,
			cpu: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
			platform: `${os.platform()} ${os.arch()}`,
			date: new Date().toISOString().slice(0, 10),
		},
		results,
	};

	if (JSON_OUTPUT) {
		console.log(JSON.stringify(output, null, 2));
		return;
	}
	const nameWidth = Math.max(...results.map((r) => r.name.length));
	console.log(`\nnope-redis ${output.meta.version} — node ${output.meta.node}, ${output.meta.cpu} (${output.meta.platform})\n`);
	console.log(`${'Operation'.padEnd(nameWidth)}  ${'ops/sec'.padStart(12)}  ${'ns/op'.padStart(8)}`);
	console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(12)}  ${'-'.repeat(8)}`);
	for (const r of results) {
		console.log(`${r.name.padEnd(nameWidth)}  ${r.opsPerSec.toLocaleString('en-US').padStart(12)}  ${r.nsPerOp.toLocaleString('en-US').padStart(8)}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

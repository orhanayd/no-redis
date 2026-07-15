/**
 * Get current Unix timestamp (seconds) — used only for killer/stats bookkeeping.
 * Hot paths compare millisecond timestamps directly (no division per operation).
 */
function getTimestamp() {
	return Math.floor(Date.now() / 1000);
}

let defaultTtl = 30;
let isMemoryStatsEnabled = false;
let criticalError = 0;
let KILL_SERVICE = false;
const intervalSecond = 5;
let runnerInterval = null;
let maxChecksPerCycle = 100000; // Maximum keys to check per cleanup cycle

// Memory accounting is integer BYTES end to end; MB conversion happens only for display.
const BYTES_PER_MB = 1024 * 1024;
let maxMemorySizeMb = 100; // 100MB default limit (public unit)
let maxMemorySizeBytes = 100 * BYTES_PER_MB;
let currentMemorySize = 0; // integer bytes
let evictionPolicy = 'lru'; // 'lru', 'lfu', 'ttl'

// Sampled eviction (Redis-style approximate LRU/LFU/TTL):
// reads never reorder any structure — they only stamp entry.la with a monotonic
// access clock. Eviction samples EVICTION_SAMPLES entries via a rotating cursor
// and removes the worst candidate for the active policy.
const EVICTION_SAMPLES = 8;
let accessClock = 0;
let sampleCursor = null; // rotating iterator over memory.store for eviction sampling
let sweepCursor = null; // persistent iterator over memory.store for the background sweep

// Synchronous size estimation bounds
const SIZE_NODE_BUDGET = 2000; // max nodes visited per deep scan (rest is extrapolated)
const SIZE_MAX_DEPTH = 10;
const ENTRY_OVERHEAD = 120; // map slot + entry object + bookkeeping fields (bytes)
const SIZE_FALLBACK = 256; // used when a hostile value (throwing getter/Proxy) breaks the scan

function subtractMemorySize(size) {
	currentMemorySize -= size;
	if (currentMemorySize < 0 || Number.isNaN(currentMemorySize)) {
		currentMemorySize = 0;
	}
}

const memory = {
	config: {
		status: false,
		killerIsFinished: true,
		lastKiller: 0,
		nextKiller: 0,
		totalHits: 0,
		nextMemoryStatsTime: 0,
		memoryStats: {},
		evictionCount: 0,
	},
	store: new Map(), // key -> { value, hit, expires_at (ms), size (bytes), la }
};

/**
 * Configure nope-redis settings
 *
 * @param {object} options - Configuration options
 * @param {boolean} [options.isMemoryStatsEnabled=false] - Enable hourly memory statistics collection
 * @param {number} [options.defaultTtl=30] - Default TTL in seconds for keys without explicit TTL
 * @param {number} [options.maxMemorySize=100] - Maximum memory size in MB (default 100MB)
 * @param {'lru'|'lfu'|'ttl'} [options.evictionPolicy='lru'] - Eviction policy when memory limit is reached
 * @param {number} [options.maxChecksPerCycle=100000] - Maximum keys to check per cleanup cycle
 * @returns {boolean} true on success, false on error
 */
module.exports.config = (options = {}) => {
	try {
		// Config can be set anytime
		if (typeof options === 'object') {
			if (typeof options.isMemoryStatsEnabled === 'boolean') {
				isMemoryStatsEnabled = options.isMemoryStatsEnabled;
				if (isMemoryStatsEnabled && memory.config.nextMemoryStatsTime === 0) {
					memory.config.nextMemoryStatsTime = getTimestamp() + 3600; // 1 hour
				}
			}
			if (typeof options.defaultTtl === 'number' && options.defaultTtl > 0) {
				const now_ttl = Number.parseInt(options.defaultTtl, 10);
				if (Number.isNaN(now_ttl) === false) {
					defaultTtl = now_ttl;
				}
			}
			if (typeof options.maxMemorySize === 'number' && options.maxMemorySize > 0) {
				maxMemorySizeMb = options.maxMemorySize;
				maxMemorySizeBytes = Math.round(options.maxMemorySize * BYTES_PER_MB);
				while (currentMemorySize > maxMemorySizeBytes && memory.store.size > 0) {
					if (!evictKeys()) break;
				}
			}
			if (options.evictionPolicy && ['lru', 'lfu', 'ttl'].includes(options.evictionPolicy)) {
				evictionPolicy = options.evictionPolicy;
			}
			if (typeof options.maxChecksPerCycle === 'number' && options.maxChecksPerCycle > 0) {
				maxChecksPerCycle = options.maxChecksPerCycle;
			}
			return true;
		}
	} catch (error) {
		console.error('nope-redis -> config error', error);
	}
	return false;
};

/**
 * Estimate value size in integer bytes (recursive, budgeted deep scan).
 * Exact for strings/numbers/booleans/Buffers/TypedArrays; heuristic for
 * objects/arrays with extrapolation once the node budget is exhausted.
 */
function estimateSize(value, depth, state) {
	const t = typeof value;
	if (t === 'string') return value.length * 2;
	if (t === 'number') return 8;
	if (t === 'boolean') return 4;
	if (t === 'function') return 100;
	if (t === 'symbol') return 8;
	if (t === 'bigint') return 16;
	if (value === null || t !== 'object') return 16;
	if (depth > SIZE_MAX_DEPTH) return 64;
	if (value instanceof Map) return 32 + value.size * 100;
	if (value instanceof Set) return 32 + value.size * 50;
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.length;
	if (ArrayBuffer.isView(value)) return value.byteLength;
	if (value instanceof ArrayBuffer) return value.byteLength;
	if (Array.isArray(value)) {
		let bytes = 32;
		const len = value.length;
		for (let i = 0; i < len; i++) {
			if (--state.nodes < 0) {
				// budget exhausted: extrapolate the remainder from the average so far
				const visited = i === 0 ? 1 : i;
				bytes += Math.floor(((bytes - 32) / visited) * (len - i));
				return bytes;
			}
			bytes += estimateSize(value[i], depth + 1, state) + 8;
		}
		return bytes;
	}
	const keys = Object.keys(value);
	let bytes = 32;
	const len = keys.length;
	for (let i = 0; i < len; i++) {
		if (--state.nodes < 0) {
			const visited = i === 0 ? 1 : i;
			bytes += Math.floor(((bytes - 32) / visited) * (len - i));
			return bytes;
		}
		const k = keys[i];
		bytes += k.length * 2 + 16;
		bytes += estimateSize(value[k], depth + 1, state) + 8;
	}
	return bytes;
}

const sizeScanState = { nodes: 0 };

/**
 * Full entry size in bytes (value + key + per-entry overhead), computed
 * synchronously at set time. Never throws: hostile values (throwing getters,
 * Proxy traps) fall back to a flat estimate so setItem keeps succeeding.
 */
function estimateEntrySize(key, value) {
	try {
		let bytes;
		const t = typeof value;
		if (t === 'string') {
			bytes = value.length * 2;
		} else if (t === 'number') {
			bytes = 8;
		} else if (t === 'boolean') {
			bytes = 4;
		} else {
			sizeScanState.nodes = SIZE_NODE_BUDGET;
			bytes = estimateSize(value, 0, sizeScanState);
		}
		return bytes + ENTRY_OVERHEAD + key.length * 2;
	} catch (_e) {
		return SIZE_FALLBACK + ENTRY_OVERHEAD + key.length * 2;
	}
}

/**
 * Remove one entry and its accounted bytes. The single funnel for every
 * delete path (expiry, eviction, deleteItem, sweep) — keeps accounting exact.
 */
function removeEntry(key, item) {
	subtractMemorySize(item.size);
	memory.store.delete(key);
}

/**
 * Evict one entry using sampled selection (Redis-style approximation).
 * Samples up to EVICTION_SAMPLES entries via a rotating cursor and evicts:
 * - lru: the entry with the oldest last-access stamp
 * - lfu: the entry with the lowest hit count
 * - ttl: the entry expiring soonest
 *
 * @returns {boolean} true if an entry was evicted — callers MUST stop looping
 * on false, which structurally prevents the infinite-eviction-loop failure mode.
 */
function evictKeys() {
	if (memory.store.size === 0) return false;
	let victimKey;
	let victimItem;
	let best = Infinity;
	let sampled = 0;
	if (sampleCursor === null) sampleCursor = memory.store.entries();
	while (sampled < EVICTION_SAMPLES) {
		let n = sampleCursor.next();
		if (n.done) {
			sampleCursor = memory.store.entries();
			n = sampleCursor.next();
			if (n.done) break; // store emptied concurrently within this call chain
		}
		const item = n.value[1];
		let metric;
		if (evictionPolicy === 'lru') metric = item.la;
		else if (evictionPolicy === 'lfu') metric = item.hit;
		else metric = item.expires_at;
		if (metric < best) {
			best = metric;
			victimKey = n.value[0];
			victimItem = item;
		}
		sampled++;
	}
	if (victimItem === undefined) return false;
	removeEntry(victimKey, victimItem);
	memory.config.evictionCount++;
	return true;
}

/**
 * Set an item in the cache
 *
 * @param {string} key - The key to store the value under (must be a string)
 * @param {*} value - The value to store (can be any JavaScript type)
 * @param {number} [ttl=defaultTtl] - Time-to-live in seconds (optional, defaults to global defaultTtl)
 * @returns {boolean} true if stored successfully, false if service is stopped or error occurs
 */
function setItem(key, value, ttl = defaultTtl) {
	try {
		if (!memory.config.status || typeof key !== 'string' || !Number.isFinite(ttl) || ttl < 0) {
			return false;
		}

		// Size is exact-or-extrapolated synchronously — no deferred work, no timers.
		const size = estimateEntrySize(key, value);

		// Remove any previous entry BEFORE the eviction loop so eviction can never
		// double-subtract the old size or evict the slot we are about to fill.
		const existing = memory.store.get(key);
		if (existing !== undefined) {
			subtractMemorySize(existing.size);
			memory.store.delete(key);
		}

		let evictionLimit = 1000;
		while (currentMemorySize + size > maxMemorySizeBytes && memory.store.size > 0 && evictionLimit > 0) {
			if (!evictKeys()) break;
			evictionLimit--;
		}

		memory.store.set(key, {
			value: value,
			hit: 0,
			expires_at: Date.now() + Math.floor(ttl) * 1000,
			size: size,
			la: ++accessClock,
		});
		currentMemorySize += size;

		return true;
	} catch (error) {
		console.error('nope-redis -> Cant Set Error! ', error);
		return false;
	}
}
module.exports.setItem = setItem;

/**
 * Get statistics for a specific key
 *
 * @param {string} key - The key to get statistics for
 * @returns {object|null} Object with expires_at, remaining_seconds, and hit count, or null if key doesn't exist
 */
module.exports.itemStats = (key) => {
	try {
		if (!memory.config.status) {
			return false;
		}
		const item = memory.store.get(key);
		if (item === undefined) return null;
		const nowMs = Date.now();
		if (item.expires_at <= nowMs) {
			removeEntry(key, item);
			return null;
		}
		const expiresAtSec = Math.floor(item.expires_at / 1000);
		return {
			expires_at: expiresAtSec,
			remaining_seconds: expiresAtSec - Math.floor(nowMs / 1000),
			hit: item.hit,
		};
	} catch (error) {
		console.error('nope-redis -> Cant get item stats Error! ', error);
		return false;
	}
};

/**
 * Get an item from the cache
 *
 * Expired entries are removed immediately on read (eager delete) — memory is
 * reclaimed at access time instead of waiting for the background sweep.
 *
 * @param {string} key - The key to retrieve
 * @returns {*|null} The stored value, or null if key doesn't exist or has expired
 */
function getItem(key) {
	try {
		if (!memory.config.status || typeof key !== 'string') {
			return false;
		}

		const item = memory.store.get(key);
		if (item === undefined) {
			return null;
		}

		if (item.expires_at > Date.now()) {
			item.hit++;
			item.la = ++accessClock;
			memory.config.totalHits++;
			return item.value;
		}

		removeEntry(key, item);
		return null;
	} catch (error) {
		console.error('nope-redis -> Critical error! ', error);
		return false;
	}
}
module.exports.getItem = getItem;

/**
 * Delete an item from the cache
 *
 * @param {string} key - The key to delete
 * @returns {boolean} true if deleted successfully, false if service is stopped
 */
function deleteItem(key) {
	try {
		if (!memory.config.status) {
			return false;
		}
		const item = memory.store.get(key);
		if (item !== undefined) {
			removeEntry(key, item);
		}
		return true;
	} catch (error) {
		console.error('nope-redis -> Cant delete item', error);
		return false;
	}
}
module.exports.deleteItem = deleteItem;

/**
 * Set multiple items in a single operation
 *
 * @param {Array<{key: string, value: *, ttl?: number}>} items - Array of items to set
 * @returns {Array<boolean>|false} Array of success status for each item, or false on error
 */
module.exports.setItems = (items) => {
	try {
		if (!memory.config.status || !Array.isArray(items)) {
			return false;
		}

		const results = [];
		for (const item of items) {
			const { key, value, ttl } = item;
			results.push(setItem(key, value, ttl));
		}
		return results;
	} catch (error) {
		console.error('nope-redis -> Batch set error!', error);
		return false;
	}
};

/**
 * Get multiple items in a single operation
 *
 * @param {Array<string>} keys - Array of keys to retrieve
 * @returns {object|false} Object with key-value pairs, expired/missing keys return null, or false on error
 */
module.exports.getItems = (keys) => {
	try {
		if (!memory.config.status || !Array.isArray(keys)) {
			return false;
		}

		const results = {};
		const nowMs = Date.now();

		for (const key of keys) {
			if (typeof key !== 'string') continue;

			let resultValue = null;
			const item = memory.store.get(key);
			if (item !== undefined) {
				if (item.expires_at > nowMs) {
					item.hit++;
					item.la = ++accessClock;
					memory.config.totalHits++;
					resultValue = item.value;
				} else {
					removeEntry(key, item); // eager delete on expired read
				}
			}

			// "__proto__" as a plain assignment would REPLACE the result object's
			// prototype instead of creating an own property — define it explicitly.
			if (key === '__proto__') {
				Object.defineProperty(results, key, {
					value: resultValue,
					enumerable: true,
					writable: true,
					configurable: true,
				});
			} else {
				results[key] = resultValue;
			}
		}
		return results;
	} catch (error) {
		console.error('nope-redis -> Batch get error!', error);
		return false;
	}
};

/**
 * Delete multiple items in a single operation
 *
 * @param {Array<string>} keys - Array of keys to delete
 * @returns {boolean} true if operation succeeded, false on error
 */
module.exports.deleteItems = (keys) => {
	try {
		if (!memory.config.status || !Array.isArray(keys)) {
			return false;
		}

		for (const key of keys) {
			if (typeof key !== 'string') continue;

			const item = memory.store.get(key);
			if (item !== undefined) {
				removeEntry(key, item);
			}
		}
		return true;
	} catch (error) {
		console.error('nope-redis -> Batch delete error!', error);
		return false;
	}
};

/**
 * Clear all cached data
 *
 * @returns {boolean} true if flushed successfully, false if service is stopped
 */
module.exports.flushAll = () => {
	try {
		if (!memory.config.status) {
			return false;
		}
		// just store clean
		defaultMemory(false);
		return true;
	} catch (error) {
		console.error('nope-redis -> Cant flush!', error);
		return false;
	}
};

/**
 * Get comprehensive cache statistics
 *
 * @param {object} [options={}] - Statistics options
 * @param {boolean} [options.showKeys=true] - Include array of all keys
 * @param {boolean} [options.showTotal=true] - Include total key count
 * @param {boolean} [options.showSize=false] - Include current memory usage in stats output
 * @returns {object} Statistics object with status, counts, memory usage, and configuration
 */
module.exports.stats = (options = {}) => {
	try {
		// Merge with defaults
		const config = {
			showKeys: true,
			showTotal: true,
			showSize: false,
			...options,
		};

		const result = {
			status: memory.config.status,
			killerIsFinished: memory.config.killerIsFinished,
			lastKiller: memory.config.lastKiller,
			nextKiller: memory.config.nextKiller,
			criticalError,
			defaultTtl,
			totalHits: memory.config.totalHits,
			isMemoryStatsEnabled,
			evictionCount: memory.config.evictionCount,
			evictionPolicy,
			maxMemorySize: formatSizeUnits(maxMemorySizeMb),
		};
		if (isMemoryStatsEnabled) {
			result.nextMemoryStatsTime = memory.config.nextMemoryStatsTime;
			result.memoryStats = memory.config.memoryStats;
		}
		if (config.showTotal) {
			result.total = memory.store.size;
		}
		if (config.showSize) {
			result.size = formatSizeUnits(currentMemorySize / BYTES_PER_MB);
		}
		if (config.showKeys) {
			result.keys = Array.from(memory.store.keys());
		}
		return result;
	} catch (error) {
		console.error('nope-redis -> stats error!', error);
		return false;
	}
};

// Move formatSizeUnits outside of roughSizeOfObject
function formatSizeUnits(mb) {
	// Input is now in MB
	if (mb >= 1024) {
		return `${(mb / 1024).toFixed(2)} GB`;
	}
	if (mb >= 1) {
		return `${mb.toFixed(2)} MB`;
	}
	if (mb > 0) {
		return `${(mb * 1024).toFixed(2)} KB`;
	}
	return '0 MB';
}

/**
 * default memory set
 *
 * @param {Boolean} withConfig
 * @returns {Boolean}
 */
function defaultMemory(withConfig = false) {
	try {
		const defaultState = {
			config: {
				killerIsFinished: true,
				lastKiller: 0,
				nextKiller: 0,
				totalHits: 0,
				nextMemoryStatsTime: 0,
				status: false,
				memoryStats: {},
				evictionCount: 0,
			},
		};
		memory.store = new Map();
		// Both cursors point into the replaced Map — they MUST be dropped here.
		sweepCursor = null;
		sampleCursor = null;
		currentMemorySize = 0;
		if (withConfig) {
			memory.config = JSON.parse(JSON.stringify(defaultState.config));
		}
	} catch (error) {
		console.error('nope-redis -> Cant default memory!', error);
		return false;
	}
}

function memoryStats() {
	try {
		// Use native Date for timestamp formatting
		const timestamp = new Date().toISOString().slice(0, 19);

		memory.config.memoryStats[timestamp] = formatSizeUnits(currentMemorySize / BYTES_PER_MB);
		const keys = Object.keys(memory.config.memoryStats);
		if (keys.length > 25) {
			// Use splice for better performance
			const keysToDelete = keys.splice(0, 12);
			for (const key of keysToDelete) {
				delete memory.config.memoryStats[key];
			}
		}
	} catch (error) {
		console.error('nope-redis -> error!', error);
		return false;
	}
}

/**
 * Background sweep for expired keys that are never read.
 *
 * Uses a persistent rotating cursor across cycles: each run advances up to
 * maxChecksPerCycle entries and the next run continues where it stopped, so a
 * full rotation is guaranteed every ceil(size / maxChecksPerCycle) cycles no
 * matter how large the store grows. (The old scan restarted from the front
 * every cycle, so expired keys behind long-lived ones were never reached.)
 */
function killer() {
	const nowMs = Date.now();
	const now = getTimestamp();

	memory.config.killerIsFinished = false;

	if (sweepCursor === null) sweepCursor = memory.store.entries();
	let checked = 0;
	while (checked < maxChecksPerCycle) {
		const n = sweepCursor.next();
		if (n.done) {
			sweepCursor = null; // full rotation completed — restart next cycle
			break;
		}
		if (n.value[1].expires_at <= nowMs) {
			removeEntry(n.value[0], n.value[1]);
		}
		checked++;
	}

	memory.config.killerIsFinished = true;
	memory.config.lastKiller = now;
	memory.config.nextKiller = now + intervalSecond;

	if (isMemoryStatsEnabled && now >= memory.config.nextMemoryStatsTime) {
		memory.config.nextMemoryStatsTime = now + 3600; // 1 hour
		memoryStats();
	}
}

/**
 * Stop the background cleanup service and clear all data
 *
 * @async
 * @returns {Promise<boolean>} Always returns true
 */
module.exports.SERVICE_KILL = async () => {
	KILL_SERVICE = true;
	// Run final cleanup immediately
	if (memory.config.status) {
		killer();
		// Clear interval if exists
		if (runnerInterval) {
			clearInterval(runnerInterval);
			runnerInterval = null;
		}
		// Reset memory and status
		defaultMemory(true);
	}
	KILL_SERVICE = false; // Always reset
	return true;
};

/**
 * Start the background cleanup service
 *
 * @async
 * @returns {Promise<boolean>} true if started successfully, false if already running
 */
module.exports.SERVICE_START = async () => {
	if (memory.config.status === false) {
		KILL_SERVICE = false;
		criticalError = 0;
		return runner();
	}
	return false;
};

/**
 * init runner
 */
function runner() {
	try {
		if (runnerInterval) {
			clearInterval(runnerInterval);
			runnerInterval = null;
		}
		if (memory.config.status === false) {
			if (criticalError <= 3) {
				memory.config.status = true;
				// Initialize nextKiller when service starts
				memory.config.nextKiller = getTimestamp() + intervalSecond;
			} else {
				console.error('nope-redis -> critic error, nope-redis not started');
				return false;
			}
		}
		runnerInterval = setInterval(() => {
			try {
				if (KILL_SERVICE) {
					clearInterval(runnerInterval);
					runnerInterval = null;
					defaultMemory(true);
					KILL_SERVICE = false;
					return true;
				}
				if (memory.config.killerIsFinished) {
					killer();
				}
			} catch (error) {
				console.error('nope-redis -> Critical Error flushed all data! > ', error);
				clearInterval(runnerInterval);
				defaultMemory(true);
				criticalError++;
				runner();
			}
		}, intervalSecond * 1000);
		// The cache must never keep an otherwise-idle process alive.
		if (runnerInterval && typeof runnerInterval.unref === 'function') {
			runnerInterval.unref();
		}
		return true; // Success return
	} catch (error) {
		console.error('nope-redis -> Critical Error flushed all data! > ', error);
		if (typeof runnerInterval !== 'undefined') {
			clearInterval(runnerInterval);
		}
		defaultMemory(true);
		criticalError++;
		if (memory.config.status === false) {
			runner();
		}
		return false;
	}
}

if (memory.config.status === false) {
	runner();
}

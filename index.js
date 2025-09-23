/**
 * Get current Unix timestamp
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

// Performance optimizations
let maxMemorySize = 100 * 1024 * 1024; // 100MB default limit
let currentMemorySize = 0;
let evictionPolicy = 'lru'; // 'lru', 'lfu', 'ttl'
const expiredKeysPool = new Set();

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
	store: {},
	lru: new Map(), // For LRU tracking
};

/**
 * no-redis config
 *
 * @param {object} options
 * @returns {boolean}
 */
module.exports.config = (options = { isMemoryStatsEnabled, defaultTtl }) => {
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
				maxMemorySize = options.maxMemorySize;
			}
			if (options.evictionPolicy && ['lru', 'lfu', 'ttl'].includes(options.evictionPolicy)) {
				evictionPolicy = options.evictionPolicy;
			}
			return true;
		}
	} catch (error) {
		console.error('nope-redis -> config error', error);
	}
	return false;
};

/**
 * set item to no-redis
 *
 * @param {string} key
 * @param {*} value
 * @param {number} ttl
 * @returns {Boolean}
 */

// Helper function to estimate value size
function estimateSize(value) {
	if (typeof value === 'boolean') return 4;
	if (typeof value === 'string') return value.length * 2;
	if (typeof value === 'number') return 8;
	if (typeof value === 'object' && value !== null) {
		// Check for Buffer
		if (Buffer.isBuffer(value)) {
			return value.length;
		}
		// Check for TypedArray
		if (ArrayBuffer.isView(value)) {
			return value.byteLength;
		}
		// Check for ArrayBuffer
		if (value instanceof ArrayBuffer) {
			return value.byteLength;
		}
		// For other objects, try JSON.stringify with circular reference handling
		try {
			const seen = new WeakSet();
			const jsonStr = JSON.stringify(value, (_, val) => {
				if (typeof val === 'object' && val !== null) {
					if (seen.has(val)) return '[Circular]';
					seen.add(val);
				}
				return val;
			});
			return jsonStr.length * 2;
		} catch (_e) {
			// If JSON.stringify fails, estimate based on object keys
			return Object.keys(value).length * 50; // Rough estimate
		}
	}
	if (typeof value === 'function') return 100; // Estimate for functions
	if (typeof value === 'symbol') return 8;
	if (typeof value === 'bigint') return 16;
	return 16; // Default for other types
}

// Eviction function
function evictKeys() {
	if (evictionPolicy === 'lru') {
		// Evict least recently used
		const lruKey = memory.lru.keys().next().value;
		if (lruKey) {
			const item = memory.store[lruKey];
			if (item) {
				currentMemorySize -= item.size || estimateSize(item.value) + 20;
			}
			delete memory.store[lruKey];
			memory.lru.delete(lruKey);
			memory.config.evictionCount++;
		}
	} else if (evictionPolicy === 'lfu') {
		// Evict least frequently used
		let minHits = Infinity;
		let keyToEvict = null;
		for (const key in memory.store) {
			if (memory.store[key].hit < minHits) {
				minHits = memory.store[key].hit;
				keyToEvict = key;
			}
		}
		if (keyToEvict) {
			const item = memory.store[keyToEvict];
			if (item) {
				currentMemorySize -= item.size || estimateSize(item.value) + 20;
			}
			delete memory.store[keyToEvict];
			memory.lru.delete(keyToEvict);
			memory.config.evictionCount++;
		}
	} else if (evictionPolicy === 'ttl') {
		// Evict soonest to expire
		let minExpiry = Infinity;
		let keyToEvict = null;
		for (const key in memory.store) {
			if (memory.store[key].expires_at < minExpiry) {
				minExpiry = memory.store[key].expires_at;
				keyToEvict = key;
			}
		}
		if (keyToEvict) {
			const item = memory.store[keyToEvict];
			if (item) {
				currentMemorySize -= item.size || estimateSize(item.value) + 20;
			}
			delete memory.store[keyToEvict];
			memory.lru.delete(keyToEvict);
			memory.config.evictionCount++;
		}
	}
}

module.exports.setItem = (key, value, ttl = defaultTtl) => {
	try {
		if (!memory.config.status || typeof key !== 'string' || typeof ttl !== 'number') {
			return false;
		}

		// Quick size estimate for eviction check
		let quickSizeEstimate = 20; // metadata
		if (typeof value === 'string') quickSizeEstimate += value.length * 2;
		else if (typeof value === 'number') quickSizeEstimate += 8;
		else if (typeof value === 'boolean') quickSizeEstimate += 4;
		else if (Buffer.isBuffer(value)) quickSizeEstimate += value.length;
		else if (ArrayBuffer.isView(value)) quickSizeEstimate += value.byteLength;
		else quickSizeEstimate += 100; // Default estimate for objects

		// Check if we need to evict (using quick estimate)
		if (memory.store[key]) {
			// Updating existing key - remove old size immediately
			if (memory.store[key].size) {
				currentMemorySize -= memory.store[key].size;
			}
		}

		// Quick eviction check
		while (currentMemorySize + quickSizeEstimate > maxMemorySize && Object.keys(memory.store).length > 0) {
			evictKeys();
		}

		const expiresAt = getTimestamp() + Number.parseInt(ttl, 10);

		// Store with initial size estimate
		memory.store[key] = {
			value: value,
			hit: 0,
			expires_at: expiresAt,
			size: quickSizeEstimate,
		};

		// Add quick estimate to current size
		currentMemorySize += quickSizeEstimate;

		// Update LRU
		if (memory.lru.has(key)) {
			memory.lru.delete(key);
		}
		memory.lru.set(key, true);

		// Calculate accurate size asynchronously
		setImmediate(() => {
			try {
				if (memory.store[key]) {
					const accurateSize = estimateSize(value) + 20;
					const sizeDiff = accurateSize - memory.store[key].size;
					memory.store[key].size = accurateSize;
					currentMemorySize += sizeDiff;
				}
			} catch (_e) {
				// Ignore errors in async size calculation
			}
		});

		return true;
	} catch (error) {
		console.error('nope-redis -> Cant Set Error! ', error);
		return false;
	}
};

/**
 * get item stats
 *
 * @param {string} key
 * @returns {object}
 */
module.exports.itemStats = (key) => {
	try {
		if (memory.store[key]) {
			const now = getTimestamp();
			return {
				expires_at: memory.store[key].expires_at,
				remaining_seconds: memory.store[key].expires_at - now,
				hit: memory.store[key].hit,
			};
		}
		return null;
	} catch (error) {
		console.error('nope-redis -> Cant get item stats Error! ', error);
		return false;
	}
};

/**
 * get item from no-redis
 *
 * @param {string} key
 * @returns {*}
 */
module.exports.getItem = (key) => {
	try {
		if (!memory.config.status || typeof key !== 'string') {
			return false;
		}

		const item = memory.store[key];
		if (!item) {
			return null;
		}

		const now = getTimestamp();

		if (item.expires_at > now) {
			item.hit++;
			memory.config.totalHits++;

			// Update LRU
			if (evictionPolicy === 'lru') {
				memory.lru.delete(key);
				memory.lru.set(key, true);
			}

			return item.value;
		}

		// Mark for deletion in next cycle
		expiredKeysPool.add(key);
		return null;
	} catch (error) {
		console.error('nope-redis -> Critical error! ', error);
		return false;
	}
};

/**
 * delete item from no-redis
 *
 * @param {string} key
 * @returns {Boolean}
 */
module.exports.deleteItem = (key) => {
	try {
		if (!memory.config.status) {
			return false;
		}
		if (memory.store[key]) {
			const item = memory.store[key];
			currentMemorySize -= item.size || estimateSize(item.value) + 20;
			delete memory.store[key];
			memory.lru.delete(key);
			expiredKeysPool.delete(key);
		}
		return true;
	} catch (error) {
		console.error('nope-redis -> Cant delete item', error);
		return false;
	}
};

/**
 * flush all data
 *
 * @returns {Boolean}
 */
// Batch operations
module.exports.setItems = (items) => {
	try {
		if (!memory.config.status || !Array.isArray(items)) {
			return false;
		}

		const results = [];
		for (const item of items) {
			const { key, value, ttl } = item;
			results.push(module.exports.setItem(key, value, ttl));
		}
		return results;
	} catch (error) {
		console.error('nope-redis -> Batch set error!', error);
		return false;
	}
};

module.exports.getItems = (keys) => {
	try {
		if (!memory.config.status || !Array.isArray(keys)) {
			return false;
		}

		const results = {};
		const now = getTimestamp();

		for (const key of keys) {
			if (typeof key !== 'string') continue;

			const item = memory.store[key];
			if (item && item.expires_at > now) {
				item.hit++;
				memory.config.totalHits++;

				// Update LRU
				if (evictionPolicy === 'lru') {
					memory.lru.delete(key);
					memory.lru.set(key, true);
				}

				results[key] = item.value;
			} else {
				results[key] = null;
				if (item) {
					expiredKeysPool.add(key);
				}
			}
		}
		return results;
	} catch (error) {
		console.error('nope-redis -> Batch get error!', error);
		return false;
	}
};

module.exports.deleteItems = (keys) => {
	try {
		if (!memory.config.status || !Array.isArray(keys)) {
			return false;
		}

		for (const key of keys) {
			if (typeof key !== 'string') continue;

			if (memory.store[key]) {
				const item = memory.store[key];
				currentMemorySize -= item.size || estimateSize(item.value) + 20;
				delete memory.store[key];
				memory.lru.delete(key);
				expiredKeysPool.delete(key);
			}
		}
		return true;
	} catch (error) {
		console.error('nope-redis -> Batch delete error!', error);
		return false;
	}
};

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
 * get stats from noRedis
 *
 * @param {object} config
 * @returns {object}
 */
module.exports.stats = (config = { showKeys: true, showTotal: true, showSize: false }) => {
	try {
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
			currentMemorySize: formatSizeUnits(currentMemorySize),
			maxMemorySize: formatSizeUnits(maxMemorySize),
		};
		if (isMemoryStatsEnabled) {
			result.nextMemoryStatsTime = memory.config.nextMemoryStatsTime;
			result.memoryStats = memory.config.memoryStats;
		}
		if (config.showTotal) {
			result.total = Object.keys(memory.store).length;
		}
		if (config.showSize) {
			result.size = formatSizeUnits(currentMemorySize);
		}
		if (config.showKeys) {
			result.keys = Object.keys(memory.store);
		}
		return result;
	} catch (error) {
		console.error('nope-redis -> stats error!', error);
		return false;
	}
};

// Move formatSizeUnits outside of roughSizeOfObject
function formatSizeUnits(unit_bytes) {
	if (unit_bytes >= 1073741824) {
		return `${(unit_bytes / 1073741824).toFixed(2)} GB`;
	}
	if (unit_bytes >= 1048576) {
		return `${(unit_bytes / 1048576).toFixed(2)} MB`;
	}
	if (unit_bytes >= 1024) {
		return `${(unit_bytes / 1024).toFixed(2)} KB`;
	}
	if (unit_bytes > 1) {
		return `${unit_bytes} bytes`;
	}
	if (unit_bytes === 1) {
		return `${unit_bytes} byte`;
	}
	return '0 bytes';
}

/**
 * default memory set
 *
 * @param {Boolean} withConfig
 * @returns {Boolean}
 */
function defaultMemory(withConfig = false) {
	try {
		const defaultMemory = {
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
		memory.store = {};
		memory.lru = new Map();
		expiredKeysPool.clear();
		currentMemorySize = 0;
		if (withConfig) {
			memory.config = JSON.parse(JSON.stringify(defaultMemory.config));
		}
	} catch (error) {
		console.error('nope-redis -> Cant default memory!', error);
		return false;
	}
}

/**
 * get object size
 *
 * @param {object} object
 * @returns {string}
 */

async function memoryStats() {
	try {
		// Use native Date for timestamp formatting
		const timestamp = new Date().toISOString().slice(0, 19);

		memory.config.memoryStats[timestamp] = formatSizeUnits(currentMemorySize);
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
 * Optimized deleter for expired keys
 */
function killer() {
	const now = getTimestamp();

	memory.config.killerIsFinished = false;

	// Process pre-identified expired keys first
	for (const key of expiredKeysPool) {
		if (memory.store[key]) {
			const item = memory.store[key];
			currentMemorySize -= item.size || estimateSize(item.value) + 20;
			delete memory.store[key];
			memory.lru.delete(key);
		}
	}
	expiredKeysPool.clear();

	// Batch process with early termination
	const keysToDelete = [];
	const maxChecksPerCycle = 1000; // Limit checks per cycle
	let checked = 0;

	for (const property in memory.store) {
		if (checked >= maxChecksPerCycle) break;
		checked++;

		if (memory.store[property].expires_at <= now) {
			keysToDelete.push(property);
		}
	}

	// Batch delete
	for (const key of keysToDelete) {
		const item = memory.store[key];
		if (item) {
			currentMemorySize -= item.size || estimateSize(item.value) + 20;
		}
		delete memory.store[key];
		memory.lru.delete(key);
	}

	memory.config.killerIsFinished = true;
	memory.config.lastKiller = now;
	memory.config.nextKiller = now + intervalSecond;

	if (isMemoryStatsEnabled && now >= memory.config.nextMemoryStatsTime) {
		memory.config.nextMemoryStatsTime = now + 3600; // 1 hour
		memoryStats();
	}
}

module.exports.SERVICE_KILL = async () => {
	KILL_SERVICE = true;
	return true;
};

module.exports.SERVICE_START = async () => {
	if (memory.config.status === false) {
		KILL_SERVICE = false; // Reset flag
		return runner();
	}
	return false;
};

/**
 * init runner
 */
function runner() {
	try {
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

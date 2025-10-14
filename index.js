// External dependencies
const KkDate = require('kk-date');

/**
 * Get current Unix timestamp using kk-date
 */
function getTimestamp() {
	const d = new KkDate();
	return Math.floor(d.getTime() / 1000);
}

let defaultTtl = 30;
let isMemoryStatsEnabled = false;
let criticalError = 0;
let KILL_SERVICE = false;
const intervalSecond = 5;
let runnerInterval = null;
let maxChecksPerCycle = 100000; // Maximum keys to check per cleanup cycle

// Performance optimizations
let maxMemorySize = 100; // 100MB default (in MB) limit
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
				maxMemorySize = options.maxMemorySize;
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
 * Set an item in the cache
 *
 * @param {string} key - The key to store the value under (must be a string)
 * @param {*} value - The value to store (can be any JavaScript type)
 * @param {number} [ttl=defaultTtl] - Time-to-live in seconds (optional, defaults to global defaultTtl)
 * @returns {boolean} true if stored successfully, false if service is stopped or error occurs
 */

// Helper function to estimate value size
function estimateSize(value) {
	if (typeof value === 'boolean') return 4;
	if (typeof value === 'string') return value.length * 2;
	if (typeof value === 'number') return 8;
	if (typeof value === 'object' && value !== null) {
		// Check for Buffer (Node.js only)
		if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
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

// Eviction function - optimized for performance
function evictKeys() {
	if (evictionPolicy === 'lru') {
		// Evict least recently used - O(1) operation
		const lruKey = memory.lru.keys().next().value;
		if (lruKey) {
			const item = memory.store[lruKey];
			if (item) {
				currentMemorySize -= item.size || (estimateSize(item.value) + 20) / (1024 * 1024);
			}
			delete memory.store[lruKey];
			memory.lru.delete(lruKey);
			memory.config.evictionCount++;
		}
	} else if (evictionPolicy === 'lfu' || evictionPolicy === 'ttl') {
		// For LFU and TTL, use LRU map to get candidates without Object.keys()
		// This avoids creating a huge array and provides O(1) access
		let keyToEvict = null;
		let compareValue = Infinity;

		// Check first 20 items from LRU map (oldest accessed items)
		let checked = 0;
		for (const key of memory.lru.keys()) {
			if (checked >= 20) break; // Limit sampling for performance

			const item = memory.store[key];
			if (!item) continue;

			if (evictionPolicy === 'lfu') {
				// Find item with lowest hit count
				if (item.hit < compareValue) {
					compareValue = item.hit;
					keyToEvict = key;
				}
			} else {
				// TTL policy
				// Find item expiring soonest
				if (item.expires_at < compareValue) {
					compareValue = item.expires_at;
					keyToEvict = key;
				}
			}
			checked++;
		}

		// If no good candidate from sampling, just evict the oldest from LRU
		if (!keyToEvict) {
			keyToEvict = memory.lru.keys().next().value;
		}

		if (keyToEvict) {
			const item = memory.store[keyToEvict];
			if (item) {
				currentMemorySize -= item.size || (estimateSize(item.value) + 20) / (1024 * 1024);
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

		// Quick size estimate for eviction check (in bytes then convert to MB)
		let quickSizeEstimateBytes = 20; // metadata
		if (typeof value === 'string') quickSizeEstimateBytes += value.length * 2;
		else if (typeof value === 'number') quickSizeEstimateBytes += 8;
		else if (typeof value === 'boolean') quickSizeEstimateBytes += 4;
		else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) quickSizeEstimateBytes += value.length;
		else if (ArrayBuffer.isView(value)) quickSizeEstimateBytes += value.byteLength;
		else quickSizeEstimateBytes += 100; // Default estimate for objects

		const quickSizeEstimate = quickSizeEstimateBytes / (1024 * 1024); // Convert to MB

		// Check if we need to evict (using quick estimate)
		if (memory.store[key]) {
			// Updating existing key - remove old size immediately
			if (memory.store[key].size) {
				currentMemorySize -= memory.store[key].size;
			}
		}

		// Quick eviction check - use memory.lru.size instead of Object.keys()
		while (currentMemorySize + quickSizeEstimate > maxMemorySize && memory.lru.size > 0) {
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
					const accurateSize = (estimateSize(value) + 20) / (1024 * 1024); // Convert to MB
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
 * Get statistics for a specific key
 *
 * @param {string} key - The key to get statistics for
 * @returns {object|null} Object with expires_at, remaining_seconds, and hit count, or null if key doesn't exist
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
 * Get an item from the cache
 *
 * @param {string} key - The key to retrieve
 * @returns {*|null} The stored value, or null if key doesn't exist or has expired
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
 * Delete an item from the cache
 *
 * @param {string} key - The key to delete
 * @returns {boolean} true if deleted successfully, false if service is stopped or key doesn't exist
 */
module.exports.deleteItem = (key) => {
	try {
		if (!memory.config.status) {
			return false;
		}
		if (memory.store[key]) {
			const item = memory.store[key];
			currentMemorySize -= item.size || (estimateSize(item.value) + 20) / (1024 * 1024);
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
			results.push(module.exports.setItem(key, value, ttl));
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

			if (memory.store[key]) {
				const item = memory.store[key];
				currentMemorySize -= item.size || (estimateSize(item.value) + 20) / (1024 * 1024);
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
 * @param {boolean} [options.showKeys=false] - Include array of all keys
 * @param {boolean} [options.showTotal=true] - Include total key count
 * @param {boolean} [options.showSize=false] - Force recalculate memory size
 * @returns {object} Statistics object with status, counts, memory usage, and configuration
 */
module.exports.stats = (options = {}) => {
	try {
		// Merge with defaults
		const config = {
			showKeys: true,
			showTotal: true,
			showSize: false,
			...options
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
			maxMemorySize: formatSizeUnits(maxMemorySize),
		};
		if (isMemoryStatsEnabled) {
			result.nextMemoryStatsTime = memory.config.nextMemoryStatsTime;
			result.memoryStats = memory.config.memoryStats;
		}
		if (config.showTotal) {
			result.total = memory.lru.size;
		}
		if (config.showSize) {
			result.size = formatSizeUnits(currentMemorySize);
		}
		if (config.showKeys) {
			result.keys = Array.from(memory.lru.keys());
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
			currentMemorySize -= item.size || (estimateSize(item.value) + 20) / (1024 * 1024);
			delete memory.store[key];
			memory.lru.delete(key);
		}
	}
	expiredKeysPool.clear();

	// Batch process with early termination
	const keysToDelete = [];
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
			currentMemorySize -= item.size || (estimateSize(item.value) + 20) / (1024 * 1024);
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
		KILL_SERVICE = false;
	}
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

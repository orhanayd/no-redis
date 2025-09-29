export = nopeRedis;

declare namespace nopeRedis {
	/**
	 * Configuration options for nope-redis
	 */
	export interface Config {
		/** Default TTL in seconds (default: 30) */
		defaultTtl?: number;
		/** Enable memory statistics collection (default: false) */
		isMemoryStatsEnabled?: boolean;
		/** Maximum memory size in MB (default: 100) */
		maxMemorySize?: number;
		/** Eviction policy: 'lru', 'lfu', or 'ttl' (default: 'lru') */
		evictionPolicy?: 'lru' | 'lfu' | 'ttl';
	}

	/**
	 * Statistics object returned by stats()
	 */
	export interface Stats {
		/** Service running status */
		status: boolean;
		/** Total number of keys */
		total: number;
		/** Total cache hits across all keys */
		totalHits: number;
		/** Human-readable memory usage */
		currentMemorySize: string;
		/** Number of evicted keys */
		evictionCount: number;
		/** Cleanup process status */
		killerIsFinished: boolean;
		/** Last cleanup timestamp */
		lastKiller: number;
		/** Next cleanup timestamp */
		nextKiller: number;
		/** Memory stats collection status */
		isMemoryStatsEnabled: boolean;
		/** Next stats collection time */
		nextMemoryStatsTime: number;
		/** Historical memory data (if enabled) */
		memoryStats: Record<string, { size: number; count: number }>;
		/** Array of all keys (optional) */
		keys?: string[];
	}

	/**
	 * Item statistics for a specific key
	 */
	export interface ItemStats {
		/** Unix timestamp when item expires */
		expires_at: number;
		/** Seconds remaining until expiration */
		remaining_seconds: number;
		/** Number of times accessed */
		hit: number;
	}

	/**
	 * Batch item for setItems operation
	 */
	export interface BatchItem<T = any> {
		/** The key to store */
		key: string;
		/** The value to store */
		value: T;
		/** TTL in seconds (optional) */
		ttl?: number;
	}

	/**
	 * Options for stats() method
	 */
	export interface StatsOptions {
		/** Include array of all keys (default: true) */
		showKeys?: boolean;
		/** Include total count (default: true) */
		showTotal?: boolean;
		/** Force recalculate memory usage (default: false) */
		showSize?: boolean;
	}

	/**
	 * Configure nope-redis settings
	 * @param options Configuration options
	 * @returns true on success, false on error
	 */
	export function config(options: Config): boolean;

	/**
	 * Set an item in the cache
	 * @param key The key to store the value under (must be a string)
	 * @param value The value to store (can be any JavaScript type)
	 * @param ttl Time-to-live in seconds (optional, defaults to defaultTtl)
	 * @returns true if stored successfully, false if service is stopped or error occurs
	 */
	export function setItem<T = any>(key: string, value: T, ttl?: number): boolean;

	/**
	 * Get an item from the cache
	 * @param key The key to retrieve
	 * @returns The stored value, null if key doesn't exist or has expired, or false if service is stopped
	 */
	export function getItem<T = any>(key: string): T | null | false;

	/**
	 * Delete an item from the cache
	 * @param key The key to delete
	 * @returns true if operation succeeded (even if key doesn't exist), false if service is stopped
	 */
	export function deleteItem(key: string): boolean;

	/**
	 * Get statistics for a specific key
	 * @param key The key to get statistics for
	 * @returns Object with expires_at, remaining_seconds, and hit count, null if key doesn't exist, or false if service is stopped
	 */
	export function itemStats(key: string): ItemStats | null | false;

	/**
	 * Clear all cached data
	 * @returns true on success, false if service is stopped
	 */
	export function flushAll(): boolean;

	/**
	 * Set multiple items in a single operation
	 * @param items Array of items to set
	 * @returns Array of success status for each item, or false on error
	 */
	export function setItems<T = any>(items: BatchItem<T>[]): boolean[] | false;

	/**
	 * Get multiple items at once
	 * @param keys Array of keys to retrieve
	 * @returns Object with key-value pairs, non-existent/expired keys return null
	 */
	export function getItems<T = any>(keys: string[]): Record<string, T | null> | false;

	/**
	 * Delete multiple items in a single operation
	 * @param keys Array of keys to delete
	 * @returns true if operation succeeded
	 */
	export function deleteItems(keys: string[]): boolean;

	/**
	 * Get comprehensive cache statistics
	 * @param options Options for what to include in stats
	 * @returns Statistics object
	 */
	export function stats(options?: StatsOptions): Stats | false;

	/**
	 * Stop the background cleanup service and clear all data
	 * @returns Promise that resolves to true when service is killed
	 */
	export function SERVICE_KILL(): Promise<true>;

	/**
	 * Start the service after it has been killed
	 * @returns Promise that resolves to true if started successfully, false if already running
	 */
	export function SERVICE_START(): Promise<boolean>;

	// Type aliases
	export type NopeRedisConfig = Config;
	export type NopeRedisStats = Stats;
	export type NopeRedisItemStats = ItemStats;
	export type NopeRedisBatchItem<T = any> = BatchItem<T>;
	export type NopeRedisStatsOptions = StatsOptions;
}

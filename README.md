# nope-redis

### Simple & Fast Node.js In-Memory Caching

A lightweight, high-performance in-memory caching library for Node.js that provides Redis-like functionality without requiring a Redis server.

## Features

- 🚀 **Blazing Fast**: 1.3M+ SET ops/sec, 2.6M+ GET ops/sec, 3M+ DELETE ops/sec
- 💾 **Flexible Storage**: Supports objects, arrays, strings, numbers, booleans, functions, and more
- ⏰ **Auto-Expiration**: TTL-based automatic key expiration with efficient cleanup
- 🔄 **Eviction Policies**: LRU, LFU, and TTL-based eviction strategies
- 📊 **Memory Management**: Configurable memory limits with automatic eviction
- 🛡️ **Self-Recovery**: Automatic recovery from critical errors (up to 3 retries)
- 📈 **Statistics**: Built-in hit counters and memory usage tracking
- 🎯 **Batch Operations**: Efficient bulk set/get/delete operations
- 📘 **TypeScript Support**: Full TypeScript definitions included
- 🔧 **Minimal Dependencies**: Only kk-date (v4.0.2) for robust date/time handling

## Installation

```bash
npm install nope-redis
```

## Requirements

- Node.js v12 or higher

## Quick Start

### JavaScript
```javascript
const nopeRedis = require("nope-redis");

// Store a value with 10 second TTL
nopeRedis.setItem("user:1", { name: "John", age: 30 }, 10);

// Retrieve the value
const user = nopeRedis.getItem("user:1");
console.log(user); // { name: "John", age: 30 }

// Delete the value
nopeRedis.deleteItem("user:1");

// Batch operations
const items = [
    { key: "item1", value: "value1", ttl: 30 },
    { key: "item2", value: { nested: "data" }, ttl: 60 }
];
nopeRedis.setItems(items);

const values = nopeRedis.getItems(["item1", "item2"]);
console.log(values); // { item1: "value1", item2: { nested: "data" } }
```

### TypeScript
```typescript
import nopeRedis = require("nope-redis");

interface User {
  name: string;
  age: number;
}

// Store typed data
nopeRedis.setItem<User>("user:1", { name: "John", age: 30 }, 10);

// Retrieve with type safety
const user = nopeRedis.getItem<User>("user:1");
if (user) {
  console.log(user.name); // TypeScript knows this is a User
}

// Batch operations with types
const items = [
  { key: "user:2", value: { name: "Jane", age: 25 }, ttl: 30 },
  { key: "user:3", value: { name: "Bob", age: 35 }, ttl: 60 }
];
nopeRedis.setItems(items);

// Get multiple items with type
const users = nopeRedis.getItems<User>(["user:1", "user:2", "user:3"]);
```

## API Reference

### Basic Operations

#### `setItem(key, value, ttl?)`
Store any type of data with optional TTL (time-to-live).

```javascript
// Store with default TTL (30 seconds)
nopeRedis.setItem("key1", "value1");

// Store with custom TTL (60 seconds)
nopeRedis.setItem("key2", { data: "complex" }, 60);

// Store functions, arrays, or any JavaScript type
nopeRedis.setItem("func", () => console.log("Hello"), 30);
nopeRedis.setItem("array", [1, 2, 3], 45);

// Returns: true on success, false if service is stopped
```

#### `getItem(key)`
Retrieve a cached value. Returns `null` if not found or expired, `false` if service is stopped.

```javascript
const value = nopeRedis.getItem("key1");
if (value === null) {
    // Key doesn't exist or has expired
} else if (value === false) {
    // Service is stopped
}

// Accessing a key updates its access count and LRU position
```

#### `deleteItem(key)`
Remove a key from the cache immediately.

```javascript
const result = nopeRedis.deleteItem("key1");
// Returns: true always (even if key doesn't exist), false only if service is stopped
// Note: Always returns true for successful operation, regardless of key existence
```

#### `itemStats(key)`
Get detailed statistics for a specific key.

```javascript
const stats = nopeRedis.itemStats("key1");
// Returns: {
//   expires_at: 1234567890,     // Unix timestamp
//   remaining_seconds: 25,       // Seconds until expiration
//   hit: 5                      // Number of times accessed
// }
// Returns: null if key doesn't exist, false if service is stopped
```

#### `flushAll()`
Clear all cached data.

```javascript
nopeRedis.flushAll();
// Returns: true on success, false if service is stopped
// Resets all memory but keeps service running
```

### Batch Operations

#### `setItems(items)`
Set multiple items in a single operation for better performance.

```javascript
const items = [
    { key: "item1", value: "value1", ttl: 30 },
    { key: "item2", value: { nested: "data" }, ttl: 60 },
    { key: "item3", value: [1, 2, 3], ttl: 90 }
];
const results = nopeRedis.setItems(items);
// Returns: [true, true, true] - success status for each item
// Returns false if service is stopped or error occurs
```

#### `getItems(keys)`
Retrieve multiple items at once.

```javascript
const values = nopeRedis.getItems(["item1", "item2", "item3"]);
// Returns: {
//   item1: "value1",
//   item2: { nested: "data" },
//   item3: [1, 2, 3]
// }
// Non-existent or expired keys return null
// Returns false if service is stopped or error occurs
```

#### `deleteItems(keys)`
Delete multiple items in a single operation.

```javascript
const result = nopeRedis.deleteItems(["item1", "item2", "item3"]);
// Returns: true if operation succeeded, false if service is stopped
// Skips non-string keys silently
```

### Configuration

#### `config(options)`
Configure global settings at runtime.

```javascript
nopeRedis.config({
    defaultTtl: 60,                    // Default TTL in seconds (default: 30)
    isMemoryStatsEnabled: true,        // Enable memory statistics (default: false)
    maxMemorySize: 50,                 // Maximum memory in MB (default: 100MB)
    evictionPolicy: 'lru'              // 'lru', 'lfu', or 'ttl' (default: 'lru')
});
// Returns: true on success, false on error
```

**Configuration Options:**
- `defaultTtl`: Default expiration time for keys without explicit TTL (seconds)
- `isMemoryStatsEnabled`: Enables hourly memory statistics collection
- `maxMemorySize`: Maximum memory size in MB before eviction starts (Note: value is in MB, not bytes)
- `evictionPolicy`: Strategy for removing keys when memory limit is reached
  - `'lru'`: Least Recently Used (removes least recently accessed keys)
  - `'lfu'`: Least Frequently Used (removes least frequently accessed keys)
  - `'ttl'`: Time-To-Live (removes keys closest to expiration)

### Statistics

#### `stats(options?)`
Get comprehensive cache statistics.

```javascript
const stats = nopeRedis.stats();
// Basic stats (no parameters)
// Returns false if error occurs
// Returns: {
//   status: true,                    // Service running status
//   total: 150,                      // Total number of keys
//   totalHits: 1250,                 // Total cache hits across all keys
//   currentMemorySize: "1.5 MB",     // Human-readable memory usage
//   evictionCount: 10,               // Number of evicted keys
//   killerIsFinished: true,          // Cleanup process status
//   lastKiller: 1234567890,          // Last cleanup timestamp
//   nextKiller: 1234567895,          // Next cleanup timestamp
//   isMemoryStatsEnabled: false,     // Memory stats collection status
//   nextMemoryStatsTime: 0,          // Next stats collection time
//   memoryStats: {}                  // Historical memory data (if enabled)
// }

// Advanced options (defaults: showKeys=true, showTotal=true, showSize=false)
const detailedStats = nopeRedis.stats({
    showKeys: true,   // Include array of all keys (default: true)
    showTotal: true,  // Include total count (default: true)
    showSize: false   // Force recalculate memory usage (default: false)
});
// Additional fields when showKeys: true
// keys: ["key1", "key2", ...]
```

### Service Management

The service starts automatically when the module is loaded. You can manually control it if needed:

#### `SERVICE_KILL()`
Stop the background cleanup service and clear all data.

```javascript
await nopeRedis.SERVICE_KILL();
// Returns: Promise<true>
// - Runs final cleanup immediately
// - Stops background interval
// - Resets all memory
// - Sets service status to false
```

#### `SERVICE_START()`
Restart the service after it has been killed.

```javascript
await nopeRedis.SERVICE_START();
// Returns: Promise<true> if started successfully
// Returns: Promise<false> if already running
// - Resets error counter
// - Restarts background cleanup interval
// - Service auto-recovery after critical errors
```

## Performance

Benchmark results on modern hardware (Apple M1/M2):

| Operation | Rate | Performance |
|-----------|------|-------------|
| SET | 1,337,644 ops/sec | ~0.75μs per operation |
| GET | 2,600,000+ ops/sec | ~0.38μs per operation |
| DELETE | 3,000,000+ ops/sec | ~0.33μs per operation |

**Performance characteristics:**
- O(1) complexity for all basic operations
- String-only keys enforced for V8 optimization
- Asynchronous size calculation prevents blocking
- Batch processing for expired key cleanup
- Pre-identified expired keys pool for efficiency

## Memory Management

### Automatic Cleanup
- Background service runs every 5 seconds
- Processes up to 1000 expired keys per cycle
- Expired keys marked during reads for batch deletion
- Memory statistics collected hourly (when enabled)

### Eviction Policies

When memory limit is reached, nope-redis automatically removes keys based on the selected eviction policy. This ensures your application never runs out of memory.

#### Available Policies

**1. LRU (Least Recently Used) - Default**
```javascript
nopeRedis.config({
    maxMemorySize: 100, // 100MB
    evictionPolicy: 'lru'
});
```
- Removes keys that haven't been accessed recently
- Uses a Map to track access order with O(1) complexity
- Every `getItem()` call updates the key's position
- Best for: General-purpose caching, hot/cold data patterns

**2. LFU (Least Frequently Used)**
```javascript
nopeRedis.config({
    maxMemorySize: 50,  // 50MB
    evictionPolicy: 'lfu'
});
```
- Removes keys with the lowest access count
- Each key tracks its `hit` counter
- Keys rarely accessed are removed first
- Best for: Long-lived cache with varying access patterns

**3. TTL (Time-To-Live Based)**
```javascript
nopeRedis.config({
    maxMemorySize: 75,  // 75MB
    evictionPolicy: 'ttl'
});
```
- Removes keys closest to their expiration time
- Prioritizes removing short-lived data first
- Keeps longer TTL items in cache
- Best for: Mixed TTL scenarios, session management

#### How It Works

1. Before each `setItem()`, nope-redis checks if adding the new item would exceed `maxMemorySize`
2. If memory limit would be exceeded, it calls `evictKeys()` to remove items based on the policy
3. This continues until there's enough space for the new item
4. The eviction count is tracked in statistics (`evictionCount`)

**Performance Optimization**: LFU and TTL policies leverage the existing LRU map structure, checking only the first 20 least-recently-used items instead of scanning all keys. The eviction loop uses `memory.lru.size` instead of `Object.keys(memory.store).length` to check if store has items, avoiding array allocation and providing O(1) complexity.

#### Example: Memory Pressure Handling

```javascript
// Configure with 10MB limit and LRU policy
nopeRedis.config({
    maxMemorySize: 10,  // 10MB (Note: value is in MB, not bytes or KB)
    evictionPolicy: 'lru'
});

// Fill cache with data
for (let i = 0; i < 100000; i++) {
    nopeRedis.setItem(`key${i}`, `data${i}`, 300);
}

// Check eviction statistics
const stats = nopeRedis.stats();
console.log(`Evicted ${stats.evictionCount} keys to maintain memory limit`);
```

### Memory Size Calculation
- Quick estimation during set operations
- Accurate async calculation with `setImmediate()`
- Handles all JavaScript types including TypedArrays and Buffers
- Circular reference detection

## Use Cases

- **Session Management**: Store user sessions with automatic expiration
- **API Response Caching**: Cache frequently accessed API responses
- **Rate Limiting**: Implement request throttling with TTL
- **Temporary Storage**: Store computation results or temporary state
- **Queue Management**: Simple in-memory job queue with TTL
- **Real-time Data**: Cache real-time data with short TTLs
- **Application State**: Maintain application-wide state in memory

## Comparison with Alternatives

| Feature | nope-redis | node-cache | memory-cache | lru-cache |
|---------|------------|------------|--------------|-----------|
| Performance | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Batch Operations | ✅ | ❌ | ❌ | ❌ |
| Multiple Eviction Policies | LRU, LFU, TTL | LRU | None | LRU only |
| Memory Limits | ✅ | ❌ | ❌ | ✅ |
| Statistics | Comprehensive | Basic | Basic | Basic |
| Auto-Recovery | ✅ | ❌ | ❌ | ❌ |
| Minimal Dependencies | ✅ (1 dep) | ❌ | ✅ | ✅ |
| TypeScript Types | ✅ | ✅ | ❌ | ✅ |

## Advanced Features

### Error Recovery
The service automatically recovers from critical errors:
- Flushes all data on critical error
- Attempts recovery up to 3 times
- Refuses to start after 3 consecutive failures
- All operations return `false` when service is stopped

### Memory Statistics
When enabled, collects hourly memory usage data:

```javascript
nopeRedis.config({ isMemoryStatsEnabled: true });

// After some time...
const stats = nopeRedis.stats();
console.log(stats.memoryStats);
// {
//   "1234567890": { size: 1048576, count: 150 },
//   "1234571490": { size: 2097152, count: 300 }
// }
```

## Limitations

- **Single Process**: Not suitable for distributed systems or multi-process architectures
- **No Persistence**: Data is lost on restart (in-memory only)
- **Memory Bound**: Limited by available heap memory
- **Second Precision**: TTL precision is in seconds, not milliseconds
- **Key Type**: Keys must be strings for optimal performance
- **Key Limit**: Practical limit of ~1 million keys (single object storage)

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/basic-operations.test.js

# Run with coverage
npx jest --coverage
```

Test coverage: ~97% with 120+ test cases covering:
- Basic CRUD operations
- Batch operations
- Service lifecycle management
- TTL and timing accuracy
- Performance benchmarks
- Data type support
- Eviction policies
- Edge cases and error conditions
- Memory management
- Configuration changes

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/orhanayd/no-redis.git
cd no-redis

# Install dependencies
npm install

# Run tests
npm test

# Format code
npx @biomejs/biome check index.js --write --unsafe
```

## License

MIT

## Author

Orhan Aydogdu ([orhanayd](https://github.com/orhanayd))

## Links

- [GitHub Repository](https://github.com/orhanayd/no-redis)
- [NPM Package](https://www.npmjs.com/package/nope-redis)
- [Issue Tracker](https://github.com/orhanayd/no-redis/issues)
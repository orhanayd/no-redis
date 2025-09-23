# nope-redis

### Simple & Fast Node.js In-Memory Caching

A lightweight, high-performance in-memory caching library for Node.js that provides Redis-like functionality without requiring a Redis server.

## Features

- 🚀 **Blazing Fast**: 1.3M+ SET ops/sec, 2.6M+ GET ops/sec
- 💾 **Flexible Storage**: Supports objects, arrays, strings, numbers, booleans, functions, and more
- ⏰ **Auto-Expiration**: TTL-based automatic key expiration
- 🔄 **Eviction Policies**: LRU, LFU, and TTL-based eviction strategies
- 📊 **Memory Management**: Configurable memory limits with automatic eviction
- 🛡️ **Self-Recovery**: Automatic recovery from critical errors
- 📈 **Statistics**: Built-in hit counters and memory usage tracking
- 🎯 **Batch Operations**: Efficient bulk set/get/delete operations
- 🔧 **Zero Dependencies**: No external runtime dependencies (only dev dependencies)

## Installation

```bash
npm install nope-redis
```

## Requirements

- Node.js v12 or higher

## Quick Start

```javascript
const nopeRedis = require("nope-redis");

// Store a value with 10 second TTL
nopeRedis.setItem("user:1", { name: "John", age: 30 }, 10);

// Retrieve the value
const user = nopeRedis.getItem("user:1");
console.log(user); // { name: "John", age: 30 }

// Delete the value
nopeRedis.deleteItem("user:1");
```

## API Reference

### Basic Operations

#### `setItem(key, value, ttl)`
Store any type of data with optional TTL (time-to-live).

```javascript
// Store with default TTL (30 seconds)
nopeRedis.setItem("key1", "value1");

// Store with custom TTL (60 seconds)
nopeRedis.setItem("key2", { data: "complex" }, 60);

// Store functions, arrays, or any JavaScript type
nopeRedis.setItem("func", () => console.log("Hello"), 30);
```

#### `getItem(key)`
Retrieve a cached value. Returns `null` if not found or expired.

```javascript
const value = nopeRedis.getItem("key1");
if (value === null) {
    // Key doesn't exist or has expired
}
```

#### `deleteItem(key)`
Remove a key from the cache immediately.

```javascript
nopeRedis.deleteItem("key1"); // Returns true
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
```

#### `flushAll()`
Clear all cached data.

```javascript
nopeRedis.flushAll(); // Returns true
```

### Batch Operations

#### `setItems(items)`
Set multiple items in a single operation.

```javascript
const items = [
    { key: "item1", value: "value1", ttl: 30 },
    { key: "item2", value: { nested: "data" }, ttl: 60 },
    { key: "item3", value: [1, 2, 3], ttl: 90 }
];
const results = nopeRedis.setItems(items); // [true, true, true]
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
```

#### `deleteItems(keys)`
Delete multiple items in a single operation.

```javascript
nopeRedis.deleteItems(["item1", "item2", "item3"]); // Returns true
```

### Configuration

#### `config(options)`
Configure global settings.

```javascript
nopeRedis.config({
    defaultTtl: 60,                    // Default TTL in seconds
    isMemoryStatsEnabled: true,        // Enable memory statistics
    maxMemorySize: 50 * 1024 * 1024,  // 50MB limit
    evictionPolicy: 'lru'             // 'lru', 'lfu', or 'ttl'
});
```

### Statistics

#### `stats(options)`
Get comprehensive cache statistics.

```javascript
const stats = nopeRedis.stats({
    showKeys: true,   // Include list of all keys
    showTotal: true,  // Include total count
    showSize: true    // Calculate memory usage
});

console.log(stats);
// {
//   status: true,
//   total: 150,
//   currentMemorySize: "1.5 MB",
//   totalHits: 1250,
//   evictionCount: 10,
//   keys: ["key1", "key2", ...],
//   ...
// }
```

### Service Management

The service starts automatically when the module is loaded. You can manually control it if needed:

```javascript
// Stop the background cleanup service
await nopeRedis.SERVICE_KILL();

// Restart the service
await nopeRedis.SERVICE_START();
```

## Performance

Benchmark results on modern hardware:

| Operation | Rate | Performance |
|-----------|------|-------------|
| SET | 1,337,644 ops/sec | ~0.75μs per operation |
| GET | 3,496,656 ops/sec | ~0.29μs per operation |
| DELETE | 3,519,578 ops/sec | ~0.28μs per operation |

## Memory Management

### Eviction Policies

1. **LRU (Least Recently Used)**: Removes least recently accessed keys
2. **LFU (Least Frequently Used)**: Removes least frequently accessed keys
3. **TTL**: Removes keys closest to expiration

### Memory Limits

Set a maximum memory size to prevent unbounded growth:

```javascript
nopeRedis.config({
    maxMemorySize: 100 * 1024 * 1024, // 100MB
    evictionPolicy: 'lru'
});
```

## Use Cases

- **Session Management**: Store user sessions with automatic expiration
- **API Response Caching**: Cache frequently accessed API responses
- **Rate Limiting**: Implement request throttling with TTL
- **Temporary Storage**: Store computation results or temporary state
- **Queue Management**: Simple in-memory job queue with TTL

## Comparison with Alternatives

| Feature | nope-redis | node-cache | memory-cache |
|---------|------------|------------|--------------|
| Performance | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Batch Operations | ✅ | ❌ | ❌ |
| Eviction Policies | LRU, LFU, TTL | LRU | None |
| Memory Limits | ✅ | ❌ | ❌ |
| Statistics | Comprehensive | Basic | Basic |
| Zero Dependencies | ✅ | ❌ | ✅ |

## Limitations

- **Single Process**: Not suitable for distributed systems
- **No Persistence**: Data is lost on restart
- **Memory Bound**: Limited by available heap memory
- **Second Precision**: TTL precision is in seconds, not milliseconds

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Author

Orhan Aydogdu ([orhanayd](https://github.com/orhanayd))

## Links

- [GitHub Repository](https://github.com/orhanayd/no-redis)
- [NPM Package](https://www.npmjs.com/package/nope-redis)
- [Issue Tracker](https://github.com/orhanayd/no-redis/issues)
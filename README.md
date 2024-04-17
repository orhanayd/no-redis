### nope-redis
### Simple & Fast Node.JS memory caching

- **Support:** object, array, string, integer, boolean, hex store, function, WHAT YOU WANT.
- **Full-featured:** A simple caching system with `setItem`, `getItem`, and `deleteItem` methods, designed to function similar to Redis. Keys in this system can have a specified timeout (`ttl`), after which they expire and are automatically deleted from the cache. All keys are stored within a single object, so the practical limit is approximately 1 million keys.

#### Prerequisite:
- Node.js, at least v12 >

# Examples:

## Initialize (INIT):

```js
const nopeRedis = require("nope-redis");
```

## Store a key (setItem):
Sets a key value pair. It is possible to define a ttl (in seconds). Returns true on success.
```js
let obj = { name: "orhan", age: 26 };
 
result = nopeRedis.setItem("user1", obj,  10 );
// true
```

## Retrieve a key (getItem):
Gets a saved value from the cache. Returns a null if not found or expired. If the value was found it returns the value.
```js 
result = nopeRedis.getItem("user1");
if(!result){
	// no data
}
// { name: "orhan", age: 26 }
```

## Delete a key (deleteItem):
Delete a key. Returns the true or false.

```js 
result = nopeRedis.deleteItem("user1");
// true
```

## Retrieve stats of key (itemStats):
It is used to get statistics and general information of a key.
```js 
result = nopeRedis.itemStats("user1");
if(!result){
	// no data
}
// { expires_at: 789541503 , remaining_seconds: 260, hit: 1995 }
```

## Flush all keys (flushAll)
Flush all data.
```js 
result = nopeRedis.flushAll();
// true
```

## Stop Service (SERVICE_KILL)
Stops the "nope-redis" service.
```js 
result = nopeRedis.SERVICE_KILL();
// true
```
## Start SERVICE (SERVICE_START)
Start the "nope-redis" service. **IT STARTS AUTOMATICALLY BY DEFAULT.** YOU DON'T NEED THIS. JUST USE WHEN YOU "SERVICE_KILL"
```js 
result = nopeRedis.SERVICE_START();
// true
```
## Store Statistics (stats)
Returns the statistics and information.
```js
result = nopeRedis.stats({ showKeys: true, showTotal: true, showSize: true });
/*
		{
		    "status": true,
			"killerIsFinished": true,
			"lastKiller": 1647245881,
			"nextKiller": 1647245886,
			"criticalError": 0,
			"totalHits": 0,
			"total": 0,
			"keys": [],
			"size": "0 bytes"
		}
*/
```

- **status:** nope-redis service status.
- **killerIsFinished:** The ttl value indicates whether the function is finished deleting obsolete values.
- **lastKiller:** The unix timestamp value of the last time old values were deleted.
- **nextKiller:** The unix timestamp value when it will delete old values.
- **criticalError:** is the value of how many times it gets critical errors and therefore how many times it reboots itself "nope-redis".
- **totalHits:** global total hits (total get item count)
- **total:** Key count
- **keys:** Array of all existing keys.
- **size:** Value size count in approximately file size (Bytes, KB, MB, GB, TB)

### Bencmark:
- MacBook Pro 2015 i5 2,3 GHz 8 GB,
- Node.JS v16.10.0

| TEST  | total set/get  | seconds  |
| ------------ | ------------ | ------------ |
| setItem   | 1  | 137 μs (0 s + 136603 ns)  |
| getItem   | 1  | ~44 μs (0 s + 43732 ns)  |

| TEST  | total set/get  | seconds  |
| ------------ | ------------ | ------------ |
| setItem   | 250.000  | 148 ms (0 s + 147908556 ns)  |
| getItem   | 250.000  | ok ~69 ms (0 s + 69199889 ns)  |

The second it takes in total to set or get 250.000 records.

## Notes:
- key must be string,
- default ttl is 30 seconds
- If you activate memoryStats calculation, it will operate every 1 hour.
- Data that is due for deletion is purged in bulk every 5 seconds.
- On average, it consumes around 6-7 MB when idle.
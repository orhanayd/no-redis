### no-redis
### Simple & Fast Node.JS memory caching

- **Support ** hex store, object, array, string, integer, boolean....
- **Full-featured:** A simple caching setItem, getItem and deleteItem methods and works a like redis. Keys can have a timeout (ttl) after which they expire and are deleted from the cache. All keys are stored in a single object so the practical limit is at around 1m keys.

# Examples:

## Initialize (INIT):

```js
const noRedis = require( "no-redis" );
```

## Store a key (setItem):
Sets a key value pair. It is possible to define a ttl (in seconds). Returns true on success.
```js
let obj = { name: "orhan", age: 26 };
 
result = noRedis.setItem( "user1", obj,  10 );
// true
```

## Retrieve a key (getItem):
Gets a saved value from the cache. Returns a null if not found or expired. If the value was found it returns the value.
```js 
result = noRedis.getItem( "user1");
if(!result){
	// no data
}
// { name: "orhan", age: 26 }
```

## Delete a key (deleteItem):
Delete a key. Returns the true or false.

```js 
result = noRedis.deleteItem( "user1");
// true
```
## Flush all keys (flushAll)
Flush all data.
```js 
result = noRedis.flushAll();
// true
```

## Store Statistics (stats)
Returns the statistics.
```js
result = noRedis.stats({ showKeys: true, showTotal: true, showSize: true });
/*
		{
			"killerIsFinished": true,
			"lastKiller": 1647245881,
			"nextKiller": 1647245886,
			"criticalError": 0,
			"total": 0,
			"keys": [],
			"size": "0 bytes"
		}
*/
```
**killerIsFinished: ** The ttl value indicates whether the function is finished deleting obsolete values.
**lastKiller:** The unix timestamp value of the last time old values were deleted.
**nextKiller:** The unix timestamp value when it will delete old values.
**criticalError: ** is the value of how many times it gets critical errors and therefore how many times it reboots itself "no-redis".
**total:** Key count
**keys: ** Array of all existing keys.
**size: ** Value size count in approximately file size (Bytes, KB, MB, GB, TB)
## Notes:
- key must be string,
- default ttl is 30 seconds

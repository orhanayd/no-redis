let defaultTtl = 30;
let isMemoryStatsEnabled = false;
let criticalError = 0;

const memory = {
    config: {
        killerIsFinished: true,
        lastKiller: 0,
        nextKiller: 0,
        totalHits: 0,
        intervalSecond: 5,
        nextMemoryStatsTime: 0,
        memoryStats: {}
    },
    store: {}
};


/**
 * no-redis config
 * 
 * @param {object} options 
 * @returns {boolean}
 */
module.exports.config = (options = { isMemoryStatsEnabled, defaultTtl }) => {
    try {
        if (typeof options === 'object') {
            if (options.isMemoryStatsEnabled === true || options.isMemoryStatsEnabled === false) {
                isMemoryStatsEnabled = options.isMemoryStatsEnabled;
            }
            if (options.defaultTtl && options.defaultTtl > 0) {
                defaultTtl = options.defaultTtl;
            }
            return true;
        }
    } catch (error) {
        console.error('no redis - config error', error);
    }
    return false;
}

/**
 * set item to no-redis
 * 
 * @param {string} key 
 * @param {*} value 
 * @param {number} ttl 
 * @returns {Boolean}
 */
module.exports.setItem = (key, value, ttl = defaultTtl) => {
    try {
        if (typeof key !== 'string') {
            console.error('no-redis -> key must be string!')
            return false;
        }
        if (typeof ttl !== 'number') {
            console.error('no-redis -> key must be number!');
            return false;
        }
        ttl = parseInt(ttl, 10);
        memory.store[`${key}`] = {
            value: null,
            hit: 0,
            expires_at: null
        };
        memory.store[`${key}`].value = value;
        memory.store[`${key}`].hit = 0;
        memory.store[`${key}`].expires_at = (Math.floor(new Date() / 1000) + ttl);
        return true;
    } catch (error) {
        console.error('no-redis -> Cant Set Error! ', error);
        return false;
    }
}

/**
 * get item stats
 * 
 * @param {string} key 
 * @returns {object}
 */
module.exports.itemStats = (key) => {
    try {
        if (memory.store[`${key}`]) {
            return {
                expires_at: memory.store[`${key}`].expires_at,
                remaining_seconds: (memory.store[`${key}`].expires_at - (Math.floor(new Date() / 1000))),
                hit: memory.store[`${key}`].hit
            };
        }
        return null;
    } catch (error) {
        console.error('no-redis -> Cant get item stats Error! ', error);
        return false;
    }
}

/**
 * get item from no-redis
 * 
 * @param {string} key 
 * @returns {*}
 */
module.exports.getItem = (key) => {
    try {
        if (typeof key !== 'string') {
            console.error('no-redis -> key must be string!')
            return false;
        }
        if (memory.store[`${key}`] && memory.store[`${key}`].expires_at > (Math.floor(new Date() / 1000))) {
            memory.store[`${key}`].hit++;
            memory.config.totalHits++;
            return memory.store[`${key}`].value;
        }
        return null;
    } catch (error) {
        console.error('no-redis -> Crital error! ', error);
        return false;
    }
}


/**
 * delete item from no-redis
 * 
 * @param {string} key 
 * @returns {Boolean}
 */
module.exports.deleteItem = (key) => {
    try {
        if (memory.store[`${key}`]) {
            memory.store[`${key}`].value = null;
            memory.store[`${key}`].hit = null;
            memory.store[`${key}`].expires_at = null;
            delete memory.store[`${key}`];
        }
        return true;
    } catch (error) {
        console.error('no-redis -> Cant delete item', error);
        return false;
    }
}

/**
 * flush all data
 * 
 * @returns {Boolean}
 */
module.exports.flushAll = () => {
    try {
        defaultMemory();
        return true;
    } catch (error) {
        console.error('no-redis -> Cant flush!', error);
        return false;
    }
}

/**
 * get stats from noRedis
 * 
 * @param {object} config 
 * @returns {object}
 */
module.exports.stats = (config = { showKeys: true, showTotal: true, showSize: false }) => {
    try {
        let result = {
            killerIsFinished: memory.config.killerIsFinished,
            lastKiller: memory.config.lastKiller,
            nextKiller: memory.config.nextKiller,
            criticalError,
            defaultTtl,
            totalHits: memory.config.totalHits,
            isMemoryStatsEnabled
        };
        if (isMemoryStatsEnabled) {
            result.nextMemoryStatsTime = memory.config.nextMemoryStatsTime;
        }
        if (config.showTotal) {
            result.total = Object.keys(memory.store).length;
        }
        if (config.showSize) {
            result.size = roughSizeOfObject(memory.store);
        }
        if (config.showKeys) {
            result.keys = Object.keys(memory.store);
        }
        if (isMemoryStatsEnabled) {
            result.memoryStats = memory.config.memoryStats;
        }
        return result;
    } catch (error) {
        console.error('no-redis - stats error!', error);
        return false;
    }
}

/**
 * reset no-redis
 * 
 * @returns {Boolean}
 */
function defaultMemory() {
    try {
        const defaultMemory = {
            config: {
                killerIsFinished: true,
                lastKiller: 0,
                nextKiller: 0,
                totalHits: 0,
                intervalSecond: 5
            },
            store: {}
        };
        memory.store = defaultMemory.store;
        memory.config = defaultMemory.config;
    } catch (error) {
        console.error('no-redis -> Cant default memory!', error);
        return false;
    }
}

/**
 * get object size
 * 
 * @param {object} object 
 * @returns {string}
 */
function roughSizeOfObject(object) {
    try {
        function formatSizeUnits(bytes) {
            if (bytes >= 1073741824) { bytes = (bytes / 1073741824).toFixed(2) + " GB"; }
            else if (bytes >= 1048576) { bytes = (bytes / 1048576).toFixed(2) + " MB"; }
            else if (bytes >= 1024) { bytes = (bytes / 1024).toFixed(2) + " KB"; }
            else if (bytes > 1) { bytes = bytes + " bytes"; }
            else if (bytes == 1) { bytes = bytes + " byte"; }
            else { bytes = "0 bytes"; }
            return bytes;
        }
        let objectList = [];
        let stack = [object];
        let bytes = 0;

        while (stack.length) {
            let value = stack.pop();

            if (typeof value === 'boolean') {
                bytes += 4;
            }
            else if (typeof value === 'string') {
                bytes += value.length * 2;
            }
            else if (typeof value === 'number') {
                bytes += 8;
            }
            else if (typeof value === 'object' &&
                objectList.indexOf(value) === -1
            ) {
                objectList.push(value);
                for (let i in value) {
                    stack.push(value[i]);
                }
            }
        }
        return formatSizeUnits(bytes);
    } catch (error) {
        console.error('no-redis - roughSizeOfObject error!', error);
        return 'Error !';
    }
}

async function memoryStats() {
    try {
        const date = new Date();
        memory.config.memoryStats[`${date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() + 'T' + date.getHours() + ':' + date.getMinutes()}`] = roughSizeOfObject(memory.store);
    } catch (error) {
        console.error('no-redis - error!', error);
        return false;
    }
}

/**
 * deleter for expired key
 */
function killer() {
    memory.config.killerIsFinished = false;
    for (const property in memory.store) {
        if (memory.store[`${property} `].expires_at < (Math.floor(new Date() / 1000))) {
            memory.store[`${property} `] = null;
            delete memory.store[`${property} `];
        }
    }
    memory.config.killerIsFinished = true;
    memory.config.lastKiller = (Math.floor(new Date() / 1000));
    if (isMemoryStatsEnabled) {
        if ((Math.floor(new Date() / 1000)) >= memory.config.nextMemoryStatsTime) {
            memoryStats();
            memory.config.nextMemoryStatsTime = ((Math.floor(new Date() / 1000) + 1 * 60 * 60));
        }
    }
}

/**
 * init runner
 */
function runner() {
    try {
        let runnerInterval = setInterval(function () {
            try {
                if (memory.config.killerIsFinished) {
                    killer();
                }
                memory.config.nextKiller = (Math.floor(new Date() / 1000) + memory.config.intervalSecond);
            } catch (error) {
                console.error('no-redis - Critical Error flushed all data! > ', error);
                criticalError++;
                defaultMemory();
                clearInterval(runnerInterval);
                runner();
            }
        }, (memory.config.intervalSecond * 1000));
    } catch (error) {
        console.error('no-redis - Critical Error flushed all data! > ', error);
        criticalError++;
        defaultMemory();
        return false;
    }
}

runner();
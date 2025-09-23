const nopeRedis = require('../index');

describe('Comprehensive Data Types Tests', () => {
    beforeEach(async () => {
        await nopeRedis.SERVICE_START();
        nopeRedis.flushAll();
    });

    afterEach(async () => {
        nopeRedis.flushAll();
        await nopeRedis.SERVICE_KILL();
    });

    describe('Primitive Types', () => {
        test('should handle boolean values', () => {
            nopeRedis.setItem('bool-true', true);
            nopeRedis.setItem('bool-false', false);

            expect(nopeRedis.getItem('bool-true')).toBe(true);
            expect(nopeRedis.getItem('bool-false')).toBe(false);
            expect(typeof nopeRedis.getItem('bool-true')).toBe('boolean');
        });

        test('should handle string values of different sizes', () => {
            const emptyStr = '';
            const shortStr = 'test';
            const mediumStr = 'a'.repeat(100);
            const unicodeStr = '你好世界 🌍 مرحبا بالعالم';
            const specialChars = '!@#$%^&*()_+-=[]{}|;:"<>,.?/\\`~';

            nopeRedis.setItem('empty', emptyStr);
            nopeRedis.setItem('short', shortStr);
            nopeRedis.setItem('medium', mediumStr);
            nopeRedis.setItem('unicode', unicodeStr);
            nopeRedis.setItem('special', specialChars);

            expect(nopeRedis.getItem('empty')).toBe('');
            expect(nopeRedis.getItem('short')).toBe('test');
            expect(nopeRedis.getItem('medium').length).toBe(100);
            expect(nopeRedis.getItem('unicode')).toBe(unicodeStr);
            expect(nopeRedis.getItem('special')).toBe(specialChars);
        });

        test('should handle number values of different types', () => {
            const integer = 42;
            const negative = -100;
            const float = 3.14159;
            const zero = 0;
            const negZero = -0;
            const maxInt = Number.MAX_SAFE_INTEGER;
            const minInt = Number.MIN_SAFE_INTEGER;
            const infinity = Infinity;
            const negInfinity = -Infinity;
            const nan = NaN;
            const scientific = 1.23e-10;
            const hexNum = 0xFF;
            const octalNum = 0o77;
            const binaryNum = 0b1111;

            nopeRedis.setItem('int', integer);
            nopeRedis.setItem('neg', negative);
            nopeRedis.setItem('float', float);
            nopeRedis.setItem('zero', zero);
            nopeRedis.setItem('negZero', negZero);
            nopeRedis.setItem('maxInt', maxInt);
            nopeRedis.setItem('minInt', minInt);
            nopeRedis.setItem('inf', infinity);
            nopeRedis.setItem('negInf', negInfinity);
            nopeRedis.setItem('nan', nan);
            nopeRedis.setItem('sci', scientific);
            nopeRedis.setItem('hex', hexNum);
            nopeRedis.setItem('octal', octalNum);
            nopeRedis.setItem('binary', binaryNum);

            expect(nopeRedis.getItem('int')).toBe(42);
            expect(nopeRedis.getItem('neg')).toBe(-100);
            expect(nopeRedis.getItem('float')).toBe(3.14159);
            expect(nopeRedis.getItem('zero')).toBe(0);
            expect(Object.is(nopeRedis.getItem('negZero'), -0)).toBe(true);
            expect(nopeRedis.getItem('maxInt')).toBe(Number.MAX_SAFE_INTEGER);
            expect(nopeRedis.getItem('minInt')).toBe(Number.MIN_SAFE_INTEGER);
            expect(nopeRedis.getItem('inf')).toBe(Infinity);
            expect(nopeRedis.getItem('negInf')).toBe(-Infinity);
            expect(Number.isNaN(nopeRedis.getItem('nan'))).toBe(true);
            expect(nopeRedis.getItem('sci')).toBe(1.23e-10);
            expect(nopeRedis.getItem('hex')).toBe(255);
            expect(nopeRedis.getItem('octal')).toBe(63);
            expect(nopeRedis.getItem('binary')).toBe(15);
        });

        test('should handle undefined and null', () => {
            const obj = {
                undefinedVal: undefined,
                nullVal: null
            };

            nopeRedis.setItem('undef', undefined);
            nopeRedis.setItem('null', null);
            nopeRedis.setItem('obj', obj);

            expect(nopeRedis.getItem('undef')).toBe(undefined);
            expect(nopeRedis.getItem('null')).toBe(null);
            expect(nopeRedis.getItem('obj').undefinedVal).toBe(undefined);
            expect(nopeRedis.getItem('obj').nullVal).toBe(null);
        });

        test('should handle symbols', () => {
            const sym1 = Symbol('test');
            const sym2 = Symbol.for('global');
            const sym3 = Symbol.iterator;

            nopeRedis.setItem('sym1', sym1);
            nopeRedis.setItem('sym2', sym2);
            nopeRedis.setItem('sym3', sym3);

            expect(typeof nopeRedis.getItem('sym1')).toBe('symbol');
            expect(typeof nopeRedis.getItem('sym2')).toBe('symbol');
            expect(nopeRedis.getItem('sym3')).toBe(Symbol.iterator);
        });

        test('should handle BigInt', () => {
            const bigInt1 = BigInt(9007199254740991);
            const bigInt2 = BigInt('123456789012345678901234567890');
            const bigInt3 = 123n;

            nopeRedis.setItem('big1', bigInt1);
            nopeRedis.setItem('big2', bigInt2);
            nopeRedis.setItem('big3', bigInt3);

            expect(typeof nopeRedis.getItem('big1')).toBe('bigint');
            expect(nopeRedis.getItem('big1')).toBe(bigInt1);
            expect(nopeRedis.getItem('big2')).toBe(bigInt2);
            expect(nopeRedis.getItem('big3')).toBe(123n);
        });
    });

    describe('Object Types', () => {
        test('should handle plain objects', () => {
            const simple = { a: 1, b: 2 };
            const nested = {
                level1: {
                    level2: {
                        level3: {
                            value: 'deep'
                        }
                    }
                }
            };
            const mixed = {
                str: 'string',
                num: 123,
                bool: true,
                arr: [1, 2, 3],
                obj: { nested: true }
            };

            nopeRedis.setItem('simple', simple);
            nopeRedis.setItem('nested', nested);
            nopeRedis.setItem('mixed', mixed);

            expect(nopeRedis.getItem('simple')).toEqual(simple);
            expect(nopeRedis.getItem('nested').level1.level2.level3.value).toBe('deep');
            expect(nopeRedis.getItem('mixed')).toEqual(mixed);
        });

        test('should handle arrays', () => {
            const empty = [];
            const numbers = [1, 2, 3, 4, 5];
            const mixed = [1, 'two', true, null, undefined, { key: 'value' }];
            const nested = [[1, 2], [3, 4], [[5, 6]]];
            const sparse = [1, , , 4]; // sparse array

            nopeRedis.setItem('empty', empty);
            nopeRedis.setItem('numbers', numbers);
            nopeRedis.setItem('mixed', mixed);
            nopeRedis.setItem('nested', nested);
            nopeRedis.setItem('sparse', sparse);

            expect(nopeRedis.getItem('empty')).toEqual([]);
            expect(nopeRedis.getItem('numbers')).toEqual(numbers);
            expect(nopeRedis.getItem('mixed')[5]).toEqual({ key: 'value' });
            expect(nopeRedis.getItem('nested')[2][0]).toEqual([5, 6]);
            expect(nopeRedis.getItem('sparse')[2]).toBe(undefined);
        });

        test('should handle dates', () => {
            const now = new Date();
            const past = new Date('2000-01-01');
            const future = new Date('2100-12-31');
            const epoch = new Date(0);
            const invalid = new Date('invalid');

            nopeRedis.setItem('now', now);
            nopeRedis.setItem('past', past);
            nopeRedis.setItem('future', future);
            nopeRedis.setItem('epoch', epoch);
            nopeRedis.setItem('invalid', invalid);

            expect(nopeRedis.getItem('now')).toEqual(now);
            expect(nopeRedis.getItem('past')).toEqual(past);
            expect(nopeRedis.getItem('future')).toEqual(future);
            expect(nopeRedis.getItem('epoch').getTime()).toBe(0);
            expect(Number.isNaN(nopeRedis.getItem('invalid').getTime())).toBe(true);
        });

        test('should handle regular expressions', () => {
            const simple = /test/;
            const flags = /test/gim;
            const complex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
            const unicode = /[\u4e00-\u9fa5]/;

            nopeRedis.setItem('simple', simple);
            nopeRedis.setItem('flags', flags);
            nopeRedis.setItem('complex', complex);
            nopeRedis.setItem('unicode', unicode);

            expect(nopeRedis.getItem('simple')).toEqual(/test/);
            expect(nopeRedis.getItem('flags').flags).toBe('gim');
            expect(nopeRedis.getItem('complex').test('test@example.com')).toBe(true);
            expect(nopeRedis.getItem('unicode').test('中文')).toBe(true);
        });

        test('should handle errors', () => {
            const error = new Error('Test error');
            const typeError = new TypeError('Type error');
            const customError = new Error('Custom');
            customError.code = 'CUSTOM_ERROR';
            customError.details = { foo: 'bar' };

            nopeRedis.setItem('error', error);
            nopeRedis.setItem('typeError', typeError);
            nopeRedis.setItem('customError', customError);

            expect(nopeRedis.getItem('error')).toBeInstanceOf(Error);
            expect(nopeRedis.getItem('error').message).toBe('Test error');
            expect(nopeRedis.getItem('typeError')).toBeInstanceOf(TypeError);
            expect(nopeRedis.getItem('customError').code).toBe('CUSTOM_ERROR');
            expect(nopeRedis.getItem('customError').details).toEqual({ foo: 'bar' });
        });
    });

    describe('Built-in Objects', () => {
        test('should handle Map', () => {
            const map = new Map();
            map.set('string', 'value');
            map.set(123, 'number key');
            map.set(true, 'boolean key');
            map.set({ obj: true }, 'object key');
            map.set(null, 'null key');

            nopeRedis.setItem('map', map);
            const retrieved = nopeRedis.getItem('map');

            expect(retrieved).toBeInstanceOf(Map);
            expect(retrieved.get('string')).toBe('value');
            expect(retrieved.get(123)).toBe('number key');
            expect(retrieved.get(true)).toBe('boolean key');
            expect(retrieved.get(null)).toBe('null key');
            expect(retrieved.size).toBe(5);
        });

        test('should handle Set', () => {
            const set = new Set();
            set.add('string');
            set.add(123);
            set.add(true);
            set.add(null);
            set.add({ obj: true });
            set.add('string'); // duplicate, should not be added

            nopeRedis.setItem('set', set);
            const retrieved = nopeRedis.getItem('set');

            expect(retrieved).toBeInstanceOf(Set);
            expect(retrieved.has('string')).toBe(true);
            expect(retrieved.has(123)).toBe(true);
            expect(retrieved.has(true)).toBe(true);
            expect(retrieved.has(null)).toBe(true);
            expect(retrieved.size).toBe(5); // duplicate not counted
        });

        test('should handle WeakMap and WeakSet', () => {
            const obj1 = { id: 1 };
            const obj2 = { id: 2 };

            const weakMap = new WeakMap();
            weakMap.set(obj1, 'value1');
            weakMap.set(obj2, 'value2');

            const weakSet = new WeakSet();
            weakSet.add(obj1);
            weakSet.add(obj2);

            nopeRedis.setItem('weakMap', weakMap);
            nopeRedis.setItem('weakSet', weakSet);

            // WeakMap and WeakSet cannot be properly serialized
            // but should not throw errors
            expect(() => nopeRedis.getItem('weakMap')).not.toThrow();
            expect(() => nopeRedis.getItem('weakSet')).not.toThrow();
        });
    });

    describe('Typed Arrays', () => {
        test('should handle all typed array types', () => {
            const int8 = new Int8Array([127, -128, 0]);
            const uint8 = new Uint8Array([255, 128, 0]);
            const uint8Clamped = new Uint8ClampedArray([300, -10, 128]); // will be clamped
            const int16 = new Int16Array([32767, -32768, 0]);
            const uint16 = new Uint16Array([65535, 32768, 0]);
            const int32 = new Int32Array([2147483647, -2147483648, 0]);
            const uint32 = new Uint32Array([4294967295, 2147483648, 0]);
            const float32 = new Float32Array([3.14, -1.5, 0.0]);
            const float64 = new Float64Array([Math.PI, Math.E, -0.0]);
            const bigInt64 = new BigInt64Array([9223372036854775807n, -9223372036854775808n]);
            const bigUint64 = new BigUint64Array([18446744073709551615n, 0n]);

            nopeRedis.setItem('int8', int8);
            nopeRedis.setItem('uint8', uint8);
            nopeRedis.setItem('uint8Clamped', uint8Clamped);
            nopeRedis.setItem('int16', int16);
            nopeRedis.setItem('uint16', uint16);
            nopeRedis.setItem('int32', int32);
            nopeRedis.setItem('uint32', uint32);
            nopeRedis.setItem('float32', float32);
            nopeRedis.setItem('float64', float64);
            nopeRedis.setItem('bigInt64', bigInt64);
            nopeRedis.setItem('bigUint64', bigUint64);

            expect(nopeRedis.getItem('int8')).toBeInstanceOf(Int8Array);
            expect(Array.from(nopeRedis.getItem('int8'))).toEqual([127, -128, 0]);
            expect(nopeRedis.getItem('uint8')).toBeInstanceOf(Uint8Array);
            expect(nopeRedis.getItem('uint8Clamped')).toBeInstanceOf(Uint8ClampedArray);
            expect(Array.from(nopeRedis.getItem('uint8Clamped'))).toEqual([255, 0, 128]);
            expect(nopeRedis.getItem('float32')[0]).toBeCloseTo(3.14, 5);
            expect(nopeRedis.getItem('float64')[0]).toBe(Math.PI);
            expect(nopeRedis.getItem('bigInt64')[0]).toBe(9223372036854775807n);
        });

        test('should handle ArrayBuffer and DataView', () => {
            const buffer = new ArrayBuffer(16);
            const view = new DataView(buffer);
            view.setInt32(0, 42);
            view.setFloat64(8, Math.PI);

            nopeRedis.setItem('buffer', buffer);
            nopeRedis.setItem('view', view);

            const retrievedBuffer = nopeRedis.getItem('buffer');
            const retrievedView = nopeRedis.getItem('view');

            expect(retrievedBuffer).toBeInstanceOf(ArrayBuffer);
            expect(retrievedView).toBeInstanceOf(DataView);

            const newView = new DataView(retrievedView.buffer);
            expect(newView.getInt32(0)).toBe(42);
            expect(newView.getFloat64(8)).toBe(Math.PI);
        });
    });

    describe('Functions', () => {
        test('should handle different function types', () => {
            function regularFunc(x) {
                return x * 2;
            }

            const arrowFunc = (x) => x * 3;

            const asyncFunc = async function(x) {
                return x * 4;
            };

            const generatorFunc = function*(x) {
                yield x;
                yield x * 2;
            };

            const constructorFunc = function Person(name) {
                this.name = name;
            };

            nopeRedis.setItem('regular', regularFunc);
            nopeRedis.setItem('arrow', arrowFunc);
            nopeRedis.setItem('async', asyncFunc);
            nopeRedis.setItem('generator', generatorFunc);
            nopeRedis.setItem('constructor', constructorFunc);

            expect(typeof nopeRedis.getItem('regular')).toBe('function');
            expect(nopeRedis.getItem('regular')(5)).toBe(10);
            expect(nopeRedis.getItem('arrow')(5)).toBe(15);
            expect(nopeRedis.getItem('async')(5)).toBeInstanceOf(Promise);

            const gen = nopeRedis.getItem('generator')(3);
            expect(gen.next().value).toBe(3);
            expect(gen.next().value).toBe(6);

            const Person = nopeRedis.getItem('constructor');
            const person = new Person('John');
            expect(person.name).toBe('John');
        });

        test('should handle functions with closures', () => {
            const outer = function(x) {
                return function(y) {
                    return x + y;
                };
            };

            const closure = outer(10);

            nopeRedis.setItem('closure', closure);
            const retrieved = nopeRedis.getItem('closure');

            expect(typeof retrieved).toBe('function');
            expect(retrieved(5)).toBe(15);
        });
    });

    describe('Buffer and Binary Data', () => {
        test('should handle Buffer objects', () => {
            const buffer1 = Buffer.from('hello world', 'utf8');
            const buffer2 = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF]);
            const buffer3 = Buffer.alloc(10, 'a');
            const buffer4 = Buffer.from('48656c6c6f', 'hex');
            const buffer5 = Buffer.from('SGVsbG8gV29ybGQ=', 'base64');

            nopeRedis.setItem('buf1', buffer1);
            nopeRedis.setItem('buf2', buffer2);
            nopeRedis.setItem('buf3', buffer3);
            nopeRedis.setItem('buf4', buffer4);
            nopeRedis.setItem('buf5', buffer5);

            expect(Buffer.isBuffer(nopeRedis.getItem('buf1'))).toBe(true);
            expect(nopeRedis.getItem('buf1').toString()).toBe('hello world');
            expect(nopeRedis.getItem('buf2')[4]).toBe(0xFF);
            expect(nopeRedis.getItem('buf3').length).toBe(10);
            expect(nopeRedis.getItem('buf4').toString()).toBe('Hello');
            expect(nopeRedis.getItem('buf5').toString()).toBe('Hello World');
        });
    });

    describe('Circular References', () => {
        test('should handle circular object references', () => {
            const obj1 = { name: 'obj1', children: [] };
            const obj2 = { name: 'obj2', parent: obj1 };
            obj1.children.push(obj2);
            obj2.self = obj2; // self reference

            nopeRedis.setItem('circular', obj1);
            const retrieved = nopeRedis.getItem('circular');

            expect(retrieved.name).toBe('obj1');
            expect(retrieved.children[0].name).toBe('obj2');
            expect(retrieved.children[0].parent).toBe(retrieved);
            expect(retrieved.children[0].self).toBe(retrieved.children[0]);
        });

        test('should handle circular array references', () => {
            const arr = [1, 2, 3];
            arr.push(arr); // circular reference

            nopeRedis.setItem('circularArr', arr);
            const retrieved = nopeRedis.getItem('circularArr');

            expect(retrieved[0]).toBe(1);
            expect(retrieved[3]).toBe(retrieved);
        });
    });

    describe('Memory Size Estimation', () => {
        test('should correctly estimate sizes for different types', () => {
            // Test boolean (4 bytes)
            nopeRedis.setItem('testBool', true);

            // Test string (length * 2 bytes)
            nopeRedis.setItem('testString', 'hello'); // 10 bytes

            // Test number (8 bytes)
            nopeRedis.setItem('testNumber', 42);

            // Test object (JSON.stringify.length * 2)
            nopeRedis.setItem('testObject', { a: 1, b: 2 });

            const stats = nopeRedis.stats({ showSize: true });
            expect(stats.currentMemorySize).toBeDefined();
            expect(typeof stats.currentMemorySize).toBe('string');
            expect(stats.currentMemorySize).not.toBe('0 bytes');
        });
    });
});
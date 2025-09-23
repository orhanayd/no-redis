const nopeRedis = require('../index');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

describe('Edge Cases and Special Data Types', () => {
    beforeEach(async () => {
        await nopeRedis.SERVICE_START();
        nopeRedis.flushAll();
    });

    afterEach(async () => {
        nopeRedis.flushAll();
        await nopeRedis.SERVICE_KILL();
    });

    describe('Cryptographic Data', () => {
        test('should store and retrieve crypto hashes', () => {
            const hash1 = crypto.createHash('sha256').update('test').digest();
            const hash2 = crypto.createHash('md5').update('test').digest('hex');
            const hash3 = crypto.createHash('sha512').update('test').digest('base64');

            nopeRedis.setItem('sha256', hash1);
            nopeRedis.setItem('md5', hash2);
            nopeRedis.setItem('sha512', hash3);

            expect(Buffer.isBuffer(nopeRedis.getItem('sha256'))).toBe(true);
            expect(nopeRedis.getItem('sha256').equals(hash1)).toBe(true);
            expect(nopeRedis.getItem('md5')).toBe(hash2);
            expect(nopeRedis.getItem('sha512')).toBe(hash3);
        });

        test('should store and retrieve encrypted data', () => {
            const algorithm = 'aes-256-cbc';
            const key = crypto.randomBytes(32);
            const iv = crypto.randomBytes(16);

            const cipher = crypto.createCipheriv(algorithm, key, iv);
            let encrypted = cipher.update('Secret Message', 'utf8', 'hex');
            encrypted += cipher.final('hex');

            nopeRedis.setItem('encrypted', encrypted);
            nopeRedis.setItem('key', key);
            nopeRedis.setItem('iv', iv);

            const retrievedEncrypted = nopeRedis.getItem('encrypted');
            const retrievedKey = nopeRedis.getItem('key');
            const retrievedIv = nopeRedis.getItem('iv');

            const decipher = crypto.createDecipheriv(algorithm, retrievedKey, retrievedIv);
            let decrypted = decipher.update(retrievedEncrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            expect(decrypted).toBe('Secret Message');
        });
    });

    describe('Media and File Data', () => {
        test('should store and retrieve image metadata', () => {
            const imageMetadata = {
                filename: 'test.jpg',
                mimeType: 'image/jpeg',
                size: 1024 * 1024 * 2, // 2MB
                dimensions: { width: 1920, height: 1080 },
                exif: {
                    camera: 'Canon EOS 5D',
                    aperture: 'f/2.8',
                    iso: 400
                },
                thumbnail: Buffer.from('fakeImageData'),
                tags: ['nature', 'landscape', 'mountains']
            };

            nopeRedis.setItem('image', imageMetadata);
            const retrieved = nopeRedis.getItem('image');

            expect(retrieved.filename).toBe('test.jpg');
            expect(retrieved.dimensions.width).toBe(1920);
            expect(Buffer.isBuffer(retrieved.thumbnail)).toBe(true);
            expect(retrieved.tags).toContain('mountains');
        });

        test('should store and retrieve audio/video metadata', () => {
            const mediaData = {
                type: 'video',
                codec: 'H.264',
                duration: 3600, // seconds
                bitrate: 4000000, // 4 Mbps
                framerate: 30,
                resolution: '1920x1080',
                audioTracks: [
                    { language: 'en', codec: 'AAC', channels: 2 },
                    { language: 'es', codec: 'AAC', channels: 2 }
                ],
                subtitles: ['en', 'es', 'fr'],
                chapters: [
                    { start: 0, end: 600, title: 'Introduction' },
                    { start: 600, end: 2400, title: 'Main Content' }
                ]
            };

            nopeRedis.setItem('media', mediaData);
            const retrieved = nopeRedis.getItem('media');

            expect(retrieved.type).toBe('video');
            expect(retrieved.audioTracks).toHaveLength(2);
            expect(retrieved.subtitles).toContain('fr');
            expect(retrieved.chapters[0].title).toBe('Introduction');
        });
    });

    describe('Database-like Records', () => {
        test('should store and retrieve SQL-like records', () => {
            const userRecord = {
                id: 1001,
                username: 'john_doe',
                email: 'john@example.com',
                created_at: new Date('2024-01-01T10:00:00Z'),
                updated_at: new Date('2024-01-15T15:30:00Z'),
                profile: {
                    first_name: 'John',
                    last_name: 'Doe',
                    avatar: Buffer.from('avatarImageData'),
                    bio: 'Software developer',
                    settings: {
                        theme: 'dark',
                        notifications: true,
                        privacy: 'friends'
                    }
                },
                permissions: new Set(['read', 'write', 'delete']),
                sessions: new Map([
                    ['session1', { ip: '192.168.1.1', device: 'Chrome' }],
                    ['session2', { ip: '10.0.0.1', device: 'Mobile' }]
                ])
            };

            nopeRedis.setItem('user:1001', userRecord);
            const retrieved = nopeRedis.getItem('user:1001');

            expect(retrieved.id).toBe(1001);
            expect(retrieved.created_at).toEqual(userRecord.created_at);
            expect(Buffer.isBuffer(retrieved.profile.avatar)).toBe(true);
            expect(retrieved.permissions).toBeInstanceOf(Set);
            expect(retrieved.permissions.has('write')).toBe(true);
            expect(retrieved.sessions).toBeInstanceOf(Map);
            expect(retrieved.sessions.get('session1').ip).toBe('192.168.1.1');
        });

        test('should store and retrieve NoSQL-like documents', () => {
            const document = {
                _id: crypto.randomBytes(12).toString('hex'),
                type: 'article',
                title: 'Test Article',
                content: 'Lorem ipsum'.repeat(1000),
                author: {
                    id: 'author123',
                    name: 'Jane Smith'
                },
                tags: ['tech', 'javascript', 'nodejs'],
                metadata: {
                    views: 1000,
                    likes: 50,
                    shares: 20
                },
                comments: [
                    { id: 1, text: 'Great article!', user: 'user1', date: new Date() },
                    { id: 2, text: 'Thanks!', user: 'user2', date: new Date() }
                ],
                revisions: new Map([
                    ['v1', { date: new Date('2024-01-01'), changes: 'Initial version' }],
                    ['v2', { date: new Date('2024-01-02'), changes: 'Fixed typos' }]
                ])
            };

            nopeRedis.setItem(`doc:${document._id}`, document);
            const retrieved = nopeRedis.getItem(`doc:${document._id}`);

            expect(retrieved._id).toBe(document._id);
            expect(retrieved.content.length).toBeGreaterThan(10000);
            expect(retrieved.comments).toHaveLength(2);
            expect(retrieved.revisions.get('v1').changes).toBe('Initial version');
        });
    });

    describe('Scientific and Mathematical Data', () => {
        test('should store and retrieve mathematical structures', () => {
            const mathData = {
                matrix: [
                    [1, 2, 3],
                    [4, 5, 6],
                    [7, 8, 9]
                ],
                vector: new Float64Array([1.1, 2.2, 3.3, 4.4]),
                complex: { real: 3, imaginary: 4 },
                infinity: Infinity,
                negInfinity: -Infinity,
                nan: NaN,
                precision: 3.141592653589793,
                scientific: 1.23e-10,
                bigInt: BigInt('9007199254740991'),
                formula: 'E = mc^2',
                dataset: new Float32Array(10000).fill(0).map(() => Math.random())
            };

            nopeRedis.setItem('math', mathData);
            const retrieved = nopeRedis.getItem('math');

            expect(retrieved.matrix[1][1]).toBe(5);
            expect(retrieved.vector).toBeInstanceOf(Float64Array);
            expect(retrieved.infinity).toBe(Infinity);
            expect(retrieved.negInfinity).toBe(-Infinity);
            expect(Number.isNaN(retrieved.nan)).toBe(true);
            expect(retrieved.precision).toBe(Math.PI);
            expect(retrieved.scientific).toBe(1.23e-10);
            expect(typeof retrieved.bigInt).toBe('bigint');
            expect(retrieved.dataset.length).toBe(10000);
        });

        test('should store and retrieve graph structures', () => {
            const graph = {
                nodes: new Map([
                    ['A', { value: 1, connections: ['B', 'C'] }],
                    ['B', { value: 2, connections: ['A', 'D'] }],
                    ['C', { value: 3, connections: ['A', 'D'] }],
                    ['D', { value: 4, connections: ['B', 'C'] }]
                ]),
                edges: [
                    { from: 'A', to: 'B', weight: 1.5 },
                    { from: 'A', to: 'C', weight: 2.0 },
                    { from: 'B', to: 'D', weight: 1.0 },
                    { from: 'C', to: 'D', weight: 3.0 }
                ],
                metadata: {
                    type: 'weighted',
                    directed: false,
                    cyclic: true
                }
            };

            nopeRedis.setItem('graph', graph);
            const retrieved = nopeRedis.getItem('graph');

            expect(retrieved.nodes).toBeInstanceOf(Map);
            expect(retrieved.nodes.get('A').value).toBe(1);
            expect(retrieved.edges).toHaveLength(4);
            expect(retrieved.metadata.type).toBe('weighted');
        });
    });

    describe('Geo and Time Data', () => {
        test('should store and retrieve geospatial data', () => {
            const geoData = {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [125.6, 10.1]
                        },
                        properties: {
                            name: 'Location A',
                            population: 200000
                        }
                    },
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [
                                [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]]
                            ]
                        },
                        properties: {
                            name: 'Area B',
                            area: 'urban'
                        }
                    }
                ],
                crs: 'EPSG:4326',
                bbox: [100.0, 0.0, 101.0, 10.1]
            };

            nopeRedis.setItem('geo', geoData);
            const retrieved = nopeRedis.getItem('geo');

            expect(retrieved.type).toBe('FeatureCollection');
            expect(retrieved.features).toHaveLength(2);
            expect(retrieved.features[0].geometry.coordinates).toEqual([125.6, 10.1]);
            expect(retrieved.crs).toBe('EPSG:4326');
        });

        test('should store and retrieve temporal data', () => {
            const timeData = {
                timestamp: Date.now(),
                date: new Date(),
                timezone: 'America/New_York',
                schedule: {
                    daily: [
                        { hour: 9, minute: 0, task: 'start' },
                        { hour: 17, minute: 30, task: 'end' }
                    ],
                    weekly: new Map([
                        ['monday', ['meeting', 'review']],
                        ['friday', ['deploy', 'test']]
                    ])
                },
                duration: {
                    milliseconds: 3600000,
                    readable: '1 hour',
                    iso8601: 'PT1H'
                },
                ranges: [
                    { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
                    { start: new Date('2024-02-01'), end: new Date('2024-02-29') }
                ]
            };

            nopeRedis.setItem('time', timeData);
            const retrieved = nopeRedis.getItem('time');

            expect(typeof retrieved.timestamp).toBe('number');
            expect(retrieved.date).toBeInstanceOf(Date);
            expect(retrieved.schedule.daily[0].hour).toBe(9);
            expect(retrieved.schedule.weekly.get('monday')).toContain('meeting');
            expect(retrieved.ranges[0].start).toBeInstanceOf(Date);
        });
    });

    describe('Application State and Config', () => {
        test('should store and retrieve application state', () => {
            const appState = {
                version: '1.2.3',
                environment: 'production',
                features: new Set(['feature-a', 'feature-b', 'feature-c']),
                config: {
                    database: {
                        host: 'localhost',
                        port: 5432,
                        ssl: true,
                        pool: {
                            min: 2,
                            max: 10
                        }
                    },
                    cache: {
                        ttl: 3600,
                        prefix: 'app:',
                        driver: 'redis'
                    },
                    api: {
                        endpoints: new Map([
                            ['/users', { method: 'GET', auth: true }],
                            ['/posts', { method: 'POST', auth: true }]
                        ]),
                        rateLimits: {
                            global: 1000,
                            perUser: 100
                        }
                    }
                },
                metrics: {
                    requests: 1000000,
                    errors: 42,
                    uptime: 86400,
                    memory: process.memoryUsage(),
                    cpu: 45.5
                },
                handlers: {
                    onError: function(err) { console.error(err); },
                    onSuccess: function(data) { return data; },
                    middleware: [
                        function auth() { return true; },
                        function validate() { return true; }
                    ]
                }
            };

            nopeRedis.setItem('appState', appState);
            const retrieved = nopeRedis.getItem('appState');

            expect(retrieved.version).toBe('1.2.3');
            expect(retrieved.features).toBeInstanceOf(Set);
            expect(retrieved.features.has('feature-b')).toBe(true);
            expect(retrieved.config.api.endpoints).toBeInstanceOf(Map);
            expect(retrieved.config.api.endpoints.get('/users').auth).toBe(true);
            expect(typeof retrieved.handlers.onError).toBe('function');
            expect(retrieved.handlers.middleware).toHaveLength(2);
            expect(retrieved.metrics.memory.heapUsed).toBeDefined();
        });
    });

    describe('Error Conditions', () => {
        test('should handle extremely large values', () => {
            const veryLargeArray = new Array(100000).fill('x'.repeat(100));
            const result = nopeRedis.setItem('huge', veryLargeArray);
            expect(result).toBe(true);

            const retrieved = nopeRedis.getItem('huge');
            expect(retrieved).toHaveLength(100000);
        });

        test('should handle rapid succession operations', () => {
            const promises = [];
            for (let i = 0; i < 1000; i++) {
                nopeRedis.setItem(`rapid${i}`, { value: i, data: 'test' });
                const value = nopeRedis.getItem(`rapid${i}`);
                expect(value.value).toBe(i);
            }
        });

        test('should handle special JavaScript values', () => {
            const special = {
                undefined: undefined,
                null: null,
                true: true,
                false: false,
                zero: 0,
                negZero: -0,
                emptyString: '',
                emptyArray: [],
                emptyObject: {},
                date: new Date(0),
                regex: new RegExp(''),
                error: new Error('test error'),
                promise: Promise.resolve('test'),
                weakMap: new WeakMap(),
                weakSet: new WeakSet()
            };

            nopeRedis.setItem('special', special);
            const retrieved = nopeRedis.getItem('special');

            expect(retrieved.undefined).toBe(undefined);
            expect(retrieved.null).toBe(null);
            expect(retrieved.true).toBe(true);
            expect(retrieved.false).toBe(false);
            expect(retrieved.zero).toBe(0);
            expect(retrieved.negZero).toBe(-0);
            expect(retrieved.emptyString).toBe('');
            expect(retrieved.emptyArray).toEqual([]);
            expect(retrieved.emptyObject).toEqual({});
            expect(retrieved.date).toEqual(new Date(0));
            expect(retrieved.regex).toEqual(new RegExp(''));
            expect(retrieved.error).toBeInstanceOf(Error);
            expect(retrieved.error.message).toBe('test error');
        });
    });
});
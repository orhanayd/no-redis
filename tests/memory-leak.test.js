const nopeRedis = require('../index');

/**
 * Memory Leak Test
 *
 * 500K yoğun JSON set/get sonrası memory leak kontrolü.
 * TTL sonrası killer'ın cache'leri temizleyip memory'i free bıraktığını doğrular.
 */
describe('Memory Leak - 500K Heavy JSON', () => {
	const TOTAL = 500_000;
	const TTL = 5; // 5 saniye — kısa TTL, hızlı expire
	const CHECKS_PER_CYCLE = 500_000; // Tüm key'leri tek cycle'da tarayabilsin

	beforeAll(async () => {
		await nopeRedis.SERVICE_START();
		nopeRedis.flushAll();
		nopeRedis.config({
			maxMemorySize: 500, // 500MB — eviction karışmasın, saf leak testi
			evictionPolicy: 'lru',
			maxChecksPerCycle: CHECKS_PER_CYCLE,
		});
	});

	afterAll(async () => {
		nopeRedis.flushAll();
		await nopeRedis.SERVICE_KILL();
	});

	function createJsonPayload(i) {
		return {
			id: i,
			username: `user_${i}`,
			email: `user_${i}@example.com`,
			profile: {
				age: 20 + (i % 50),
				city: ['Istanbul', 'Ankara', 'Izmir', 'Bursa', 'Antalya'][i % 5],
				score: Math.random() * 1000,
				tags: [`tag_${i % 10}`, `tag_${i % 20}`, `tag_${i % 30}`],
			},
			metadata: {
				created: Date.now(),
				version: i % 5,
				active: i % 2 === 0,
			},
		};
	}

	test('Phase 1: 500K set — heap stabil kalmalı', () => {
		if (global.gc) global.gc();
		const heapBefore = process.memoryUsage().heapUsed;

		for (let i = 0; i < TOTAL; i++) {
			nopeRedis.setItem(`k_${i}`, createJsonPayload(i), TTL);
		}

		const statsAfterSet = nopeRedis.stats({ showSize: true });
		console.log(`[SET] total keys : ${statsAfterSet.total}`);
		console.log(`[SET] cache size  : ${statsAfterSet.size}`);

		expect(statsAfterSet.total).toBe(TOTAL);

		const heapAfterSet = process.memoryUsage().heapUsed;
		const heapGrowthMB = (heapAfterSet - heapBefore) / (1024 * 1024);
		console.log(`[SET] heap growth : ${heapGrowthMB.toFixed(2)} MB`);

		// Heap büyümesi mantıklı aralıkta olmalı (500K JSON → ~200-800 MB beklenir)
		expect(heapGrowthMB).toBeGreaterThan(0);
		expect(heapGrowthMB).toBeLessThan(2000); // 2GB'ı aşmamalı
	}, 120_000);

	test('Phase 2: 500K get — tüm değerler doğru dönmeli', () => {
		const SAMPLE_SIZE = 10_000; // Her key'i kontrol etmek yerine rastgele örneklem

		let hitCount = 0;
		let nullCount = 0;

		for (let i = 0; i < SAMPLE_SIZE; i++) {
			const idx = Math.floor(Math.random() * TOTAL);
			const val = nopeRedis.getItem(`k_${idx}`);
			if (val !== null && val !== false) {
				expect(val.id).toBe(idx);
				expect(val.username).toBe(`user_${idx}`);
				hitCount++;
			} else {
				nullCount++;
			}
		}

		console.log(`[GET] ${SAMPLE_SIZE} örnekten hit: ${hitCount}, null/expired: ${nullCount}`);
		// Çoğunluğu hâlâ hayatta olmalı (TTL 5s, test hızlı koşar)
		expect(hitCount).toBeGreaterThan(SAMPLE_SIZE * 0.5);

		const statsAfterGet = nopeRedis.stats({ showSize: true });
		console.log(`[GET] totalHits   : ${statsAfterGet.totalHits}`);
		console.log(`[GET] cache size  : ${statsAfterGet.size}`);
	}, 60_000);

	test('Phase 3: TTL sonrası killer temizliği — memory free olmalı', (done) => {
		// TTL 5s + killer 5s cycle interval = ~12s'de tüm key'ler temizlenmeli
		// maxChecksPerCycle=500K → tek cycle'da tüm key'leri tarar
		const WAIT_MS = 14_000;

		const statsBefore = nopeRedis.stats({ showSize: true });
		console.log(`[WAIT] beklemeden önce keys: ${statsBefore.total}, size: ${statsBefore.size}`);

		if (global.gc) global.gc();
		const heapBeforeWait = process.memoryUsage().heapUsed;

		setTimeout(() => {
			try {
				const statsAfter = nopeRedis.stats({ showSize: true });
				console.log(`[CLEANUP] keys kaldı : ${statsAfter.total}`);
				console.log(`[CLEANUP] cache size : ${statsAfter.size}`);
				console.log(`[CLEANUP] eviction   : ${statsAfter.evictionCount}`);

				// maxChecksPerCycle=500K, killer tek cycle'da tüm store'u tarayabilir
				// 14s'de en az 2 cycle döner → tüm expired key'ler silinmiş olmalı
				expect(statsAfter.total).toBe(0);

				// Expire olmuş key'lere erişim null dönmeli
				const expired1 = nopeRedis.getItem('k_0');
				const expired2 = nopeRedis.getItem('k_250000');
				const expired3 = nopeRedis.getItem('k_499999');
				expect(expired1).toBeNull();
				expect(expired2).toBeNull();
				expect(expired3).toBeNull();

				// Cache size sıfırlanmış olmalı
				expect(statsAfter.size).toBe('0 MB');

				// Ek olarak flushAll ile garanti temizlik
				nopeRedis.flushAll();

				const statsClean = nopeRedis.stats({ showSize: true });
				console.log(`[FLUSH] keys  : ${statsClean.total}`);
				console.log(`[FLUSH] size  : ${statsClean.size}`);
				expect(statsClean.total).toBe(0);
				expect(statsClean.size).toBe('0 MB');

				if (global.gc) global.gc();
				const heapAfterCleanup = process.memoryUsage().heapUsed;
				const heapFreedMB = (heapBeforeWait - heapAfterCleanup) / (1024 * 1024);
				console.log(`[HEAP] freed after cleanup: ${heapFreedMB.toFixed(2)} MB`);

				done();
			} catch (err) {
				done(err);
			}
		}, WAIT_MS);
	}, 30_000);

	test('Phase 4: Temiz slate sonrası tekrar yükleme — leak yok', () => {
		// Önceki fazdan kalan varsa temizle
		nopeRedis.flushAll();

		if (global.gc) global.gc();
		const heapBefore = process.memoryUsage().heapUsed;

		const SECOND_BATCH = 50_000;
		for (let i = 0; i < SECOND_BATCH; i++) {
			nopeRedis.setItem(`v2_${i}`, createJsonPayload(i), 30);
		}

		const stats = nopeRedis.stats({ showSize: true });
		console.log(`[RELOAD] keys : ${stats.total}, size: ${stats.size}`);
		expect(stats.total).toBe(SECOND_BATCH);

		const heapAfter = process.memoryUsage().heapUsed;
		const heapGrowthMB = (heapAfter - heapBefore) / (1024 * 1024);
		console.log(`[RELOAD] heap growth: ${heapGrowthMB.toFixed(2)} MB`);

		// 50K key → 500K'nın 1/10'u, heap büyümesi de oransal olmalı
		// Eğer leak varsa burada orantısız büyüme görürüz
		expect(heapGrowthMB).toBeLessThan(500); // 50K için 500MB'ı asla geçmemeli
	}, 60_000);
});

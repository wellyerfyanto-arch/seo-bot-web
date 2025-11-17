const { chromium } = require('playwright');
const fetch = require('node-fetch');

class SEOBot {
    constructor(logCallback = console.log) {
        this.logCallback = logCallback;
        this.browser = null;
        this.page = null;
        this.isRunning = false;
        
        this.userAgents = {
            desktop: [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            mobile: [
                'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
                'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36'
            ]
        };

        // Layanan pihak ketiga untuk test proxy
        this.thirdPartyServices = [
            'https://httpbin.org/ip',
            'https://api.ipify.org?format=json',
            'https://jsonip.com',
            'https://api.myip.com',
            'https://ipinfo.io/json'
        ];
    }

    log(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.logCallback(`[${timestamp}] ${message}`);
    }

    // Test proxy menggunakan layanan pihak ketiga yang ringan
    async testProxyWithThirdParty(proxyString) {
        let controller;
        let timeoutId;

        try {
            // Setup timeout
            controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 10000);

            const startTime = Date.now();
            
            // Coba beberapa layanan pihak ketiga
            for (const service of this.thirdPartyServices) {
                try {
                    const response = await fetch(service, {
                        signal: controller.signal,
                        timeout: 10000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const responseTime = Date.now() - startTime;
                        
                        clearTimeout(timeoutId);
                        return {
                            proxy: proxyString,
                            status: responseTime < 2000 ? 'active' : 'slow',
                            responseTime: responseTime,
                            ip: data.ip || data.origin,
                            method: 'third-party'
                        };
                    }
                } catch (error) {
                    // Coba service berikutnya
                    continue;
                }
            }

            clearTimeout(timeoutId);
            return {
                proxy: proxyString,
                status: 'dead',
                responseTime: 9999,
                error: 'Semua layanan gagal'
            };

        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            return {
                proxy: proxyString,
                status: 'dead',
                responseTime: 9999,
                error: error.message
            };
        }
    }

    // Test proxy dengan Playwright (fallback)
    async testProxyWithPlaywright(proxyString) {
        let browser;
        try {
            const startTime = Date.now();
            
            browser = await chromium.launch({
                headless: true,
                proxy: { server: proxyString },
                timeout: 15000
            });
            
            const context = await browser.newContext();
            const page = await context.newPage();
            
            // Block resources yang tidak perlu untuk mempercepat
            await page.route('**/*.{png,jpg,jpeg,svg,gif,webp,ico}', route => route.abort());
            await page.route('**/*.css', route => route.abort());
            await page.route('**/*.woff*', route => route.abort());
            
            // Test dengan httpbin
            await page.goto('https://httpbin.org/ip', { 
                timeout: 10000,
                waitUntil: 'domcontentloaded'
            });
            
            const content = await page.textContent('body');
            const responseTime = Date.now() - startTime;
            
            await browser.close();

            if (content && content.includes('origin')) {
                return {
                    proxy: proxyString,
                    status: responseTime < 3000 ? 'active' : 'slow',
                    responseTime: responseTime,
                    method: 'playwright'
                };
            } else {
                return {
                    proxy: proxyString,
                    status: 'dead',
                    responseTime: 9999,
                    error: 'Invalid response'
                };
            }
            
        } catch (error) {
            if (browser) await browser.close();
            return {
                proxy: proxyString,
                status: 'dead',
                responseTime: 9999,
                error: error.message
            };
        }
    }

    // Test multiple proxies dengan prioritas third-party
    async testProxiesWithThirdParty(proxyList) {
        this.log('🔍 Memulai test proxy dengan layanan pihak ketiga...');
        this.log('💡 Menggunakan httpbin.org, ipify.org, jsonip.com, dll.');
        
        const results = [];
        let tested = 0;

        for (const proxy of proxyList) {
            tested++;
            this.log(`\n📡 Testing ${tested}/${proxyList.length}: ${proxy}`);
            
            try {
                // Coba third-party dulu (lebih ringan)
                let result = await this.testProxyWithThirdParty(proxy);
                
                // Jika third-party gagal, coba playwright sebagai fallback
                if (result.status === 'dead') {
                    this.log('🔄 Third-party gagal, mencoba dengan Playwright...');
                    result = await this.testProxyWithPlaywright(proxy);
                }

                results.push(result);

                if (result.status === 'active') {
                    this.log(`✅ AKTIF: ${result.responseTime}ms (${result.method})`);
                    if (result.ip) {
                        this.log(`🌐 IP: ${result.ip}`);
                    }
                } else if (result.status === 'slow') {
                    this.log(`⚠️  LAMBAT: ${result.responseTime}ms (${result.method})`);
                } else {
                    this.log(`❌ MATI: ${result.error}`);
                }

            } catch (error) {
                this.log(`💥 ERROR testing proxy: ${error.message}`);
                results.push({
                    proxy: proxy,
                    status: 'dead',
                    responseTime: 9999,
                    error: error.message
                });
            }

            // Delay antara test untuk menghindari block
            if (tested < proxyList.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        return results;
    }

    // Filter proxy berdasarkan response time
    filterProxiesByResponseTime(proxyResults, minPing = 100, maxPing = 5000) {
        return proxyResults
            .filter(result => 
                result.status === 'active' && 
                result.responseTime >= minPing && 
                result.responseTime <= maxPing
            )
            .sort((a, b) => a.responseTime - b.responseTime)
            .map(result => ({
                proxy: result.proxy,
                responseTime: result.responseTime
            }));
    }

    // Dapatkan layanan test yang tersedia
    async getAvailableServices() {
        const availableServices = [];
        
        for (const service of this.thirdPartyServices) {
            try {
                const response = await fetch(service, { timeout: 5000 });
                if (response.ok) {
                    availableServices.push(service);
                    this.log(`✅ Layanan tersedia: ${service}`);
                }
            } catch (error) {
                this.log(`❌ Layanan tidak tersedia: ${service}`);
            }
        }
        
        return availableServices;
    }

    async checkDataLeak(page) {
        try {
            // Coba beberapa layanan cek IP yang sederhana
            const ipCheckServices = [
                'https://httpbin.org/ip',
                'https://api.ipify.org?format=json'
            ];
            
            for (const service of ipCheckServices) {
                try {
                    await page.goto(service, { 
                        timeout: 8000,
                        waitUntil: 'domcontentloaded'
                    });
                    
                    const content = await page.textContent('body');
                    if (content && (content.includes('ip') || content.includes('origin'))) {
                        this.log(`🔒 IP check berhasil: ${service.split('/')[2]}`);
                        return true;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            this.log('⚠️  Gagal cek IP dengan layanan external');
            return true;
            
        } catch (error) {
            this.log('❌ Gagal cek kebocoran data');
            return true;
        }
    }

    async handleBotDetection(page) {
        try {
            // Cek captcha
            const captchaSelectors = [
                '#captcha',
                '.g-recaptcha',
                '[aria-label*="human"]',
                'iframe[src*="captcha"]',
                'iframe[src*="recaptcha"]'
            ];
            
            for (const selector of captchaSelectors) {
                if (await page.$(selector)) {
                    this.log('🛑 Captcha terdeteksi, tunggu 20 detik...');
                    await page.waitForTimeout(20000);
                    break;
                }
            }
            
            // Cek halaman verifikasi
            const currentUrl = page.url();
            if (currentUrl.includes('verify') || currentUrl.includes('challenge') || currentUrl.includes('blocked')) {
                this.log('🤖 Halaman verifikasi bot terdeteksi');
                await page.waitForTimeout(8000);
            }
            
        } catch (error) {
            this.log('⚠️  Error handling bot detection');
        }
    }

    async simulateHumanActivity(page, duration = 30000) {
        this.log('👤 Simulasi aktivitas manusia...');
        const startTime = Date.now();
        
        try {
            while (Date.now() - startTime < duration && this.isRunning) {
                // Gerakan mouse random
                const viewport = page.viewportSize();
                if (viewport) {
                    const x = Math.floor(Math.random() * viewport.width);
                    const y = Math.floor(Math.random() * viewport.height);
                    await page.mouse.move(x, y);
                }
                
                // Scroll random
                const scrollStep = Math.floor(Math.random() * 300) + 100;
                await page.evaluate((step) => {
                    window.scrollBy(0, step);
                }, scrollStep);
                
                // Random delay antara aksi
                await page.waitForTimeout(800 + Math.random() * 1500);
            }
        } catch (error) {
            this.log('⚠️  Error dalam simulasi aktivitas manusia');
        }
    }

    async clickGoogleAds(page) {
        try {
            this.log('🤑 Mencari Google Ads...');
            
            // Tunggu sebentar untuk memuat ads
            await page.waitForTimeout(4000);
            
            // Cari iframe ads
            const adFrames = page.frames().filter(frame => 
                frame.url().includes('googleads') || 
                frame.url().includes('doubleclick') ||
                frame.url().includes('googlesyndication')
            );
            
            if (adFrames.length > 0) {
                for (const adFrame of adFrames) {
                    try {
                        const adLinks = await adFrame.$$('a');
                        if (adLinks.length > 0) {
                            await adLinks[0].click();
                            this.log('✅ Berhasil klik Google Ads');
                            await page.waitForTimeout(6000);
                            return true;
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
            
            // Alternative selector untuk ads
            const adSelectors = [
                '[data-text-ad]',
                '.adsbygoogle',
                '[id*="ads"]',
                '[class*="ad"]',
                'a[href*="googleadservices"]',
                'a[href*="doubleclick"]'
            ];
            
            for (const selector of adSelectors) {
                try {
                    const ads = await page.$$(selector);
                    for (const ad of ads) {
                        try {
                            const isVisible = await ad.isVisible();
                            if (isVisible) {
                                await ad.scrollIntoViewIfNeeded();
                                await page.waitForTimeout(1000);
                                await ad.click();
                                this.log('✅ Berhasil klik ads');
                                await page.waitForTimeout(6000);
                                return true;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
            
            this.log('ℹ️  Tidak ada Google Ads yang ditemukan');
            return false;
            
        } catch (error) {
            this.log(`❌ Gagal klik ads: ${error.message}`);
            return false;
        }
    }

    async visitFromGoogleSearch(page, targetUrl) {
        try {
            this.log('🔍 Mengunjungi target melalui Google Search...');
            
            const domain = new URL(targetUrl).hostname;
            const siteName = domain.split('.')[0]; // Ambil nama situs tanpa domain
            
            await page.goto('https://www.google.com', { 
                timeout: 10000,
                waitUntil: 'domcontentloaded'
            });
            
            await this.handleBotDetection(page);
            
            // Input pencarian dengan nama situs
            const searchQuery = `${siteName} blog`;
            await page.fill('textarea[name="q"], input[name="q"]', '');
            await page.type('textarea[name="q"], input[name="q"]', searchQuery, { delay: 80 });
            await page.keyboard.press('Enter');
            await page.waitForTimeout(3000);
            
            await this.handleBotDetection(page);
            
            // Cari link yang menuju ke target domain
            const links = await page.$$eval('a[href]', anchors => 
                anchors.map(a => ({
                    href: a.href,
                    text: a.textContent?.substring(0, 100) || ''
                })).filter(a => a.href && a.text)
            );
            
            // Cari link yang menuju ke target domain
            const targetLink = links.find(link => 
                link.href.includes(domain) && !link.href.includes('google.com')
            );
            
            if (targetLink) {
                this.log(`✅ Menemukan link target di hasil pencarian: ${targetLink.text}`);
                await page.click(`a[href*="${domain}"]:not([href*="google.com"])`);
                await page.waitForTimeout(5000);
                return true;
            } else {
                this.log('⚠️  Tidak menemukan link target di hasil pencarian, langsung kunjungi URL');
                await page.goto(targetUrl, { timeout: 15000 });
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Gagal melalui Google Search: ${error.message}`);
            // Fallback: langsung kunjungi target
            await page.goto(targetUrl, { timeout: 15000 });
            return false;
        }
    }

    async runSEOBot(targetUrl, proxyList = [], useMobile = false, delay = 5, sessions = 1, minPing = 100, maxPing = 5000) {
        this.isRunning = true;
        
        try {
            // Validasi URL
            if (!targetUrl || !targetUrl.startsWith('http')) {
                throw new Error('URL target tidak valid');
            }

            this.log(`🎯 Target: ${targetUrl}`);
            this.log(`📱 Mode: ${useMobile ? 'Mobile' : 'Desktop'}`);
            this.log(`🔄 Sesi: ${sessions}`);
            this.log(`⏰ Delay: ${delay} detik`);

            // Test ketersediaan layanan pihak ketiga
            this.log('🌐 Mengecek ketersediaan layanan test proxy...');
            const availableServices = await this.getAvailableServices();
            
            if (availableServices.length === 0) {
                this.log('⚠️  Semua layanan pihak ketiga tidak tersedia, menggunakan Playwright');
            } else {
                this.log(`✅ ${availableServices.length} layanan tersedia`);
            }

            // Test proxies dengan third-party services
            let activeProxies = [];
            if (proxyList.length > 0) {
                this.log(`🎯 Memulai test ${proxyList.length} proxy...`);
                const proxyResults = await this.testProxiesWithThirdParty(proxyList);
                activeProxies = this.filterProxiesByResponseTime(proxyResults, minPing, maxPing);
                
                this.log(`📊 Hasil filter: ${activeProxies.length} proxy aktif (response time ${minPing}-${maxPing}ms)`);
                
                if (activeProxies.length === 0) {
                    this.log('⚠️  Tidak ada proxy yang memenuhi kriteria, menggunakan koneksi langsung');
                }
            } else {
                this.log('🌐 Menggunakan koneksi langsung (tanpa proxy)');
            }
            
            for (let session = 1; session <= sessions && this.isRunning; session++) {
                this.log(`\n🔄 MEMULAI SESI ${session}/${sessions}`);
                
                let browser;
                try {
                    // Setup browser options
                    const launchOptions = {
                        headless: true,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-web-security',
                            '--disable-blink-features=AutomationControlled',
                            '--disable-dev-shm-usage'
                        ]
                    };
                    
                    // Pilih proxy berdasarkan response time (yang tercepat)
                    let selectedProxy = null;
                    if (activeProxies.length > 0) {
                        selectedProxy = activeProxies[session % activeProxies.length]; // Rotasi proxy
                        launchOptions.proxy = { server: selectedProxy.proxy };
                        this.log(`🌐 Menggunakan proxy: ${selectedProxy.proxy} (${selectedProxy.responseTime}ms)`);
                    }
                    
                    // Launch browser
                    browser = await chromium.launch(launchOptions);
                    
                    // Setup user agent
                    const userAgentType = useMobile ? 'mobile' : 'desktop';
                    const userAgent = this.userAgents[userAgentType][
                        Math.floor(Math.random() * this.userAgents[userAgentType].length)
                    ];
                    
                    const context = await browser.newContext({
                        userAgent,
                        viewport: useMobile ? { width: 375, height: 667 } : { width: 1920, height: 1080 },
                        javaScriptEnabled: true,
                        ignoreHTTPSErrors: true
                    });
                    
                    this.page = await context.newPage();
                    
                    // Set headers untuk menghindari deteksi
                    await this.page.setExtraHTTPHeaders({
                        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                    });
                    
                    // Remove webdriver property menggunakan evaluate yang benar
                    await this.page.evaluate(() => {
                        Object.defineProperty(navigator, 'webdriver', { 
                            get: () => undefined 
                        });
                    });
                    
                    // Cek kebocoran data
                    await this.checkDataLeak(this.page);
                    
                    // Kunjungi target melalui Google Search atau langsung
                    await this.visitFromGoogleSearch(this.page, targetUrl);
                    
                    // Aktivitas manusia di halaman target
                    const activityDuration = selectedProxy ? 
                        Math.min(35000, selectedProxy.responseTime * 15) : 25000;
                    await this.simulateHumanActivity(this.page, activityDuration);
                    
                    // Klik internal link (jika ada)
                    try {
                        const internalLinks = await this.page.$$eval('a[href]', links => 
                            links
                                .filter(link => {
                                    try {
                                        const url = new URL(link.href, window.location.href);
                                        return url.hostname === window.location.hostname;
                                    } catch {
                                        return false;
                                    }
                                })
                                .map(link => link.href)
                                .slice(0, 3)
                        );
                        
                        if (internalLinks.length > 0) {
                            const randomLink = internalLinks[Math.floor(Math.random() * internalLinks.length)];
                            this.log(`🔗 Mengunjungi halaman internal: ${randomLink}`);
                            await this.page.goto(randomLink);
                            await this.simulateHumanActivity(this.page, 10000);
                            
                            // Kembali ke halaman utama
                            await this.page.goto(targetUrl);
                            await this.page.waitForTimeout(2000);
                        }
                    } catch (error) {
                        this.log('⚠️  Gagal mengunjungi halaman internal');
                    }
                    
                    // Coba klik ads
                    await this.clickGoogleAds(this.page);
                    
                    // Aktivitas tambahan sebelum sesi berakhir
                    await this.simulateHumanActivity(this.page, 8000);
                    
                    this.log(`✅ Sesi ${session} selesai`);
                    
                    // Delay antara sesi
                    const sessionDelay = selectedProxy ? 
                        Math.max(delay * 1000, selectedProxy.responseTime * 2) : delay * 1000;
                    
                    if (session < sessions) {
                        this.log(`⏳ Menunggu ${Math.round(sessionDelay/1000)} detik sebelum sesi berikutnya...`);
                        await new Promise(resolve => setTimeout(resolve, sessionDelay));
                    }
                    
                } catch (error) {
                    this.log(`❌ Error dalam sesi ${session}: ${error.message}`);
                } finally {
                    // Cleanup
                    if (browser) {
                        await browser.close();
                    }
                    // Clear memory
                    if (global.gc) {
                        global.gc();
                    }
                }
            }
            
            this.log('\n🎉 SEMUA SESI SEO BOT TELAH SELESAI!');
            
        } catch (error) {
            this.log(`💥 ERROR: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    stop() {
        this.isRunning = false;
        if (this.browser) {
            this.browser.close();
        }
    }
}

module.exports = SEOBot;
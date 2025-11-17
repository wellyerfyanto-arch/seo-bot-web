const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
const fetch = require('node-fetch');

// Gunakan stealth plugin untuk menghindari deteksi
chromium.use(StealthPlugin);

class SEOBot {
    constructor(logCallback = console.log) {
        this.logCallback = logCallback;
        this.browser = null;
        this.page = null;
        this.isRunning = false;
        
        this.userAgents = {
            desktop: [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
            ],
            mobile: [
                'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
                'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36',
                'Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/120.0 Firefox/120.0',
                'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36'
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
            await page.goto('https://ipleak.net/', { 
                timeout: 15000,
                waitUntil: 'domcontentloaded'
            });
            await page.waitForTimeout(3000);
            
            const isSecure = await page.evaluate(() => {
                const dnsText = document.querySelector('.dns')?.textContent;
                return !dnsText || dnsText.includes('No DNS');
            });
            
            if (isSecure) {
                this.log('🔒 Tidak ada kebocoran data');
            } else {
                this.log('⚠️  Kemungkinan ada kebocoran data');
            }
            
            return isSecure;
            
        } catch (error) {
            this.log('❌ Gagal cek kebocoran data');
            return true;
        }
    }

    // Enhanced Google Detection Handling
    async handleGoogleDetection(page) {
        try {
            const currentUrl = page.url();
            
            // Deteksi halaman verifikasi Google
            const googleDetectionIndicators = [
                'sorry.google.com',
                'www.google.com/sorry',
                'google.com/verify',
                'accounts.google.com',
                'support.google.com',
                'detected unusual traffic',
                'automated requests',
                'computer network is sending',
                'verify you are human'
            ];

            for (const indicator of googleDetectionIndicators) {
                if (currentUrl.includes(indicator) || await this.checkPageContent(page, indicator)) {
                    this.log(`🛑 Google detection terdeteksi: ${indicator}`);
                    
                    // Tunggu lebih lama untuk Google detection
                    await page.waitForTimeout(15000);
                    
                    // Coba selesaikan dengan reload
                    await page.reload();
                    await page.waitForTimeout(5000);
                    
                    return true;
                }
            }

            // Cek captcha khusus Google
            const googleCaptchaSelectors = [
                '#recaptcha',
                '.g-recaptcha',
                '[aria-label="Verifikasi bahwa Anda adalah manusia"]',
                'iframe[src*="google.com/recaptcha"]',
                'div.rc-anchor',
                '#captcha-form'
            ];

            for (const selector of googleCaptchaSelectors) {
                if (await page.$(selector)) {
                    this.log('🛑 Google reCAPTCHA terdeteksi, tunggu 45 detik...');
                    await page.waitForTimeout(45000);
                    return true;
                }
            }

            return false;
            
        } catch (error) {
            this.log('⚠️  Error handling Google detection');
            return false;
        }
    }

    async checkPageContent(page, keyword) {
        try {
            const content = await page.content();
            return content.toLowerCase().includes(keyword.toLowerCase());
        } catch {
            return false;
        }
    }

    async handleBotDetection(page) {
        try {
            // Handle Google detection terlebih dahulu
            const googleDetected = await this.handleGoogleDetection(page);
            if (googleDetected) return;

            // Cek captcha umum
            const captchaSelectors = [
                '#captcha',
                '.captcha',
                '[aria-label*="human"]',
                '[aria-label*="robot"]',
                'iframe[src*="captcha"]',
                'iframe[src*="recaptcha"]',
                '.captcha-container',
                '#verification-code'
            ];
            
            for (const selector of captchaSelectors) {
                if (await page.$(selector)) {
                    this.log('🛑 Captcha terdeteksi, tunggu 30 detik...');
                    await page.waitForTimeout(30000);
                    break;
                }
            }
            
            // Cek halaman verifikasi umum
            const currentUrl = page.url();
            if (currentUrl.includes('verify') || currentUrl.includes('challenge') || currentUrl.includes('captcha')) {
                this.log('🤖 Halaman verifikasi bot terdeteksi');
                await page.waitForTimeout(10000);
                
                // Coba reload page
                await page.reload();
                await page.waitForTimeout(5000);
            }
            
        } catch (error) {
            this.log('⚠️  Error handling bot detection');
        }
    }

    // Enhanced Google Search dengan handling error
    async searchKeywords(page, url) {
        try {
            const domain = new URL(url).hostname;
            this.log(`🔎 Mencari keyword untuk: ${domain}`);
            
            // Coba akses Google dengan retry mechanism
            let googleSuccess = false;
            let retryCount = 0;
            const maxRetries = 3;

            while (!googleSuccess && retryCount < maxRetries && this.isRunning) {
                try {
                    this.log(`🌐 Mencoba akses Google (percobaan ${retryCount + 1}/${maxRetries})...`);
                    
                    await page.goto('https://www.google.com', { 
                        timeout: 25000,
                        waitUntil: 'domcontentloaded'
                    });
                    
                    await this.handleBotDetection(page);
                    
                    // Cek jika berhasil sampai Google
                    if (page.url().includes('google.com') && !page.url().includes('sorry')) {
                        googleSuccess = true;
                        this.log('✅ Berhasil mengakses Google');
                    } else {
                        this.log('❌ Gagal mengakses Google, mencoba lagi...');
                        retryCount++;
                        await page.waitForTimeout(8000);
                    }
                    
                } catch (error) {
                    this.log(`❌ Error akses Google: ${error.message}`);
                    retryCount++;
                    if (retryCount < maxRetries) {
                        await page.waitForTimeout(10000);
                    }
                }
            }

            if (!googleSuccess) {
                this.log('🚫 Gagal melalui Google Search, melewati pencarian keyword');
                return [];
            }

            const keywords = [
                `site:${domain}`,
                `"${domain}"`,
                `review ${domain}`,
                `${domain.split('.')[0]} blog`,
                `www.${domain}`
            ];
            
            const foundKeywords = [];
            
            for (const keyword of keywords) {
                if (!this.isRunning) break;
                
                try {
                    // Tunggu search box muncul dengan timeout
                    try {
                        await page.waitForSelector('textarea[name="q"], input[name="q"]', { 
                            timeout: 10000,
                            state: 'visible'
                        });
                    } catch {
                        this.log('⚠️  Search box tidak ditemukan, skip keyword');
                        continue;
                    }
                    
                    // Clear search box dan input keyword
                    await page.fill('textarea[name="q"], input[name="q"]', '', { force: true });
                    await page.type('textarea[name="q"], input[name="q"]', keyword, { 
                        delay: 80 + Math.random() * 100,
                        force: true 
                    });
                    
                    // Random delay sebelum enter
                    await page.waitForTimeout(1000 + Math.random() * 2000);
                    
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(5000 + Math.random() * 3000);
                    
                    await this.handleBotDetection(page);
                    
                    // Cari hasil yang relevan
                    const searchResults = await page.$$eval('h3', elements => 
                        elements.map(el => ({
                            text: el.textContent,
                            href: el.closest('a')?.href
                        })).filter(item => item.text && item.href)
                    );
                    
                    let clickedResult = false;
                    for (const result of searchResults) {
                        if (!this.isRunning) break;
                        
                        if (result.href && result.href.includes(domain)) {
                            foundKeywords.push({
                                keyword,
                                result: result.text.substring(0, 50) + '...',
                                url: result.href
                            });
                            
                            // Klik hasil
                            try {
                                await page.click(`h3:has-text("${this.escapeRegex(result.text.substring(0, 30))}")`, {
                                    timeout: 5000
                                });
                                await page.waitForTimeout(4000);
                                
                                // Kembali ke hasil pencarian
                                await page.goBack({ waitUntil: 'domcontentloaded' });
                                await page.waitForTimeout(3000);
                                clickedResult = true;
                                break;
                            } catch (clickError) {
                                this.log('⚠️  Gagal klik hasil pencarian, mencoba hasil lain...');
                                continue;
                            }
                        }
                    }
                    
                    if (!clickedResult) {
                        this.log(`ℹ️  Tidak ada hasil untuk keyword: ${keyword}`);
                    }
                    
                    // Kembali ke halaman pencarian untuk keyword berikutnya
                    try {
                        await page.goto('https://www.google.com', { 
                            waitUntil: 'domcontentloaded',
                            timeout: 15000 
                        });
                        await page.waitForTimeout(3000);
                    } catch (error) {
                        this.log('⚠️  Gagal kembali ke halaman Google');
                    }
                    
                } catch (error) {
                    this.log(`❌ Error mencari keyword "${keyword}": ${error.message}`);
                }
            }
            
            this.log(`📝 Ditemukan ${foundKeywords.length} keyword relevan`);
            return foundKeywords;
            
        } catch (error) {
            this.log(`❌ Error dalam pencarian keyword: ${error.message}`);
            return [];
        }
    }

    // Helper function untuk escape regex
    escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async simulateHumanActivity(page, duration = 30000) {
        this.log('👤 Simulasi aktivitas manusia...');
        const startTime = Date.now();
        
        while (Date.now() - startTime < duration && this.isRunning) {
            try {
                // Gerakan mouse random
                const viewport = page.viewportSize();
                if (viewport) {
                    const x = Math.floor(Math.random() * viewport.width);
                    const y = Math.floor(Math.random() * viewport.height);
                    await page.mouse.move(x, y);
                }
                
                // Scroll random dengan pola manusia
                const scrollSteps = [100, 150, 200, 180, 120, 250];
                for (const step of scrollSteps) {
                    if (!this.isRunning) break;
                    await page.evaluate((step) => {
                        window.scrollBy(0, step);
                    }, step);
                    await page.waitForTimeout(800 + Math.random() * 1200);
                }
                
                // Random delay antara aksi
                const randomDelay = 1500 + Math.random() * 2500;
                await page.waitForTimeout(randomDelay);
                
            } catch (error) {
                // Continue jika ada error kecil dalam simulasi
                continue;
            }
        }
    }

    async clickGoogleAds(page) {
        try {
            this.log('🤑 Mencari Google Ads...');
            
            // Tunggu sebentar untuk memuat ads
            await page.waitForTimeout(6000);
            
            // Cari iframe ads
            const adFrames = page.frames().filter(frame => {
                try {
                    const frameUrl = frame.url();
                    return frameUrl.includes('googleads') || 
                           frameUrl.includes('doubleclick') ||
                           frameUrl.includes('googlesyndication');
                } catch {
                    return false;
                }
            });
            
            if (adFrames.length > 0) {
                for (const adFrame of adFrames) {
                    if (!this.isRunning) break;
                    
                    try {
                        const adLinks = await adFrame.$$('a');
                        for (const adLink of adLinks) {
                            try {
                                const isVisible = await adLink.isVisible();
                                if (isVisible) {
                                    await adLink.scrollIntoViewIfNeeded();
                                    await page.waitForTimeout(2000);
                                    await adLink.click({ delay: 100 });
                                    this.log('✅ Berhasil klik Google Ads');
                                    await page.waitForTimeout(12000);
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
            }
            
            // Alternative selector untuk ads
            const adSelectors = [
                '[data-text-ad]',
                '.adsbygoogle',
                '[id*="ads"]',
                '[class*="ad"]',
                'a[href*="googleadservices"]',
                'a[href*="doubleclick"]',
                'ins.adsbygoogle',
                '.ad-container',
                '[data-ad]'
            ];
            
            for (const selector of adSelectors) {
                if (!this.isRunning) break;
                
                try {
                    const ads = await page.$$(selector);
                    for (const ad of ads) {
                        try {
                            const isVisible = await ad.isVisible();
                            if (isVisible) {
                                await ad.scrollIntoViewIfNeeded();
                                await page.waitForTimeout(1500);
                                await ad.click({ delay: 150 });
                                this.log('✅ Berhasil klik ads');
                                await page.waitForTimeout(10000);
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
            
        } catch (error) {
            this.log(`❌ Gagal klik ads: ${error.message}`);
        }
        
        return false;
    }

    // Enhanced navigation dengan error handling
    async safeNavigate(page, url, description = 'halaman') {
        try {
            this.log(`🌐 Mengunjungi: ${url}`);
            await page.goto(url, { 
                timeout: 45000,
                waitUntil: 'domcontentloaded'
            });
            
            // Cek jika navigasi terinterupsi
            if (page.url().includes('chrome-error://') || page.url().includes('error')) {
                throw new Error(`Navigasi terinterupsi: ${page.url()}`);
            }
            
            await this.handleBotDetection(page);
            return true;
            
        } catch (error) {
            this.log(`❌ Gagal mengunjungi ${description}: ${error.message}`);
            
            // Coba reload jika error connection
            if (error.message.includes('ERR_TUNNEL_CONNECTION_FAILED') || 
                error.message.includes('NETWORK') ||
                error.message.includes('TIMEOUT')) {
                
                this.log('🔄 Mencoba reload...');
                try {
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    return true;
                } catch (retryError) {
                    this.log(`❌ Gagal reload: ${retryError.message}`);
                }
            }
            
            return false;
        }
    }

    async runSEOBot(targetUrl, proxyList = [], useMobile = false, delay = 5, sessions = 1, minPing = 100, maxPing = 5000) {
        this.isRunning = true;
        
        try {
            // Validasi URL
            if (!targetUrl || !targetUrl.startsWith('http')) {
                throw new Error('URL target tidak valid. Harus dimulai dengan http:// atau https://');
            }

            this.log(`🎯 Target URL: ${targetUrl}`);
            this.log(`📱 Mode: ${useMobile ? 'Mobile' : 'Desktop'}`);
            this.log(`🔄 Jumlah Sesi: ${sessions}`);

            // Test ketersediaan layanan pihak ketiga
            this.log('🌐 Mengecek ketersediaan layanan test proxy...');
            const availableServices = await this.getAvailableServices();
            
            if (availableServices.length === 0) {
                this.log('⚠️  Semua layanan pihak ketiga tidak tersedia, menggunakan Playwright untuk test proxy');
            } else {
                this.log(`✅ ${availableServices.length} layanan tersedia`);
            }

            // Test proxies dengan third-party services
            let activeProxies = [];
            if (proxyList && proxyList.length > 0) {
                this.log('🎯 Memulai test proxy dengan layanan pihak ketiga...');
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
                            '--disable-dev-shm-usage',
                            '--disable-features=VizDisplayCompositor',
                            '--disable-accelerated-2d-canvas',
                            '--disable-gpu',
                            '--disable-webgl',
                            '--disable-software-rasterizer',
                            '--no-first-run',
                            '--no-default-browser-check',
                            '--disable-default-apps',
                            '--disable-translate',
                            '--disable-extensions'
                        ]
                    };
                    
                    // Pilih proxy secara random dari 3 proxy terbaik
                    let selectedProxy = null;
                    if (activeProxies.length > 0) {
                        const topProxies = activeProxies.slice(0, Math.min(3, activeProxies.length));
                        selectedProxy = topProxies[Math.floor(Math.random() * topProxies.length)];
                        launchOptions.proxy = { server: selectedProxy.proxy };
                        this.log(`🌐 Menggunakan proxy: ${selectedProxy.proxy} (${selectedProxy.responseTime}ms)`);
                    }
                    
                    // Launch browser dengan playwright-extra + stealth
                    this.log('🚀 Membuka browser...');
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
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cache-Control': 'no-cache'
                    });
                    
                    // Additional anti-detection untuk Google
                    await this.page.evaluateOnNewDocument(() => {
                        // Remove webdriver property
                        Object.defineProperty(navigator, 'webdriver', { 
                            get: () => false 
                        });
                        
                        // Remove automation properties
                        Object.defineProperty(navigator, 'webdriver', { 
                            get: () => undefined 
                        });
                        
                        // Override permissions
                        Object.defineProperty(navigator, 'permissions', {
                            get: () => ({
                                query: () => Promise.resolve({ state: 'granted' })
                            })
                        });
                        
                        // Override plugins
                        Object.defineProperty(navigator, 'plugins', {
                            get: () => [1, 2, 3, 4, 5]
                        });
                        
                        // Override languages
                        Object.defineProperty(navigator, 'languages', {
                            get: () => ['en-US', 'en', 'id']
                        });
                    });
                    
                    // Cek kebocoran data
                    await this.checkDataLeak(this.page);
                    
                    // Search keywords di Google dengan enhanced handling
                    const foundKeywords = await this.searchKeywords(this.page, targetUrl);
                    
                    // Kunjungi URL target dengan safe navigation
                    const targetSuccess = await this.safeNavigate(this.page, targetUrl, 'URL target');
                    if (!targetSuccess) {
                        this.log('❌ Gagal mengunjungi target URL, melanjutkan ke sesi berikutnya...');
                        continue;
                    }
                    
                    // Aktivitas manusia dengan durasi sesuai response time
                    const activityDuration = selectedProxy ? 
                        Math.min(45000, selectedProxy.responseTime * 10) : 30000;
                    await this.simulateHumanActivity(this.page, activityDuration);
                    
                    // Klik internal link random
                    const internalLinks = await this.page.$$eval('a[href]', links => 
                        links
                            .filter(link => {
                                try {
                                    const url = new URL(link.href, window.location.href);
                                    return url.hostname === window.location.hostname && 
                                           !link.href.includes('#') &&
                                           link.href !== window.location.href;
                                } catch {
                                    return false;
                                }
                            })
                            .map(link => link.href)
                            .slice(0, 8)
                    );
                    
                    if (internalLinks.length > 0 && this.isRunning) {
                        const randomLink = internalLinks[Math.floor(Math.random() * internalLinks.length)];
                        this.log(`🔗 Mengunjungi halaman internal: ${randomLink}`);
                        
                        const internalSuccess = await this.safeNavigate(this.page, randomLink, 'halaman internal');
                        if (internalSuccess) {
                            await this.simulateHumanActivity(this.page, 12000);
                            
                            // Kembali ke target URL
                            await this.safeNavigate(this.page, targetUrl, 'URL target');
                        }
                    }
                    
                    // Coba klik Google Ads
                    if (this.isRunning) {
                        await this.clickGoogleAds(this.page);
                    }
                    
                    // Aktivitas tambahan sebelum selesai
                    if (this.isRunning) {
                        await this.simulateHumanActivity(this.page, 8000);
                    }
                    
                    // Klik home jika ada
                    const homeSelectors = [
                        'a[href="/"]',
                        'a[href*="home"]',
                        'a[class*="home"]',
                        'a[class*="logo"]',
                        '.navbar-brand',
                        '.logo',
                        'header a',
                        '.site-title a'
                    ];
                    
                    for (const selector of homeSelectors) {
                        if (!this.isRunning) break;
                        
                        const homeLink = await this.page.$(selector);
                        if (homeLink) {
                            try {
                                await homeLink.click();
                                await this.page.waitForTimeout(3000);
                                break;
                            } catch (error) {
                                continue;
                            }
                        }
                    }
                    
                    this.log(`✅ Sesi ${session} selesai`);
                    
                    // Delay antara sesi berdasarkan response time proxy
                    const sessionDelay = selectedProxy ? 
                        Math.max(delay * 1000, selectedProxy.responseTime * 2) : delay * 1000;
                    
                    if (session < sessions && this.isRunning) {
                        this.log(`⏳ Menunggu ${Math.round(sessionDelay/1000)} detik sebelum sesi berikutnya...`);
                        await new Promise(resolve => setTimeout(resolve, sessionDelay));
                    }
                    
                } catch (error) {
                    this.log(`❌ Error dalam sesi ${session}: ${error.message}`);
                } finally {
                    // Cleanup
                    if (browser) {
                        await browser.close();
                        this.log('🔒 Browser ditutup');
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
        this.log('🛑 Menghentikan SEO Bot...');
        this.isRunning = false;
        if (this.browser) {
            this.browser.close();
        }
    }
}

module.exports = SEOBot;
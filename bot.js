const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const dns = require('dns');
const { URL } = require('url');
const net = require('net');

// Gunakan stealth plugin untuk menghindari deteksi
chromium.use(stealth);

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
    }

    log(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.logCallback(`[${timestamp}] ${message}`);
    }

    // Test koneksi TCP ke proxy
    async testProxyTCP(proxyInfo) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = 5000;
            let responded = false;

            const timer = setTimeout(() => {
                if (!responded) {
                    socket.destroy();
                    resolve({ success: false, time: timeout, error: 'Timeout' });
                }
            }, timeout);

            const startTime = Date.now();

            socket.connect(proxyInfo.port, proxyInfo.host, () => {
                responded = true;
                clearTimeout(timer);
                const connectTime = Date.now() - startTime;
                socket.destroy();
                resolve({ success: true, time: connectTime });
            });

            socket.on('error', (err) => {
                if (!responded) {
                    responded = true;
                    clearTimeout(timer);
                    resolve({ success: false, time: Date.now() - startTime, error: err.message });
                }
            });
        });
    }

    // Test DNS lookup
    async testDNS(host) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            dns.lookup(host, (err, address) => {
                const dnsTime = Date.now() - startTime;
                if (err) {
                    resolve({ success: false, time: dnsTime, error: err.message });
                } else {
                    resolve({ success: true, time: dnsTime, address });
                }
            });
        });
    }

    // Test proxy dengan HTTP request menggunakan Playwright
    async testProxyHTTP(proxyString) {
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
            
            // Test dengan multiple endpoints
            const testUrls = [
                'https://httpbin.org/ip',
                'https://api.ipify.org?format=json',
                'https://jsonip.com'
            ];
            
            let success = false;
            let responseTime = 0;
            
            for (const testUrl of testUrls) {
                try {
                    await page.goto(testUrl, { 
                        timeout: 10000,
                        waitUntil: 'domcontentloaded'
                    });
                    
                    const content = await page.content();
                    if (content && (content.includes('origin') || content.includes('ip'))) {
                        success = true;
                        responseTime = Date.now() - startTime;
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            await browser.close();
            
            return {
                success,
                responseTime: success ? responseTime : 9999,
                method: 'http'
            };
            
        } catch (error) {
            if (browser) await browser.close();
            return {
                success: false,
                responseTime: 9999,
                error: error.message,
                method: 'http'
            };
        }
    }

    // Parse proxy string
    parseProxy(proxyString) {
        try {
            // Handle format tanpa protocol
            if (!proxyString.startsWith('http')) {
                proxyString = 'http://' + proxyString;
            }
            
            const url = new URL(proxyString);
            return {
                host: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                protocol: url.protocol.replace(':', ''),
                original: proxyString
            };
        } catch (error) {
            // Try to parse host:port format
            const match = proxyString.match(/(?:http:\/\/)?([^:\/]+):(\d+)/);
            if (match) {
                return {
                    host: match[1],
                    port: parseInt(match[2]),
                    protocol: 'http',
                    original: proxyString
                };
            }
            return null;
        }
    }

    // Comprehensive proxy testing dengan multiple methods
    async testProxyComprehensive(proxyString) {
        const proxyInfo = this.parseProxy(proxyString);
        if (!proxyInfo) {
            return {
                proxy: proxyString,
                status: 'dead',
                responseTime: 9999,
                error: 'Format proxy tidak valid'
            };
        }

        this.log(`Testing proxy: ${proxyInfo.original}`);

        // Test DNS pertama
        const dnsTest = await this.testDNS(proxyInfo.host);
        if (!dnsTest.success) {
            return {
                proxy: proxyInfo.original,
                status: 'dead',
                responseTime: 9999,
                error: `DNS lookup failed: ${dnsTest.error}`
            };
        }

        // Test TCP connection
        const tcpTest = await this.testProxyTCP(proxyInfo);
        if (!tcpTest.success) {
            return {
                proxy: proxyInfo.original,
                status: 'dead',
                responseTime: 9999,
                error: `TCP connection failed: ${tcpTest.error}`
            };
        }

        // Test HTTP request
        const httpTest = await this.testProxyHTTP(proxyInfo.original);
        
        if (httpTest.success) {
            const totalTime = dnsTest.time + tcpTest.time + httpTest.responseTime;
            const status = totalTime < 2000 ? 'active' : 'slow';
            
            return {
                proxy: proxyInfo.original,
                status: status,
                responseTime: totalTime,
                dnsTime: dnsTest.time,
                tcpTime: tcpTest.time,
                httpTime: httpTest.responseTime
            };
        } else {
            return {
                proxy: proxyInfo.original,
                status: 'dead',
                responseTime: 9999,
                error: `HTTP test failed: ${httpTest.error}`,
                dnsTime: dnsTest.time,
                tcpTime: tcpTest.time
            };
        }
    }

    // Test multiple proxies
    async testProxiesComprehensive(proxyList) {
        this.log('🔍 Memulai comprehensive proxy testing...');
        this.log('📝 Methods: DNS Lookup → TCP Connection → HTTP Test');
        
        const results = [];
        let tested = 0;

        for (const proxy of proxyList) {
            tested++;
            this.log(`\n📡 Testing ${tested}/${proxyList.length}: ${proxy}`);
            
            try {
                const result = await this.testProxyComprehensive(proxy);
                results.push(result);

                if (result.status === 'active') {
                    this.log(`✅ AKTIF: ${result.responseTime}ms (DNS:${result.dnsTime}ms + TCP:${result.tcpTime}ms + HTTP:${result.httpTime}ms)`);
                } else if (result.status === 'slow') {
                    this.log(`⚠️  LAMBAT: ${result.responseTime}ms (DNS:${result.dnsTime}ms + TCP:${result.tcpTime}ms + HTTP:${result.httpTime}ms)`);
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
                await new Promise(resolve => setTimeout(resolve, 1000));
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
                    this.log('🛑 Captcha terdeteksi, tunggu 30 detik...');
                    await page.waitForTimeout(30000);
                    break;
                }
            }
            
            // Cek halaman verifikasi
            if (page.url().includes('verify') || page.url().includes('challenge')) {
                this.log('🤖 Halaman verifikasi bot terdeteksi');
                await page.waitForTimeout(10000);
            }
            
        } catch (error) {
            this.log('⚠️  Error handling bot detection');
        }
    }

    async searchKeywords(page, url) {
        try {
            const domain = new URL(url).hostname;
            this.log(`🔎 Mencari keyword untuk: ${domain}`);
            
            await page.goto('https://www.google.com', { 
                timeout: 15000,
                waitUntil: 'domcontentloaded'
            });
            
            await this.handleBotDetection(page);

            const keywords = [
                `site:${domain}`,
                `"${domain}"`,
                `review ${domain}`,
                `${domain.split('.')[0]} blog`
            ];
            
            const foundKeywords = [];
            
            for (const keyword of keywords) {
                try {
                    // Clear search box dan input keyword
                    await page.fill('textarea[name="q"], input[name="q"]', '');
                    await page.type('textarea[name="q"], input[name="q"]', keyword, { delay: 100 });
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(3000);
                    
                    await this.handleBotDetection(page);
                    
                    // Cari hasil yang relevan
                    const searchResults = await page.$$eval('h3', elements => 
                        elements.map(el => ({
                            text: el.textContent,
                            href: el.closest('a')?.href
                        })).filter(item => item.text && item.href)
                    );
                    
                    for (const result of searchResults) {
                        if (result.href && result.href.includes(domain)) {
                            foundKeywords.push({
                                keyword,
                                result: result.text.substring(0, 50) + '...'
                            });
                            
                            // Klik hasil
                            try {
                                await page.click(`h3:has-text("${result.text.substring(0, 20)}")`);
                                await page.waitForTimeout(2000);
                                await page.goBack();
                                await page.waitForTimeout(2000);
                            } catch (clickError) {
                                this.log('⚠️  Gagal klik hasil pencarian');
                            }
                            break;
                        }
                    }
                    
                } catch (error) {
                    this.log(`❌ Error mencari keyword: ${keyword}`);
                }
            }
            
            this.log(`📝 Ditemukan ${foundKeywords.length} keyword relevan`);
            return foundKeywords;
            
        } catch (error) {
            this.log('❌ Error dalam pencarian keyword');
            return [];
        }
    }

    async simulateHumanActivity(page, duration = 30000) {
        this.log('👤 Simulasi aktivitas manusia...');
        const startTime = Date.now();
        
        while (Date.now() - startTime < duration) {
            // Gerakan mouse random
            const viewport = page.viewportSize();
            const x = Math.floor(Math.random() * viewport.width);
            const y = Math.floor(Math.random() * viewport.height);
            await page.mouse.move(x, y);
            
            // Scroll random
            const scrollStep = Math.floor(Math.random() * 300) + 100;
            await page.evaluate((step) => {
                window.scrollBy(0, step);
            }, scrollStep);
            
            // Random delay antara aksi
            await page.waitForTimeout(1000 + Math.random() * 2000);
        }
    }

    async clickGoogleAds(page) {
        try {
            this.log('🤑 Mencari Google Ads...');
            
            // Tunggu sebentar untuk memuat ads
            await page.waitForTimeout(5000);
            
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
                            await page.waitForTimeout(8000);
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
                                await page.waitForTimeout(8000);
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
            
        } catch (error) {
            this.log('❌ Gagal klik ads: ' + error.message);
        }
        
        return false;
    }

    async runSEOBot(targetUrl, proxyList = [], useMobile = false, delay = 5, sessions = 1, minPing = 100, maxPing = 5000) {
        this.isRunning = true;
        
        try {
            // Validasi URL
            if (!targetUrl || !targetUrl.startsWith('http')) {
                throw new Error('URL target tidak valid');
            }

            // Test proxies dengan comprehensive method
            let activeProxies = [];
            if (proxyList.length > 0) {
                this.log('🎯 Memulai comprehensive proxy testing...');
                const proxyResults = await this.testProxiesComprehensive(proxyList);
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
                            '--disable-features=VizDisplayCompositor'
                        ]
                    };
                    
                    // Pilih proxy berdasarkan response time (yang tercepat)
                    let selectedProxy = null;
                    if (activeProxies.length > 0) {
                        selectedProxy = activeProxies[0]; // Gunakan proxy tercepat
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
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br'
                    });
                    
                    // Random viewport offset
                    await this.page.evaluate(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => false });
                    });
                    
                    // Cek kebocoran data
                    await this.checkDataLeak(this.page);
                    
                    // Search keywords
                    const foundKeywords = await this.searchKeywords(this.page, targetUrl);
                    
                    // Kunjungi URL target
                    this.log(`🌐 Mengunjungi: ${targetUrl}`);
                    await this.page.goto(targetUrl, { 
                        timeout: 30000,
                        waitUntil: 'domcontentloaded'
                    });
                    
                    // Aktivitas manusia dengan durasi sesuai response time
                    const activityDuration = selectedProxy ? 
                        Math.min(45000, selectedProxy.responseTime * 20) : 30000;
                    await this.simulateHumanActivity(this.page, activityDuration);
                    
                    // Klik internal link
                    const internalLinks = await this.page.$$eval('a[href]', links => 
                        links
                            .filter(link => {
                                try {
                                    return new URL(link.href).hostname === window.location.hostname;
                                } catch {
                                    return false;
                                }
                            })
                            .map(link => link.href)
                            .slice(0, 5)
                    );
                    
                    if (internalLinks.length > 0) {
                        const randomLink = internalLinks[Math.floor(Math.random() * internalLinks.length)];
                        this.log(`🔗 Mengunjungi halaman internal: ${randomLink}`);
                        await this.page.goto(randomLink);
                        await this.simulateHumanActivity(this.page, 15000);
                    }
                    
                    // Klik ads
                    const adsClicked = await this.clickGoogleAds(this.page);
                    
                    // Kembali ke target dan scroll
                    await this.page.goto(targetUrl);
                    await this.page.waitForTimeout(2000);
                    await this.simulateHumanActivity(this.page, 10000);
                    
                    // Klik home jika ada
                    const homeLink = await this.page.$('a[href="/"], a[href*="home"], a[class*="home"], a[class*="logo"]');
                    if (homeLink) {
                        await homeLink.click();
                        await this.page.waitForTimeout(2000);
                    }
                    
                    this.log(`✅ Sesi ${session} selesai`);
                    
                    // Delay antara sesi berdasarkan response time proxy
                    const sessionDelay = selectedProxy ? 
                        Math.max(delay * 1000, selectedProxy.responseTime * 3) : delay * 1000;
                    
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
            
            this.log('🎉 SEMUA SESI SEO BOT TELAH SELESAI!');
            
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
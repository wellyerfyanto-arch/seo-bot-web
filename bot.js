const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

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

    async testProxies(proxyList) {
        this.log('🔍 Testing proxies...');
        const activeProxies = [];
        
        for (const proxy of proxyList) {
            try {
                const browser = await chromium.launch({
                    headless: true,
                    proxy: { server: proxy },
                    timeout: 15000
                });
                
                const page = await browser.newPage();
                await page.goto('https://httpbin.org/ip', { timeout: 10000 });
                await browser.close();
                
                activeProxies.push(proxy);
                this.log(`✅ Proxy aktif: ${proxy}`);
                
            } catch (error) {
                this.log(`❌ Proxy mati: ${proxy}`);
            }
        }
        
        this.log(`📊 Total proxy aktif: ${activeProxies.length}`);
        return activeProxies;
    }

    async checkDataLeak(page) {
        try {
            await page.goto('https://ipleak.net/', { timeout: 15000 });
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
                waitUntil: 'networkidle'
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

    async simulateHumanActivity(page) {
        this.log('👤 Simulasi aktivitas manusia...');
        
        // Gerakan mouse random
        const viewport = page.viewportSize();
        for (let i = 0; i < 3; i++) {
            const x = Math.floor(Math.random() * viewport.width);
            const y = Math.floor(Math.random() * viewport.height);
            await page.mouse.move(x, y);
            await page.waitForTimeout(800);
        }
        
        // Scroll seperti manusia
        const scrollSteps = [200, 150, 300, 100, 250];
        for (const step of scrollSteps) {
            await page.evaluate((step) => {
                window.scrollBy(0, step);
            }, step);
            await page.waitForTimeout(1500 + Math.random() * 1000);
        }
        
        // Klik element random
        const clickableElements = await page.$$('a, button');
        if (clickableElements.length > 0) {
            const randomIndex = Math.floor(Math.random() * clickableElements.length);
            try {
                await clickableElements[randomIndex].click();
                await page.waitForTimeout(3000);
                await page.goBack();
                await page.waitForTimeout(2000);
            } catch (error) {
                // Ignore click errors
            }
        }
    }

    async clickGoogleAds(page) {
        try {
            this.log('🤑 Mencari Google Ads...');
            
            // Cari iframe ads
            const adFrames = page.frames().filter(frame => 
                frame.url().includes('googleads') || 
                frame.url().includes('doubleclick')
            );
            
            if (adFrames.length > 0) {
                const adLinks = await adFrames[0].$$('a');
                if (adLinks.length > 0) {
                    await adLinks[0].click();
                    this.log('✅ Berhasil klik Google Ads');
                    await page.waitForTimeout(8000);
                    return true;
                }
            }
            
            // Alternative selector untuk ads
            const adSelectors = [
                '[data-text-ad]',
                '.adsbygoogle',
                '[id*="ads"]',
                '[class*="ad"]'
            ];
            
            for (const selector of adSelectors) {
                const ads = await page.$$(selector);
                for (const ad of ads) {
                    try {
                        const isVisible = await ad.isVisible();
                        if (isVisible) {
                            await ad.click();
                            this.log('✅ Berhasil klik ads');
                            await page.waitForTimeout(8000);
                            return true;
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
            
        } catch (error) {
            this.log('❌ Gagal klik ads');
        }
        
        return false;
    }

    async runSEOBot(targetUrl, proxyList = [], useMobile = false, delay = 5, sessions = 1) {
        this.isRunning = true;
        
        try {
            // Validasi URL
            if (!targetUrl || !targetUrl.startsWith('http')) {
                throw new Error('URL target tidak valid');
            }

            // Test proxies
            const activeProxies = proxyList.length > 0 ? await this.testProxies(proxyList) : [];
            
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
                    
                    // Add proxy jika ada
                    if (activeProxies.length > 0) {
                        const randomProxy = activeProxies[Math.floor(Math.random() * activeProxies.length)];
                        launchOptions.proxy = { server: randomProxy };
                        this.log(`🌐 Menggunakan proxy: ${randomProxy}`);
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
                        javaScriptEnabled: true
                    });
                    
                    this.page = await context.newPage();
                    
                    // Set headers
                    await this.page.setExtraHTTPHeaders({
                        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    });
                    
                    // Cek kebocoran data
                    await this.checkDataLeak(this.page);
                    
                    // Search keywords
                    const foundKeywords = await this.searchKeywords(this.page, targetUrl);
                    
                    // Kunjungi URL target
                    this.log(`🌐 Mengunjungi: ${targetUrl}`);
                    await this.page.goto(targetUrl, { 
                        timeout: 20000, 
                        waitUntil: 'networkidle' 
                    });
                    
                    // Aktivitas manusia
                    await this.simulateHumanActivity(this.page);
                    
                    // Klik internal link
                    const internalLinks = await this.page.$$eval('a[href]', links => 
                        links
                            .filter(link => link.href.includes(window.location.origin))
                            .map(link => link.href)
                            .slice(0, 5)
                    );
                    
                    if (internalLinks.length > 0) {
                        const randomLink = internalLinks[Math.floor(Math.random() * internalLinks.length)];
                        this.log(`🔗 Mengunjungi halaman internal: ${randomLink}`);
                        await this.page.goto(randomLink);
                        await this.simulateHumanActivity(this.page);
                    }
                    
                    // Klik ads
                    await this.clickGoogleAds(this.page);
                    
                    // Kembali ke target dan scroll
                    await this.page.goto(targetUrl);
                    await page.waitForTimeout(2000);
                    await this.simulateHumanActivity(this.page);
                    
                    // Klik home jika ada
                    const homeLink = await this.page.$('a[href="/"], a[href*="home"]');
                    if (homeLink) {
                        await homeLink.click();
                        await page.waitForTimeout(2000);
                    }
                    
                    this.log(`✅ Sesi ${session} selesai`);
                    
                    // Delay antara sesi
                    if (session < sessions) {
                        this.log(`⏳ Menunggu ${delay} detik sebelum sesi berikutnya...`);
                        await new Promise(resolve => setTimeout(resolve, delay * 1000));
                    }
                    
                } catch (error) {
                    this.log(`❌ Error dalam sesi ${session}: ${error.message}`);
                } finally {
                    // Cleanup
                    if (browser) {
                        await browser.close();
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
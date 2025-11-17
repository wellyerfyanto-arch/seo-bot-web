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

        this.thirdPartyServices = [
            'https://httpbin.org/ip',
            'https://api.ipify.org?format=json',
            'https://jsonip.com'
        ];
    }

    log(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.logCallback(`[${timestamp}] ${message}`);
    }

    async safeFetch(url, options = {}) {
        try {
            const response = await fetch(url, {
                timeout: 5000,
                ...options
            });
            return response;
        } catch (error) {
            return null;
        }
    }

    async testProxyWithThirdParty(proxyString) {
        try {
            const startTime = Date.now();
            
            for (const service of this.thirdPartyServices) {
                try {
                    const response = await this.safeFetch(service, {
                        headers: { 'User-Agent': this.userAgents.desktop[0] }
                    });

                    if (response && response.ok) {
                        const data = await response.json();
                        const responseTime = Date.now() - startTime;
                        
                        return {
                            proxy: proxyString,
                            status: responseTime < 2000 ? 'active' : 'slow',
                            responseTime: responseTime,
                            ip: data.ip || data.origin,
                            method: 'third-party'
                        };
                    }
                } catch (error) {
                    continue;
                }
            }

            return {
                proxy: proxyString,
                status: 'dead',
                responseTime: 9999,
                error: 'Semua layanan gagal'
            };

        } catch (error) {
            return {
                proxy: proxyString,
                status: 'dead',
                responseTime: 9999,
                error: error.message
            };
        }
    }

    async testProxyWithPlaywright(proxyString) {
        let browser;
        try {
            const startTime = Date.now();
            
            browser = await chromium.launch({
                headless: true,
                proxy: { server: proxyString },
                timeout: 10000
            });
            
            const context = await browser.newContext();
            const page = await context.newPage();
            
            // Block resources
            await page.route('**/*.{png,jpg,jpeg,svg,gif,webp,ico,css,woff,woff2}', route => route.abort());
            
            await page.goto('https://httpbin.org/ip', { 
                timeout: 8000,
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

    async testProxiesWithThirdParty(proxyList) {
        this.log('🔍 Testing proxies...');
        
        const results = [];
        const testPromises = proxyList.map(async (proxy, index) => {
            await new Promise(resolve => setTimeout(resolve, index * 300)); // Stagger requests
            
            try {
                let result = await this.testProxyWithThirdParty(proxy);
                
                if (result.status === 'dead') {
                    this.log(`🔄 Retrying ${proxy} with Playwright...`);
                    result = await this.testProxyWithPlaywright(proxy);
                }

                results.push(result);

                if (result.status === 'active') {
                    this.log(`✅ ${proxy} - ${result.responseTime}ms`);
                } else {
                    this.log(`❌ ${proxy} - ${result.error}`);
                }

            } catch (error) {
                this.log(`💥 Error testing ${proxy}: ${error.message}`);
                results.push({
                    proxy: proxy,
                    status: 'dead',
                    responseTime: 9999,
                    error: error.message
                });
            }
        });

        await Promise.all(testPromises);
        return results;
    }

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

    async simulateHumanActivity(page, duration = 15000) {
        this.log('👤 Simulating human activity...');
        const startTime = Date.now();
        
        try {
            while (Date.now() - startTime < duration && this.isRunning) {
                const viewport = page.viewportSize();
                if (viewport) {
                    await page.mouse.move(
                        Math.floor(Math.random() * viewport.width),
                        Math.floor(Math.random() * viewport.height)
                    );
                }
                
                await page.evaluate(() => {
                    window.scrollBy(0, Math.floor(Math.random() * 300) + 100);
                });
                
                await page.waitForTimeout(500 + Math.random() * 1000);
            }
        } catch (error) {
            this.log('⚠️ Activity simulation error');
        }
    }

    async visitFromGoogleSearch(page, targetUrl) {
        try {
            this.log('🔍 Visiting via Google Search...');
            
            const domain = new URL(targetUrl).hostname;
            const siteName = domain.split('.')[0];
            
            await page.goto('https://www.google.com', { 
                timeout: 8000,
                waitUntil: 'domcontentloaded'
            });
            
            // Simple search
            const searchQuery = siteName;
            await page.fill('textarea[name="q"], input[name="q"]', searchQuery);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2000);
            
            // Try to find and click target link
            const links = await page.$$eval('a[href]', anchors => 
                anchors.map(a => ({
                    href: a.href,
                    text: a.textContent || ''
                })).filter(a => a.href && a.text.length > 10)
            );
            
            const targetLink = links.find(link => 
                link.href.includes(domain) && !link.href.includes('google.com')
            );
            
            if (targetLink) {
                this.log(`✅ Clicking search result`);
                await page.click(`a[href*="${domain}"]`);
                await page.waitForTimeout(4000);
                return true;
            }
            
            // Fallback to direct visit
            this.log('➡️ Direct visit');
            await page.goto(targetUrl, { timeout: 10000 });
            return false;
            
        } catch (error) {
            this.log(`❌ Search failed: ${error.message}`);
            await page.goto(targetUrl, { timeout: 10000 });
            return false;
        }
    }

    async runSEOBot(targetUrl, proxyList = [], useMobile = false, delay = 5, sessions = 1, minPing = 100, maxPing = 5000) {
        if (this.isRunning) {
            this.log('⚠️ Bot is already running');
            return;
        }
        
        this.isRunning = true;
        
        try {
            if (!targetUrl?.startsWith('http')) {
                throw new Error('Invalid URL');
            }

            this.log(`🎯 Starting ${sessions} sessions for: ${targetUrl}`);

            // Test proxies
            let activeProxies = [];
            if (proxyList.length > 0) {
                const proxyResults = await this.testProxiesWithThirdParty(proxyList);
                activeProxies = this.filterProxiesByResponseTime(proxyResults, minPing, maxPing);
                this.log(`📊 Active proxies: ${activeProxies.length}`);
            }

            for (let session = 1; session <= sessions && this.isRunning; session++) {
                this.log(`\n🔄 Session ${session}/${sessions}`);
                
                let browser;
                try {
                    const launchOptions = {
                        headless: true,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-accelerated-2d-canvas',
                            '--no-first-run',
                            '--no-zygote',
                            '--disable-gpu'
                        ]
                    };
                    
                    // Select proxy
                    let selectedProxy = null;
                    if (activeProxies.length > 0) {
                        selectedProxy = activeProxies[session % activeProxies.length];
                        launchOptions.proxy = { server: selectedProxy.proxy };
                        this.log(`🌐 Using proxy: ${selectedProxy.proxy}`);
                    }
                    
                    // Launch browser with memory limits
                    browser = await chromium.launch(launchOptions);
                    
                    const userAgentType = useMobile ? 'mobile' : 'desktop';
                    const userAgent = this.userAgents[userAgentType][0];
                    
                    const context = await browser.newContext({
                        userAgent,
                        viewport: useMobile ? { width: 375, height: 667 } : { width: 1280, height: 720 },
                        ignoreHTTPSErrors: true
                    });
                    
                    this.page = await context.newPage();
                    
                    // Remove automation detection
                    await this.page.evaluate(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => false });
                    });
                    
                    // Visit via Google
                    await this.visitFromGoogleSearch(this.page, targetUrl);
                    
                    // Human activity
                    await this.simulateHumanActivity(this.page, 10000);
                    
                    // Internal navigation
                    try {
                        const links = await this.page.$$eval('a[href]', anchors => 
                            anchors
                                .filter(a => {
                                    try {
                                        return new URL(a.href, window.location.href).hostname === window.location.hostname;
                                    } catch {
                                        return false;
                                    }
                                })
                                .map(a => a.href)
                                .slice(0, 2)
                        );
                        
                        if (links.length > 0) {
                            await this.page.goto(links[0]);
                            await this.simulateHumanActivity(this.page, 5000);
                        }
                    } catch (error) {
                        // Skip internal links on error
                    }
                    
                    this.log(`✅ Session ${session} completed`);
                    
                    // Session delay
                    if (session < sessions) {
                        const sessionDelay = Math.max(delay * 1000, 3000);
                        await new Promise(resolve => setTimeout(resolve, sessionDelay));
                    }
                    
                } catch (error) {
                    this.log(`❌ Session ${session} error: ${error.message}`);
                } finally {
                    if (browser) {
                        await browser.close().catch(() => {});
                    }
                }
            }
            
            this.log('\n🎉 All sessions completed!');
            
        } catch (error) {
            this.log(`💥 Fatal error: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    stop() {
        this.isRunning = false;
        if (this.browser) {
            this.browser.close().catch(() => {});
        }
    }
}

module.exports = SEOBot;
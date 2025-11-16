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

    async initializeBrowser(useProxy = false, proxyUrl = null) {
        try {
            const launchOptions = {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-web-security',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-software-rasterizer',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection'
                ],
                timeout: 30000
            };

            if (useProxy && proxyUrl) {
                launchOptions.proxy = { server: proxyUrl };
                this.log(`🌐 Menggunakan proxy: ${proxyUrl}`);
            }

            this.browser = await chromium.launch(launchOptions);
            
            const userAgentType = Math.random() > 0.5 ? 'desktop' : 'mobile';
            const userAgent = this.userAgents[userAgentType][
                Math.floor(Math.random() * this.userAgents[userAgentType].length)
            ];
            
            const context = await this.browser.newContext({
                userAgent,
                viewport: userAgentType === 'mobile' ? { width: 375, height: 667 } : { width: 1920, height: 1080 },
                javaScriptEnabled: true,
                ignoreHTTPSErrors: true
            });
            
            // Set headers untuk menghindari deteksi
            await context.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            });
            
            this.page = await context.newPage();
            
            // Randomize viewport jika desktop
            if (userAgentType === 'desktop') {
                const widths = [1920, 1366, 1536, 1440, 1280];
                const heights = [1080, 768, 864, 900, 720];
                const randomIndex = Math.floor(Math.random() * widths.length);
                await this.page.setViewportSize({ 
                    width: widths[randomIndex], 
                    height: heights[randomIndex] 
                });
            }
            
            return true;
            
        } catch (error) {
            this.log(`❌ Gagal inisialisasi browser: ${error.message}`);
            return false;
        }
    }

    async testProxies(proxyList) {
        this.log('🔍 Testing proxies...');
        const activeProxies = [];
        
        for (const proxy of proxyList) {
            try {
                const browser = await chromium.launch({
                    headless: true,
                    proxy: { server: proxy },
                    timeout: 15000,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                
                const page = await browser.newPage();
                await page.goto('https://httpbin.org/ip', { 
                    timeout: 10000,
                    waitUntil: 'domcontentloaded'
                });
                
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

    // ... (method lainnya tetap sama, tapi tambah error handling)

    async runSEOBot(targetUrl, proxyList = [], useMobile = false, delay = 5, sessions = 1) {
        this.isRunning = true;
        
        try {
            // Validasi URL
            if (!targetUrl || !targetUrl.startsWith('http')) {
                throw new Error('URL target tidak valid. Gunakan format: https://example.com');
            }

            this.log(`🎯 Target URL: ${targetUrl}`);
            this.log(`📱 Mode: ${useMobile ? 'Mobile' : 'Desktop'}`);
            this.log(`🔄 Jumlah Sesi: ${sessions}`);

            // Test proxies jika ada
            const activeProxies = proxyList.length > 0 ? await this.testProxies(proxyList) : [];
            
            for (let session = 1; session <= sessions && this.isRunning; session++) {
                this.log(`\n🔄 MEMULAI SESI ${session}/${sessions}`);
                
                try {
                    // Pilih proxy random jika ada
                    const useProxy = activeProxies.length > 0;
                    const proxyUrl = useProxy ? 
                        activeProxies[Math.floor(Math.random() * activeProxies.length)] : null;
                    
                    // Initialize browser
                    const browserInitialized = await this.initializeBrowser(useProxy, proxyUrl);
                    if (!browserInitialized) {
                        this.log('❌ Gagal memulai browser, melanjutkan sesi berikutnya...');
                        continue;
                    }
                    
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
                    
                    // Aktivitas manusia
                    await this.simulateHumanActivity(this.page);
                    
                    this.log(`✅ Sesi ${session} selesai`);
                    
                    // Cleanup
                    if (this.browser) {
                        await this.browser.close();
                        this.browser = null;
                    }
                    
                    // Delay antara sesi
                    if (session < sessions) {
                        this.log(`⏳ Menunggu ${delay} detik sebelum sesi berikutnya...`);
                        await new Promise(resolve => setTimeout(resolve, delay * 1000));
                    }
                    
                } catch (error) {
                    this.log(`❌ Error dalam sesi ${session}: ${error.message}`);
                    // Cleanup jika error
                    if (this.browser) {
                        await this.browser.close();
                        this.browser = null;
                    }
                }
            }
            
            this.log('🎉 SEMUA SESI SEO BOT TELAH SELESAI!');
            
        } catch (error) {
            this.log(`💥 ERROR: ${error.message}`);
        } finally {
            this.isRunning = false;
            // Pastikan browser ditutup
            if (this.browser) {
                await this.browser.close();
            }
        }
    }
}

module.exports = SEOBot;

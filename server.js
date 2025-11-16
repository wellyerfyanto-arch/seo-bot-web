const express = require('express');
const path = require('path');
const SEOBot = require('./bot');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint untuk test proxy saja
app.post('/test-proxies', async (req, res) => {
    const { proxyList } = req.body;
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendLog = (message) => {
        res.write(message + '\n');
    };

    try {
        const bot = new SEOBot(sendLog);
        const proxies = proxyList ? proxyList.split('\n').filter(p => p.trim()) : [];
        
        if (proxies.length === 0) {
            sendLog('❌ Tidak ada proxy untuk di-test');
            res.end();
            return;
        }

        sendLog('🔍 Memulai test proxy dengan multiple methods...');
        const activeProxies = await bot.testProxiesComprehensive(proxies);
        
        sendLog('\n📊 HASIL TEST PROXY:');
        sendLog(`✅ Proxy aktif: ${activeProxies.filter(p => p.status === 'active').length}`);
        sendLog(`⚠️  Proxy lambat: ${activeProxies.filter(p => p.status === 'slow').length}`);
        sendLog(`❌ Proxy mati: ${activeProxies.filter(p => p.status === 'dead').length}`);
        
        sendLog('\n🎯 REKOMENDASI PROXY (Tercepat):');
        activeProxies
            .filter(p => p.status === 'active')
            .sort((a, b) => a.responseTime - b.responseTime)
            .slice(0, 10)
            .forEach(proxy => {
                sendLog(`🏎️  ${proxy.proxy} (${proxy.responseTime}ms)`);
            });

        res.end();

    } catch (error) {
        sendLog(`❌ ERROR: ${error.message}`);
        res.end();
    }
});

// Endpoint untuk menjalankan bot
app.post('/run-bot', async (req, res) => {
    const { targetUrl, proxyList, useMobile, delay, sessions, minPing, maxPing } = req.body;
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendLog = (message) => {
        res.write(message + '\n');
    };

    try {
        const bot = new SEOBot(sendLog);
        
        await bot.runSEOBot(
            targetUrl,
            proxyList ? proxyList.split('\n').filter(p => p.trim()) : [],
            useMobile === 'true',
            parseInt(delay) || 5,
            parseInt(sessions) || 1,
            parseInt(minPing) || 100,
            parseInt(maxPing) || 5000
        );

        sendLog('✅ SEMUA SESI SELESAI!');
        res.end();

    } catch (error) {
        sendLog(`❌ ERROR: ${error.message}`);
        res.end();
    }
});

// Health check untuk Railway
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 SEO Bot Server running on port ${PORT}`);
});

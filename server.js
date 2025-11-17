const express = require('express');
const path = require('path');
const SEOBot = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Global bot instance
let activeBot = null;

app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    if (activeBot) {
        activeBot.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    if (activeBot) {
        activeBot.stop();
    }
    process.exit(0);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
            sendLog('❌ No proxies to test');
            res.end();
            return;
        }

        sendLog('🔍 Testing proxies...');
        const results = await bot.testProxiesWithThirdParty(proxies);
        
        const active = results.filter(p => p.status === 'active').length;
        const slow = results.filter(p => p.status === 'slow').length;
        const dead = results.filter(p => p.status === 'dead').length;
        
        sendLog(`\n📊 Results: ${active} active, ${slow} slow, ${dead} dead`);
        
        res.end();

    } catch (error) {
        sendLog(`❌ ERROR: ${error.message}`);
        res.end();
    }
});

app.post('/run-bot', async (req, res) => {
    // Stop previous bot if running
    if (activeBot) {
        activeBot.stop();
    }
    
    const { targetUrl, proxyList, useMobile, delay, sessions, minPing, maxPing } = req.body;
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendLog = (message) => {
        res.write(message + '\n');
    };

    try {
        activeBot = new SEOBot(sendLog);
        
        await activeBot.runSEOBot(
            targetUrl,
            proxyList ? proxyList.split('\n').filter(p => p.trim()) : [],
            useMobile === 'true',
            parseInt(delay) || 3, // Reduced default delay
            parseInt(sessions) || 1,
            parseInt(minPing) || 100,
            parseInt(maxPing) || 5000
        );

        sendLog('✅ All sessions completed!');
        res.end();

    } catch (error) {
        sendLog(`❌ ERROR: ${error.message}`);
        res.end();
    }
});

app.post('/stop-bot', (req, res) => {
    if (activeBot) {
        activeBot.stop();
        activeBot = null;
        res.json({ status: 'stopped' });
    } else {
        res.json({ status: 'no active bot' });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 SEO Bot Server running on port ${PORT}`);
    console.log(`💾 Memory limit: ${process.env.NODE_OPTIONS}`);
});
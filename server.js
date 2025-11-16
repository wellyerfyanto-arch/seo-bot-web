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

// Endpoint untuk menjalankan bot
app.post('/run-bot', async (req, res) => {
    const { targetUrl, proxyList, useMobile, delay, sessions } = req.body;
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Fungsi untuk mengirim log ke client
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
            parseInt(sessions) || 1
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
    console.log(`📧 Access via: http://localhost:${PORT}`);
});
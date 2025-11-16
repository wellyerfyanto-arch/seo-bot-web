const express = require('express');
const path = require('path');
const SEOBot = require('./bot');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        playwright: true
    });
});

// Endpoint untuk menjalankan bot
app.post('/run-bot', async (req, res) => {
    const { targetUrl, proxyList, useMobile, delay, sessions } = req.body;
    
    // Validasi input
    if (!targetUrl) {
        return res.status(400).json({ error: 'URL target diperlukan' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        const bot = new SEOBot((message) => {
            res.write(message + '\n');
        });
        
        await bot.runSEOBot(
            targetUrl,
            proxyList ? proxyList.split('\n').filter(p => p.trim()) : [],
            useMobile === 'true',
            parseInt(delay) || 5,
            parseInt(sessions) || 1
        );

        res.write('✅ SEMUA SESI SELESAI!\n');
        res.end();

    } catch (error) {
        console.error('Bot error:', error);
        res.write(`❌ ERROR: ${error.message}\n`);
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 SEO Bot Server running on port ${PORT}`);
    console.log(`📧 Access via: http://localhost:${PORT}`);
});

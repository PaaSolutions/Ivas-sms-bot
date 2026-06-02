const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Telegraf } = require('telegraf');
const express = require('express');
const crypto = require('crypto');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const BOT_TOKEN = '8627509525:AAESth4wK45uHcaDK49oNgCwFNPSfd5vCf8';
const CHAT_ID = '-1004297132684';
const CHECK_INTERVAL = 7000; // 7 seconds
const CREATOR = '@K1XTREME';

// State
let lastMessages = new Set();
let messageCount = 0;
let startTime = Date.now();
let browser = null;
let page = null;

// Logger
const log = {
    info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
    error: (msg) => console.log(`[ERROR] ${new Date().toISOString()} - ${msg}`),
    success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`),
    warn: (msg) => console.log(`[WARN] ${new Date().toISOString()} - ${msg}`)
};

// Telegram Bot
const bot = new Telegraf(BOT_TOKEN);

// Helper functions
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function extractOTP(message) {
    const patterns = [
        /\b(\d{4,8})\b/,
        /code[:\s]*(\d{4,8})/i,
        /otp[:\s]*(\d{4,8})/i,
        /verification[:\s]*(\d{4,8})/i
    ];
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) return match[1];
    }
    return 'N/A';
}

function maskNumber(number) {
    const clean = number.replace(/\D/g, '');
    if (clean.length >= 10) {
        return `+${clean.slice(0, 4)}****${clean.slice(-4)}`;
    }
    return number;
}

function detectService(message, sender) {
    const combined = (message + ' ' + sender).toLowerCase();
    
    if (combined.includes('telegram') || combined.includes('t.me')) return { icon: '🔵', name: 'Telegram' };
    if (combined.includes('whatsapp') || combined.includes('wa.me')) return { icon: '🟢', name: 'WhatsApp' };
    if (combined.includes('imo')) return { icon: '💬', name: 'IMO' };
    if (combined.includes('facebook') || combined.includes('fb')) return { icon: '📘', name: 'Facebook' };
    if (combined.includes('instagram') || combined.includes('ig')) return { icon: '📷', name: 'Instagram' };
    if (combined.includes('tiktok')) return { icon: '🎵', name: 'TikTok' };
    
    return { icon: '📨', name: 'SMS' };
}

function getCountryFlag(number) {
    const clean = number.replace(/\D/g, '');
    if (clean.startsWith('263')) return '🇿🇼';
    if (clean.startsWith('58')) return '🇻🇪';
    if (clean.startsWith('7')) return '🇰🇿';
    if (clean.startsWith('225')) return '🇨🇮';
    if (clean.startsWith('237')) return '🇨🇲';
    if (clean.startsWith('1')) return '🇺🇸';
    if (clean.startsWith('44')) return '🇬🇧';
    if (clean.startsWith('91')) return '🇮🇳';
    return '📱';
}

function generateHash(sms) {
    const unique = `${sms.datetime}|${sms.number}|${sms.sender}|${sms.message.slice(0, 50)}`;
    return crypto.createHash('md5').update(unique).digest('hex');
}

function formatSMS(sms) {
    const flag = getCountryFlag(sms.number);
    const { icon, name: serviceName } = detectService(sms.message, sms.sender);
    const otpCode = extractOTP(sms.message);
    const maskedNumber = maskNumber(sms.number);
    const safeMessage = escapeHtml(sms.message.slice(0, 500));
    
    return `<b>${flag} New ${serviceName} OTP!</b>\n\n` +
        `🕰 <b>Time:</b> ${sms.datetime}\n` +
        `📞 <b>Number:</b> ${maskedNumber}\n` +
        `${icon} <b>Service:</b> ${serviceName}\n` +
        `🔑 <b>OTP:</b> <code>${otpCode}</code>\n\n` +
        `📩 <b>Message:</b>\n` +
        `<code>${safeMessage}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>All credits goes to ${CREATOR} 🗿</i>`;
}

// Send Telegram message
async function sendTelegramMessage(message) {
    try {
        await bot.telegram.sendMessage(CHAT_ID, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        messageCount++;
        return true;
    } catch (error) {
        log.error(`Telegram error: ${error.message}`);
        return false;
    }
}

// Initialize browser
async function initBrowser() {
    log.info('Launching browser...');
    
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920x1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });
    
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    log.success('Browser launched');
    return page;
}

// Login to IVA SMS portal (automated)
async function autoLogin() {
    log.info('Logging into IVA SMS portal...');
    
    try {
        await page.goto('https://www.ivasms.com/portal', { 
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        await page.waitForTimeout(5000);
        
        // Check if already logged in
        const currentUrl = page.url();
        if (currentUrl.includes('/portal')) {
            log.success('Already logged in');
            const token = await page.evaluate(() => {
                const meta = document.querySelector('meta[name="csrf-token"]');
                return meta ? meta.getAttribute('content') : null;
            });
            if (token) return token;
        }
        
        // Check if on login page
        if (currentUrl.includes('login')) {
            log.warn('On login page - waiting for manual login (60 seconds)...');
            log.info('Please login manually in your browser: https://ivasms.com');
            
            // Wait for navigation after manual login
            await page.waitForNavigation({ timeout: 60000 });
            log.success('Manual login detected');
        }
        
        // Get CSRF token
        const token = await page.evaluate(() => {
            const meta = document.querySelector('meta[name="csrf-token"]');
            return meta ? meta.getAttribute('content') : null;
        });
        
        if (token) {
            log.success(`Token obtained: ${token.substring(0, 20)}...`);
            return token;
        }
        
        throw new Error('Failed to get CSRF token');
        
    } catch (error) {
        log.error(`Login failed: ${error.message}`);
        throw error;
    }
}

// Fetch SMS using puppeteer
async function fetchSMS(token) {
    const today = new Date().toISOString().slice(0, 10);
    
    try {
        // Get ranges
        const ranges = await page.evaluate(async (token, today) => {
            const formData = new URLSearchParams();
            formData.append('from', today);
            formData.append('to', today);
            formData.append('_token', token);
            
            const response = await fetch('/portal/sms/received/getsms', {
                method: 'POST',
                body: formData,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRF-TOKEN': token
                }
            });
            
            const html = await response.text();
            const ranges = [];
            const regex = /toggleRange\('([^']+)'/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                ranges.push(match[1]);
            }
            return ranges;
        }, token, today);
        
        if (!ranges.length) return [];
        
        log.info(`Found ${ranges.length} ranges: ${ranges.join(', ')}`);
        
        const allSMS = [];
        
        for (const range of ranges) {
            // Get numbers
            const numbers = await page.evaluate(async (token, today, range) => {
                const formData = new URLSearchParams();
                formData.append('_token', token);
                formData.append('start', today);
                formData.append('end', today);
                formData.append('range', range);
                
                const response = await fetch('/portal/sms/received/getsms/number', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRF-TOKEN': token
                    }
                });
                
                const html = await response.text();
                const numbers = [];
                const regex = /toggleNum[^(]+\('(\d+)'/g;
                let match;
                while ((match = regex.exec(html)) !== null) {
                    numbers.push(match[1]);
                }
                return numbers;
            }, token, today, range);
            
            log.info(`Range ${range}: ${numbers.length} numbers`);
            
            for (const number of numbers) {
                // Get SMS
                const messages = await page.evaluate(async (token, today, number, range) => {
                    const formData = new URLSearchParams();
                    formData.append('_token', token);
                    formData.append('start', today);
                    formData.append('end', today);
                    formData.append('Number', number);
                    formData.append('Range', range);
                    
                    const response = await fetch('/portal/sms/received/getsms/number/sms', {
                        method: 'POST',
                        body: formData,
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Requested-With': 'XMLHttpRequest',
                            'X-CSRF-TOKEN': token
                        }
                    });
                    
                    const html = await response.text();
                    const messages = [];
                    const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
                    
                    for (const row of rows) {
                        if (row.includes('<th')) continue;
                        
                        const senderMatch = row.match(/class="cli-tag"[^>]*>([^<]+)</);
                        const sender = senderMatch ? senderMatch[1].trim() : 'SMS';
                        
                        const msgMatch = row.match(/class="msg-text"[^>]*>([\s\S]*?)<\/div>/i);
                        let message = '';
                        if (msgMatch) {
                            message = msgMatch[1]
                                .replace(/<[^>]+>/g, '')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&amp;/g, '&')
                                .replace(/&#039;/g, "'")
                                .trim();
                        }
                        
                        const timeMatch = row.match(/class="time-cell"[^>]*>\s*([0-9:]+)\s*</);
                        const time = timeMatch ? timeMatch[1].trim() : new Date().toLocaleTimeString();
                        
                        if (message && message.length > 2) {
                            messages.push({
                                datetime: `${today} ${time}`,
                                number: number,
                                sender: sender,
                                message: message
                            });
                        }
                    }
                    
                    return messages;
                }, token, today, number, range);
                
                allSMS.push(...messages);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        return allSMS;
        
    } catch (error) {
        log.error(`Fetch SMS failed: ${error.message}`);
        return [];
    }
}

// Process new SMS
async function processNewSMS(smsList) {
    if (!smsList.length) return 0;
    
    const newMessages = [];
    for (const sms of smsList) {
        const hash = generateHash(sms);
        if (!lastMessages.has(hash)) {
            newMessages.push(sms);
            lastMessages.add(hash);
            if (lastMessages.size > 5000) {
                const toDelete = [...lastMessages].slice(0, 2500);
                toDelete.forEach(h => lastMessages.delete(h));
            }
        }
    }
    
    if (!newMessages.length) return 0;
    
    let sent = 0;
    for (const sms of newMessages) {
        if (await sendTelegramMessage(formatSMS(sms))) {
            sent++;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    if (sent > 0) {
        log.info(`📨 Sent ${sent} new messages`);
    }
    
    return sent;
}

// Express app for health checks
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>IVA SMS Monitor</title></head>
        <body>
            <h1>🤖 IVA SMS Monitor Bot</h1>
            <p>Status: <b style="color:green">RUNNING ✅</b></p>
            <p>Messages Sent: <b>${messageCount}</b></p>
            <p>Uptime: <b>${Math.floor((Date.now() - startTime) / 1000)} seconds</b></p>
            <p>Check Interval: <b>7 seconds</b></p>
            <hr>
            <h3>📝 Instructions for First Time Setup</h3>
            <ol>
                <li>Visit <a href="https://www.ivasms.com" target="_blank">https://www.ivasms.com</a> and login</li>
                <li>Come back here - the bot will detect your login</li>
                <li>Wait for "Login successful" message in Telegram</li>
            </ol>
            <hr>
            <p><i>Bot is monitoring for OTP messages every 7 seconds</i></p>
            <p>Creator: <b>${CREATOR}</b></p>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'alive',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        messages: messageCount,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    log.info(`Web server running on port ${PORT}`);
});

// Main function
async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('  🔥 IVA SMS MONITOR - PROFESSIONAL EDITION 🔥');
    console.log(`  👑 Created by ${CREATOR}`);
    console.log(`  ⏱️  Check Interval: 7 seconds`);
    console.log('═'.repeat(60) + '\n');
    
    try {
        await initBrowser();
        
        // First, try to auto-detect login
        let token = await autoLogin();
        
        if (!token) {
            log.warn('Could not auto-login. Please visit the bot URL and login manually.');
            await sendTelegramMessage(`<b>⚠️ Manual Login Required</b>\n\n` +
                `Please visit the bot's web interface and login to IVA SMS.\n` +
                `The bot will detect your login automatically.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `<i>All credits goes to ${CREATOR} 🗿</i>`);
            
            // Wait for manual login
            while (!token) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                await page.reload();
                token = await page.evaluate(() => {
                    const meta = document.querySelector('meta[name="csrf-token"]');
                    return meta ? meta.getAttribute('content') : null;
                });
                if (token) log.success('Manual login detected!');
            }
        }
        
        await sendTelegramMessage(`<b>✅ IVA SMS Monitor Active</b>\n\n` +
            `• Session: Active\n` +
            `• Check Interval: 7s\n` +
            `• Browser: Puppeteer (No Cloudflare issues!)\n` +
            `• Monitoring for new messages...\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>All credits goes to ${CREATOR} 🗿</i>`);
        
        log.success('Bot started successfully!');
        
        let lastStats = Date.now();
        
        while (true) {
            try {
                // Refresh token occasionally
                const freshToken = await page.evaluate(() => {
                    const meta = document.querySelector('meta[name="csrf-token"]');
                    return meta ? meta.getAttribute('content') : null;
                });
                if (freshToken) token = freshToken;
                
                const smsList = await fetchSMS(token);
                await processNewSMS(smsList);
                
                if (Date.now() - lastStats > 600000) {
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    await sendTelegramMessage(`<b>📊 Bot Statistics</b>\n\n` +
                        `• Uptime: ${hours}h ${minutes}m\n` +
                        `• Messages Sent: ${messageCount}\n` +
                        `• Check Interval: 7s\n` +
                        `• Status: ✅ Active\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `<i>All credits goes to ${CREATOR} 🗿</i>`);
                    lastStats = Date.now();
                }
                
                await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
                
            } catch (error) {
                log.error(`Loop error: ${error.message}`);
                
                // Try to recover
                try {
                    await page.reload({ waitUntil: 'networkidle2' });
                    await page.waitForTimeout(3000);
                    log.success('Page reloaded');
                } catch (recoverError) {
                    log.error('Failed to recover, restarting browser...');
                    await browser.close();
                    await initBrowser();
                    token = await autoLogin();
                }
                
                await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
            }
        }
        
    } catch (error) {
        log.error(`Fatal error: ${error.message}`);
        await sendTelegramMessage(`<b>❌ Bot Failed</b>\n\n` +
            `Error: ${error.message}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>All credits goes to ${CREATOR} 🗿</i>`);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⚠️ Shutting down...');
    if (browser) await browser.close();
    process.exit(0);
});

// Start
main().catch(console.error);

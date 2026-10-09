/*
  SHANA GIRL MD MINI BOT - MULTI SESSION SUPPORT
  DEVELOPED BY SHANA DEVALOPEE
  FULLY ENC AND PRIVET SOURCE CODE
*/

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { sms } = require("./msg");
const router = express.Router();
const pino = require('pino');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const yts = require('yt-search');
const { ytmp3, ytmp4 } = require('sadaslk-dlcore');
const os = require('os');
const fecth = require('node-fetch');
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);
// ffmpeg-static binary eka yt-dlp ekatath pennanna (mp3 convert ekata)
process.env.PATH = path.dirname(ffmpegPath) + ':' + (process.env.PATH || '');

// ═══ Tesseract + pdf-parse (receipt OCR සඳහා) ═══
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');

// ═══════════════════════════════════════════════════════════════
// ═══ SHANA AUTO CONTACT SAVE — NATIVE WHATSAPP (Google නැතුව) ═══
// ═══ RAM-friendly: module එකක් load කරන්නෙ නෑ, Map + JSON file ═══
// ═══ Save වෙද්දිම 1-2s ඇතුලට. ආයෙක් save වෙන්නෙ නෑ.           ═══
// ═══════════════════════════════════════════════════════════════
const SHANA_SAVED_CONTACTS_PATH = path.join(__dirname, 'session', 'shana_saved_contacts.json');
const shanaContactCache = new Map();                 // runtime dedupe (TTL)
const SHANA_CONTACT_TTL = 24 * 60 * 60 * 1000;       // එකම number එකට දවසකට එකපාරයි
const shanaSavedContacts = new Set();                // permanent — file එකෙන් load වෙනවා

try {
    if (fs.existsSync(SHANA_SAVED_CONTACTS_PATH)) {
        const arr = JSON.parse(fs.readFileSync(SHANA_SAVED_CONTACTS_PATH, 'utf8'));
        if (Array.isArray(arr)) arr.forEach(n => shanaSavedContacts.add(String(n)));
        console.log(`✅ [AUTO SAVE] ${shanaSavedContacts.size} saved contacts loaded from file`);
    }
} catch (e) {
    console.warn('⚠️ [AUTO SAVE] saved contacts file load error:', e.message);
}

let shanaSavePersistTimer = null;
function shanaPersistSavedContacts() {
    // debounced write — RAM/disk friendly
    if (shanaSavePersistTimer) return;
    shanaSavePersistTimer = setTimeout(() => {
        shanaSavePersistTimer = null;
        try {
            fs.writeFileSync(SHANA_SAVED_CONTACTS_PATH, JSON.stringify([...shanaSavedContacts], null, 2));
        } catch (e) {
            console.warn('⚠️ [AUTO SAVE] persist error:', e.message);
        }
    }, 3000);
}

// msg/call එකෙන් එන jid + pushName එකෙන් contact එක save කරන main function (FIXED)
async function shanaAutoSaveContact(socket, jid, pushName, botKey) {
    let number = '';
    try {
        if (!socket || !jid) return;

        if (jid === 'status@broadcast') return;
        if (jid.endsWith('@g.us') || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return;

        number = String(jid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        if (!number || number.length < 7) return;

        // බොට්ගේම අංකය skip
        if (botKey && number === String(botKey).replace(/[^0-9]/g, '')) return;

        // permanent check — දැනටමත් save කරලා තියෙනවා නම් ආයෙ save නෑ
        if (shanaSavedContacts.has(number)) return;

        // runtime dedupe — TTL
        const last = shanaContactCache.get(number) || 0;
        if (Date.now() - last < SHANA_CONTACT_TTL) return;
        shanaContactCache.set(number, Date.now());

        // cache එක ලොකු වැඩි නම් මුල් entries අයින් කරනවා (RAM ආරක්ෂාව)
        if (shanaContactCache.size > 3000) {
            const firstKey = shanaContactCache.keys().next().value;
            if (firstKey) shanaContactCache.delete(firstKey);
        }

        const name = (pushName && String(pushName).trim())
            ? String(pushName).trim()
            : `SHANA ${number}`;

        const contact = {
            fullName: name,
            firstName: name,
            saveOnPrimaryAddressbook: true
        };

        // LID jid එකක් නම් lidJid වලට දාන්න (Baileys 7.x)
        if (String(jid).endsWith('@lid')) contact.lidJid = jid;
        else contact.pnJid = jid;

        let savedNative = false;

        // FIX: addOrEditContact API එක තියෙනවා නම් (Baileys fork එකක) native save කරනවා
        if (typeof socket.addOrEditContact === 'function') {
            try {
                await socket.addOrEditContact(String(jid), contact);
                savedNative = true;
            } catch (e2) {
                console.warn('⚠️ [AUTO SAVE] native save failed, falling back to record:', e2.message);
            }
        }

        // FIX: සාමාන්‍ය Baileys version වල addOrEditContact නෑ —
        // ඒත් මෙතනින් return වෙන්නේ නෑ. Contact record එක permanent file එකට
        // save කරලා success mark කරනවා (ආයෙ ආයෙ try නොවෙන්න, spam log නොවෙන්න).
        // Native API එක support කරන version එකකට switch කළාම auto native save වෙනවා.
        const record = {
            number: number,
            jid: String(jid),
            name: name,
            savedNative: savedNative,
            savedAt: new Date().toISOString()
        };
        try {
            fs.ensureDirSync(path.dirname(SHANA_SAVED_CONTACTS_PATH));
            const recordPath = path.join(path.dirname(SHANA_SAVED_CONTACTS_PATH), `shana_contact_${number}.json`);
            fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
        } catch (recErr) {
            console.warn('⚠️ [AUTO SAVE] record write error:', recErr.message);
        }

        // success — permanent list එකට දාන්න (ආයෙ save වෙන්නෙ නෑ)
        shanaSavedContacts.add(number);
        shanaPersistSavedContacts();

        console.log(`✅ [AUTO SAVE] +${number} → "${name}" ${savedNative ? 'saved to contacts' : 'recorded (native API unavailable)'}`);
    } catch (e) {
        if (number) {
            shanaContactCache.delete(number);   // fail උනොත් ආයෙ try කරන්න ඉඩ දෙනවා
        }
        console.error('❌ [AUTO SAVE] error:', e.message);
    }
}

// ═══ SHANA IMAGE — හැම තැනම මේ එකම image එක ═══
const SHANA_IMG = 'https://files.catbox.moe/bruuvx.jpg';
const akira = SHANA_IMG;

// ═══ AUTO SAVE STATE ═══
const autoSaveEnabled = new Map();
const autoSaveCounters = new Map();

const {
    default: makeWASocket,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    fetchLatestBaileysVersion,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    extractMessageContent,
    jidDecode,
    MessageRetryMap,
    jidNormalizedUser,
    proto,
    getContentType,
    areJidsSameUser,
    generateWAMessage,
    delay,
    Browsers
} = require("baileys");

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    STATUS: 'true',
    MODE: 'public',
    PREFIX: '.',
    MAX_RETRIES: 3,
    ADMIN_LIST_PATH: './admin.json',
    AKIRA_IMG: 'https://files.catbox.moe/bruuvx.jpg',
    AUTORP_IMG: 'https://files.catbox.moe/bruuvx.jpg',
    NEWSLETTER_JID: '120363419619460838@newsletter',
    NEWSLETTER_LIST: [
        '120363425584831057@newsletter',
        '120363422562980426@newsletter'
    ],
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94728348795',
    CHANNEL_LINK: ''
};

const replyFq = (text) => reply(text);
const activeSockets = new Map();
const socketCreationTime = new Map();
const socketHandlersMap = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';

// ═══ Status forward සඳහා ═══
const latestStatuses = new Map();

// ═══ Receipt OCR dedupe ═══
const receiptProcessed = new Set();
setInterval(() => receiptProcessed.clear(), 10 * 60 * 1000);

const SessionSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    creds: { type: Object, required: true },
    config: { type: Object },
    updatedAt: { type: Date, default: Date.now }
});
const Session = mongoose.model('Session', SessionSchema);

async function connectMongoDB() {
    try {
        const mongoUri = process.env.MONGO_URI || '<MONGODB-URL>';
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection failed:', error);
        console.log('Retrying MongoDB in 10s...');
        setTimeout(connectMongoDB, 10000);
    }
}
connectMongoDB();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function initialize() {
    activeSockets.clear();
    socketCreationTime.clear();
    console.log('Cleared active sockets and creation times on startup');
}

async function uploadToCatbox(stream, fileName) {
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', stream, fileName);

        const res = await axios.post(
            'https://catbox.moe/user/api.php',
            form,
            { headers: form.getHeaders(), timeout: 0 }
        );

        if (!res.data.startsWith('https://')) return null;
        return res.data.trim();
    } catch {
        return null;
    }
}

async function saveMediaToCatbox(msg) {
    try {
        const type = Object.keys(msg.message)[0];
        const mediaMap = {
            imageMessage: 'image',
            videoMessage: 'video',
            audioMessage: 'audio',
            documentMessage: 'document'
        };

        if (!mediaMap[type]) return null;

        const mediaMsg = msg.message[type];
        const size = mediaMsg.fileLength || 0;

        if (size > 100 * 1024 * 1024) return null;

        const stream = await downloadContentFromMessage(mediaMsg, mediaMap[type]);

        const ext =
            type === 'imageMessage' ? 'jpg' :
            type === 'videoMessage' ? 'mp4' :
            type === 'audioMessage' ? 'opus' :
            'bin';

        return await uploadToCatbox(stream, `${msg.key.id}.${ext}`);
    } catch {
        return null;
    }
}

async function cleanupInactiveSessions() {
    try {
        const sessions = await Session.find({}, 'number').lean();
        let cleanedCount = 0;

        for (const { number } of sessions) {
            const sanitizedNumber = number.replace(/[^0-9]/g, '');

            if (!activeSockets.has(sanitizedNumber) && !socketCreationTime.has(sanitizedNumber)) {
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

                if (fs.existsSync(sessionPath)) {
                    const stats = fs.statSync(sessionPath);
                    const timeSinceModified = Date.now() - stats.mtime.getTime();

                    if (timeSinceModified > 60 * 60 * 1000) {
                        console.log(`Cleaning up stale session: ${sanitizedNumber}`);
                        fs.removeSync(sessionPath);
                        cleanedCount++;
                    }
                }
            }
        }

        console.log(`Cleaned up ${cleanedCount} stale sessions`);
        return cleanedCount;
    } catch (error) {
        console.error('Cleanup error:', error);
        return 0;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const jid = message.key.remoteJid;

        if (jid !== config.NEWSLETTER_JID) return;

        try {
            const emojis = ['🎀', '🍬', '👽', '🌺', '🍓', '🍫', '🫐', '🥷'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

            const messageId = message.key.server_id || message.newsletterServerId;

            if (!messageId) {
                console.warn('⚠️ No newsletterServerId found in message:', message);
                return;
            }

            await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
            console.log(`✅ Reacted to official newsletter: ${jid}`);
        } catch (error) {
            console.error('⚠️ Newsletter reaction failed:', error.message);
        }
    });
}

async function autoReconnectOnStartup() {
    try {
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            console.log(`Loaded ${numbers.length} numbers from numbers.json`);
        }

        const sessions = await Session.find({}, 'number').lean();
        const mongoNumbers = sessions.map(s => s.number);
        numbers = [...new Set([...numbers, ...mongoNumbers])];

        if (numbers.length === 0) {
            console.log('No numbers found for auto-reconnect');
            return;
        }

        console.log(`Attempting to reconnect ${numbers.length} sessions...`);

        for (const number of numbers) {
            const sanitized = number.replace(/[^0-9]/g, '');
            if (activeSockets.has(sanitized)) {
                console.log(`Number ${sanitized} already connected, skipping`);
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };

            try {
                await EmpirePair(sanitized, mockRes);
                console.log(`✅ Initiated reconnect for ${sanitized}`);
            } catch (error) {
                console.error(`❌ Failed to reconnect ${sanitized}:`, error);
            }

            await delay(1500);
        }
    } catch (error) {
        console.error('Auto-reconnect on startup failed:', error);
    }
}

(async () => {
    await initialize();
    setTimeout(autoReconnectOnStartup, 5000);
})();

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

const fetchJson = async (url, options) => {
    try {
        options ? options : {}
        const res = await axios({
            method: 'GET',
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
            },
            ...options
        })
        return res.data
    } catch (err) {
        return err
    }
}

const runtime = (seconds) => {
    seconds = Number(seconds)
    var d = Math.floor(seconds / (3600 * 24))
    var h = Math.floor(seconds % (3600 * 24) / 3600)
    var m = Math.floor(seconds % 3600 / 60)
    var s = Math.floor(seconds % 60)
    var dDisplay = d > 0 ? d + (d == 1 ? ' day, ' : ' days, ') : ''
    var hDisplay = h > 0 ? h + (h == 1 ? ' hour, ' : ' hours, ') : ''
    var mDisplay = m > 0 ? m + (m == 1 ? ' minute, ' : ' minutes, ') : ''
    var sDisplay = s > 0 ? s + (s == 1 ? ' second' : ' seconds') : ''
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

// ══════════════════════════════════════════════════════════════
// ═══ SHANA UNIVERSAL DOWNLOADER (yt-dlp + API fallback) ═══
// ══════════════════════════════════════════════════════════════
const YT_DLP_PATH = path.join(__dirname, 'yt-dlp');

const execAsync = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 200, timeout: 300000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
    });
});

async function ytdlpDirect(url, mode, outPath) {
    let ytdl = YT_DLP_PATH;
    if (!fs.existsSync(YT_DLP_PATH)) ytdl = 'yt-dlp';

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    let cmd;
    if (mode === 'mp3') {
        cmd = `"${ytdl}" -f "bestaudio/best" --no-playlist --no-warnings --user-agent "${UA}" -x --audio-format mp3 --audio-quality 0 -o "${outPath}.%(ext)s" "${url}"`;
    } else {
        cmd = `"${ytdl}" -f "best[ext=mp4][height<=720]/best[ext=mp4]/best" --no-playlist --no-warnings --user-agent "${UA}" --merge-output-format mp4 -o "${outPath}.%(ext)s" "${url}"`;
    }
    await execAsync(cmd);

    const dir = path.dirname(outPath);
    const base = path.basename(outPath);
    const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
    if (!files.length) throw new Error('Download failed');
    return path.join(dir, files[0]);
}

async function downloadFromUrl(directUrl, outPath, ext = 'mp4') {
    const res = await axios.get(directUrl, {
        responseType: 'arraybuffer',
        timeout: 300000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    const filePath = outPath + '.' + ext;
    fs.writeFileSync(filePath, Buffer.from(res.data));
    if (fs.statSync(filePath).length < 10000) throw new Error('File too small / invalid');
    return filePath;
}

async function ytdlpDownload(url, mode, outPath) {
    try {
        return await ytdlpDirect(url, mode, outPath);
    } catch (e) {
        console.log('yt-dlp failed, trying API fallback:', e.message.slice(0, 150));
    }

    if (mode === 'mp3') {
        try {
            const r = await axios.post(`https://api.cobalt.tools/api/json`,
                { url: url, aFormat: 'mp3', isAudioOnly: true },
                { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 30000 });
            if (r.data?.url) return await downloadFromUrl(r.data.url, outPath, 'mp3');
        } catch (_) {}

        try {
            const r = await axios.get(`https://ytdl-new-dxz.vercel.app/api/ytmp3?url=${encodeURIComponent(url)}`, { timeout: 30000 });
            const dl = r.data.download_url || r.data.result || r.data.url;
            if (dl) return await downloadFromUrl(dl, outPath, 'mp3');
        } catch (_) {}

        throw new Error('All download methods failed');
    }

    if (url.includes('tiktok.com')) {
        try {
            const r = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { timeout: 30000 });
            const d = r.data?.data;
            const dl = d?.play || d?.hdplay || d?.wmplay;
            if (dl) return await downloadFromUrl(dl.startsWith('http') ? dl : 'https://www.tikwm.com' + dl, outPath, 'mp4');
        } catch (_) {}

        try {
            const r = await axios.get(`https://www.movanest.xyz/v2/tiktok?url=${encodeURIComponent(url)}`, { timeout: 30000 });
            const d = r.data?.results;
            const dl = d?.no_watermark || d?.watermark;
            if (dl) return await downloadFromUrl(dl, outPath, 'mp4');
        } catch (_) {}
    }

    if (url.includes('facebook.com') || url.includes('fb.watch')) {
        try {
            const r = await axios.get(`https://www.movanest.xyz/v2/fbdown?url=${encodeURIComponent(url)}`, { timeout: 30000 });
            const d = r.data?.results?.[0];
            const dl = d?.hdQualityLink || d?.normalQualityLink;
            if (dl) return await downloadFromUrl(dl, outPath, 'mp4');
        } catch (_) {}

        try {
            const r = await axios.post(`https://api.cobalt.tools/api/json`,
                { url: url },
                { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 30000 });
            if (r.data?.url) return await downloadFromUrl(r.data.url, outPath, 'mp4');
        } catch (_) {}
    }

    if (url.includes('youtu')) {
        try {
            const r = await axios.get(`https://ytdl-new-dxz.vercel.app/api/ytmp4?url=${encodeURIComponent(url)}&quality=360`, { timeout: 30000 });
            const dl = r.data.video_url || r.data.download_url;
            if (dl) return await downloadFromUrl(dl, outPath, 'mp4');
        } catch (_) {}

        try {
            const r = await axios.post(`https://api.cobalt.tools/api/json`,
                { url: url },
                { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 30000 });
            if (r.data?.url) return await downloadFromUrl(r.data.url, outPath, 'mp4');
        } catch (_) {}
    }

    try {
        const r = await axios.post(`https://api.cobalt.tools/api/json`,
            { url: url },
            { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 30000 });
        if (r.data?.url) return await downloadFromUrl(r.data.url, outPath, 'mp4');
    } catch (_) {}

    throw new Error('All download methods failed');
}

async function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const senderNumber = msg.key.participant ? msg.key.participant.split('@')[0] : msg.key.remoteJid.split('@')[0];
        const botNumber = jidNormalizedUser(socket.user.id).split('@')[0];
        const isReact = msg.message.reactionMessage;

        const sanitizedNumber = botNumber.replace(/[^0-9]/g, '');
        const sessionConfig = activeSockets.get(sanitizedNumber)?.config || config;
    });
}

function setupAutoRestart(socket, number) {
    const id = number;
    let reconnecting = false;

    socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {

        if (connection === 'open') {
            reconnecting = false;
            return;
        }

        if (connection !== 'close' || reconnecting) return;
        reconnecting = true;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.warn(`[${id}] Connection closed | code:`, statusCode);

        if (statusCode === 401) {
            await destroySocket(id);
            await deleteSession(id);
            return;
        }

        await delay(2000);
        await destroySocket(id);

        const mockRes = {
            headersSent: true,
            send() {},
            status() { return this }
        };

        try {
            await EmpirePair(id, mockRes);
        } catch (e) {
            console.error('Reconnect failed:', e);
        }

        reconnecting = false;
    });
}

async function destroySocket(id) {
    try {
        const data = activeSockets.get(id);
        if (data?.socket?._statusFwdInterval) clearInterval(data.socket._statusFwdInterval);
        if (data?.socket) {
            data.socket.ev.removeAllListeners();
            data.socket.ws?.close();
        }
    } catch (e) {
        console.error('Destroy socket error:', e);
    }

    activeSockets.delete(id);
    socketCreationTime.delete(id);
}

async function saveSession(number, creds) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.findOneAndUpdate({
            number: sanitizedNumber
        }, {
            creds,
            updatedAt: new Date()
        }, {
            upsert: true
        });
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(creds, null, 2));
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
        }
        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        }
        console.log(`Saved session for ${sanitizedNumber} to MongoDB, local storage, and numbers.json`);
    } catch (error) {
        console.error(`Failed to save session for ${sanitizedNumber}:`, error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const session = await Session.findOne({
            number: sanitizedNumber
        });
        if (!session) {

            return null;
        }
        if (!session.creds || !session.creds.me || !session.creds.me.id) {
            console.error(`Invalid session data for ${sanitizedNumber}`);
            await deleteSession(sanitizedNumber);
            return null;
        }
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(session.creds, null, 2));
        console.log(`Restored session for ${sanitizedNumber} from MongoDB`);
        return session.creds;
    } catch (error) {
        console.error(`Failed to restore session for ${number}:`, error);
        return null;
    }
}

async function deleteSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.deleteOne({
            number: sanitizedNumber
        });
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
        }
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            let numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        }

    } catch (error) {
        console.error(`Failed to delete session for ${number}:`, error);
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configDoc = await Session.findOne({
            number: sanitizedNumber
        }, 'config');
        return configDoc?.config || {
            ...config
        };
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return {
            ...config
        };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.findOneAndUpdate({
            number: sanitizedNumber
        }, {
            config: newConfig,
            updatedAt: new Date()
        }, {
            upsert: true
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error(`Failed to update config for ${sanitizedNumber}:`, error);
        throw error;
    }
}

async function setupStatusHandlers(socket) {
    const pendingReplies = new Map();
    const seenJids = new Set();

    socket.ev.on('messages.upsert', async ({
        messages
    }) => {
        const msg = messages[0];
        if (!msg?.key ||
            msg.key.remoteJid !== 'status@broadcast' ||
            !msg.key.participant ||
            msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const botJid = jidNormalizedUser(socket.user.id);
        if (msg.key.participant === botJid) return;

        const sanitizedNumber = botJid.split('@')[0].replace(/[^0-9]/g, '');
        const sessionConfig = activeSockets.get(sanitizedNumber)?.config || config;

        if ((sessionConfig.STATUS || config.STATUS) !== 'true') return;

        // ═══ NIGHT MODE — රෑ වෙලාවේ status view/like නෑ ═══
        if (shanaIsNightMode()) return;

        try {
            latestStatuses.set(sanitizedNumber, {
                key: msg.key,
                message: msg.message,
                from: msg.key.participant,
                ts: Date.now()
            });
            for (const [k, v] of latestStatuses) {
                if (Date.now() - v.ts > 24 * 60 * 60 * 1000) latestStatuses.delete(k);
            }
        } catch (_) {}

        let statusViewed = false;

        try {

            if (sessionConfig.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([msg.key]);
                        statusViewed = true;
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) {
                            console.error('Permanently failed to view status:', error);
                            return;
                        }
                        await delay(1000 * (config.MAX_RETRIES - retries + 1));
                    }
                }
            } else {

                statusViewed = true;
            }

            if (statusViewed && sessionConfig.AUTO_LIKE_STATUS === 'true') {
                await delay(5000);

                const emojis = sessionConfig.AUTO_LIKE_EMOJI || ['❤️', '💚', '💜', '🧡', '🩷'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            msg.key.remoteJid, {
                                react: {
                                    text: randomEmoji,
                                    key: msg.key
                                }
                            }, {
                                statusJidList: [msg.key.participant]
                            }
                        );
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) {
                            console.error('Permanently failed to react to status:', error);
                        }
                        await delay(1000 * (config.MAX_RETRIES - retries + 1));
                    }
                }
            }

        } catch (error) {
            console.error('Unexpected error in status handler:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function EmpirePair(number, res) {
    console.log(`Initiating pairing/reconnect for ${number}`);
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    if (activeSockets.has(sanitizedNumber)) {
        try { activeSockets.get(sanitizedNumber).socket?.end?.(); } catch {}
        activeSockets.delete(sanitizedNumber);
    }

    await restoreSession(sanitizedNumber);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const socket = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            printQRInTerminal: false,
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        // ═══ GLOBAL HUMAN TYPING ═══
        const origSendMessage = socket.sendMessage.bind(socket);
        socket.sendMessage = async (jid, content, opts) => {
            try {
                const jidStr = typeof jid === 'string' ? jid : jid?.id || '';
                const isChatJid =
                    typeof jidStr === 'string' &&
                    (jidStr.endsWith('@s.whatsapp.net') || jidStr.endsWith('@g.us'));
                const hasText = content && (typeof content.text === 'string' || typeof content.caption === 'string');

                if (isChatJid && hasText && Math.random() < 0.85) {
                    const thinkTime = 800 + Math.floor(Math.random() * 1700);
                    await socket.sendPresenceUpdate('composing', jidStr);
                    await delay(thinkTime);
                    const result = await origSendMessage(jid, content, opts);
                    await socket.sendPresenceUpdate('paused', jidStr).catch(() => {});
                    return result;
                }
            } catch (_) {}
            return origSendMessage(jid, content, opts);
        };

        if (!socket._handlersAttached) {
            socket._handlersAttached = true;
            setupCommandHandlers(socket, sanitizedNumber);
            setupStatusHandlers(socket);
            setupNewsletterHandlers(socket);
            setupMessageHandlers(socket);
        }

        setupAutoRestart(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            const custom = "SHANADV1";
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber, custom);
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) res.send({ code });
        }

        socket.ev.on('creds.update', async () => {
            try {
                await saveCreds();
                const credsPath = path.join(sessionPath, 'creds.json');
                if (!fs.existsSync(credsPath)) return;
                const fileContent = await fs.readFile(credsPath, 'utf8');
                const creds = JSON.parse(fileContent);
                await saveSession(sanitizedNumber, creds);
            } catch {}
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`✅ Connection opened for ${sanitizedNumber}`);
                try {
                    await delay(3000);

                    if (!socket.user?.id) {
                        console.error(`❌ socket.user is null after connection open for ${sanitizedNumber}`);
                        return;
                    }

                    const userJid = jidNormalizedUser(socket.user.id);
                    const freshConfig = await loadUserConfig(sanitizedNumber);

                    activeSockets.set(sanitizedNumber, { socket, config: freshConfig });
                    console.log(`📌 Socket registered in activeSockets for ${sanitizedNumber}`);

                    if (freshConfig.AUTOSAVE === 'true') {
                        autoSaveEnabled.set(sanitizedNumber, true);
                        console.log(`✅ [AUTO SAVE] Restored ON state for ${sanitizedNumber}`);
                    } else {
                        autoSaveEnabled.set(sanitizedNumber, false);
                    }

                    try {
                        const combinedList = [];

                        if (config.NEWSLETTER_JID) {
                            combinedList.push(config.NEWSLETTER_JID);
                        }

                        if (config.NEWSLETTER_LIST && Array.isArray(config.NEWSLETTER_LIST)) {
                            config.NEWSLETTER_LIST.forEach(jid => {
                                if (!combinedList.includes(jid)) {
                                    combinedList.push(jid);
                                }
                            });
                        }

                        console.log(`📌 Total Newsletters to follow (including Main): ${combinedList.length}`);

                        for (const jid of combinedList) {
                            try {
                                await socket.newsletterFollow(jid);

                                if (jid === config.NEWSLETTER_JID) {
                                    console.log(`👑 Main Newsletter Followed Successfully: ${jid}`);
                                } else {
                                    console.log(`✅ Extra Newsletter Followed: ${jid}`);
                                }

                                await delay(2000);
                            } catch (e) {
                                console.log(`❌ Newsletter error for ${jid}:`, e.message);
                            }
                        }
                    } catch (newsletterError) {
                        console.error("Newsletter list error:", newsletterError);
                    }

                    await socket.sendMessage(userJid, {
                        image: { url: SHANA_IMG },
                        caption: `**↳ ❝ [🎀  𝗦𝗛𝗔𝗡𝗔 SYSTEM ONLINE  🎀] ¡! ❞**

╭─────⊹₊⟡⋆ 𝐈𝐧𝐟𝐨 ⋆⟡₊⊹─────<𝟑 .ᐟ
┊ 𝜗𝜚⋆ : 𝚅𝙴𝚁𝙸𝙾𝙽 - V1.0.0
┊ 𝜗𝜚⋆ : 𝙽𝚄𝙼𝙱𝙴𝚁 - ${sanitizedNumber}
┊ 𝜗𝜚⋆ : 𝙾𝚆𝙽𝙴𝚁 -  𝑺𝑯𝑨𝑵𝑨 𝑨𝑼𝑻𝑶 𝑺𝒀𝑺𝑻𝑬𝑴 ⚡ ִ ࣪𖤐.ᐟ
╰────────────────────<𝟑 .ᐟ

POWER BUY SHANA OWNER 🥷.
I'M BACK SHANA SYSTEM ONLINE ✅. 

₊❏❜ ⋮ Web - nipunbotsystem-production.up.railway.app

> * 𝑺𝑯𝑨𝑵𝑨 𝑨𝑼𝑻𝑶 𝑺𝒀𝑺𝑻𝑬𝑴 ⚡ ✹*`
                    });
                    console.log(`📩 Welcome message sent for ${sanitizedNumber}`);

                    // ═══ NIGHT MODE — reconnect උනොත් රෑ වෙලාවක් නම් notice එක ═══
                    if (shanaIsNightMode()) {
                        await shanaSendNightNotice(socket, userJid, null);
                    }
                } catch (error) {
                    console.error('Error in connection open handler:', error.message);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === 401) {
                    try { socket.end(); } catch {}
                    activeSockets.delete(sanitizedNumber);
                    socketCreationTime.delete(sanitizedNumber);
                    await deleteSession(sanitizedNumber);
                }
            }
        });

    } catch (error) {
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

// ═══════ PART 2 මෙතනින් පටන් ගන්නවා ═══════
async function setupCommandHandlers(socket, number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    let sessionConfig = await loadUserConfig(sanitizedNumber);
    activeSockets.set(sanitizedNumber, {
        socket,
        config: sessionConfig
    });

    if (sessionConfig.AUTOSAVE === 'true') {
        autoSaveEnabled.set(sanitizedNumber, true);
    } else {
        autoSaveEnabled.set(sanitizedNumber, false);
    }

    const recentCallers = new Set();

    const autorpLastSent = new Map();
    const AUTORP_DELAY_MS_MIN = 5000;
    const AUTORP_DELAY_MS_MAX = 10000;

    const statusFwdLastSent = new Map();
    const STATUS_FWD_COOLDOWN_MS = 10 * 60 * 1000;

    if (socket._statusFwdInterval) clearInterval(socket._statusFwdInterval);
    socket._statusFwdInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, ts] of statusFwdLastSent) {
            if (now - ts > STATUS_FWD_COOLDOWN_MS * 2) statusFwdLastSent.delete(key);
        }
    }, 30000);

    // ═══ SHANA AGENT - CALLCUT handler ═══
    socket.ev.on('call', async (calls) => {
        try {
            const currentData = activeSockets.get(sanitizedNumber);
            const cfg = currentData?.config || sessionConfig;

            // ═══ SHANA AUTO SAVE — call එකක් ආවම number එක save ═══
            try {
                if (autoSaveEnabled.get(sanitizedNumber) === true) {
                    for (const call of calls) {
                        if (call && call.from) {
                            let callName = null;
                            try { callName = (typeof socket.getName === 'function') ? socket.getName(call.from) : null; } catch (_) {}
                            shanaAutoSaveContact(socket, call.from, callName || '', sanitizedNumber).catch(() => {});
                        }
                    }
                }
            } catch (_) {}

            if (cfg.CALLCUT !== 'true') return;

            // ═══ NIGHT MODE — රෑ වෙලාවේ call cut කරලා notice එක විතරයි ═══
            if (shanaIsNightMode()) {
                for (const call of calls) {
                    if (call.status === 'offer') {
                        try {
                            await socket.rejectCall(call.id, call.from);
                            await shanaSendNightNotice(socket, call.from, null);
                            console.log(`🌙 [NIGHT MODE] Call rejected from ${call.from}`);
                        } catch (_) {}
                    }
                }
                return;
            }

            for (const call of calls) {
                if (call.status === 'offer') {
                    const callFrom = call.from;
                    const callId = call.id;
                    try {
                        await socket.rejectCall(callId, callFrom);
                        console.log(`✅ [SHANA AGENT] Call cut from ${callFrom}`);

                        await socket.sendMessage(callFrom, {
                            text: `*❗සාමාවේන්න 🙌.*

 *මේ වේලාවේ ඔබට UVA SERVICE ඇඩ්මින් සමග Call වලින්  සම්බන්ද විය නොහැක.* 

 *Call Back කරන තුරු රැදී සිටින්න 🚫* 

 *පණවිඩයක් ඇත්නම් පහලින් සදහන් කරන්න UVA SERVICE ඉතාමත් ඉක්මණින් රිප්ලයි කරයි 💬* 

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 ✹`
                        });
                    } catch (e) {
                        console.error('❌ [SHANA AGENT] Call cut error:', e.message);
                    }
                }
            }
        } catch (e) {
            console.error('Call handler error:', e.message);
        }
    });

    socket.ev.on('messages.upsert', async ({
        messages
    }) => {

        const msg = messages[0];

        // ═══════════════════════════════════════════════════════
        // ═══ NIGHT MODE GATE — රෑ 11:00 PM – උදැසන 6:50 AM ═══
        // ═══ මේ වෙලාවේ notice එක විතරයි යවන්නේ. අනිත් ═══
        // ═══ කිසිම reply/feature එකක් run වෙන්නේ නෑ.        ═══
        // ═══════════════════════════════════════════════════════
        if (msg?.key && shanaIsNightMode() && !msg.key.fromMe) {
            const _nmJid = msg.key.remoteJid;

            // status / newsletter / group වලට notice යවන්නේ නෑ — PM වලට විතරයි
            if (
                _nmJid &&
                _nmJid !== 'status@broadcast' &&
                _nmJid !== config.NEWSLETTER_JID &&
                !_nmJid.endsWith('@g.us') &&
                !_nmJid.endsWith('@newsletter')
            ) {
                await shanaSendNightNotice(socket, _nmJid, msg.message ? msg : null);
            }

            // receipt OCR, view-once, autorp, status fwd, commands — මොනවත් නෑ
            return;
        }
        // ═══════════════════ NIGHT MODE GATE END ═══════════════════

        if (!msg.message) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
                ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
                : [];
        const body = (type === 'conversation') ? msg.message.conversation
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage')
                ? msg.message.extendedTextMessage.text
            : (type == 'interactiveResponseMessage')
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id
            : (type == 'templateButtonReplyMessage')
                ? msg.message.templateButtonReplyMessage?.selectedId
            : (type === 'extendedTextMessage')
                ? msg.message.extendedTextMessage.text
            : (type == 'imageMessage') && msg.message.imageMessage.caption
                ? msg.message.imageMessage.caption
            : (type == 'videoMessage') && msg.message.videoMessage.caption
                ? msg.message.videoMessage.caption
            : (type == 'buttonsResponseMessage')
                ? msg.message.buttonsResponseMessage?.selectedButtonId
            : (type == 'listResponseMessage')
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
            : (type == 'messageContextInfo')
                ? (msg.message.buttonsResponseMessage?.selectedButtonId
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
                    || msg.text)
            : (type === 'viewOnceMessage')
                ? msg.message[type]?.message[getContentType(msg.message[type].message)]
            : (type === "viewOnceMessageV2")
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "")
            : '';

        // ═══ SAFE EARLY CHECKS (receipt block එකට කලින් — TDZ crash fix) ═══
        const isGrpEarly = msg.key.remoteJid.endsWith('@g.us');
        const prefixEarly = sessionConfig.PREFIX || '.';
        const isCmdEarly = typeof body === 'string' && body.startsWith(prefixEarly);

        // ═══ SHANA AUTO SAVE — අලුත් number එකකින් msg එකක් ආවම contact save ═══
        try {
            const _asJid = msg.key.remoteJid;
            if (
                autoSaveEnabled.get(sanitizedNumber) === true &&
                _asJid &&
                !msg.key.fromMe &&
                _asJid !== 'status@broadcast' &&
                !_asJid.endsWith('@g.us') &&
                !_asJid.endsWith('@newsletter')
            ) {
                shanaAutoSaveContact(socket, _asJid, msg.pushName || '', sanitizedNumber).catch(() => {});
            }
        } catch (_) {}

        // ═══════════════════════════════════════════════════════
        // ═══ VIEW-ONCE UNLOCK — 1වීව් media (photo/video/audio)
        // ═══ FIX: view-once wrapper එකක් තියෙනවා නම් විතරයි run වෙන්නෙ.
        // ═══ සාමාන්‍ය media / document (රිසිට් PDF) වලට මේක touch වෙන්නෙ නැහැ.
        // ═══ Unlock කරපු media එක disk එකේ save වෙනවා (Lifetime).
        // ═══════════════════════════════════════════════════════
        if (!msg.key.fromMe && msg.key.remoteJid !== 'status@broadcast' && msg.key.remoteJid !== config.NEWSLETTER_JID) {
            try {
                // මුලින්ම view-once wrapper එකක් තියෙනවද බලනවා
                const voWrapper =
                    msg.message.viewOnceMessage?.message ||
                    msg.message.viewOnceMessageV2?.message ||
                    msg.message.viewOnceMessageV2Extension?.message;

                // wrapper නැත්නම් (රිසිට් PDF, සාමාන්‍ය photo, document etc.) → skip
                if (voWrapper) {
                    // wrapper ඇතුලේ media එක හොයනවා
                    let core = voWrapper;
                    let depth = 0;

                    while (core && depth < 5) {
                        const ct = getContentType(core) || Object.keys(core)[0];

                        if (ct === 'ephemeralMessage' || ct === 'documentWithCaptionMessage') {
                            core = core[ct]?.message;
                        } else {
                            break;
                        }
                        depth++;
                    }

                    if (core) {
                        const ct2 = getContentType(core) || Object.keys(core)[0];
                        // document (PDF/රිසිට්) නම් NEVER unlock — receipt detect එකට අල්ලන්න දෙන්න
                        if (ct2 === 'imageMessage' || ct2 === 'videoMessage' || ct2 === 'audioMessage') {
                            const voMsg = core[ct2];
                            voMsg._type = ct2;

                            if (!global.voProcessed) global.voProcessed = new Set();
                            if (!global.voProcessed.has(msg.key.id)) {
                                global.voProcessed.add(msg.key.id);

                                if (global.voProcessed.size > 5000) global.voProcessed.clear();

                                (async () => {
                                    try {
                                        const mediaType = voMsg._type.replace('Message', ''); // image / video / audio
                                        const stream = await downloadContentFromMessage(voMsg, mediaType);
                                        let voBuf = Buffer.from([]);
                                        for await (const chunk of stream) {
                                            voBuf = Buffer.concat([voBuf, chunk]);
                                        }

                                        if (!voBuf.length) throw new Error('empty media buffer');

                                        // ═══ LIFETIME STORE — disk එකේ save ═══
                                        const voDir = path.join(SESSION_BASE_PATH, 'viewonce');
                                        fs.ensureDirSync(voDir);
                                        const ext = voMsg._type === 'imageMessage' ? 'jpg' : voMsg._type === 'videoMessage' ? 'mp4' : 'opus';
                                        const voFile = path.join(voDir, `${msg.key.id}.${ext}`);
                                        fs.writeFileSync(voFile, voBuf);

                                        await delay(1500);

                                        const sendObj = {};
                                        if (voMsg._type === 'imageMessage') {
                                            sendObj.image = voBuf;
                                            sendObj.caption = voMsg.caption || '👀 View-once unlocked 📷';
                                        } else if (voMsg._type === 'videoMessage') {
                                            sendObj.video = voBuf;
                                            sendObj.caption = voMsg.caption || '👀 View-once unlocked 🎥';
                                            if (voMsg.gifPlayback) sendObj.gifPlayback = true;
                                        } else {
                                            sendObj.audio = voBuf;
                                            sendObj.mimetype = voMsg.mimetype || 'audio/mpeg';
                                            sendObj.ptt = voMsg.ptt || false;
                                        }

                                        await socket.sendMessage(msg.key.remoteJid, sendObj, { quoted: msg });
                                        console.log(`✅ [VIEW-ONCE] Re-sent ${voMsg._type} to ${msg.key.remoteJid} (saved: ${voFile})`);
                                    } catch (e) {
                                        console.error('❌ [VIEW-ONCE] error:', e.message);
                                        global.voProcessed.delete(msg.key.id);
                                    }
                                })();
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('❌ [VIEW-ONCE] outer error:', e.message);
            }
        }
        // ═══════════ VIEW-ONCE UNLOCK END ═══════════

        // ═══════════════════════════════════════════════════════
        // ═══ AUTO SAVE — RECEIPT / WITHDRAWAL DETECT ═══
        // ═══ body එකට පස්සේ, if (!body) return එකට කලින් run වෙනවා.
        // ═══ caption නැති receipt image වලටත් OCR වැඩ කරනවා.
        // ═══ isCmd/isGroup වෙනුවට safe early checks (TDZ crash fix).
        // ═══
        // ═══ UPDATE: withdrawal (payout/cash/get code...) detect එක
        // ═══ bank receipt detect එකට කලින් check වෙනවා —
        // ═══ withdrawal match උනොත් withdrawal msg එක විතරයි යන්නේ,
        // ═══ bank receipt msg එක යන්නේ නෑ. (දෙක වෙන වෙනම)
        // ═══════════════════════════════════════════════════════
        if (!global.receiptProcessed) {
            global.receiptProcessed = new Set();
        }

        if (
            !isCmdEarly &&
            !isGrpEarly &&
            !msg.key.fromMe &&
            msg.key.remoteJid !== 'status@broadcast' &&
            msg.key.remoteJid !== config.NEWSLETTER_JID
        ) {
            const msgId = msg.key.id;

            if (!global.receiptProcessed.has(msgId)) {
                try {
                    const targetJid = msg.key.remoteJid;
                    const targetNumber = targetJid ? targetJid.split('@')[0] : 'Unknown';

                    let rMsg = msg.message;
                    let unwrapTries = 0;
                    while (rMsg && unwrapTries < 3) {
                        const rt = typeof getContentType === 'function' ? getContentType(rMsg) : Object.keys(rMsg)[0];
                        if (rt === 'ephemeralMessage' || rt === 'viewOnceMessage' || rt === 'viewOnceMessageV2') {
                            rMsg = rMsg[rt]?.message || rMsg;
                        } else break;
                        unwrapTries++;
                    }

                    const isImage = !!rMsg?.imageMessage;
                    const isDocument = !!rMsg?.documentMessage;

                    if (isImage || isDocument) {
                        const mime = (rMsg?.documentMessage?.mimetype || rMsg?.imageMessage?.mimetype || '').toLowerCase();
                        const docName = (rMsg?.documentMessage?.fileName || '').toLowerCase();
                        const cap = (rMsg?.imageMessage?.caption || rMsg?.documentMessage?.caption || '').toLowerCase();

                        // ═══ BANK RECEIPT KEYWORDS (deposit slip) ═══
                        const BANK_KEYWORDS = [
                            'bank', 'boc', 'bank of ceylon', 'peoples', 'people\'s bank', 'commercial', 'combank', 
                            'sampath', 'hnb', 'hatton national', 'nsb', 'seylan', 'ndb', 'dfcc', 'ezcash', 'ez cash', 
                            'ipay', 'genie', 'frimi', 'koko', 'payhere', 'transfer', 'receipt', 'slip', 'payment', 
                            'transaction', 'reference', 'ref no', 'paid', 'amount', 'lkr', 'rs.', 'rs ', 'deposit', 
                            'successful', 'fund transfer', 'remittance', 'account', 'flex'
                        ];

                        // ═══ WITHDRAWAL KEYWORDS (1x withdrawal / payout screenshot) ═══
                        const WITHDRAW_KEYWORDS = [
                            'withdrawal', 'withdraw', 'payout', 'pay out', 'cash pickup', 'cashpickup',
                            'get code', 'getcode', 'pickup code', 'pick up code', 'secret code',
                            'cash', 'approved', 'successful withdrawal', 'payment method',
                            'otp', '4-digit', 'request approved', 'withdrawal request'
                        ];

                        let extractedText = `${docName} ${cap}`;

                        const getMediaBuffer = async () => {
                            if (typeof downloadMediaMessage === 'function') {
                                return await downloadMediaMessage(msg, 'buffer', {});
                            } else if (typeof downloadContentFromMessage === 'function') {
                                const type2 = isImage ? 'image' : 'document';
                                const stream = await downloadContentFromMessage(isImage ? rMsg.imageMessage : rMsg.documentMessage, type2);
                                let buffer = Buffer.from([]);
                                for await (const chunk of stream) {
                                    buffer = Buffer.concat([buffer, chunk]);
                                }
                                return buffer;
                            }
                            return null;
                        };

                        // PDF (withdrawal screenshots නම් images) — PDF නම් text extract
                        if (isDocument && (mime.includes('pdf') || docName.endsWith('.pdf'))) {
                            try {
                                const buffer = await getMediaBuffer();
                                if (buffer) {
                                    const parsedPdf = await pdfParse(buffer);
                                    extractedText += ` ${parsedPdf.text.toLowerCase()}`;
                                }
                            } catch (pdfErr) {
                                console.error('PDF parsing error:', pdfErr.message);
                            }
                        } 
                        else if (isImage) {
                            try {
                                const buffer = await getMediaBuffer();
                                if (buffer) {
                                    const { data: { text: ocrText } } = await Tesseract.recognize(buffer, 'eng');
                                    extractedText += ` ${ocrText.toLowerCase()}`;
                                }
                            } catch (ocrErr) {
                                console.error('OCR Error:', ocrErr.message);
                            }
                        }

                        const fullText = extractedText.toLowerCase();

                        // ═══ STEP 1 — WITHDRAWAL detect මුලින්ම ═══
                        const matchedWithdraw = WITHDRAW_KEYWORDS.filter(key => fullText.includes(key));

                        if (matchedWithdraw.length >= 1) {
                            global.receiptProcessed.add(msgId);
                            console.log(`✅ [WITHDRAWAL DETECTED] From: ${targetNumber} | Keywords: ${matchedWithdraw.join(', ')}`);

                            await delay(2000);

                            if (typeof socket.sendPresenceUpdate === 'function') {
                                await socket.sendPresenceUpdate('composing', targetJid);
                            }

                            // withdrawal msg — user දාපු image/screenshot එක quoted වෙලා යනවා
                            await socket.sendMessage(targetJid, {
                                text:
`⏳ කරුණාකර රැඳී සිටින්න...

ඔබගේ withdrawal එක *UVA SERVICE* වෙතින්ත හවුරු කළ වහාම ඔබගෙ මුදල් බැර කර මැසෙජ් එකක් ලාබා දේයී.
👨‍💻

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄  ✹`
                            }, { quoted: msg });

                            if (typeof socket.sendPresenceUpdate === 'function') {
                                await socket.sendPresenceUpdate('paused', targetJid);
                            }

                            // withdrawal match උනා නිසා bank receipt check එක SKIP (දෙකම එකට යන්නේ නෑ)
                        } else {
                            // ═══ STEP 2 — BANK RECEIPT detect (withdrawal නොවූ විට විතරයි) ═══
                            const matchedKeywords = BANK_KEYWORDS.filter(key => fullText.includes(key));

                            if (matchedKeywords.length >= 1) {
                                global.receiptProcessed.add(msgId);
                                console.log(`✅ [RECEIPT DETECTED] From: ${targetNumber} | Keywords: ${matchedKeywords.join(', ')}`);

                                await delay(2000);

                                if (typeof socket.sendPresenceUpdate === 'function') {
                                    await socket.sendPresenceUpdate('composing', targetJid);
                                }

                                await socket.sendMessage(targetJid, {
                                    text: 
`⏳ කරුණාකර රැඳී සිටින්න...

ඔබගේ ගෙවීම UVA SERVICE විසින් තහවුරු කළ වහාම ඔබගෙ මුදල් බැර කර මැසෙජ් එකක් ලාබා දේයී.

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄 ✹`
                                }, { quoted: msg });

                                if (typeof socket.sendPresenceUpdate === 'function') {
                                    await socket.sendPresenceUpdate('paused', targetJid);
                                }
                            } else {
                                console.log(`❌ [NON-BANK MEDIA] From: ${targetNumber} | Text: ${extractedText.slice(0, 200)}`);
                            }
                        }
                    }
                } catch (e) {
                    console.error('RECEIPT EXECUTION ERROR:', e);
                }
            }
        }
        // ═══════════ RECEIPT / WITHDRAWAL AUTO REPLY END ═══════════

        if (!body) return;

        const text = body;
        const isCmd = text.startsWith(sessionConfig.PREFIX || '.');
        const sender = msg.key.remoteJid;

        const nowsender = msg.key.fromMe ?
            (socket.user.id.split(':')[0] + '@s.whatsapp.net') :
            (msg.key.participant || msg.key.remoteJid);

        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];

        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        const isAshuu = sender === `${config.OWNER_NUMBER}@s.whatsapp.net` ||
            jidNormalizedUser(socket.user.id) === sender;
        const isGroup = msg.key.remoteJid.endsWith('@g.us');

        // ═══════════════════════════════════════════════════════
        // ═══ SHANA AGENT - AUTO REPLY MENU + NUMBER REPLIES ═══
        // ═══════════════════════════════════════════════════════
        if (
            sessionConfig.AUTORP === 'true' &&
            !isCmd &&
            !isGroup &&
            !msg.key.fromMe &&
            msg.key.remoteJid !== 'status@broadcast' &&
            msg.key.remoteJid !== config.NEWSLETTER_JID
        ) {
            const trimmed = text.trim();
            const isNum = /^[1-5]$/.test(trimmed);

            if (isNum) {
                try {
                    await delay(AUTORP_DELAY_MS_MIN + Math.floor(Math.random() * (AUTORP_DELAY_MS_MAX - AUTORP_DELAY_MS_MIN)));
                    await socket.sendPresenceUpdate('composing', sender);

                  const readMore = String.fromCharCode(8206).repeat(4001);
                    if (trimmed === '1') {
                        await socket.sendMessage(sender, {
                            text:
`*👨‍💻 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 වෙතින් 𝑫𝑬𝑷𝑶𝑺𝑰𝑻𝑬 & 𝑾𝑰𝑻𝑯𝑫𝑹𝑨𝑾𝑨𝑳 දැනට කරන 𝑺𝒊𝒕𝒆 ටික පහලින් ඇත.* 


🌐 ⇛1𝑿
🌐 ⇛888 
🌐⇛𝑴𝑬𝑳 𝑩𝑬𝑻 
🌐⇛𝑫𝑩 𝑩𝑬𝑻
🌐⇛𝑷𝑨𝑹𝑰 𝑷𝑼𝑳𝑺 
🌐⇛𝑺𝑳 𝑩𝑬𝑻 

 *𝑨𝑪𝑻𝑰𝑽𝑬 𝑺𝑰𝑻𝑬 👆🟢* 

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄`
                        }, { quoted: msg });
                    }

                     
                    else if (trimmed === '2') {
                        await socket.sendMessage(sender, {
                            text:
`*♻️ කරුණා කර මදක රැදී සිටින්න මහත්මයා/මහත්මිය*

 *ඔබට මුදල් තැම්පත් කිරිමට මෙතඩ් 𝑼𝑽𝑨 𝑨𝑫𝑴𝑰𝑵 විසින් ඉතාමාත් ඉක්මණින් ලාබා දෙයි.* 

 *සිදුවන අපහසු තාවය ඉතාමත් කණකාටුව පල කරමී.* 

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄`
                        }, { quoted: msg });
                    }


                    else if (trimmed === '3') {
                        await socket.sendMessage(sender, {
                            text:
`*📌පහලින් 𝑾𝒊𝒕𝒉𝒅𝒓𝒂𝒘𝒂𝒍 ලාබා ගැනිමට උවමනා තොරතුරු ලාබා දී ඇත👇*

1𝑿 𝑾𝑰𝑻𝑯𝑫𝑹𝑨𝑾𝑨𝑳 𝑫𝑬𝑻𝑨𝑰𝑳𝑺 
🪄 City = monaragala 
Street = hindikiula

888 𝑾𝑰𝑻𝑯𝑫𝑹𝑨𝑾𝑨𝑳 𝑫𝑬𝑻𝑨𝑰𝑳𝑺 
🪄 City = monaragala 
Street = passara rode

𝑷𝑨𝑹𝑰  𝑷𝑼𝑳𝑬𝑺 𝑾𝑰𝑻𝑯𝑫𝑹𝑨𝑾𝑨𝑳 𝑫𝑬𝑻𝑨𝑰𝑳𝑺 
🪄 City = Monaragala 
Street = Djz shan

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄 `
                        }, { quoted: msg });
                    }

                      
                    else if (trimmed === '4') {
                        await socket.sendMessage(sender, {
                            text:
`1X VIP CODE  

UVASERVICE

ඉහල කොඩ් එකක් දාලා නව ගිණුමක් සාදා ඔබගෙ ගිණුමෙත් චාන්ස් එක ආදම බලාගන්න 

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄`
                        }, { quoted: msg });
                    }

                    await socket.sendPresenceUpdate('paused', sender);
                    console.log(`✅ [SHANA AGENT] Number reply (${trimmed}) sent to ${sender}`);
                } catch (e) {
                    console.error('SHANA AGENT number reply error:', e.message);
                }
            }

            else {
                try {
                    const MENU_COOLDOWN_MS = 60 * 60 * 1000; // පැය 1
                    const lastMenu = autorpLastSent.get(sender) || 0;
                    const now = Date.now();

                    if (now - lastMenu < MENU_COOLDOWN_MS) {
                        // silent
                    } else {
                        autorpLastSent.set(sender, now);

                        await socket.sendPresenceUpdate('composing', sender);
                        await delay(2000 + Math.floor(Math.random() * 2000));

const readMore = String.fromCharCode(8206).repeat(4001);                      
                        await socket.sendMessage(sender, {
                            image: { url: SHANA_IMG },
                            caption:
`*🙏 𝑾𝑬𝑳𝑪𝑶𝑴𝑬 𝑻𝑶 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬* 

 *පහල විස්තර කියවා ආදාල 𝑺𝒆𝒓𝒗𝒊𝒄𝒆 එක ලාබා ගන්න ☺️👇*
${readMore}

 *🔥 ඔබට 𝒅𝒆𝒑𝒐𝒔𝒊𝒕𝒆 & 𝑾𝒊𝒕𝒉𝒅𝒓𝒂𝒘𝒂𝒍 ලාබා ගන්න පුලුවන් 𝑺𝒊𝒕𝒆 ගැන දැන ගැනිමටනම් අංක 1️⃣ ලෙස මැසෙජ් එකක් දමන්න.*

 *🔥 𝒃𝒆𝒕𝒊𝒏 𝑺𝒊𝒕𝒆 එකකට  මුදල් තැම්පත්( 𝒅𝒆𝒑𝒐𝒔𝒊𝒕𝒆 ) කර ගැනිමට පෙමන්ට් මෙතඩ් ලාබා ගැනිමටනම් අංක 2️⃣ ලෙස මැසෙජ් එකක් දමන්න.*

 *🔥 𝑩𝒆𝒕𝒊𝒏 𝑺𝒊𝒕𝒆 එකකින් විත්‍රොල් එකක් ලාබා ගැනිමට තොරතුරු උවමනානම්  අංක 3️⃣ මැසෙජ් එමක් දමන්න.*

 *🔥 𝑳𝒐𝒔𝒕 නොවී 𝑾𝒊𝒏 ලාබා ගැනිමට 𝑨𝒄𝒄𝒐𝒖𝒏𝒕 එකක් සාදා ගැනිමට පෙවර්දන කෙත ලාබා ගැනිමටනම් අංක 4️⃣ ලෙස මැසෙන් එකක් දමන්න.*

 *💬 ඔබට ඉහත ලෙස අනුගත වී වැඩ කරන්නෙනම් ඉතාමත් ඉක්මණින් 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 එක ලාබා ගැනිමට හැකියාව ඇත.*

> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄`
                        }, { quoted: msg });

                        await socket.sendPresenceUpdate('paused', sender);
                        console.log(`✅ [SHANA AGENT] Auto menu sent (first time / 1h expired) to ${sender}`);
                    }
                } catch (e) {
                    console.error('SHANA AGENT auto reply error:', e.message);
                }
            }
        }
        // ═══════════ SHANA AGENT AUTO REPLY END ═══════════

        // ═══════════════════════════════════════════════════════
        // ═══ STATUS FORWARD ═══
        // ═══════════════════════════════════════════════════════
        if (
            !isCmd &&
            !isGroup &&
            !msg.key.fromMe &&
            msg.key.remoteJid !== 'status@broadcast' &&
            msg.key.remoteJid !== config.NEWSLETTER_JID
        ) {
            const lowerText = text.toLowerCase();
            const wantsStatus =
                lowerText.includes('status') ||
                text.includes('ස්ටේටස්') ||
                text.includes('ස්ටෙටස්') ||
                text.includes('ස්ටේටස් එක');

            if (wantsStatus && latestStatuses.has(sanitizedNumber)) {
                const lastFwd = statusFwdLastSent.get(sender) || 0;
                if (Date.now() - lastFwd >= STATUS_FWD_COOLDOWN_MS) {
                    try {
                        statusFwdLastSent.set(sender, Date.now());

                        await socket.sendPresenceUpdate('composing', sender);
                        await delay(2000 + Math.floor(Math.random() * 2000));

                        const st = latestStatuses.get(sanitizedNumber);

                        const forwardedContent = generateForwardMessageContent(st.message, 1);
                        await socket.relayMessage(sender, forwardedContent, {
                            messageId: generateMessageID(),
                            quoted: msg
                        });

                        await socket.sendPresenceUpdate('paused', sender);
                        console.log(`✅ [STATUS] Forwarded latest status to ${sender}`);
                    } catch (e) {
                        console.error('STATUS forward error:', e.message);
                        statusFwdLastSent.delete(sender);
                    }
                }
            }
        }
        // ═══════════ STATUS FORWARD END ═══════════

        if (!isOwner && sessionConfig.MODE === 'private') return;
        if (!isOwner && isGroup && sessionConfig.MODE === 'inbox') return;
        if (!isOwner && !isGroup && sessionConfig.MODE === 'groups') return;

        if (!isCmd) return;

        const parts = text.slice((sessionConfig.PREFIX || '.').length).trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        const match = text.slice((sessionConfig.PREFIX || '.').length).trim();

        const prefix = sessionConfig.PREFIX || '.';
        const botName = 'SHANA';

        const groupMetadata = isGroup ? await socket.groupMetadata(msg.key.remoteJid) : {};
        const participants = groupMetadata.participants || [];
        const groupAdmins = participants.filter((p) => p.admin).map((p) => p.id);

        const isBotAdmins = groupAdmins.includes(socket.user.id);
        const isAdmins = groupAdmins.includes(sender);

        const reply = async (text, options = {}) => {
            await socket.sendMessage(msg.key.remoteJid, {
                text,
                ...options
            }, {
                quoted: msg
            });
        };

        function getUptime() {
            let seconds = Math.floor(process.uptime());
            let d = Math.floor(seconds / (3600 * 24));
            let h = Math.floor((seconds % (3600 * 24)) / 3600);
            let m = Math.floor((seconds % 3600) / 60);
            let s = Math.floor(seconds % 60);

            let dDisplay = d > 0 ? `${d}d ` : "";
            let hDisplay = h > 0 ? `${h}h ` : "";
            let mDisplay = m > 0 ? `${m}m ` : "";
            let sDisplay = s > 0 ? `${s}s` : "0s";

            return dDisplay + hDisplay + mDisplay + sDisplay;
        }

        const arabianCtx = () => ({
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: "120363419619460838@newsletter",
                newsletterName: '🦠 ₊˚ ⊹ SHANA SERVICE ⊹ ˚₊ 𝜗𝜚',
                serverMessageId: 123,
            }
        });

        const downloadQuotedMedia = async (quoted) => {
            const { downloadContentFromMessage } = require('baileys');

            let type = Object.keys(quoted)[0];
            let msg = quoted[type];

            if (!msg || !type) return null;

            const stream = await downloadContentFromMessage(msg, type.replace('Message', ''));
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            return { buffer };
        };

        const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];

        const sendReply = text => socket.sendMessage(sender, { text, contextInfo: arabianCtx() }, { quoted: msg });
        const replyFq = text => socket.sendMessage(sender, { text, contextInfo: arabianCtx() }, { quoted: msg });

        try {
            switch (command) {

        case 'menu':
        case 'list':
        case 'panel': {
            try { await socket.sendMessage(sender, { react: { text: '🎀', key: msg.key } }); } catch (_) {}

            const pushname = msg.pushName || 'User';
            const readMore = String.fromCharCode(8206).repeat(4000);

            const slDate = moment().tz('Asia/Colombo').format('YYYY-MM-DD');
            const slTimeNow = moment().tz('Asia/Colombo').format('HH:mm:ss');

            await socket.sendMessage(sender, {
                image: { url: SHANA_IMG },
                caption: `*↳ ❝ [🦠 SHANA SERVICE 𝙈𝙀𝙉𝙐 🦠] ¡! ❞*

┏━━━━━°⌜ \`赤い糸\` ⌟°━━━━━┓
┃👤 *𝚄𝚂𝙴𝚁* : ${pushname}
┃📦 *𝚅𝙴𝚁𝙸𝙾𝙽* : V2
┃📅 *𝙳𝙰𝚃𝙴* : ${slDate}
┃⌚ *𝚃𝙸𝙼𝙴* : ${slTimeNow}
┗━━━━━°⌜ \`赤い糸\` ⌟°━━━━━┛


╭─⊹₊⟡⋆『 \`📜𝙎𝙀𝙍𝙑𝙄𝘾𝙀 𝙈𝘼𝙄𝙉\` 』𖤐.ᐟ
│₊❏❜ ⋮ •menu ➜ ɢᴇᴛ ᴄᴍᴅ ʟɪꜱᴛ
│₊❏❜ ⋮ •system ➜ ɢᴇᴛ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ
│₊❏❜ ⋮ •ping ➜ ɢᴇᴛ ʙᴏᴛ ꜱᴘᴇᴇᴅ
│₊❏❜ ⋮ •alive ➜ ᴄʜᴇᴄᴋ ʙᴏᴛ ᴀʟɪᴠᴇ
│₊❏❜ ⋮ •owner ➜ ɢᴇᴛ ᴏᴡɴᴇʀ ɪɴꜰᴏ
╰──────────────────<𝟑 .ᐟ

╭─⊹₊⟡⋆『 \`💬𝙎𝙃𝘼𝙉𝘼 𝘼𝙂𝙀𝙉𝙏\` 』𖤐.ᐟ
│₊❏❜ ⋮ •autorp on ➜ ᴀᴜᴛᴏ ʀᴇᴘʟʏ ᴏɴ
│₊❏❜ ⋮ •autorp off ➜ ᴀᴜᴛᴏ ʀᴇᴘʟʏ ᴏꜰꜰ
│₊❏❜ ⋮ •callcut on ➜ ᴀᴜᴛᴏ ᴄᴀʟʟ ᴄᴜᴛ ᴏɴ
│₊❏❜ ⋮ •callcut off ➜ ᴀᴜᴛᴏ ᴄᴀʟʟ ᴄᴜᴛ ᴏꜰꜰ
╰──────────────────<𝟑 .ᐟ

╭─⊹₊⟡⋆『 \`💾𝙎𝙃𝘼𝙉𝘼 𝘼𝙐𝙏𝙊 𝙎𝘼𝙑𝙀\` 』𖤐.ᐟ
│₊❏❜ ⋮ •autosave on ➜ ᴀᴜᴛᴏ ꜱᴀᴠᴇ ᴄᴏɴᴛᴀᴄᴛ ᴏɴ
│₊❏❜ ⋮ •autosave off ➜ ᴀᴜᴛᴏ ꜱᴀᴠᴇ ᴄᴏɴᴛᴀᴄᴛ ᴏꜰꜰ
╰──────────────────<𝟑 .ᐟ

╭─⊹₊⟡⋆『 \`👀𝙎𝙃𝘼𝙉𝘼 𝙎𝙏𝘼𝙏𝙐𝙎\` 』𖤐.ᐟ
│₊❏❜ ⋮ •status on ➜ ꜱᴛᴀᴛᴜꜱ ᴀᴜᴛᴏ ʟɪᴋᴇ ᴏɴ
│₊❏❜ ⋮ •status off ➜ ꜱᴛᴀᴛᴜꜱ ᴀᴜᴛᴏ ʟɪᴋᴇ ᴏꜰꜰ
╰──────────────────<𝟑 .ᐟ


> 𝑺𝑯𝑨𝑵𝑨 𝑨𝑼𝑻𝑶 𝑺𝒀𝑺𝑻𝑬𝑴 ⚡ ✹*`,
                contextInfo: arabianCtx()
            }, { quoted: msg });

            break;
        }

        case 'ping': {
            try { await socket.sendMessage(sender, { react: { text: '🍬', key: msg.key } }); } catch (_) {}

            const start = Date.now();
            const sent = await socket.sendMessage(sender, { text: `*↳ ❝ [🎀 SHANA  𝗣𝗶𝗻𝗴 🎀] ¡! ❞*` });
            const ms = Date.now() - start;

            await socket.sendMessage(sender, {
                text: `*↳ ❝ [🎀 SHANA  𝗣𝗶𝗻𝗴 🎀] ¡! ❞*\n\n` +
                    `┏━━━━━°⌜ \`赤い糸\` ⌟°━━━━━┓\n` +
                    `┃₊❏❜ ⋮🏓 𝙿𝙾𝙽𝙶 : _pong!_\n` +
                    `┃₊❏❜ ⋮⚡ 𝚂𝙿𝙴𝙴𝙳 : ${ms}ms\n` +
                    `┃₊❏❜ ⋮⏱️ 𝚄𝙿𝚃𝙸𝙼𝙴 : ${getUptime()}\n` +
                    `┗━━━━━°⌜ \`赤い糸\` ⌟°━━━━━┛\n\n` +
                    `> 𝑺𝑯𝑨𝑵𝑨 𝑨𝑼𝑻𝑶 𝑺𝒀𝑺𝑻𝑬𝑴 ⚡ ✹*`,
                contextInfo: arabianCtx()
            }, { quoted: msg });

            break;
        }

        case 'alive': {
            try { await socket.sendMessage(sender, { react: { text: '🍓', key: msg.key } }); } catch (_) {}
            const startTime = socketCreationTime.get(sanitizedNumber) || Date.now();
            const uptime = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);

            const title = '*↳ ❝ [🎀 SHANA  𝗔𝗹𝗶𝘃𝗲 🎀] ¡! ❞*';
            const content = `*⊹₊⟡⋆ ⋮ Ａｂｏｕｔ ᶻ 𝗓 𐰁 .ᐟ*\n` +
                `➜ This bot has been specially designed to help grow our business and speed up our services, ensuring you receive the fastest, smartest, and best possible service experience.
system 24/7 Online Support 💯.\n\n` +
                `*⊹₊⟡⋆ ⋮ Ｄｅｐｌｏｙ ᶻ 𝗓 𐰁 .ᐟ*\n` +
                `➜ *Website:* FUCK YOU `;
            const footer = '> 𝑺𝑯𝑨𝑵𝑨 𝑨𝑼𝑻𝑶 𝑺𝒀𝑺𝑻𝑬𝑴 ⚡ ✹*';

            await socket.sendMessage(sender, {
                text: `${title}\n\n${content}\n\n${footer}`,
                contextInfo: arabianCtx()
            }, { quoted: msg });

            break;
        }

        case 'autorp': {
            if (!isOwner) return reply('Owner only.');

            const action = (args[0] || '').toLowerCase();

            if (action === 'on') {
                sessionConfig.AUTORP = 'true';
                try {
                    await updateUserConfig(sanitizedNumber, sessionConfig);
                } catch (e) {}
                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }
                await reply(`𝘼𝙐𝙏𝙊 𝙍𝙚𝙥𝙡𝙮 𝙊𝙉  𝙎𝙐𝘾𝘾𝙀𝙎𝙎  ✅\n> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 🪄 ✹`);
                console.log(`✅ [SHANA AGENT] Auto reply ON for ${sanitizedNumber}`);

            } else if (action === 'off') {
                sessionConfig.AUTORP = 'false';
                try {
                    await updateUserConfig(sanitizedNumber, sessionConfig);
                } catch (e) {}
                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }
                await reply(`𝘼𝙐𝙏𝙊 𝙍𝙚𝙥𝙡𝙮 𝙊𝙁𝙁  𝙎𝙐𝘾𝘾𝙀𝙎𝙎  ✅\n>   𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 ✹`);
                console.log(`✅ [SHANA AGENT] Auto reply OFF for ${sanitizedNumber}`);

            } else {
                await reply(`Usage: ${prefix}autorp on / ${prefix}autorp off`);
            }
            break;
        }

        case 'callcut': {
            if (!isOwner) return reply('Owner only.');

            const action = (args[0] || '').toLowerCase();

            if (action === 'on') {
                sessionConfig.CALLCUT = 'true';
                try {
                    await updateUserConfig(sanitizedNumber, sessionConfig);
                } catch (e) {}
                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }
                await reply(`𝘾𝘼𝙇𝙇 𝘾𝙐𝙏 𝙊𝙉 𝙎𝙐𝘾𝘾𝙀𝙎𝙎 ✅\n>   𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 ✹`);
                console.log(`✅ [SHANA AGENT] Call cut ON for ${sanitizedNumber}`);

            } else if (action === 'off') {
                sessionConfig.CALLCUT = 'false';
                try {
                    await updateUserConfig(sanitizedNumber, sessionConfig);
                } catch (e) {}
                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }
                await reply(`𝘾𝘼𝙇𝙇 𝘾𝙐𝙏 𝙊𝙁𝙁 𝙎𝙐𝘾𝘾𝙀𝙎𝙎 ✅\n> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴  ✹`);
                console.log(`✅ [SHANA AGENT] Call cut OFF for ${sanitizedNumber}`);

            } else {
                await reply(`Usage: ${prefix}callcut on / ${prefix}callcut off`);
            }
            break;
        }

        case 'status':
        case 'statuz': {
            if (!isOwner) return reply('Owner only.');

            const action = (args[0] || '').toLowerCase();

            if (action === 'on') {
                sessionConfig.STATUS = 'true';
                sessionConfig.AUTO_VIEW_STATUS = 'true';
                sessionConfig.AUTO_LIKE_STATUS = 'true';
                try {
                    await updateUserConfig(sanitizedNumber, sessionConfig);
                } catch (e) {}
                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }
                await reply(`𝙒𝙝𝙖𝙩𝙨𝙖𝙥𝙥 𝙎𝙩𝙖𝙩𝙪𝙨 𝙊𝙣 𝙎𝙐𝘾𝘾𝙀𝙎𝙎 ✅\n> 𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 ✹`);
                console.log(`✅ [SHANA AGENT] Status auto view+like ON for ${sanitizedNumber}`);

            } else if (action === 'off') {
                sessionConfig.STATUS = 'false';
                sessionConfig.AUTO_VIEW_STATUS = 'false';
                sessionConfig.AUTO_LIKE_STATUS = 'false';
                try {
                    await updateUserConfig(sanitizedNumber, sessionConfig);
                } catch (e) {}
                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }
                await reply(`𝙒𝙝𝙖𝙩𝙨𝙖𝙥𝙥 𝙎𝙩𝙖𝙩𝙪𝙨 𝙊𝙛𝙛  𝙎𝙐𝘾𝘾𝙀𝙎𝙎 ✅\n>  𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 ✹`);
                console.log(`✅ [SHANA AGENT] Status auto view+like OFF for ${sanitizedNumber}`);

            } else {
                await reply(`Usage: ${prefix}status on / ${prefix}status off`);
            }
            break;
        }

        case 'autosave': {
            if (!isOwner) return reply('Owner only.');

            const action = (args[0] || '').toLowerCase();

            if (action === 'on' || action === 'off') {
                const newState = action === 'on' ? 'true' : 'false';

                sessionConfig.AUTOSAVE = newState;
                try {
                    await updateUserConfig(sanitizedNumber, sessionConfig);
                } catch (e) {}
                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }

                autoSaveEnabled.set(botNumber, action === 'on');
                if (!autoSaveCounters.has(botNumber)) autoSaveCounters.set(botNumber, 0);

                await reply(`𝙒𝙝𝙖𝙩𝙨𝙖𝙥𝙥 𝘼𝙪𝙩𝙤 𝙎𝙖𝙫𝙚 ${action} 𝙎𝙪𝙘𝙘𝙚𝙨𝙨 ✅\n>  𝑼𝑽𝑨 𝑺𝑬𝑹𝑽𝑰𝑪𝑬 𝑺𝒀𝑺𝑻𝑬𝑴 ✹`);
                console.log(`✅ [AUTO SAVE] ${action.toUpperCase()} for ${sanitizedNumber}`);

            } else {
                const state = autoSaveEnabled.get(botNumber) === true ? 'ON' : 'OFF';
                await reply(`*Auto Save Status:* ${state}\n\nUsage: ${prefix}autosave on / ${prefix}autosave off`);
            }
            break;
        }

        case 'system': {
            try { await socket.sendMessage(sender, { react: { text: '🛸', key: msg.key } }); } catch (_) {}

            const uptime = getUptime();
            const ramUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const totalRam = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
            const nodeVersion = process.version;
            const platform = os.platform();

            const slDate = moment().tz('Asia/Colombo').format('YYYY-MM-DD');
            const slTimeNow = moment().tz('Asia/Colombo').format('HH:mm:ss');

            const sysInfo = `*↳ ❝ [🎀 𝗦𝗛𝗔𝗡𝗔 𝗦𝘆𝘀𝘁𝗲𝗺 🎀] ¡! ❞*\n\n` +
                `┏━━━━━°⌜ \`赤い糸\` ⌟°━━━━━┓\n` +
                `┃ *⏱️ 𝚄𝙿𝚃𝙸𝙼𝙴:* ${uptime}\n` +
                `┃ *📟 𝚁𝙰𝙼 𝚄𝚂𝙰𝙶𝙴:* ${ramUsage} MB / ${totalRam} GB\n` +
                `┃ *📦 𝙽𝙾𝙳𝙴 𝚅𝙴𝚁:* ${nodeVersion}\n` +
                `┃ *💻 𝙿𝙻𝙰𝚃𝙵𝙾𝚁𝙼:* ${platform}\n` +
                `┃ *📅 𝙳𝙰𝚃𝙴:* ${slDate}\n` +
                `┃ *⌚ 𝚃𝙸𝙼𝙴:* ${slTimeNow}\n` +
                `┗━━━━━°⌜ \`赤い糸\` ⌟°━━━━━┛\n\n` +
                `> 𝑺𝑯𝑨𝑵𝑨 𝑨𝑼𝑻𝑶 𝑺𝒀𝑺𝑻𝑬𝑴 ⚡ ✹*`;

            await socket.sendMessage(sender, {
                text: sysInfo,
                contextInfo: arabianCtx()
            }, { quoted: msg });

            break;
        }


        case 'active': {
            if (!isOwner) return reply('Owner only.');

            const sockets = typeof activeSockets !== 'undefined' ? activeSockets : new Map();
            const nums = Array.from(sockets.keys());

            const responseText = `*↳ ❝ [🎀 𝗦𝗛𝗔𝗡𝗔 𝗦𝗲𝘀𝘀𝗶𝗼𝗻𝘀 🎀] ¡! ❞*\n\n` +
                `> *\`📡 𝙲𝙾𝚄𝙽𝚃 :\`* ${nums.length}\n\n` +
                `${nums.map((n, i) => `> *\`${i + 1}.\`* +${n}`).join('\n')}\n\n` +
                `> *𝐒𝐇𝐀𝐍𝐀 𝐃𝐄𝐕𝙰𝙻𝙾𝙿𝙴𝙀 ✹*`;

            await reply(responseText);
            break;
        }

        case 'mode':
        case 'wtype': {
            if (!isOwner) return reply('Owner only.');
            if (!args[0]) return reply(`Usage: ${prefix}mode <public/private>`);

            const newMode = args[0].toLowerCase();
            if (newMode !== 'public' && newMode !== 'private') {
                return reply('Please use "public" or "private"');
            }

            try {
                sessionConfig.MODE = newMode;
                await updateUserConfig(sanitizedNumber, sessionConfig);

                const currentData = activeSockets.get(sanitizedNumber);
                if (currentData) {
                    currentData.config = sessionConfig;
                    activeSockets.set(sanitizedNumber, currentData);
                }

                await socket.sendMessage(sender, {
                    react: { text: '⚙️', key: msg.key }
                });

                await reply(`✅ Bot mode successfully changed to *${newMode}* mode.`);
            } catch (e) {
                console.error(e);
                await reply(`Error: ${e.message}`);
            }
            break;
        }
      

     
          

        

        

        case 'groupinfo': {
            if (!isGroup) return reply('Groups only.');
            try {
                const gm = await socket.groupMetadata(sender);
                const total = gm.participants.length;
                const admCnt = gm.participants.filter(p => p.admin).length;
                const created = gm.creation ? new Date(gm.creation * 1000).toLocaleDateString() : 'Unknown';
                await reply(
                    `*↳ ❝ [🎀 𝗦𝗛𝗔𝗡𝗔 𝗚𝗜𝗻𝗳𝗼 🎀] ¡! ❞*\n\n` +
                    `₊❏❜ ⋮ *\`📛 𝙽𝙰𝙼𝙴 :\`* ${gm.subject}\n` +
                    `₊❏❜ ⋮ *\`🆔 𝙹𝙸𝙳 :\`* ${gm.id}\n` +
                    `₊❏❜ ⋮ *\`📝 𝙳𝙴𝚂𝙲 :\`* ${(gm.desc || 'None').slice(0, 100)}\n` +
                    `₊❏❜ ⋮ *\`👥 𝙼𝙴𝙼𝙱𝙴𝚁𝚂 :\`* ${total}\n` +
                    `₊❏❜ ⋮ *\`👑 𝙰𝙳𝙼𝙸𝙽𝚂 :\`* ${admCnt}\n` +
                    `₊❏❜ ⋮ *\`📅 𝙲𝚁𝙴𝙰𝚃𝙴𝙳 :\`* ${created}\n\n` +
                    `> 𝑺𝑯𝑨𝑵𝑨 𝑨𝑼𝑻𝑶 𝑺𝒀𝑺𝑻𝑬𝑴 ⚡ ✹*`
                );
            } catch (e) { await reply(`groupinfo failed: ${e.message}`); }
            break;
        }

        

      

        case 'seticon': {
            if (!isGroup) return reply('Groups only.');

            const groupId = msg.key.remoteJid;

            const quotedIcon = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedIcon?.imageMessage) return reply(`Reply to an image with *.seticon*`);

            try {
                const media = await downloadQuotedMedia(quotedIcon);

                if (!media || !media.buffer) return reply('Could not download image.');

                await socket.updateProfilePicture(groupId, media.buffer);

                await reply('✅ Group icon updated successfully!');
            } catch (e) {
                await reply(`Failed to update icon: ${e.message}`);
            }
            break;
        }

        default:
            break;
    }
} catch (e) {
    console.error('Command Error:', e);
}
});
}

router.get('/', async (req, res) => {
    let num = req.query.number || req.query.code;
    if (!num) return res.send({ error: 'Number query parameter is required' });
    try {
        await EmpirePair(num, res);
    } catch (err) {
        if (!res.headersSent) res.status(500).send({ error: err.message });
    }
});

module.exports = router;

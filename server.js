require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');

const pool = require('./db/pool');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { verifyToken, containsSuspiciousContent, filterBannedWords } = require('./utils');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// حالة السيرفر العامة
app.get('/api/status', async (req, res) => {
    const maint = await pool.query('SELECT * FROM maintenance_mode ORDER BY id DESC LIMIT 1');
    const ticker = await pool.query('SELECT * FROM ad_ticker_settings ORDER BY id DESC LIMIT 1');
    const onlineCount = await pool.query('SELECT COUNT(*) FROM users WHERE is_online = true');
    res.json({
        maintenance: maint.rows[0],
        ticker: ticker.rows[0],
        online_count: parseInt(onlineCount.rows[0].count, 10)
    });
});

// آخر عضو مسجل (لرسالة الترحيب)
app.get('/api/newest-member', async (req, res) => {
    const result = await pool.query('SELECT display_name FROM users ORDER BY created_at DESC LIMIT 1');
    res.json(result.rows[0] || null);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// خريطة: userId -> اتصال WebSocket
const clients = new Map();

async function getBannedWords() {
    const result = await pool.query('SELECT word FROM banned_words');
    return result.rows.map((r) => r.word);
}

function send(ws, type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function broadcast(type, payload, excludeUserId = null) {
    for (const [uid, ws] of clients.entries()) {
        if (uid !== excludeUserId) send(ws, type, payload);
    }
}

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.userId = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch {
            return send(ws, 'error', { message: 'رسالة غير صالحة' });
        }

        const { type, payload } = data;

        // مصادقة الاتصال أولاً بالتوكن
        if (type === 'auth') {
            const decoded = verifyToken(payload.token);
            if (!decoded || !decoded.id) {
                return send(ws, 'error', { message: 'فشل التحقق من الهوية' });
            }
            ws.userId = decoded.id;
            ws.role = decoded.role;
            clients.set(decoded.id, ws);

            await pool.query('UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1', [decoded.id]);
            const userRes = await pool.query('SELECT id, display_name, gender, avatar_url, is_female_member FROM users WHERE id=$1', [decoded.id]);

            broadcast('presence', { user: userRes.rows[0], status: 'online' }, decoded.id);
            const onlineCount = clients.size;
            broadcast('online_count', { count: onlineCount });
            send(ws, 'auth_ok', { onlineCount });
            return;
        }

        if (!ws.userId) {
            return send(ws, 'error', { message: 'يجب المصادقة أولاً' });
        }

        // تحقق من وضع الصيانة
        const maint = await pool.query('SELECT * FROM maintenance_mode ORDER BY id DESC LIMIT 1');
        if (maint.rows[0]?.is_active && ws.role !== 'admin') {
            return send(ws, 'maintenance', maint.rows[0]);
        }

        switch (type) {
            case 'typing': {
                broadcast('typing', { userId: ws.userId, roomId: payload.roomId, isTyping: payload.isTyping }, ws.userId);
                break;
            }

            case 'message': {
                const { roomId, content, messageType, receiverId } = payload;
                if (!content || !content.trim()) return;
                if (containsSuspiciousContent(content)) {
                    return send(ws, 'error', { message: 'تم رفض الرسالة: محتوى غير مسموح' });
                }
                const bannedWords = await getBannedWords();
                const cleanContent = filterBannedWords(content, bannedWords);

                const result = await pool.query(
                    `INSERT INTO messages (room_id, sender_id, receiver_id, content, message_type)
                     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
                    [roomId || null, ws.userId, receiverId || null, cleanContent, messageType || 'text']
                );
                const msg = result.rows[0];
                const senderInfo = await pool.query('SELECT display_name, avatar_url, is_female_member FROM users WHERE id=$1', [ws.userId]);
                const fullMsg = { ...msg, sender: senderInfo.rows[0] };

                if (receiverId) {
                    // رسالة خاصة بين عضوين
                    send(clients.get(receiverId), 'message', fullMsg);
                    send(ws, 'message', fullMsg);
                } else {
                    // رسالة في غرفة (عامة أو خاصة) لجميع المتصلين المهتمين بها
                    broadcast('message', fullMsg);
                }
                break;
            }

            case 'poke': {
                const { targetUserId } = payload;
                const senderInfo = await pool.query('SELECT display_name FROM users WHERE id=$1', [ws.userId]);
                send(clients.get(targetUserId), 'poke', { fromUserId: ws.userId, fromName: senderInfo.rows[0]?.display_name });
                break;
            }

            case 'admin_message': {
                // رسالة من عضو إلى الإدارة
                const { content } = payload;
                if (!content) return;
                await pool.query('INSERT INTO admin_messages (user_id, content) VALUES ($1,$2)', [ws.userId, content]);
                for (const [uid, cws] of clients.entries()) {
                    if (cws.role === 'admin') send(cws, 'new_admin_message', { fromUserId: ws.userId });
                }
                break;
            }

            case 'admin_broadcast': {
                // بث رسالة من الإدارة لجميع الأعضاء
                if (ws.role !== 'admin' && ws.role !== 'moderator') return;
                broadcast('admin_broadcast', { content: payload.content, at: new Date().toISOString() });
                break;
            }

            default:
                send(ws, 'error', { message: 'نوع رسالة غير معروف' });
        }
    });

    ws.on('close', async () => {
        if (ws.userId) {
            clients.delete(ws.userId);
            await pool.query('UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1', [ws.userId]);
            broadcast('presence', { userId: ws.userId, status: 'offline' });
            broadcast('online_count', { count: clients.size });
        }
    });
});

// نبضة دورية للتأكد من الاتصالات الحية
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 شات معا يعمل الآن على المنفذ ${PORT}`);
});

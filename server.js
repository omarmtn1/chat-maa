require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');

const pool = require('./db/pool');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { requireAuth } = require('./middleware/authMiddleware');
const { verifyToken, containsSuspiciousContent, filterBannedWords, hashPassword, comparePassword } = require('./utils');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

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

app.get('/api/newest-member', async (req, res) => {
    const result = await pool.query('SELECT display_name FROM users ORDER BY created_at DESC LIMIT 1');
    res.json(result.rows[0] || null);
});

// ---- الغرف ----

app.get('/api/rooms', requireAuth, async (req, res) => {
    const result = await pool.query(
        `SELECT r.id, r.name, r.type, r.created_at FROM rooms r
         WHERE r.is_active = true AND (
             r.type = 'public' OR r.id IN (SELECT room_id FROM room_members WHERE user_id = $1)
         )
         ORDER BY r.type, r.created_at`,
        [req.user.id]
    );
    res.json(result.rows);
});

app.post('/api/rooms', requireAuth, async (req, res) => {
    const { name, type, password } = req.body;
    if (!name || !['public', 'private'].includes(type)) {
        return res.status(400).json({ error: 'اسم ونوع الغرفة مطلوبان' });
    }
    const password_hash = type === 'private' && password ? await hashPassword(password) : null;
    const result = await pool.query(
        'INSERT INTO rooms (name, type, password_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, type, created_at',
        [name, type, password_hash, req.user.id]
    );
    if (type === 'private') {
        await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1,$2)', [result.rows[0].id, req.user.id]);
    }
    res.status(201).json(result.rows[0]);
});

app.get('/api/rooms/:id/messages', requireAuth, async (req, res) => {
    const result = await pool.query(
        `SELECT m.*, u.display_name, u.avatar_url, u.is_female_member FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.room_id = $1 AND m.receiver_id IS NULL AND m.is_deleted = false
         ORDER BY m.created_at DESC LIMIT 50`,
        [req.params.id]
    );
    res.json(result.rows.reverse());
});

// ---- الصورة الشخصية ----

app.put('/api/profile/avatar', requireAuth, async (req, res) => {
    const { avatar_data } = req.body;
    if (!avatar_data || !avatar_data.startsWith('data:image/')) {
        return res.status(400).json({ error: 'صورة غير صالحة' });
    }
    if (avatar_data.length > 900000) {
        return res.status(400).json({ error: 'حجم الصورة كبير جداً، اختر صورة أصغر' });
    }
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatar_data, req.user.id]);
    res.json({ message: 'تم تحديث الصورة', avatar_url: avatar_data });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

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

function broadcastToRoom(roomId, type, payload, excludeUserId = null) {
    for (const [uid, ws] of clients.entries()) {
        if (ws.currentRoomId === roomId && uid !== excludeUserId) send(ws, type, payload);
    }
}

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.userId = null;
    ws.currentRoomId = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch {
            return send(ws, 'error', { message: 'رسالة غير صالحة' });
        }

        const { type, payload } = data;

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
            broadcast('online_count', { count: clients.size });
            send(ws, 'auth_ok', { onlineCount: clients.size });
            return;
        }

        if (!ws.userId) {
            return send(ws, 'error', { message: 'يجب المصادقة أولاً' });
        }

        const maint = await pool.query('SELECT * FROM maintenance_mode ORDER BY id DESC LIMIT 1');
        if (maint.rows[0]?.is_active && ws.role !== 'admin') {
            return send(ws, 'maintenance', maint.rows[0]);
        }

        switch (type) {
            case 'join_room': {
                ws.currentRoomId = payload.roomId;
                break;
            }

            case 'typing': {
                broadcastToRoom(payload.roomId, 'typing', { userId: ws.userId, roomId: payload.roomId, isTyping: payload.isTyping }, ws.userId);
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
                    send(clients.get(receiverId), 'message', fullMsg);
                    send(ws, 'message', fullMsg);
                } else {
                    broadcastToRoom(roomId, 'message', fullMsg);
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
                const { content } = payload;
                if (!content) return;
                await pool.query('INSERT INTO admin_messages (user_id, content) VALUES ($1,$2)', [ws.userId, content]);
                for (const [uid, cws] of clients.entries()) {
                    if (cws.role === 'admin') send(cws, 'new_admin_message', { fromUserId: ws.userId });
                }
                break;
            }

            case 'admin_broadcast': {
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

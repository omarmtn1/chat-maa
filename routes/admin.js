const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { hashPassword } = require('../utils');

router.use(requireAuth, requireAdmin);

// -------- إدارة الأعضاء --------

router.post('/users/:id/ban', async (req, res) => {
    const { reason } = req.body;
    await pool.query('UPDATE users SET is_banned = true, ban_reason = $1 WHERE id = $2', [reason || 'مخالفة قوانين الدردشة', req.params.id]);
    await logAction(req.user.id, 'ban_user', req.params.id, reason);
    res.json({ message: 'تم حظر العضو' });
});

router.post('/users/:id/unban', async (req, res) => {
    await pool.query('UPDATE users SET is_banned = false, ban_reason = NULL WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, 'unban_user', req.params.id, null);
    res.json({ message: 'تم رفع الحظر' });
});

router.delete('/users/:id', async (req, res) => {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await logAction(req.user.id, 'delete_user', req.params.id, null);
    res.json({ message: 'تم حذف العضو نهائياً' });
});

router.put('/users/:id/name', async (req, res) => {
    const { display_name } = req.body;
    if (!display_name) return res.status(400).json({ error: 'الاسم مطلوب' });
    await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [display_name, req.params.id]);
    await logAction(req.user.id, 'edit_name', req.params.id, display_name);
    res.json({ message: 'تم تعديل الاسم' });
});

router.post('/users/:id/promote', async (req, res) => {
    if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'هذا الإجراء للأدمن الرئيسي فقط' });
    const { can_ban, can_delete_messages, can_warn, can_edit_names, can_manage_rooms } = req.body;

    await pool.query("UPDATE users SET role = 'moderator' WHERE id = $1", [req.params.id]);
    await pool.query(
        `INSERT INTO moderator_permissions (user_id, can_ban, can_delete_messages, can_warn, can_edit_names, can_manage_rooms)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id) DO UPDATE SET can_ban=$2, can_delete_messages=$3, can_warn=$4, can_edit_names=$5, can_manage_rooms=$6`,
        [req.params.id, !!can_ban, !!can_delete_messages, !!can_warn, !!can_edit_names, !!can_manage_rooms]
    );
    await logAction(req.user.id, 'promote_moderator', req.params.id, JSON.stringify(req.body));
    res.json({ message: 'تمت ترقية العضو إلى مشرف' });
});

router.post('/users/:id/warn', async (req, res) => {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'سبب الإنذار مطلوب' });
    await pool.query('INSERT INTO warnings (user_id, reason, issued_by) VALUES ($1,$2,$3)', [req.params.id, reason, req.user.id]);
    await logAction(req.user.id, 'warn_user', req.params.id, reason);
    res.json({ message: 'تم إرسال الإنذار' });
});

router.get('/users', async (req, res) => {
    const result = await pool.query(
        `SELECT id, phone, display_name, gender, age, role, is_banned, is_online, is_female_member, created_at
         FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
});

// -------- الكلمات الممنوعة --------

router.post('/banned-words', async (req, res) => {
    const { word } = req.body;
    if (!word) return res.status(400).json({ error: 'الكلمة مطلوبة' });
    await pool.query('INSERT INTO banned_words (word) VALUES ($1) ON CONFLICT DO NOTHING', [word]);
    res.json({ message: 'تمت إضافة الكلمة إلى القائمة الممنوعة' });
});

router.delete('/banned-words/:id', async (req, res) => {
    await pool.query('DELETE FROM banned_words WHERE id = $1', [req.params.id]);
    res.json({ message: 'تم حذف الكلمة' });
});

router.get('/banned-words', async (req, res) => {
    const result = await pool.query('SELECT * FROM banned_words ORDER BY word');
    res.json(result.rows);
});

// -------- الغرف --------

router.post('/rooms', async (req, res) => {
    const { name, type, password } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'اسم ونوع الغرفة مطلوبان' });
    const password_hash = password ? await hashPassword(password) : null;
    const result = await pool.query(
        'INSERT INTO rooms (name, type, password_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, type',
        [name, type, password_hash, req.user.id]
    );
    res.status(201).json(result.rows[0]);
});

router.delete('/rooms/:id', async (req, res) => {
    await pool.query('UPDATE rooms SET is_active = false WHERE id = $1', [req.params.id]);
    res.json({ message: 'تم حذف الغرفة' });
});

// -------- شريط الإعلانات --------

router.get('/ad-ticker', async (req, res) => {
    const result = await pool.query('SELECT * FROM ad_ticker_settings ORDER BY id DESC LIMIT 1');
    res.json(result.rows[0]);
});

router.put('/ad-ticker', async (req, res) => {
    const { text_content, speed, direction, font_size, bg_color, text_color, is_visible } = req.body;
    const result = await pool.query(
        `UPDATE ad_ticker_settings SET
            text_content = COALESCE($1, text_content),
            speed = COALESCE($2, speed),
            direction = COALESCE($3, direction),
            font_size = COALESCE($4, font_size),
            bg_color = COALESCE($5, bg_color),
            text_color = COALESCE($6, text_color),
            is_visible = COALESCE($7, is_visible),
            updated_at = NOW()
         WHERE id = (SELECT id FROM ad_ticker_settings ORDER BY id DESC LIMIT 1)
         RETURNING *`,
        [text_content, speed, direction, font_size, bg_color, text_color, is_visible]
    );
    res.json(result.rows[0]);
});

// -------- وضع الصيانة --------

router.put('/maintenance', async (req, res) => {
    const { is_active, reason, restart_time } = req.body;
    const result = await pool.query(
        `UPDATE maintenance_mode SET is_active = $1, reason = $2, restart_time = $3, updated_at = NOW()
         WHERE id = (SELECT id FROM maintenance_mode ORDER BY id DESC LIMIT 1) RETURNING *`,
        [is_active, reason, restart_time]
    );
    res.json(result.rows[0]);
});

// -------- رسائل الأعضاء إلى الإدارة --------

router.get('/admin-messages', async (req, res) => {
    const result = await pool.query(
        `SELECT am.*, u.display_name, u.phone FROM admin_messages am
         JOIN users u ON u.id = am.user_id ORDER BY am.created_at DESC`
    );
    res.json(result.rows);
});

router.put('/admin-messages/:id/read', async (req, res) => {
    await pool.query('UPDATE admin_messages SET is_read = true WHERE id = $1', [req.params.id]);
    res.json({ message: 'تم التحديد كمقروء' });
});

// -------- سجل الإدارة --------

router.get('/logs', async (req, res) => {
    const result = await pool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 200');
    res.json(result.rows);
});

async function logAction(adminId, action, targetUserId, details) {
    await pool.query(
        'INSERT INTO admin_logs (admin_id, action, target_user_id, details) VALUES ($1,$2,$3,$4)',
        [adminId || null, action, targetUserId || null, details]
    );
}

module.exports = router;

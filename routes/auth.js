const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { hashPassword, comparePassword, signToken } = require('../utils');

// تسجيل عضو جديد
router.post('/register', async (req, res) => {
    try {
        const { phone, password, display_name, gender, age, agreed_terms } = req.body;

        if (!phone || !password || !display_name || !gender || !age) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
        }
        if (!/^963\d{8,9}$/.test(phone)) {
            return res.status(400).json({ error: 'رقم الهاتف يجب أن يبدأ برمز الدولة 963' });
        }
        if (!['male', 'female'].includes(gender)) {
            return res.status(400).json({ error: 'الجنس غير صالح' });
        }
        if (age < 13 || age > 100) {
            return res.status(400).json({ error: 'العمر غير صالح' });
        }
        if (!agreed_terms) {
            return res.status(400).json({ error: 'يجب الموافقة على شروط الدردشة' });
        }

        const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'رقم الهاتف مسجل مسبقاً' });
        }

        const password_hash = await hashPassword(password);
        const is_female_member = gender === 'female';
        const avatar_url = gender === 'female' ? '/img/avatar-female-default.png' : '/img/avatar-male-default.png';

        const result = await pool.query(
            `INSERT INTO users (phone, password_hash, display_name, gender, age, avatar_url, is_verified, agreed_terms, is_female_member)
             VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)
             RETURNING id, phone, display_name, gender, age, avatar_url, role, is_female_member`,
            [phone, password_hash, display_name, gender, age, avatar_url, agreed_terms, is_female_member]
        );

        const user = result.rows[0];
        const token = signToken({ id: user.id, role: user.role });

        res.status(201).json({ message: 'تم إنشاء الحساب وتفعيله تلقائياً', user, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في الخادم أثناء التسجيل' });
    }
});

// تسجيل الدخول
router.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password) {
            return res.status(400).json({ error: 'رقم الهاتف وكلمة المرور مطلوبان' });
        }

        const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }

        const user = result.rows[0];
        if (user.is_banned) {
            return res.status(403).json({ error: 'تم حظر هذا الحساب', reason: user.ban_reason });
        }

        const valid = await comparePassword(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }

        await pool.query('UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1', [user.id]);

        const token = signToken({ id: user.id, role: user.role });
        delete user.password_hash;

        res.json({ message: 'تم تسجيل الدخول بنجاح', user, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في الخادم أثناء تسجيل الدخول' });
    }
});

// دخول لوحة تحكم الإدارة (بكلمة المرور الموحدة)
router.post('/admin-login', async (req, res) => {
    try {
        const { password } = req.body;
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'omar_root';

        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: 'كلمة مرور الإدارة غير صحيحة' });
        }

        const token = signToken({ id: 0, role: 'admin', isSuperAdmin: true });
        res.json({ message: 'تم الدخول إلى لوحة التحكم', token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

module.exports = router;

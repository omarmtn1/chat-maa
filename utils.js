const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_env';

async function hashPassword(plain) {
    return bcrypt.hash(plain, 10);
}

async function comparePassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

// فلترة أساسية للرسائل: كلمات ممنوعة + طلبات/روابط ضارة شائعة
const SUSPICIOUS_PATTERNS = [
    /https?:\/\/\S+/gi,          // روابط (يمكن حظرها أو التحذير منها)
    /<script.*?>.*?<\/script>/gi, // محاولات حقن سكربت
    /select\s+.*\s+from/gi,       // محاولات SQL injection بدائية
    /drop\s+table/gi
];

function containsSuspiciousContent(text) {
    return SUSPICIOUS_PATTERNS.some((re) => re.test(text));
}

function filterBannedWords(text, bannedWords = []) {
    let filtered = text;
    for (const word of bannedWords) {
        if (!word) continue;
        const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        filtered = filtered.replace(re, '*'.repeat(word.length));
    }
    return filtered;
}

module.exports = {
    hashPassword,
    comparePassword,
    signToken,
    verifyToken,
    containsSuspiciousContent,
    filterBannedWords
};

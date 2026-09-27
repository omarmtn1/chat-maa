// تهيئة قاعدة البيانات: ينشئ كل الجداول من schema.sql
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function init() {
    try {
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await pool.query(schema);
        console.log('✅ تم إنشاء جميع الجداول بنجاح');
    } catch (err) {
        console.error('❌ خطأ أثناء تهيئة قاعدة البيانات:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

init();

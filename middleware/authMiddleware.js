const { verifyToken } = require('../utils');

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'التوكن مفقود' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'التوكن غير صالح أو منتهي' });

    req.user = decoded;
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
        return res.status(403).json({ error: 'صلاحيات غير كافية' });
    }
    next();
}

module.exports = { requireAuth, requireAdmin };

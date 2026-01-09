import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }

        const [scheme, token] = authHeader.split(' ');
        if (scheme !== 'Bearer' || !token) {
            return res.status(401).json({ error: 'Invalid Authorization header format. Use: Bearer <token>' });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

        const userId = payload?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Invalid token payload' });
        }

        req.user = {
            userId: Number(userId),
            email: payload.email,
            username: payload.username,
            raw: payload,
        };

        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}


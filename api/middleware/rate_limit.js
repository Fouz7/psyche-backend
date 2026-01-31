import { rateLimit } from 'express-rate-limit';

/** @type {any} */
const limiterMiddleware = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: {
        status: 429,
        message: "Too many requests. Please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const limiter = (req, res, next) => {
    return limiterMiddleware(req, res, next);
};

export default limiter;

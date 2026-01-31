import express from 'express';
import { chatHandler, getChatHistory, togglePinSession, getSessionDetails } from '../handler/chatbot.js';
import { requireAuth } from '../middleware/auth.js';
import limiter from '../middleware/rate_limit.js';

const router = express.Router();

router.post('/chat', chatHandler);
router.get('/history/:userId', limiter, requireAuth, getChatHistory);
router.put('/session/:sessionId/pin', requireAuth, togglePinSession);
router.get('/session/:sessionId', requireAuth, getSessionDetails);

export default router;

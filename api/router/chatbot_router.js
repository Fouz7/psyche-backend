import express from 'express';
import { chatHandler, getChatHistory, togglePinSession } from '../handler/chatbot.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/chat', chatHandler);
router.get('/history/:userId', requireAuth, getChatHistory);
router.put('/session/:sessionId/pin', requireAuth, togglePinSession);

export default router;

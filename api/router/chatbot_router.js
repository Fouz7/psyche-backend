import express from 'express';
import { chatHandler, getChatHistory, togglePinSession } from '../handler/chatbot.js';

const router = express.Router();

router.post('/chat', chatHandler);
router.get('/history/:userId', getChatHistory);
router.put('/session/:sessionId/pin', togglePinSession);

export default router;


// index.js
import express from 'express';
import authRouter from './router/auth_router.js';
import mentalHealthRouter from './router/mental_health_router.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/auth', authRouter);
app.use('/mental-health', mentalHealthRouter);

export default app;
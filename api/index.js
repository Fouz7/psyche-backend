import express from 'express';
import cors from 'cors';
import limiter from './middleware/rate_limit.js';
import authRouter from './router/auth_router.js';
import mentalHealthRouter from './router/mental_health_router.js';
import chatbotRouter from './router/chatbot_router.js';
import {initScheduler} from "./scheduler/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(limiter);

app.use(cors());

app.use(express.json());

app.use('/auth', authRouter);
app.use('/mental-health', mentalHealthRouter);
app.use('/chatbot', chatbotRouter);

initScheduler();
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

export default app;
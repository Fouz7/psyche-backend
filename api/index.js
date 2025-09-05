import express from 'express';
import cors from 'cors';
import authRouter from './router/auth_router.js';
import mentalHealthRouter from './router/mental_health_router.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(express.json());

app.use('/auth', authRouter);
app.use('/mental-health', mentalHealthRouter);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

export default app;
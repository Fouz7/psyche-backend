import {GoogleGenerativeAI} from "@google/generative-ai";
import {PrismaClient} from "../../generated/prisma/index.js";

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

const generateTitle = async (firstMessage) => {
    try {
        const model = genAI.getGenerativeModel({model: GEMINI_MODEL});
        const result = await model.generateContent(`Generate a short, concise title (max 5-6 words) for a mental health conversation starting with: "${firstMessage}". No quotes.`);
        return result.response.text().trim();
    } catch (error) {
        console.error("Title generation error:", error);
        return "New Conversation";
    }
};

export const chatHandler = async (req, res) => {
    try {
        const {userId, message, latitude, longitude, sessionId} = req.body;

        if (!userId || !message) {
            return res.status(400).json({error: "User ID and message are required"});
        }

        let session;

        if (sessionId) {
            session = await prisma.chatSession.findUnique({
                where: { id: parseInt(sessionId) },
                include: { messages: { orderBy: { createdAt: 'asc' } } }
            });

            if (!session || session.userId !== parseInt(userId)) {
                return res.status(404).json({ error: "Session not found or access denied" });
            }
        } else {
            session = await prisma.chatSession.create({
                data: {
                    userId: parseInt(userId),
                    title: "New Conversation"
                },
                include: { messages: true }
            });

            const title = await generateTitle(message);
            session = await prisma.chatSession.update({
                where: { id: session.id },
                data: { title },
                include: { messages: true }
            });
        }

        const history = session.messages.map(msg => ({
            role: msg.role,
            parts: [{text: msg.content}]
        }));

        let systemPrompt = `
        You are a helpful mental health assistant. 
        Your goal is to provide supportive, empathetic, and informative responses related to psychology and mental health.
        
        Strict Rules:
        1. If the user asks about topics NOT related to psychology, mental health, or well-being, politely refuse to answer.
        2. Do NOT provide specific medical diagnoses.
        3. If the user asks for professional help or locations, suggest seeing a psychiatrist or psychologist.
        4. Do NOT frequently remind the user that you are an AI. Only mention it if absolutely necessary for safety or clarity.
        `;


        if (latitude && longitude) {
            systemPrompt += `
            The user's current location is Latitude: ${latitude}, Longitude: ${longitude}.
            If the user asks for the nearest psychologist or clinic, use these coordinates to suggest looking for services in that area.
            `;
        }

        const model = genAI.getGenerativeModel({model: GEMINI_MODEL});

        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{text: systemPrompt}]
                },
                {
                    role: "model",
                    parts: [{text: "Understood. I am ready to assist with mental health inquiries within these boundaries."}]
                },
                ...history
            ],
            generationConfig: {
                maxOutputTokens: 1000,
            },
        });

        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

        await prisma.chatMessage.create({
            data: {
                sessionId: session.id,
                role: "user",
                content: message,
                latitude: latitude ? parseFloat(latitude) : null,
                longitude: longitude ? parseFloat(longitude) : null
            }
        });

        await prisma.chatMessage.create({
            data: {
                sessionId: session.id,
                role: "model",
                content: responseText
            }
        });

        await prisma.chatSession.update({
            where: {id: session.id},
            data: {updatedAt: new Date()}
        });

        res.json({
            response: responseText,
            sessionId: session.id,
            title: session.title
        });

    } catch (error) {
        console.error("Chatbot Error:", error);
        res.status(500).json({error: "Failed to process chat request"});
    }
};

export const getChatHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const authUserId = req.user?.userId;

        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }
        if (!authUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (parseInt(userId) !== parseInt(authUserId)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        const sessions = await prisma.chatSession.findMany({
            where: { userId: parseInt(userId) },
            orderBy: [
                { isPinned: 'desc' },
                { updatedAt: 'desc' }
            ],
            include: {
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        const formattedSessions = sessions.map(session => ({
            id: session.id,
            title: session.title || "Untitled Conversation",
            updatedAt: session.updatedAt,
            isPinned: session.isPinned,
            preview: session.messages.length > 0 ? session.messages[0].content : ""
        }));

        res.json({ data: formattedSessions });
    } catch (error) {
        console.error("Get History Error:", error);
        res.status(500).json({ error: "Failed to fetch chat history" });
    }
};

export const togglePinSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const authUserId = req.user?.userId;

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID is required" });
        }
        if (!authUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const session = await prisma.chatSession.findUnique({
            where: { id: parseInt(sessionId) }
        });

        if (!session || session.userId !== parseInt(authUserId)) {
            return res.status(404).json({ error: "Session not found" });
        }

        if (session.isPinned) {
            await prisma.chatSession.update({
                where: { id: parseInt(sessionId) },
                data: { isPinned: false }
            });
            return res.json({ message: "Session unpinned", isPinned: false });
        } else {
            const pinnedCount = await prisma.chatSession.count({
                where: {
                    userId: parseInt(authUserId),
                    isPinned: true
                }
            });

            if (pinnedCount >= 5) {
                return res.status(400).json({ error: "Maximum 5 pinned sessions allowed" });
            }

            await prisma.chatSession.update({
                where: { id: parseInt(sessionId) },
                data: { isPinned: true }
            });
            return res.json({ message: "Session pinned", isPinned: true });
        }

    } catch (error) {
        console.error("Toggle Pin Error:", error);
        res.status(500).json({ error: "Failed to toggle pin status" });
    }
};

export const getSessionDetails = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const authUserId = req.user?.userId;

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID is required" });
        }
        if (!authUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const session = await prisma.chatSession.findUnique({
            where: { id: parseInt(sessionId) },
            include: {
                messages: {
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        if (session.userId !== parseInt(authUserId)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        const responseData = {
            ...session,
            chats: session.messages
        };
        delete responseData.messages;

        res.json({ data: responseData });
    } catch (error) {
        console.error("Get Session Details Error:", error);
        res.status(500).json({ error: "Failed to fetch session details" });
    }
};

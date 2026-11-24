import { FunctionCallingMode, GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import prisma from "../lib/prisma.js";
import { findRelevantUserTests } from "../services/rag_service.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const MAX_TOOL_CALL_ROUNDS = 2;
const FALLBACK_CHAT_REPLY = "Maaf, saya mengalami kendala saat menyusun respons. Bisa coba ulangi pesan Anda?";

const USER_TEST_HISTORY_TOOL = {
    functionDeclarations: [
        {
            name: "retrieve_mental_health_tests",
            description:
                "Selectively retrieves the current user's past mental health screening test records from the vector database. " +
                "ONLY call this tool when historical test data would genuinely add value to the response: " +
                "(1) the user explicitly asks about their test results, scores, recommendations, or progress/trends; or " +
                "(2) the user describes personal emotional struggles or mental health symptoms where checking similar past test patterns could improve empathy, continuity, or safety. " +
                "DO NOT call this tool for greetings, casual chitchat, thank-you replies, general psychology/psychoeducation questions, general coping techniques, off-topic questions, or follow-ups where the test context was already discussed in this conversation.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    mode: {
                        type: SchemaType.STRING,
                        format: "enum",
                        enum: ["semantic", "latest", "trend"],
                        description:
                            "Use 'semantic' to find tests matching specific symptoms or topics described by the user. " +
                            "Use 'latest' when the user asks about their most recent test result or latest advice. " +
                            "Use 'trend' when the user asks about changes, progress, or comparison across past tests.",
                    },
                    query: {
                        type: SchemaType.STRING,
                        description:
                            "Focused symptom, emotion, or mental health topic query used for semantic vector search (required when mode is 'semantic').",
                    },
                    limit: {
                        type: SchemaType.INTEGER,
                        description: "Maximum number of test records to retrieve (1 to 5, default 3).",
                    },
                    reason: {
                        type: SchemaType.STRING,
                        description:
                            "Short internal reason explaining why retrieving the user's test history is genuinely necessary for this message.",
                    },
                },
                required: ["mode", "reason"],
            },
        },
    ],
};

function parsePositiveId(value) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createAssistantInstructions({ latitude, longitude }) {
    const today = new Date().toISOString().slice(0, 10);

    let instruction = `
You are a helpful, empathetic mental health assistant for Psyche.
Today's date is ${today}.
Your goal is to provide supportive, empathetic, and informative responses related to psychology and mental health, matching the user's language (Indonesian or English).

Strict Rules:
1. If the user asks about topics NOT related to psychology, mental health, or well-being, politely refuse to answer.
2. Do NOT provide specific medical diagnoses.
3. If the user asks for professional help or locations, suggest seeing a psychiatrist or psychologist.
4. Do NOT frequently remind the user that you are an AI. Only mention it if absolutely necessary for safety or clarity.

Selective Use of User Mental Health Test History (RAG Policy):
You have access to a tool named 'retrieve_mental_health_tests' that can look up this user's past mental health screening tests. You must use strong judgment and restraint:
- DO NOT call the tool reflexively on every message.
- SKIP the tool for greetings ("halo", "hi"), casual remarks, gratitude, general psychology questions ("apa itu burnout?", "bagaimana teknik grounding?"), or off-topic requests.
- SKIP the tool if the user's relevant test context was already retrieved earlier in this conversation and no new personal aspect requires re-checking.
- CONSIDER calling the tool only when:
  * The user explicitly asks about their test results, test tips, or progress over time (use mode 'latest' or 'trend').
  * The user shares personal distress, mood struggles, or specific symptoms (e.g., susah tidur, panik, lelah berkepanjangan, putus asa, pikiran menyakiti diri) where knowing their relevant past screening history adds meaningful continuity or safety support (use mode 'semantic').
- When test records ARE retrieved:
  * Treat them as optional supporting background, NOT mandatory details to force into your reply.
  * If retrieved records are outdated (check 'daysAgo'/'recency') or only weakly relevant to what the user feels right now, do not force them into the answer; prioritize what the user is expressing today.
  * Never treat a past test result as a permanent label or current diagnosis. If referencing an older test, mention its timeframe gently and check in on how they feel now.
  * Speak naturally and empathetically — do NOT dump raw numeric item scores (1-6) unless the user specifically asks for them.
`.trim();

    if (latitude && longitude) {
        instruction += `\n\nLocation Context:\nThe user's current location is Latitude: ${latitude}, Longitude: ${longitude}.\nIf the user asks for the nearest psychologist, psychiatrist, or clinic, use these coordinates to suggest looking for services in that area.`;
    }

    return instruction;
}

async function generateConversationTitle(firstMessage) {
    try {
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const result = await model.generateContent(
            `Generate a short, concise title (max 5-6 words) for a mental health conversation starting with: "${firstMessage}". No quotes.`
        );
        return result.response.text().trim();
    } catch (error) {
        console.error("Title generation error:", error);
        return "New Conversation";
    }
}

async function getOrCreateChatSession({ userId, sessionId, firstMessage }) {
    if (sessionId) {
        const parsedSessionId = parsePositiveId(sessionId);
        if (!parsedSessionId) {
            return { errorStatus: 400, errorMessage: "Invalid Session ID" };
        }

        const existingSession = await prisma.chatSession.findUnique({
            where: { id: parsedSessionId },
            include: { messages: { orderBy: { createdAt: "asc" } } },
        });

        if (!existingSession || existingSession.userId !== userId) {
            return { errorStatus: 404, errorMessage: "Session not found or access denied" };
        }

        return { session: existingSession };
    }

    const newSession = await prisma.chatSession.create({
        data: {
            userId,
            title: "New Conversation",
        },
        include: { messages: true },
    });

    const title = await generateConversationTitle(firstMessage);
    const updatedSession = await prisma.chatSession.update({
        where: { id: newSession.id },
        data: { title },
        include: { messages: true },
    });

    return { session: updatedSession };
}

function createChatModel({ latitude, longitude }) {
    return genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: createAssistantInstructions({ latitude, longitude }),
        tools: [USER_TEST_HISTORY_TOOL],
        toolConfig: {
            functionCallingConfig: {
                mode: FunctionCallingMode.AUTO,
            },
        },
    });
}

async function runAssistantTool(toolCall, userId, fallbackQuery) {
    if (toolCall.name !== "retrieve_mental_health_tests") {
        return {
            found: false,
            response: { error: `Unknown tool: ${toolCall.name}` },
        };
    }

    const args = toolCall.args || {};

    try {
        const result = await findRelevantUserTests({
            userId,
            mode: args.mode || "semantic",
            query: args.query || fallbackQuery,
            limit: args.limit || 3,
        });

        return {
            found: Boolean(result.found),
            response: result,
        };
    } catch (error) {
        console.error("RAG retrieval error:", error);
        return {
            found: false,
            response: {
                found: false,
                error: "Test history lookup temporarily unavailable. Continue helping the user naturally without test records.",
            },
        };
    }
}

async function generateReplyWithSelectiveRag({ chat, userMessage, userId }) {
    let result = await chat.sendMessage(userMessage);
    let ragUsed = false;

    for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
        const toolCalls = result.response.functionCalls();
        if (!toolCalls || toolCalls.length === 0) {
            break;
        }

        const toolResponses = [];
        for (const toolCall of toolCalls) {
            const outcome = await runAssistantTool(toolCall, userId, userMessage);
            if (outcome.found) {
                ragUsed = true;
            }
            toolResponses.push({
                functionResponse: {
                    name: toolCall.name,
                    response: outcome.response,
                },
            });
        }

        result = await chat.sendMessage(toolResponses);
    }

    const replyText = result.response.text()?.trim() || FALLBACK_CHAT_REPLY;
    return { replyText, ragUsed };
}

async function saveChatTurn({ sessionId, userMessage, assistantReply, latitude, longitude }) {
    await prisma.chatMessage.create({
        data: {
            sessionId,
            role: "user",
            content: userMessage,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
        },
    });

    await prisma.chatMessage.create({
        data: {
            sessionId,
            role: "model",
            content: assistantReply,
        },
    });

    await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
    });
}

export const chatHandler = async (req, res) => {
    try {
        const { userId, message, latitude, longitude, sessionId } = req.body;

        if (!userId || !message || !String(message).trim()) {
            return res.status(400).json({ error: "User ID and message are required" });
        }

        const parsedUserId = parsePositiveId(userId);
        if (!parsedUserId) {
            return res.status(400).json({ error: "Invalid User ID" });
        }

        const userMessage = String(message).trim();
        const sessionLookup = await getOrCreateChatSession({
            userId: parsedUserId,
            sessionId,
            firstMessage: userMessage,
        });

        if (sessionLookup.errorStatus) {
            return res.status(sessionLookup.errorStatus).json({ error: sessionLookup.errorMessage });
        }

        const { session } = sessionLookup;
        const conversationHistory = session.messages.map((msg) => ({
            role: msg.role,
            parts: [{ text: msg.content }],
        }));

        const model = createChatModel({ latitude, longitude });
        const chat = model.startChat({
            history: conversationHistory,
            generationConfig: {
                maxOutputTokens: 2048,
            },
        });

        const { replyText, ragUsed } = await generateReplyWithSelectiveRag({
            chat,
            userMessage,
            userId: parsedUserId,
        });

        await saveChatTurn({
            sessionId: session.id,
            userMessage,
            assistantReply: replyText,
            latitude,
            longitude,
        });

        res.json({
            response: replyText,
            sessionId: session.id,
            title: session.title,
            ragUsed,
        });
    } catch (error) {
        console.error("Chatbot Error:", error);
        res.status(500).json({ error: "Failed to process chat request" });
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

export const deleteSession = async (req, res) => {
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

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        if (session.userId !== parseInt(authUserId)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        await prisma.$transaction([
            prisma.chatMessage.deleteMany({
                where: { sessionId: parseInt(sessionId) }
            }),
            prisma.chatSession.delete({
                where: { id: parseInt(sessionId) }
            })
        ]);

        res.json({ message: "Session deleted successfully" });
    } catch (error) {
        console.error("Delete Session Error:", error);
        res.status(500).json({ error: "Failed to delete session" });
    }
};

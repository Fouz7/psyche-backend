// handler/mental_health.js
import { PrismaClient } from '../../generated/prisma/index.js';
import {validationResult} from 'express-validator';
import {GoogleGenerativeAI} from '@google/generative-ai';

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MENTAL_HEALTH_FIELDS = [
    'appetite', 'interest', 'fatigue', 'worthlessness', 'concentration',
    'agitation', 'suicidalIdeation', 'sleepDisturbance', 'aggression',
    'panicAttacks', 'hopelessness', 'restlessness'
];

const SCORE_MEANINGS = {
    1: "Never",
    2: "Always",
    3: "Often",
    4: "Rarely",
    5: "Sometimes",
    6: "Not at all"
};

// Helper to generate a string detailing concerning scores
function getConcerningScoresDetails(scores) {
    let details = "";
    const concerningThresholds = {
        appetite: [2, 3],
        interest: [2, 3],
        fatigue: [2, 3],
        worthlessness: [2, 3],
        concentration: [2, 3],
        agitation: [2, 3],
        suicidalIdeation: [2, 3, 5],
        sleepDisturbance: [2, 3],
        aggression: [2, 3],
        panicAttacks: [2, 3, 5],
        hopelessness: [2, 3],
        restlessness: [2, 3]
    };

    let specificConcerns = [];
    for (const field of MENTAL_HEALTH_FIELDS) {
        const score = parseInt(scores[field], 10);
        if (concerningThresholds[field] && concerningThresholds[field].includes(score)) {
            specificConcerns.push(`${field} (${SCORE_MEANINGS[score] || 'N/A'})`);
        }
    }

    if (specificConcerns.length > 0) {
        details = ` The assessment noted particular concerns with: ${specificConcerns.join(', ')}.`;
    }
    return details;
}

async function getGeminiSuggestion(depressionState, scores) {
    try {
        const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
        let promptBase;
        const specificScoreDetails = getConcerningScoresDetails(scores);

        switch (depressionState) {
            case 0: // No depression
                promptBase = `A user's mental health assessment indicates no significant depressive symptoms.${specificScoreDetails} Provide a brief, encouraging, and supportive suggestion (1-2 sentences) for maintaining good mental well-being. If there were specific minor concerns mentioned, subtly acknowledge them if appropriate while maintaining a positive tone.`;
                break;
            case 1: // Mild
                promptBase = `A user's mental health assessment indicates mild depressive symptoms.${specificScoreDetails} Provide a brief, supportive suggestion (1-2 sentences) focusing on self-care, monitoring mood, and addressing any specifically mentioned concerns.`;
                break;
            case 2: // Moderate
                promptBase = `A user's mental health assessment indicates moderate depressive symptoms.${specificScoreDetails} Provide a brief, supportive suggestion (2-3 sentences) encouraging them to consider talking to a mental health professional, especially highlighting the importance of addressing the specifically mentioned concerns.`;
                break;
            case 3: // Severe
                promptBase = `A user's mental health assessment indicates severe depressive symptoms.${specificScoreDetails} Provide a brief, supportive, and empathetic suggestion (2-3 sentences) strongly recommending they seek professional help immediately. Emphasize the seriousness of any specifically mentioned concerns like suicidal ideation.`;
                break;
            default:
                promptBase = `Provide a general mental wellness tip (1-2 sentences).${specificScoreDetails}`;
        }

        const fullPrompt = `${promptBase} Please ensure the suggestion is empathetic and actionable.`;

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();
        return text.trim();
    } catch (error) {
        console.error("Error generating suggestion with Gemini:", error);
        if (depressionState === 0) return "Your responses suggest you are doing well. Keep up the positive habits!";
        if (depressionState === 1) return "You might be experiencing mild symptoms. Consider monitoring your mood and practicing self-care.";
        if (depressionState === 2) return "Your responses indicate moderate symptoms. It would be beneficial to talk to a mental health professional.";
        if (depressionState === 3) return "It appears you are facing significant challenges. It is highly recommended to seek professional help.";
        return "It's important to take care of your mental health. Please consider reaching out to a professional if you need support.";
    }
}

export const predictDepression = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    const {userId, ...scores} = req.body;

    for (const field of MENTAL_HEALTH_FIELDS) {
        if (scores[field] === undefined) {
            return res.status(400).json({message: `Missing field: ${field}`});
        }
    }

    const scoreValues = MENTAL_HEALTH_FIELDS.map(field => parseInt(scores[field], 10));

    let depressionState;

    const allAreOne = scoreValues.every(score => score === 1);
    const allAreTwo = scoreValues.every(score => score === 2);

    if (allAreOne) {
        depressionState = 0; // No depression
    } else if (allAreTwo) {
        depressionState = 3; // Severe
    } else {
        const totalScore = scoreValues.reduce((sum, score) => sum + score, 0);
        // User's scoring logic: higher sum = better state (less depression)
        // 1: Never, 2: Always, 3: Often, 4: Rarely, 5: Sometimes, 6: Not at all.
        // "Always" (2) contributes less to sum than "Not at all" (6). This is consistent.
        if (totalScore >= 24) {
            depressionState = 0; // No depression
        } else if (totalScore >= 16) {
            depressionState = 1; // Mild
        } else if (totalScore >= 8) {
            depressionState = 2; // Moderate
        } else { // totalScore < 8
            depressionState = 3; // Severe
        }
    }

    const generatedSuggestion = await getGeminiSuggestion(depressionState, scores);

    try {
        const healthTestRecord = await prisma.healthTest.create({
            data: {
                userId: parseInt(userId),
                appetite: parseInt(scores.appetite),
                interest: parseInt(scores.interest),
                fatigue: parseInt(scores.fatigue),
                worthlessness: parseInt(scores.worthlessness),
                concentration: parseInt(scores.concentration),
                agitation: parseInt(scores.agitation),
                suicidalIdeation: parseInt(scores.suicidalIdeation),
                sleepDisturbance: parseInt(scores.sleepDisturbance),
                aggression: parseInt(scores.aggression),
                panicAttacks: parseInt(scores.panicAttacks),
                hopelessness: parseInt(scores.hopelessness),
                restlessness: parseInt(scores.restlessness),
                depressionState: depressionState,
                generatedSuggestion: generatedSuggestion,
            },
        });

        res.status(201).json({
            message: 'Depression state predicted and recorded successfully.',
            depressionState: depressionState,
            suggestion: generatedSuggestion,
            data: healthTestRecord,
        });
    } catch (error) {
        console.error('Error saving health test:', error);
        if (error.code === 'P2003' && error.meta?.field_name?.includes('userId')) {
            return res.status(400).json({message: 'Invalid userId. User does not exist.'});
        }
        res.status(500).json({message: 'Failed to record health test.', error: error.message});
    }
};

export const getTestHistoryByUserId = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    const {userId} = req.params;

    try {
        const userExists = await prisma.user.findUnique({
            where: {id: parseInt(userId)},
        });

        if (!userExists) {
            return res.status(404).json({message: 'User not found.'});
        }

        const testHistory = await prisma.healthTest.findMany({
            where: {
                userId: parseInt(userId),
            },
            orderBy: {
                healthTestDate: 'desc',
            },
        });

        if (testHistory.length === 0) {
            return res.status(200).json({message: 'No test history found for this user.', data: []});
        }

        res.status(200).json({
            message: 'Test history retrieved successfully.',
            data: testHistory,
        });
    } catch (error) {
        console.error('Error retrieving test history:', error);
        res.status(500).json({message: 'Failed to retrieve test history.', error: error.message});
    }
};
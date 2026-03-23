import {PrismaClient} from '../../generated/prisma/index.js';
import {validationResult} from 'express-validator';
import {GoogleGenerativeAI} from '@google/generative-ai';
import * as tf from '@tensorflow/tfjs';
import path from 'path';
import {promises as fs} from 'fs';

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

const projectRoot = process.env.VERCEL ? '/var/task' : process.cwd();
const modelJsonPath = path.join(projectRoot, 'api', 'tfjs_model', 'model.json');

const fileSystemHandler = (modelJsonPath) => {
    const modelDir = path.dirname(modelJsonPath);

    return {
        load: async () => {
            const modelJson = JSON.parse(await fs.readFile(modelJsonPath, 'utf-8'));
            const {modelTopology, weightsManifest} = modelJson;

            const weightBuffers = [];
            for (const entry of weightsManifest) {
                for (const weightPath of entry.paths) {
                    const binPath = path.join(modelDir, weightPath);
                    const buffer = await fs.readFile(binPath);
                    weightBuffers.push(buffer);
                }
            }
            const weightData = Buffer.concat(weightBuffers).buffer;

            return {
                modelTopology,
                weightSpecs: weightsManifest[0].weights,
                weightData,
            };
        },
    };
};

let modelPromise = null;

const loadModel = async () => {
    if (modelPromise) {
        return modelPromise;
    }

    modelPromise = (async () => {
        try {
            const handler = fileSystemHandler(modelJsonPath);
            const model = await tf.loadLayersModel(handler);
            console.log("TF.js model loaded successfully from:", modelJsonPath);
            return model;
        } catch (error) {
            console.error("Error loading TF.js model:", error);
            modelPromise = null;
            throw new Error('Machine learning model failed to load.');
        }
    })();

    return modelPromise;
};

loadModel();

const MENTAL_HEALTH_FIELDS = [
    'appetite', 'interest', 'fatigue', 'worthlessness', 'concentration',
    'agitation', 'suicidalIdeation', 'sleepDisturbance', 'aggression',
    'panicAttacks', 'hopelessness', 'restlessness'
];

const SCORE_MEANINGS_EN = {
    1: "Never",
    2: "Always",
    3: "Often",
    4: "Rarely",
    5: "Sometimes",
    6: "Not at all"
};

const SCORE_MEANINGS_ID = {
    1: "Tidak pernah",
    2: "Selalu",
    3: "Sering",
    4: "Jarang",
    5: "Kadang-kadang",
    6: "Tidak sama sekali"
};

function getConcerningScoresDetails(scores) {
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

    let concerns = [];
    for (const field of MENTAL_HEALTH_FIELDS) {
        const score = parseInt(scores[field], 10);
        if (concerningThresholds[field] && concerningThresholds[field].includes(score)) {
            concerns.push({field, score, meaningEn: SCORE_MEANINGS_EN[score]});
        }
    }
    return concerns;
}

async function getGeminiDepressionResult(scores, latitude, longitude) {
    const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { responseMimeType: "application/json" }
    });

    const answersText = MENTAL_HEALTH_FIELDS.map(f => `- ${f}: ${SCORE_MEANINGS_EN[scores[f]]} (Score: ${scores[f]})`).join('\n');

    const concerns = getConcerningScoresDetails(scores);
    const concernsText = concerns.map(c => `- ${c.field}: ${c.meaningEn}`).join('\n');

    let locationPrompt = "";
    if (latitude && longitude) {
        locationPrompt = `
        The user is currently at location (Latitude: ${latitude}, Longitude: ${longitude}). 
        If the predicted depressionState is 3 (Severe depression), as part of your "tips", please search for and recommend specific nearby psychiatrists, mental health clinics, or hospitals.`;
    } else {
        locationPrompt = `
        User location is not provided. 
        If the predicted depressionState is 3 (Severe depression), as part of your "tips", please provide encouraging advice to help the user feel comfortable seeking professional help. 
        Emphasize that visiting a psychiatrist is a brave step, nothing to be ashamed of, and is just like seeing a doctor for physical health. 
        Also, kindly remind them that providing location access would allow for more local and relevant recommendations.`;
    }

    const prompt = `
        Task: You are an expert psychiatrist. Analyze the user's answers to 12 mental health questions and determine their depression state, then provide suggestions and tips.

        Questions evaluated:
        1. Appetite: Do you experience changes in appetite?
        2. Interest: Have you lost interest in activities?
        3. Fatigue: Do you feel fatigued or have low energy?
        4. Worthlessness: Do you feel worthless or have excessive guilt?
        5. Concentration: Do you have difficulty concentrating?
        6. Agitation: Do you experience physical agitation?
        7. Suicidal Ideation: Do you have thoughts of self-harm or suicide?
        8. Sleep Disturbance: Do you have sleep disturbances?
        9. Aggression: Do you feel aggressive?
        10. Panic Attacks: Do you experience panic attacks?
        11. Hopelessness: Do you feel hopeless?
        12. Restlessness: Do you feel restless?

        Answers are scored with meanings:
        1: "Never"
        2: "Always"
        3: "Often"
        4: "Rarely"
        5: "Sometimes"
        6: "Not at all"

        User's Answers:
        ${answersText}

        Specific Concerning Symptoms (Pay close attention to these as they indicate higher severity):
        ${concernsText || "No major concerns flagged."}

        ${locationPrompt}

        Requirements:
        1. Determine the user's overall depression state based on their answers and flagged concerning symptoms. Return this as an integer ('depressionState'):
           0: No depression
           1: Mild depression
           2: Moderate depression
           3: Severe depression
        2. Provide a "suggestion": A brief, empathetic, and supportive message (1-3 sentences) based on their state.
        3. Provide "tips": Practical tips for mental health improvement (2-3 tips). These MUST be specially tailored to the user's specific answers and concerning symptoms (e.g., if they lack energy, suggest rest/routine; if they have panic attacks, suggest grounding exercises; if they lack appetite, suggest small meals, etc.).
        4. SPECIAL RULE for Severe Depression: If depressionState is 3, the tips MUST strongly recommend visiting the nearest psychiatrist/mental health professional. Use the location information provided above if available.
        5. Provide suggestions and tips in both English (en) and Indonesian (id).
        6. Return strictly a JSON object with this structure:
           {
             "depressionState": <integer 0-3>,
             "suggestion": { "en": "...", "id": "..." },
             "tips": { "en": "...", "id": "..." }
           }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return JSON.parse(response.text().trim());
}

function getFallbackResults(depressionState, latitude, longitude) {
    const fallbacks = {
        0: {
            suggestion: { en: "You seem to be doing well. Keep it up!", id: "Anda baik-baik saja. Pertahankan!" },
            tips: { en: "Keep a healthy routine and stay active.", id: "Jaga rutinitas sehat dan tetap aktif." }
        },
        1: {
            suggestion: { en: "You have mild symptoms. Take care of yourself.", id: "Ada gejala ringan. Jaga kesehatan diri." },
            tips: { en: "Try meditation and talk to friends.", id: "Coba meditasi dan bicara dengan teman." }
        },
        2: {
            suggestion: { en: "Moderate symptoms detected. Consider professional help.", id: "Gejala sedang terdeteksi. Pertimbangkan bantuan profesional." },
            tips: { en: "Speak with a counselor and monitor your mood.", id: "Bicara dengan konselor dan pantau suasana hati Anda." }
        },
        3: {
            suggestion: {
                en: "Severe symptoms detected. Please seek help immediately.",
                id: "Gejala berat terdeteksi. Mohon cari bantuan segera."
            },
            tips: {
                en: latitude && longitude
                    ? "Please visit the nearest psychiatrist or hospital immediately. Based on your location, you can search for 'psychiatrist' on Google Maps to find the closest help."
                    : "Seeking professional help is a brave and important step for your well-being; it's just like seeing a doctor for Any other health issue. There is absolutely no shame in reaching out. Please consider visiting the nearest clinic and enable location permissions for more localized help.",
                id: latitude && longitude
                    ? "Segera kunjungi psikiater atau IGD rumah sakit terdekat. Berdasarkan lokasi Anda, Anda dapat mencari 'psikiater' di Google Maps untuk bantuan terdekat."
                    : "Mencari bantuan profesional adalah langkah berani dan penting bagi kesehatan Anda; ini sama halnya dengan pergi ke dokter untuk masalah kesehatan lainnya. Tidak perlu merasa malu untuk meminta bantuan. Silakan kunjungi klinik terdekat dan berikan izin lokasi agar kami bisa membantu mencari bantuan yang lebih spesifik di dekat Anda."
            }
        }
    };
    return fallbacks[depressionState] || fallbacks[0];
}

export const predictDepression = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    const authUserId = req.user?.userId;
    if (!authUserId) {
        return res.status(401).json({message: 'Unauthorized'});
    }

    const {userId, language = 'en', latitude, longitude, ...scores} = req.body;

    if (parseInt(userId) !== parseInt(authUserId)) {
        return res.status(403).json({message: 'Forbidden'});
    }

    for (const field of MENTAL_HEALTH_FIELDS) {
        if (scores[field] === undefined) {
            return res.status(400).json({message: `Missing field: ${field}`});
        }
        const scoreValue = parseInt(scores[field], 10);
        if (isNaN(scoreValue) || scoreValue < 1 || scoreValue > 6) {
            return res.status(400).json({message: `Invalid score for ${field}. Must be an integer between 1 and 6.`});
        }
    }

    const scoreValues = MENTAL_HEALTH_FIELDS.map(field => parseInt(scores[field], 10));

    let depressionState;
    let suggestion;
    let tips;

    try {
        const geminiResult = await getGeminiDepressionResult(scores, latitude, longitude);
        depressionState = geminiResult.depressionState;
        suggestion = geminiResult.suggestion;
        tips = geminiResult.tips;
    } catch (error) {
        console.error("Error generating results with Gemini, falling back to local model:", error);
        
        let model;
        try {
            model = await loadModel();
        } catch (modelError) {
            return res.status(500).json({message: modelError.message || 'Machine learning model is not available.'});
        }

        let normalizedScores;
        try {
            const meta = JSON.parse(await fs.readFile(path.join(projectRoot, 'api', 'tfjs_model', 'metadata.json'), 'utf8'));
            const {featureStats} = meta;

            normalizedScores = scoreValues.map((value, index) => {
                const min = featureStats.mins[index];
                const max = featureStats.maxs[index];
                const range = max - min;
                return range === 0 ? 0 : (value - min) / range;
            });
        } catch (err) {
            console.error('Error reading metadata.json:', err);
            return res.status(500).json({message: 'Failed to read model metadata.'});
        }

        try {
            const inputTensor = tf.tensor2d([normalizedScores]);

            const prediction = model.predict(inputTensor);

            const predictionData = await prediction.data();
            depressionState = prediction.argMax(-1).dataSync()[0];

            console.log(`Model Prediction - Probabilities: [${predictionData.join(', ')}], Result: ${depressionState}`);

        } catch (predError) {
            console.error('Error during model prediction:', predError);
            return res.status(500).json({message: 'Failed to predict depression state using the model.'});
        }

        const fallbackResults = getFallbackResults(depressionState, latitude, longitude);
        suggestion = fallbackResults.suggestion;
        tips = fallbackResults.tips;
    }

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
                suggestionEn: suggestion.en,
                suggestionId: suggestion.id,
                tipsEn: tips.en,
                tipsId: tips.id,
                language: language
            },
        });

        res.status(201).json({
            message: 'Depression state predicted and recorded successfully.',
            data: {
                id: healthTestRecord.id,
                userId: healthTestRecord.userId,
                healthTestDate: healthTestRecord.healthTestDate,
                depressionState: healthTestRecord.depressionState,
                language: healthTestRecord.language,
                suggestion: suggestion,
                tips: tips,
            },
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

    const authUserId = req.user?.userId;
    if (!authUserId) {
        return res.status(401).json({message: 'Unauthorized'});
    }

    const {userId} = req.params;

    if (parseInt(userId) !== parseInt(authUserId)) {
        return res.status(403).json({message: 'Forbidden'});
    }

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

        const mappedHistory = testHistory.map(test => ({
            id: test.id,
            userId: test.userId,
            healthTestDate: test.healthTestDate,
            depressionState: test.depressionState,
            suggestion: {
                en: test.suggestionEn,
                id: test.suggestionId
            },
        }));

        res.status(200).json({
            message: 'Test history retrieved successfully.',
            data: mappedHistory,
        });
    } catch (error) {
        console.error('Error retrieving test history:', error);
        res.status(500).json({message: 'Failed to retrieve test history.', error: error.message});
    }
};

export const getTestHistoryDetailById = async (req, res) => {
    const authUserId = req.user?.userId;
    if (!authUserId) {
        return res.status(401).json({message: 'Unauthorized'});
    }

    const {testId} = req.params;

    try {
        const test = await prisma.healthTest.findUnique({
            where: {
                id: parseInt(testId),
            },
        });

        if (!test) {
            return res.status(404).json({message: 'Test record not found.'});
        }

        if (test.userId !== parseInt(authUserId)) {
            return res.status(403).json({message: 'Forbidden'});
        }

        const result = {
            id: test.id,
            userId: test.userId,
            healthTestDate: test.healthTestDate,
            depressionState: test.depressionState,
            language: test.language,
            suggestion: {
                en: test.suggestionEn,
                id: test.suggestionId
            },
            tips: {
                en: test.tipsEn,
                id: test.tipsId
            },
            scores: {
                appetite: test.appetite,
                interest: test.interest,
                fatigue: test.fatigue,
                worthlessness: test.worthlessness,
                concentration: test.concentration,
                agitation: test.agitation,
                suicidalIdeation: test.suicidalIdeation,
                sleepDisturbance: test.sleepDisturbance,
                aggression: test.aggression,
                panicAttacks: test.panicAttacks,
                hopelessness: test.hopelessness,
                restlessness: test.restlessness,
            }
        };

        res.status(200).json({
            message: 'Test detail retrieved successfully.',
            data: result,
        });
    } catch (error) {
        console.error('Error retrieving test detail:', error);
        res.status(500).json({message: 'Failed to retrieve test detail.', error: error.message});
    }
};

export const getLatestTestHistoryByUserId = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    const authUserId = req.user?.userId;
    if (!authUserId) {
        return res.status(401).json({message: 'Unauthorized'});
    }

    const {userId} = req.params;

    if (parseInt(userId) !== parseInt(authUserId)) {
        return res.status(403).json({message: 'Forbidden'});
    }

    try {
        const userExists = await prisma.user.findUnique({
            where: {id: parseInt(userId)},
        });

        if (!userExists) {
            return res.status(404).json({message: 'User not found.'});
        }

        const latestTest = await prisma.healthTest.findFirst({
            where: {
                userId: parseInt(userId),
            },
            orderBy: {
                healthTestDate: 'desc',
            },
        });

        if (!latestTest) {
            return res.status(200).json({message: 'No test history found for this user.', data: null});
        }

        const mappedLatestTest = {
            id: latestTest.id,
            userId: latestTest.userId,
            healthTestDate: latestTest.healthTestDate,
            depressionState: latestTest.depressionState,
            language: latestTest.language,
            suggestion: {
                en: latestTest.suggestionEn,
                id: latestTest.suggestionId
            },
            tips: {
                en: latestTest.tipsEn,
                id: latestTest.tipsId
            }
        };

        res.status(200).json({
            message: 'Latest test history retrieved successfully.',
            data: mappedLatestTest,
        });
    } catch (error) {
        console.error('Error retrieving latest test history:', error);
        res.status(500).json({message: 'Failed to retrieve latest test history.', error: error.message});
    }
};
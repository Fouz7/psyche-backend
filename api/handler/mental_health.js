import {PrismaClient} from '../../generated/prisma/index.js';
import {validationResult} from 'express-validator';
import {GoogleGenerativeAI} from '@google/generative-ai';
import * as tf from '@tensorflow/tfjs';
import path from 'path';
import {fileURLToPath} from 'url';
import {promises as fs} from 'fs';

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const __filename = fileURLToPath(import.meta.url);
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

function getConcerningScoresDetails(scores, language = 'en') {
    let details = "";
    const SCORE_MEANINGS = language === 'id' ? SCORE_MEANINGS_ID : SCORE_MEANINGS_EN;
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
        if (language === 'id') {
            details = ` Penilaian mencatat kekhawatiran khusus dengan: ${specificConcerns.join(', ')}.`;
        } else {
            details = ` The assessment noted particular concerns with: ${specificConcerns.join(', ')}.`;
        }
    }
    return details;
}

async function getGeminiSuggestion(depressionState, scores, language = 'en') {
    try {
        const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
        let promptBase;
        const specificScoreDetails = getConcerningScoresDetails(scores, language);

        if (language === 'id') {
            switch (depressionState) {
                case 0: // No depression
                    promptBase = `Hasil asesmen kesehatan mental pengguna menunjukkan tidak ada gejala depresi yang signifikan.${specificScoreDetails} Berikan saran singkat (1-2 kalimat) yang memberi semangat dan suportif untuk menjaga kesehatan mental yang baik. Jika ada kekhawatiran kecil spesifik yang disebutkan, akui secara halus jika sesuai sambil mempertahankan nada positif.`;
                    break;
                case 1: // Mild
                    promptBase = `Hasil asesmen kesehatan mental pengguna menunjukkan gejala depresi ringan.${specificScoreDetails} Berikan saran singkat (1-2 kalimat) yang suportif, fokus pada perawatan diri, pemantauan suasana hati, dan mengatasi kekhawatiran spesifik yang disebutkan.`;
                    break;
                case 2: // Moderate
                    promptBase = `Hasil asesmen kesehatan mental pengguna menunjukkan gejala depresi sedang.${specificScoreDetails} Berikan saran singkat (2-3 kalimat) yang suportif, mendorong mereka untuk mempertimbangkan berbicara dengan profesional kesehatan mental, terutama menyoroti pentingnya mengatasi kekhawatiran spesifik yang disebutkan.`;
                    break;
                case 3: // Severe
                    promptBase = `Hasil asesmen kesehatan mental pengguna menunjukkan gejala depresi berat.${specificScoreDetails} Berikan saran singkat (2-3 kalimat) yang suportif dan empatik, sangat merekomendasikan mereka untuk segera mencari bantuan profesional. Tekankan keseriusan setiap kekhawatiran spesifik yang disebutkan seperti ide bunuh diri.`;
                    break;
                default:
                    promptBase = `Berikan tips kesehatan mental umum (1-2 kalimat).${specificScoreDetails}`;
            }
            const fullPrompt = `${promptBase} Pastikan saran tersebut empatik dan dapat ditindaklanjuti. Berikan jawaban dalam Bahasa Indonesia.`;
            const result = await model.generateContent(fullPrompt);
            const response = await result.response;
            return response.text().trim();
        } else { // English
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
            const fullPrompt = `${promptBase} Please ensure the suggestion is empathetic and actionable. Provide the answer in English.`;
            const result = await model.generateContent(fullPrompt);
            const response = await result.response;
            return response.text().trim();
        }

    } catch (error) {
        console.error("Error generating suggestion with Gemini:", error);
        if (language === 'id') {
            if (depressionState === 0) return "Respons Anda menunjukkan Anda baik-baik saja. Pertahankan kebiasaan positif!";
            if (depressionState === 1) return "Anda mungkin mengalami gejala ringan. Pertimbangkan untuk memantau suasana hati Anda dan melakukan perawatan diri.";
            if (depressionState === 2) return "Respons Anda menunjukkan gejala sedang. Akan bermanfaat untuk berbicara dengan seorang profesional kesehatan mental.";
            if (depressionState === 3) return "Tampaknya Anda menghadapi tantangan yang signifikan. Sangat disarankan untuk mencari bantuan profesional.";
            return "Penting untuk menjaga kesehatan mental Anda. Pertimbangkan untuk menghubungi seorang profesional jika Anda membutuhkan dukungan.";
        } else {
            if (depressionState === 0) return "Your responses suggest you are doing well. Keep up the positive habits!";
            if (depressionState === 1) return "You might be experiencing mild symptoms. Consider monitoring your mood and practicing self-care.";
            if (depressionState === 2) return "Your responses indicate moderate symptoms. It would be beneficial to talk to a mental health professional.";
            if (depressionState === 3) return "It appears you are facing significant challenges. It is highly recommended to seek professional help.";
            return "It's important to take care of your mental health. Please consider reaching out to a professional if you need support.";
        }
    }
}

export const predictDepression = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    let model;
    try {
        model = await loadModel();
    } catch (error) {
        return res.status(500).json({message: error.message || 'Machine learning model is not available.'});
    }

    const {userId, language = 'en', ...scores} = req.body;

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
    try {
        const inputTensor = tf.tensor2d([scoreValues]);

        const prediction = model.predict(inputTensor);

        const predictionData = await prediction.data();
        depressionState = prediction.argMax(-1).dataSync()[0];

        console.log(`Model Prediction - Probabilities: [${predictionData.join(', ')}], Result: ${depressionState}`);

    } catch (error) {
        console.error('Error during model prediction:', error);
        return res.status(500).json({message: 'Failed to predict depression state using the model.'});
    }


    const generatedSuggestion = await getGeminiSuggestion(depressionState, scores, language);

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
                language: language
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

export const getLatestTestHistoryByUserId = async (req, res) => {
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

        res.status(200).json({
            message: 'Latest test history retrieved successfully.',
            data: latestTest,
        });
    } catch (error) {
        console.error('Error retrieving latest test history:', error);
        res.status(500).json({message: 'Failed to retrieve latest test history.', error: error.message});
    }
};
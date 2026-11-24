import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import prisma from '../lib/prisma.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_SIMILARITY_THRESHOLD = getSimilarityThreshold();

export const MENTAL_HEALTH_FIELDS = [
    'appetite',
    'interest',
    'fatigue',
    'worthlessness',
    'concentration',
    'agitation',
    'suicidalIdeation',
    'sleepDisturbance',
    'aggression',
    'panicAttacks',
    'hopelessness',
    'restlessness',
];

export const SCORE_MEANINGS_EN = {
    1: 'Never',
    2: 'Always',
    3: 'Often',
    4: 'Rarely',
    5: 'Sometimes',
    6: 'Not at all',
};

export const SCORE_MEANINGS_ID = {
    1: 'Tidak pernah',
    2: 'Selalu',
    3: 'Sering',
    4: 'Jarang',
    5: 'Kadang-kadang',
    6: 'Tidak sama sekali',
};

export const SYMPTOM_DESCRIPTIONS = {
    appetite: {
        en: 'Appetite changes (loss or increase of appetite)',
        id: 'Perubahan nafsu makan',
    },
    interest: {
        en: 'Loss of interest or pleasure in activities (anhedonia)',
        id: 'Kehilangan minat atau semangat beraktivitas',
    },
    fatigue: {
        en: 'Fatigue, tiredness, or low energy',
        id: 'Kelelahan atau kurang energi',
    },
    worthlessness: {
        en: 'Feelings of worthlessness or excessive guilt',
        id: 'Perasaan tidak berharga atau bersalah berlebihan',
    },
    concentration: {
        en: 'Difficulty concentrating or focusing',
        id: 'Sulit berkonsentrasi atau fokus',
    },
    agitation: {
        en: 'Physical agitation or tension',
        id: 'Gelisah fisik atau tegang',
    },
    suicidalIdeation: {
        en: 'Thoughts of self-harm or suicide',
        id: 'Pikiran menyakiti diri sendiri atau bunuh diri',
    },
    sleepDisturbance: {
        en: 'Sleep disturbance or insomnia',
        id: 'Gangguan tidur atau susah tidur (insomnia)',
    },
    aggression: {
        en: 'Aggression or irritability',
        id: 'Mudah marah atau agresif',
    },
    panicAttacks: {
        en: 'Panic attacks or sudden intense anxiety',
        id: 'Serangan panik atau kecemasan mendadak',
    },
    hopelessness: {
        en: 'Feelings of hopelessness or despair',
        id: 'Perasaan putus asa atau hampa',
    },
    restlessness: {
        en: 'Restlessness or inability to feel calm',
        id: 'Tidak tenang atau gelisah terus-menerus',
    },
};

export const DEPRESSION_STATE_LABELS = {
    0: { en: 'No depression', id: 'Tidak ada indikasi depresi' },
    1: { en: 'Mild depression', id: 'Depresi ringan' },
    2: { en: 'Moderate depression', id: 'Depresi sedang' },
    3: { en: 'Severe depression', id: 'Depresi berat' },
};

const CONCERNING_THRESHOLDS = {
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
    restlessness: [2, 3],
};

function getSimilarityThreshold() {
    const parsed = parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.64');
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 0.64;
}

function normalizeEmbedding(values) {
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
            `Expected ${EMBEDDING_DIMENSIONS}-dim embedding vector, got ${Array.isArray(values) ? values.length : typeof values}.`
        );
    }

    let sumSquares = 0;
    for (const value of values) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error('Embedding vector contains non-finite value.');
        }
        sumSquares += value * value;
    }

    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) {
        throw new Error('Embedding vector has zero magnitude.');
    }

    return values.map((value) => value / magnitude);
}

function formatVectorForPostgres(values) {
    const normalized = normalizeEmbedding(values);
    return `[${normalized.join(',')}]`;
}

function formatShortDate(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return 'Unknown date';
    }
    return date.toISOString().slice(0, 10);
}

function describeHowLongAgo(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return { daysAgo: null, label: 'unknown date' };
    }

    const diffMs = Date.now() - date.getTime();
    const daysAgo = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    if (daysAgo === 0) return { daysAgo, label: 'today' };
    if (daysAgo === 1) return { daysAgo, label: 'yesterday' };
    if (daysAgo < 7) return { daysAgo, label: `${daysAgo} days ago` };
    if (daysAgo < 30) {
        const weeks = Math.floor(daysAgo / 7);
        return { daysAgo, label: `${weeks} week${weeks > 1 ? 's' : ''} ago` };
    }

    const months = Math.floor(daysAgo / 30);
    return { daysAgo, label: `${months} month${months > 1 ? 's' : ''} ago` };
}

function clampNumber(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
}

function parsePositiveId(value) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function summarizeSymptoms(healthTest) {
    const concerning = [];
    const occasional = [];

    for (const field of MENTAL_HEALTH_FIELDS) {
        const score = Number(healthTest[field]);
        if (!Number.isInteger(score) || !SCORE_MEANINGS_EN[score]) {
            continue;
        }

        const symptom = {
            field,
            score,
            frequencyEn: SCORE_MEANINGS_EN[score],
            frequencyId: SCORE_MEANINGS_ID[score],
            labelEn: SYMPTOM_DESCRIPTIONS[field].en,
            labelId: SYMPTOM_DESCRIPTIONS[field].id,
        };

        if (CONCERNING_THRESHOLDS[field]?.includes(score)) {
            concerning.push(symptom);
        } else if (score === 5) {
            occasional.push(symptom);
        }
    }

    return { concerning, occasional };
}

export function createTestSummaryText(healthTest) {
    const dateStr = formatShortDate(healthTest.healthTestDate);
    const state = Number.isInteger(healthTest.depressionState) ? healthTest.depressionState : 0;
    const stateLabel = DEPRESSION_STATE_LABELS[state] || DEPRESSION_STATE_LABELS[0];
    const { concerning, occasional } = summarizeSymptoms(healthTest);

    const lines = [
        'Mental Health Test Record / Riwayat Tes Kesehatan Mental',
        `Date / Tanggal: ${dateStr}`,
        `Overall Result / Hasil Depresi: ${stateLabel.en} / ${stateLabel.id} (Level ${state}/3)`,
    ];

    if (concerning.length > 0) {
        lines.push('Prominent or Concerning Symptoms / Gejala Utama yang Sering atau Selalu Dialami:');
        for (const symptom of concerning) {
            lines.push(`- ${symptom.labelEn} / ${symptom.labelId}: ${symptom.frequencyEn} (${symptom.frequencyId})`);
        }
    } else {
        lines.push('Prominent or Concerning Symptoms / Gejala Utama: None reported / Tidak ada gejala utama yang menonjol.');
    }

    if (occasional.length > 0) {
        lines.push('Occasional Symptoms / Gejala yang Kadang-kadang Dialami:');
        for (const symptom of occasional) {
            lines.push(`- ${symptom.labelEn} / ${symptom.labelId}: ${symptom.frequencyEn} (${symptom.frequencyId})`);
        }
    }

    if (healthTest.suggestionId || healthTest.suggestionEn) {
        lines.push('Assessment Summary / Ringkasan Saran:');
        if (healthTest.suggestionId) lines.push(`- ID: ${healthTest.suggestionId}`);
        if (healthTest.suggestionEn) lines.push(`- EN: ${healthTest.suggestionEn}`);
    }

    if (healthTest.tipsId || healthTest.tipsEn) {
        lines.push('Recommended Tips / Tips yang Disarankan:');
        if (healthTest.tipsId) lines.push(`- ID: ${healthTest.tipsId}`);
        if (healthTest.tipsEn) lines.push(`- EN: ${healthTest.tipsEn}`);
    }

    return lines.join('\n');
}

export async function createTextEmbedding(text, { taskType = TaskType.RETRIEVAL_DOCUMENT, title } = {}) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured.');
    }

    const cleanText = String(text || '').trim();
    if (!cleanText) {
        throw new Error('Cannot embed empty text.');
    }

    const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const request = {
        content: { parts: [{ text: cleanText }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
    };

    if (title && taskType === TaskType.RETRIEVAL_DOCUMENT) {
        request.title = title;
    }

    const response = await embeddingModel.embedContent(request);
    return normalizeEmbedding(response?.embedding?.values);
}

export async function saveTestEmbedding(healthTestRecord) {
    if (!healthTestRecord?.id || !healthTestRecord?.userId) {
        throw new Error('Valid healthTestRecord with id and userId is required.');
    }

    const summaryText = createTestSummaryText(healthTestRecord);
    const shortDate = formatShortDate(healthTestRecord.healthTestDate);
    const embedding = await createTextEmbedding(summaryText, {
        taskType: TaskType.RETRIEVAL_DOCUMENT,
        title: `Mental Health Test ${shortDate}`,
    });
    const vectorLiteral = formatVectorForPostgres(embedding);

    await prisma.$executeRaw`
        INSERT INTO "health_test_embeddings" (
            "healthTestId",
            "userId",
            "content",
            "embedding",
            "embeddingModel",
            "createdAt",
            "updatedAt"
        )
        VALUES (
            ${healthTestRecord.id},
            ${healthTestRecord.userId},
            ${summaryText},
            ${vectorLiteral}::vector,
            ${EMBEDDING_MODEL},
            NOW(),
            NOW()
        )
        ON CONFLICT ("healthTestId")
        DO UPDATE SET
            "userId" = EXCLUDED."userId",
            "content" = EXCLUDED."content",
            "embedding" = EXCLUDED."embedding",
            "embeddingModel" = EXCLUDED."embeddingModel",
            "updatedAt" = NOW()
    `;

    return {
        healthTestId: healthTestRecord.id,
        userId: healthTestRecord.userId,
        embeddingModel: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
    };
}

function formatTestForAssistant(testRow, similarity = null) {
    const state = Number.isInteger(testRow.depressionState) ? testRow.depressionState : 0;
    const stateLabel = DEPRESSION_STATE_LABELS[state] || DEPRESSION_STATE_LABELS[0];
    const { concerning, occasional } = summarizeSymptoms(testRow);
    const recency = describeHowLongAgo(testRow.healthTestDate);

    const formatted = {
        testId: testRow.id,
        date: formatShortDate(testRow.healthTestDate),
        daysAgo: recency.daysAgo,
        recency: recency.label,
        depressionState: state,
        depressionLabel: `${stateLabel.en} (${stateLabel.id})`,
        concerningSymptoms: concerning.map((item) => `${item.labelEn} [${item.frequencyEn} / ${item.frequencyId}]`),
        occasionalSymptoms: occasional.map((item) => `${item.labelEn} [${item.frequencyEn} / ${item.frequencyId}]`),
        suggestion: {
            id: testRow.suggestionId || null,
            en: testRow.suggestionEn || null,
        },
        tips: {
            id: testRow.tipsId || null,
            en: testRow.tipsEn || null,
        },
    };

    if (typeof similarity === 'number' && Number.isFinite(similarity)) {
        formatted.similarity = Number(similarity.toFixed(4));
    }

    return formatted;
}

async function getLatestUserTests(userId, limit, totalTests) {
    const latestTests = await prisma.healthTest.findMany({
        where: { userId },
        orderBy: { healthTestDate: 'desc' },
        take: limit,
    });

    return {
        found: latestTests.length > 0,
        mode: 'latest',
        totalTests,
        count: latestTests.length,
        tests: latestTests.map((test) => formatTestForAssistant(test)),
    };
}

async function getUserTestTrend(userId, limit, totalTests) {
    const windowSize = Math.min(Math.max(limit, 5), 10);
    const recentTests = await prisma.healthTest.findMany({
        where: { userId },
        orderBy: { healthTestDate: 'desc' },
        take: windowSize,
    });

    const formattedTests = recentTests.map((test) => formatTestForAssistant(test));
    const newest = formattedTests[0];
    const oldestInWindow = formattedTests[formattedTests.length - 1];

    const trendWindowSummary =
        formattedTests.length >= 2
            ? `From ${oldestInWindow.date} (level ${oldestInWindow.depressionState}) to ${newest.date} (level ${newest.depressionState}) across ${formattedTests.length} recent tests.`
            : `Only 1 test recorded so far on ${newest.date} (level ${newest.depressionState}).`;

    return {
        found: formattedTests.length > 0,
        mode: 'trend',
        totalTests,
        count: formattedTests.length,
        trendWindowSummary,
        tests: formattedTests,
    };
}

async function searchSimilarUserTests(userId, query, limit, similarityThreshold, totalTests) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
        return {
            found: false,
            mode: 'semantic',
            totalTests,
            message: 'No search query provided for semantic retrieval.',
        };
    }

    const queryEmbedding = await createTextEmbedding(cleanQuery, {
        taskType: TaskType.RETRIEVAL_QUERY,
    });
    const vectorLiteral = formatVectorForPostgres(queryEmbedding);

    const candidateRows = await prisma.$queryRaw`
        SELECT
            ht."id",
            ht."userId",
            ht."healthTestDate",
            ht."appetite",
            ht."interest",
            ht."fatigue",
            ht."worthlessness",
            ht."concentration",
            ht."agitation",
            ht."suicidalIdeation",
            ht."sleepDisturbance",
            ht."aggression",
            ht."panicAttacks",
            ht."hopelessness",
            ht."restlessness",
            ht."depressionState",
            ht."language",
            ht."suggestionEn",
            ht."suggestionId",
            ht."tipsEn",
            ht."tipsId",
            (1 - (e."embedding" <=> ${vectorLiteral}::vector))::float8 AS "similarity"
        FROM "health_test_embeddings" e
        INNER JOIN "health_tests" ht ON ht."id" = e."healthTestId"
        WHERE e."userId" = ${userId}
        ORDER BY e."embedding" <=> ${vectorLiteral}::vector ASC
        LIMIT ${limit}
    `;

    const topSimilarity = candidateRows.length > 0 ? Number(Number(candidateRows[0].similarity).toFixed(4)) : 0;
    const matchingRows = candidateRows.filter((row) => Number(row.similarity) >= similarityThreshold);

    if (matchingRows.length === 0) {
        return {
            found: false,
            mode: 'semantic',
            totalTests,
            threshold: similarityThreshold,
            topSimilarity,
            message:
                'No past mental health test records met the relevance threshold for this query. Respond naturally to the user without forcing past test data.',
        };
    }

    return {
        found: true,
        mode: 'semantic',
        totalTests,
        threshold: similarityThreshold,
        count: matchingRows.length,
        tests: matchingRows.map((row) => formatTestForAssistant(row, Number(row.similarity))),
    };
}

export async function findRelevantUserTests({
    userId,
    mode = 'semantic',
    query = '',
    limit = 3,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
}) {
    const parsedUserId = parsePositiveId(userId);
    if (!parsedUserId) {
        return { found: false, mode, message: 'Invalid user ID.' };
    }

    const selectedMode = ['semantic', 'latest', 'trend'].includes(mode) ? mode : 'semantic';
    const maxResults = clampNumber(limit, 1, 5, 3);
    const totalTests = await prisma.healthTest.count({
        where: { userId: parsedUserId },
    });

    if (totalTests === 0) {
        return {
            found: false,
            mode: selectedMode,
            totalTests: 0,
            message: 'This user has no recorded mental health tests yet.',
        };
    }

    if (selectedMode === 'latest') {
        return getLatestUserTests(parsedUserId, maxResults, totalTests);
    }

    if (selectedMode === 'trend') {
        return getUserTestTrend(parsedUserId, maxResults, totalTests);
    }

    return searchSimilarUserTests(parsedUserId, query, maxResults, similarityThreshold, totalTests);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function indexExistingHealthTests({
    userId = null,
    force = false,
    delayMs = 150,
    onProgress = null,
} = {}) {
    const where = {};

    if (userId !== null && userId !== undefined) {
        const parsedUserId = parsePositiveId(userId);
        if (!parsedUserId) {
            throw new Error('Invalid userId for indexing.');
        }
        where.userId = parsedUserId;
    }

    if (!force) {
        where.embedding = { is: null };
    }

    const healthTests = await prisma.healthTest.findMany({
        where,
        orderBy: { id: 'asc' },
    });

    const summary = {
        total: healthTests.length,
        indexed: 0,
        failed: 0,
        errors: [],
    };

    for (let index = 0; index < healthTests.length; index++) {
        const test = healthTests[index];
        try {
            await saveTestEmbedding(test);
            summary.indexed += 1;
            if (typeof onProgress === 'function') {
                onProgress({ index: index + 1, total: healthTests.length, healthTestId: test.id, status: 'indexed' });
            }
        } catch (error) {
            summary.failed += 1;
            summary.errors.push({ healthTestId: test.id, message: error.message });
            if (typeof onProgress === 'function') {
                onProgress({
                    index: index + 1,
                    total: healthTests.length,
                    healthTestId: test.id,
                    status: 'failed',
                    error: error.message,
                });
            }
        }

        if (delayMs > 0 && index < healthTests.length - 1) {
            await wait(delayMs);
        }
    }

    return summary;
}

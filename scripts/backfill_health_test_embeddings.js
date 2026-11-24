import prisma from '../api/lib/prisma.js';
import { indexExistingHealthTests, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '../api/services/rag_service.js';

function parseCliOptions(argv) {
    const force = argv.includes('--force');
    const userIdFlag = argv.find((arg) => arg.startsWith('--userId='));
    const userId = userIdFlag ? parseInt(userIdFlag.split('=')[1], 10) : null;
    return { force, userId };
}

function logIndexProgress({ index, total, healthTestId, status, error }) {
    if (status === 'indexed') {
        console.log(`[${index}/${total}] Indexed healthTestId=${healthTestId}`);
    } else {
        console.error(`[${index}/${total}] Failed healthTestId=${healthTestId}: ${error}`);
    }
}

async function runBackfill() {
    const { force, userId } = parseCliOptions(process.argv.slice(2));

    console.log(
        `Starting health test indexing (model=${EMBEDDING_MODEL}, dim=${EMBEDDING_DIMENSIONS}, force=${force}, userId=${userId ?? 'ALL'})...`
    );

    const summary = await indexExistingHealthTests({
        userId,
        force,
        delayMs: 120,
        onProgress: logIndexProgress,
    });

    console.log('\nIndexing complete:', JSON.stringify(summary, null, 2));

    if (summary.failed > 0) {
        process.exitCode = 1;
    }
}

runBackfill()
    .catch((error) => {
        console.error('Indexing fatal error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

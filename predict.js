const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');

const MODEL_DIR = path.resolve(__dirname, '..', 'model');

async function loadModel() {
    const modelJsonPath = path.join(MODEL_DIR, 'model.json');
    const weightsPath = path.join(MODEL_DIR, 'weights.bin');

    if (!fs.existsSync(modelJsonPath) || !fs.existsSync(weightsPath)) {
        throw new Error(`Model files not found in ${MODEL_DIR}`);
    }

    const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf8'));
    const weights = fs.readFileSync(weightsPath);

    const loadHandler = {
        load: async () => ({
            modelTopology: modelJson.modelTopology,
            weightSpecs: modelJson.weightsManifest[0].weights,
            weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength)
        })
    };

    return tf.loadLayersModel(loadHandler);
}

async function main() {
    await tf.setBackend('cpu');
    await tf.ready();

    const meta = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, 'metadata.json'), 'utf8'));
    const {labelValues} = meta;

    // Using the parameters you provided
    const featureCols = [
        'Appetite', 'Interest', 'Fatigue', 'Worthlessness',
        'Concentration', 'Agitation', 'Suicidal Ideation', 'Sleep Disturbance',
        'Aggression', 'Panic Attacks', 'Hopelessness', 'Restlessness'
    ];

    // Using the first row of the data you provided for prediction
    const manualInput = {
        'Appetite': 2,
        'Interest': 2,
        'Fatigue': 2,
        'Worthlessness': 2,
        'Concentration': 2,
        'Agitation': 2,
        'Suicidal Ideation': 2,
        'Sleep Disturbance': 2,
        'Aggression': 2,
        'Panic Attacks': 2,
        'Hopelessness': 2,
        'Restlessness': 2
    };

    const manualFeatureStats = {
        mins: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        maxs: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]
    };

    console.log('Using manual input:', manualInput);
    console.log('Using manual feature stats for normalization.');

    // Extract feature values from the manual input object in the correct order
    const feat = featureCols.map((colName) => Number(manualInput[colName]));

    // Normalize the features using the manually defined stats
    const norm = feat.map((v, i) => {
        const min = manualFeatureStats.mins[i];
        const max = manualFeatureStats.maxs[i];
        const range = max - min;
        // Handle division by zero if a feature has no range
        return range === 0 ? 0 : (v - min) / range;
    });

    const x = tf.tensor2d([norm]);
    const model = await loadModel();
    const pred = model.predict(x).argMax(-1);
    const predIdx = (await pred.data())[0];
    const predLabel = labelValues[predIdx];

    console.log('\nPredicted Depression State:', predLabel, `(class index ${predIdx})`);

    // Dispose tensors to free memory
    tf.dispose([x, pred]);
    model.dispose();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
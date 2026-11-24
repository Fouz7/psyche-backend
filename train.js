const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const {parse} = require('csv-parse/sync');

const DATA_PATH = path.resolve(__dirname, '..', 'cleaned_data.csv');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'model');

function loadDataset(csvPath) {
    const text = fs.readFileSync(csvPath, 'utf8');
    const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        cast: (value, context) => {
            if (context.column === undefined) return value;
            const num = Number(value);
            return Number.isFinite(num) ? num : value;
        },
        trim: true
    });

    if (!records.length) throw new Error('CSV has no data rows.');
    const allColumns = Object.keys(records[0]);
    const labelCol = 'Depression State';
    if (!allColumns.includes(labelCol)) {
        throw new Error(`Label column not found: ${labelCol}. Columns: ${allColumns.join(', ')}`);
    }
    const excludedCols = new Set([labelCol, 'Sleep', 'Low Energy']);
    const featureCols = allColumns.filter((c) => !excludedCols.has(c));

    // Build features and labels arrays
    const X = [];
    const yRaw = [];
    for (const row of records) {
        const feat = featureCols.map((c) => Number(row[c]));
        if (feat.some((v) => !Number.isFinite(v))) continue; // skip bad rows
        const lbl = Number(row[labelCol]);
        if (!Number.isFinite(lbl)) continue;
        X.push(feat);
        yRaw.push(lbl);
    }

    if (X.length === 0) throw new Error('No valid numeric rows parsed.');

    // Compute per-feature min/max
    const nFeatures = featureCols.length;
    const mins = Array(nFeatures).fill(Infinity);
    const maxs = Array(nFeatures).fill(-Infinity);
    for (const row of X) {
        for (let i = 0; i < nFeatures; i++) {
            if (row[i] < mins[i]) mins[i] = row[i];
            if (row[i] > maxs[i]) maxs[i] = row[i];
        }
    }

    // Normalize to [0,1]
    const Xnorm = X.map((row) => row.map((v, i) => {
        const range = maxs[i] - mins[i];
        return range === 0 ? 0 : (v - mins[i]) / range;
    }));

    // Build label mapping to 0..C-1
    const uniqLabels = Array.from(new Set(yRaw)).sort((a, b) => a - b);
    const labelToIndex = new Map(uniqLabels.map((v, i) => [v, i]));
    const y = yRaw.map((v) => labelToIndex.get(v));

    return {
        featureCols,
        X: Xnorm,
        y,
        labelValues: uniqLabels,
        featureStats: {mins, maxs}
    };
}

function splitDataset(X, y, {train = 0.7, val = 0.15} = {}) {
    const n = X.length;
    const indices = Array.from({length: n}, (_, i) => i);
    // Shuffle
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const nTrain = Math.floor(n * train);
    const nVal = Math.floor(n * val);
    const nTest = n - nTrain - nVal;

    const take = (start, count) => indices.slice(start, start + count);
    const idxTrain = take(0, nTrain);
    const idxVal = take(nTrain, nVal);
    const idxTest = take(nTrain + nVal, nTest);

    const gather = (idxs, arr) => tf.tensor2d(idxs.map((i) => arr[i]));
    const gatherY = (idxs, arr) => tf.tensor1d(idxs.map((i) => arr[i]), 'float32');

    const Xtrain = gather(idxTrain, X);
    const yTrain = gatherY(idxTrain, y);
    const Xval = gather(idxVal, X);
    const yVal = gatherY(idxVal, y);
    const Xtest = gather(idxTest, X);
    const yTest = gatherY(idxTest, y);

    return {Xtrain, yTrain, Xval, yVal, Xtest, yTest};
}

function buildModel(inputDim, numClasses) {
    const model = tf.sequential();
    model.add(tf.layers.dense({units: 64, activation: 'relu', inputShape: [inputDim]}));
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout({rate: 0.2}));
    model.add(tf.layers.dense({units: 32, activation: 'relu'}));
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout({rate: 0.1}));
    model.add(tf.layers.dense({units: numClasses, activation: 'softmax'}));

    model.compile({
        optimizer: tf.train.adam(1e-3),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy']
    });
    return model;
}

async function run() {
    // Ensure a backend is selected and ready (CPU by default)
    await tf.setBackend('cpu');
    await tf.ready();
    console.log('TFJS backend:', tf.getBackend());

    const EPOCHS = Number(process.env.EPOCHS || 100);
    const BATCH_SIZE = Number(process.env.BATCH_SIZE || 64);
    const PATIENCE = Number(process.env.PATIENCE || 12);
    console.log(`Training config -> epochs=${EPOCHS}, batchSize=${BATCH_SIZE}, patience=${PATIENCE}`);

    console.log('Loading dataset from', DATA_PATH);
    const {featureCols, X, y, labelValues, featureStats} = loadDataset(DATA_PATH);
    console.log(`Rows: ${X.length}, Features: ${featureCols.length}, Classes: ${labelValues.length}`);

    const {Xtrain, yTrain, Xval, yVal, Xtest, yTest} = splitDataset(X, y);

    const model = buildModel(featureCols.length, labelValues.length);
    model.summary();

    // Track best weights by lowest val_loss and restore after training
    let bestValLoss = Number.POSITIVE_INFINITY;
    let bestWeights = null;
    const trackBestImpl = {
        onEpochEnd: async (epoch, logs) => {
            if (logs && typeof logs.val_loss === 'number' && logs.val_loss < bestValLoss) {
                bestValLoss = logs.val_loss;
                bestWeights = model.getWeights().map(w => w.clone());
            }
        }
    };
    const trackBest = new tf.CustomCallback(trackBestImpl);

    const earlyStop = tf.callbacks.earlyStopping({
        monitor: 'val_loss',
        patience: PATIENCE
    });

    console.log('Training...');
    const history = await model.fit(Xtrain, yTrain, {
        epochs: EPOCHS,
        batchSize: BATCH_SIZE,
        validationData: [Xval, yVal],
        callbacks: [earlyStop, trackBest],
        verbose: 1
    });

    // Restore best weights if captured
    if (bestWeights) {
        const oldWeights = model.getWeights();
        model.setWeights(bestWeights);
        console.log(`Restored best weights at val_loss=${bestValLoss.toFixed(6)}`);
    }

    const bestValAcc = Math.max(...(history.history.val_acc || []));
    console.log(`Best val accuracy: ${(bestValAcc * 100).toFixed(2)}%`);

    console.log('Evaluating on test set...');
    const evalOut = model.evaluate(Xtest, yTest, {verbose: 0});
    const testLoss = (await evalOut[0].data())[0];
    const testAcc = (await evalOut[1].data())[0];
    console.log(`Test loss: ${testLoss.toFixed(4)}, Test acc: ${(testAcc * 100).toFixed(2)}%`);

    // Confusion matrix
    const yPred = model.predict(Xtest);
    const yPredIdx = yPred.argMax(-1);
    const yTrue = yTest;
    const yPredArr = Array.from(await yPredIdx.data());
    const yTrueArr = Array.from(await yTrue.data());
    const numClasses = labelValues.length;
    const conf = Array.from({length: numClasses}, () => Array(numClasses).fill(0));
    for (let i = 0; i < yTrueArr.length; i++) {
        conf[yTrueArr[i]][yPredArr[i]] += 1;
    }
    console.log('Confusion matrix (rows=true, cols=pred):');
    console.table(conf);

    // Save model and metadata (custom FS handler for pure tfjs)
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, {recursive: true});
    const saveHandler = tf.io.withSaveHandler(async (artifacts) => {
        const weightsData = artifacts.weightData;
        const weightsPath = path.join(OUTPUT_DIR, 'weights.bin');
        await fs.promises.writeFile(weightsPath, Buffer.from(new Uint8Array(weightsData)));

        const modelJSON = {
            modelTopology: artifacts.modelTopology,
            format: 'layers-model',
            generatedBy: `tfjs-layers ${tf.version.tfjs || ''}`.trim(),
            convertedBy: null,
            weightsManifest: [
                {
                    paths: ['weights.bin'],
                    weights: artifacts.weightSpecs
                }
            ]
        };
        const modelJsonPath = path.join(OUTPUT_DIR, 'model.json');
        await fs.promises.writeFile(modelJsonPath, JSON.stringify(modelJSON));

        return {
            modelArtifactsInfo: {
                dateSaved: new Date(),
                modelTopologyType: 'JSON',
                modelTopologyBytes: modelJSON.modelTopology ? JSON.stringify(modelJSON.modelTopology).length : 0,
                weightDataBytes: weightsData ? weightsData.byteLength : 0
            }
        };
    });

    await model.save(saveHandler);

    const meta = {
        featureCols,
        labelValues,
        featureStats,
        createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'metadata.json'), JSON.stringify(meta, null, 2));
    console.log('Saved model to', OUTPUT_DIR);

    // Dispose tensors
    tf.dispose([Xtrain, yTrain, Xval, yVal, Xtest, yTest, yPred, yPredIdx]);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
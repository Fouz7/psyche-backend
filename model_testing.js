import * as tf from '@tensorflow/tfjs';

const model_url = 'http://localhost:3000/api/model-data';
const model = await tf.loadLayersModel(model_url);

const inputData = tf.tensor2d([[6, 6, 6, 6, 6, 6, 6, 1, 1, 6, 6, 6]]);
const prediction = model.predict(inputData);

console.log(prediction);
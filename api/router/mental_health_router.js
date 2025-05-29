// router/mental_health_router.js
import express from 'express';
import * as mentalHealthHandler from '../handler/mental_health.js';
import {body, param} from 'express-validator';

const router = express.Router();

const MENTAL_HEALTH_FIELDS = [
    'appetite', 'interest', 'fatigue', 'worthlessness', 'concentration',
    'agitation', 'suicidalIdeation', 'sleepDisturbance', 'aggression',
    'panicAttacks', 'hopelessness', 'restlessness'
];

const healthTestValidations = [
    body('userId')
        .notEmpty().withMessage('User ID is required.')
        .isInt({min: 1}).withMessage('User ID must be a positive integer.'),
    ...MENTAL_HEALTH_FIELDS.map(field =>
        body(field)
            .notEmpty().withMessage(`${field} score is required.`)
            .isInt({min: 1, max: 6})
            .withMessage(`${field} score must be an integer between 1 and 6.`)
    )
];

const userIdValidation = [
    param('userId')
        .notEmpty().withMessage('User ID parameter is required.')
        .isInt({min: 1}).withMessage('User ID must be a positive integer.')
];

router.post(
    '/predict',
    healthTestValidations,
    mentalHealthHandler.predictDepression
);

router.get(
    '/history/:userId',
    userIdValidation,
    mentalHealthHandler.getTestHistoryByUserId
);

router.get(
    '/latest-history/:userId',
    userIdValidation,
    mentalHealthHandler.getLatestTestHistoryByUserId
);

export default router;
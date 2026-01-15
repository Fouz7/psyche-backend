import express from 'express';
import * as mentalHealthHandler from '../handler/mental_health.js';
import {body, param} from 'express-validator';
import { requireAuth } from '../middleware/auth.js';

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
    body('language')
        .optional()
        .isIn(['en', 'id']).withMessage('Language must be either "en" or "id".'),
    body('latitude')
        .optional()
        .isFloat().withMessage('Latitude must be a float.'),
    body('longitude')
        .optional()
        .isFloat().withMessage('Longitude must be a float.'),
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

const testIdValidation = [
    param('testId')
        .notEmpty().withMessage('Test ID parameter is required.')
        .isInt({min: 1}).withMessage('Test ID must be a positive integer.')
];

router.post(
    '/predict',
    requireAuth,
    healthTestValidations,
    mentalHealthHandler.predictDepression
);

router.get(
    '/history/:userId',
    requireAuth,
    userIdValidation,
    mentalHealthHandler.getTestHistoryByUserId
);

router.get(
    '/history-detail/:testId',
    requireAuth,
    testIdValidation,
    mentalHealthHandler.getTestHistoryDetailById
);

router.get(
    '/latest-history/:userId',
    requireAuth,
    userIdValidation,
    mentalHealthHandler.getLatestTestHistoryByUserId
);

export default router;
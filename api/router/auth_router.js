import express from 'express';
import * as authHandler from '../handler/auth.js';
import {body} from 'express-validator';

const router = express.Router();

router.post('/register', [
    body('username').notEmpty().withMessage('Username is required'),
    body('email').isEmail().withMessage('Invalid email address'),
    body('password').isLength({min: 6}).withMessage('Password must be at least 6 characters long'),
], authHandler.register);

router.post('/login', authHandler.loginValidators, authHandler.login);

router.post('/forgot-password', authHandler.forgotPasswordValidators, authHandler.forgotPassword);

router.post('/change-password', authHandler.changePasswordValidators, authHandler.changePassword);


export default router;
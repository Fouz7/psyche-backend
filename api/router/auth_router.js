import express from 'express';
import * as authHandler from '../handler/auth.js';
import {body} from 'express-validator';
import limiter from '../middleware/rate_limit.js';

const router = express.Router();

router.post('/register', [
    body('username').notEmpty().withMessage('Username is required'),
    body('email').isEmail().withMessage('Invalid email address'),
    body('password').isLength({min: 6}).withMessage('Password must be at least 6 characters long'),
], authHandler.register);

router.post('/login', limiter, authHandler.loginValidators, authHandler.login);

router.get('/verify-email', authHandler.verifyEmail);

router.post('/forgot-password', limiter, authHandler.forgotPasswordValidators, authHandler.forgotPassword);

router.post('/verify-otp', authHandler.verifyOtpValidators, authHandler.verifyOtp);

router.post('/change-password', authHandler.changePasswordValidators, authHandler.changePassword);


export default router;
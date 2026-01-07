import {PrismaClient} from '../../generated/prisma/index.js';
import {body, validationResult} from 'express-validator';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getPasswordResetTemplate } from '../resources/otp_email_template.js';
import { getVerificationSuccessHtml, getVerificationEmailHtml } from '../resources/verification_templates.js';

const prisma = new PrismaClient();

const JAKARTA_OFFSET = 7 * 60 * 60 * 1000;
const getJakartaTime = () => new Date(Date.now() + JAKARTA_OFFSET);

export const register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    try {
        const {username, email, password} = req.body;
        const passwordHash = await bcrypt.hash(password, 10);

        const verificationToken = crypto.randomBytes(32).toString('hex');

        const newUser = await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                isVerified: false,
                otp: verificationToken,
                createdAt: getJakartaTime(),
            },
        });

        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const payload = Buffer.from(`${email}:${verificationToken}`).toString('base64');
        const verificationLink = `${baseUrl}/auth/verify-email?code=${payload}`;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Psyche - Verify Your Account',
            html: getVerificationEmailHtml(username, verificationLink),
        });

        res.status(201).json({message: 'User created. Please check your email to verify your account.', userId: newUser.id});
    } catch (error) {
        if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
            return res.status(400).json({message: 'Email already taken.'});
        }
        res.status(500).json({message: 'Registration failed', error: error.message});
    }
};

export const loginValidators = [
    body('email').isEmail().withMessage('Please provide a valid email address.'),
    body('password').notEmpty().withMessage('Password is required.'),
];

export const login = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    try {
        const {email, password} = req.body;
        const user = await prisma.user.findUnique({where: {email}});
        if (!user) {
            return res.status(401).json({message: 'Invalid email'});
        }

        if (user.isVerified === false) {
             return res.status(403).json({message: 'Account not verified. Please check your email.'});
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({message: 'Invalid password.'});
        }

        const token = jwt.sign(
            {sub: user.id, email: user.email, username: user.username},
            process.env.JWT_SECRET || 'dev-secret',
            {expiresIn: '7d'}
        );

        res.status(200).json({
            message: 'Logged in successfully',
            email: user.email,
            username: user.username,
            userId: user.id,
            token
        });
    } catch (error) {
        res.status(500).json({message: 'Login failed', error: error.message});
    }
};

export const changePasswordValidators = [
    body('email').isEmail().withMessage('Email is required.'),
    body('newPassword').isLength({min: 6}).withMessage('New password must be at least 6 characters long.'),
];

export const changePassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }
    const {email, oldPassword, newPassword, otp} = req.body;
    try {
        const user = await prisma.user.findUnique({where: {email}});
        if (!user) {
            return res.status(404).json({message: 'User not found.'});
        }

        const cleanOtp = otp ? otp.replace(/\s/g, '') : null;

        if (oldPassword) {
            const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
            if (!isPasswordValid) {
                return res.status(401).json({message: 'Old password is incorrect.'});
            }
        } else if (cleanOtp) {
             if (!user.otp || user.otp !== cleanOtp) {
                 return res.status(400).json({message: 'Invalid OTP.'});
            }
            if (getJakartaTime() > new Date(user.otpExpiresAt)) {
                 return res.status(400).json({message: 'OTP has expired.'});
            }
        } else {
            return res.status(400).json({message: 'Old password (for change) or OTP (for reset) is required.'});
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: {email},
            data: {
                passwordHash: newPasswordHash,
                otp: cleanOtp ? null : user.otp,
                otpExpiresAt: cleanOtp ? null : user.otpExpiresAt
            }
        });

        res.status(200).json({message: 'Password updated successfully.'});
    } catch (error) {
        res.status(500).json({message: 'Failed to change password.', error: error.message});
    }
};

export const forgotPasswordValidators = [
    body('email').isEmail().withMessage('Please provide a valid email address.'),
];

export const forgotPassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }
    const {email} = req.body;
    try {
        const user = await prisma.user.findUnique({where: {email}});
        if (!user) {
            return res.status(404).json({message: 'User not found.'});
        }

        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let otp = '';
        for (let i = 0; i < 4; i++) {
            otp += chars[Math.floor(Math.random() * chars.length)];
        }

        const otpExpiresAt = new Date(Date.now() + JAKARTA_OFFSET + 15 * 60 * 1000);

        await prisma.user.update({
            where: {email},
            data: {
                otp,
                otpExpiresAt
            }
        });

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Psyche - Password Reset OTP',
            html: getPasswordResetTemplate(otp),
        });
        res.status(200).json({message: 'OTP has been sent to your email.'});
    } catch (error) {
        res.status(500).json({message: 'Failed to process forgot password request.', error: error.message});
    }
};

export const verifyEmail = async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('<h1>Invalid Request: Missing verification code.</h1>');
    }

    let email, token;

    try {
        const decoded = Buffer.from(code, 'base64').toString('utf-8');
        [email, token] = decoded.split(':');

        if (!email || !token) {
            return res.status(400).send('<h1>Invalid verification link format.</h1>');
        }

        const user = await prisma.user.findUnique({where: {email}});
        if (!user) {
            return res.status(404).send('<h1>User not found.</h1>');
        }

        if (user.isVerified) {
             return res.send(getVerificationSuccessHtml());
        }

        if (!user.otp || user.otp !== token) {
             return res.status(400).send('<h1>Invalid verification link.</h1>');
        }

        await prisma.user.update({
            where: { email },
            data: {
                isVerified: true,
                otp: null,
                otpExpiresAt: null
            }
        });

        res.send(getVerificationSuccessHtml());

    } catch (error) {
        res.status(500).send(`<h1>Failed to verify account: ${error.message}</h1>`);
    }
};

export const verifyOtpValidators = [
    body('email').isEmail().withMessage('Please provide a valid email address.'),
    body('otp').customSanitizer(value => value.replace(/\s/g, '')).isLength({min: 4, max: 4}).withMessage('OTP must be 4 characters.'),
];

export const verifyOtp = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }
    const {email, otp} = req.body;
    try {
        const user = await prisma.user.findUnique({where: {email}});
        if (!user) {
            return res.status(404).json({message: 'User not found.'});
        }

        if (!user.otp || user.otp !== otp) {
             return res.status(400).json({message: 'Invalid OTP.'});
        }

        if (getJakartaTime() > new Date(user.otpExpiresAt)) {
             return res.status(400).json({message: 'OTP has expired.'});
        }

        res.status(200).json({message: 'OTP verified successfully.'});
    } catch (error) {
        res.status(500).json({message: 'Failed to verify OTP.', error: error.message});
    }
};

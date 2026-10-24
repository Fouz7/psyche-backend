import { PrismaClient } from '../../generated/prisma/index.js';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getPasswordResetTemplate } from '../resources/otp_email_template.js';
import { getVerificationSuccessHtml, getVerificationEmailHtml } from '../resources/verification_templates.js';

const prisma = new PrismaClient();

const JAKARTA_OFFSET = 7 * 60 * 60 * 1000;
const getJakartaTime = () => new Date(Date.now() + JAKARTA_OFFSET);

const hasUserPassword = (user) => Boolean(user?.passwordHash && user.passwordHash.trim().length > 0);

const signUserToken = (user) => {
    const hasPassword = hasUserPassword(user);
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            username: user.username,
            hasPassword,
        },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: '7d' }
    );
};

const verifyGoogleIdToken = async (googleIdToken) => {
    const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleIdToken)}`
    );
    if (!response.ok) {
        throw new Error('Invalid Google ID token');
    }
    const payload = await response.json();
    const isEmailVerified = payload.email_verified === 'true' || payload.email_verified === true;
    if (!payload.email || !isEmailVerified) {
        throw new Error('Google account email is not verified');
    }
    if (process.env.GOOGLE_WEB_CLIENT_ID && payload.aud !== process.env.GOOGLE_WEB_CLIENT_ID) {
        throw new Error('Google ID token audience mismatch');
    }
    return {
        email: payload.email.trim().toLowerCase(),
        name: payload.name || payload.given_name || payload.email.split('@')[0],
        sub: payload.sub,
    };
};

export const register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { username, email, password } = req.body;
        const normalizedEmail = email.trim().toLowerCase();
        const passwordHash = await bcrypt.hash(password, 10);

        const verificationToken = crypto.randomBytes(32).toString('hex');

        const newUser = await prisma.user.create({
            data: {
                username: username.trim(),
                email: normalizedEmail,
                passwordHash,
                isVerified: false,
                otp: verificationToken,
                createdAt: getJakartaTime(),
            },
        });

        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const payload = Buffer.from(`${normalizedEmail}:${verificationToken}`).toString('base64');
        const verificationLink = `${baseUrl}/auth/verify-email?code=${payload}`;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: normalizedEmail,
            subject: 'Psyche - Verify Your Account',
            html: getVerificationEmailHtml(username.trim(), verificationLink),
        });

        res.status(201).json({ message: 'User created. Please check your email to verify your account.', userId: newUser.id });
    } catch (error) {
        if (error.code === 'P2002') {
            const target = error.meta?.target || [];
            const targetStr = Array.isArray(target) ? target.join(',') : String(target);
            if (targetStr.includes('email')) {
                return res.status(400).json({ message: 'Email already taken.' });
            }
        }
        res.status(500).json({ message: 'Registration failed', error: error.message });
    }
};

export const loginValidators = [
    body('email').isEmail().withMessage('Please provide a valid email address.'),
    body('password').notEmpty().withMessage('Password is required.'),
];

export const login = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { email, password } = req.body;
        const normalizedEmail = email.trim().toLowerCase();
        const user =
            (await prisma.user.findUnique({ where: { email: normalizedEmail } })) ||
            (await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } }));

        if (!user) {
            return res.status(401).json({ message: 'Invalid email' });
        }

        if (user.isVerified === false) {
            return res.status(403).json({ message: 'Account not verified. Please check your email.' });
        }

        if (!hasUserPassword(user)) {
            return res.status(400).json({
                message: 'This account was registered with Google and does not have a password yet. Please sign in with Google or set a password in Settings.',
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password.' });
        }

        const token = signUserToken(user);

        res.status(200).json({
            message: 'Logged in successfully',
            email: user.email,
            username: user.username,
            userId: user.id,
            firebaseUid: user.firebaseUid,
            hasPassword: true,
            token,
        });
    } catch (error) {
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
};

export const changePasswordValidators = [
    body('email').isEmail().withMessage('Email is required.'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters long.'),
];

export const changePassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { email, oldPassword, newPassword, otp } = req.body;
    try {
        const normalizedEmail = email.trim().toLowerCase();
        const user =
            (await prisma.user.findUnique({ where: { email: normalizedEmail } })) ||
            (await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } }));

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const userHasPwd = hasUserPassword(user);
        if (userHasPwd) {
            const isSameAsOld = await bcrypt.compare(newPassword, user.passwordHash);
            if (isSameAsOld) {
                return res.status(400).json({ message: 'New password must be different from old password.' });
            }
        }

        const cleanOtp = otp ? otp.replace(/\s/g, '') : null;

        if (oldPassword) {
            if (!userHasPwd) {
                return res.status(400).json({ message: 'You do not have a password set yet. Please use set password instead.' });
            }
            const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
            if (!isPasswordValid) {
                return res.status(401).json({ message: 'Old password is incorrect.' });
            }
        } else if (cleanOtp) {
            if (!user.otp || user.otp !== cleanOtp) {
                return res.status(400).json({ message: 'Invalid OTP.' });
            }
            if (getJakartaTime() > new Date(user.otpExpiresAt)) {
                return res.status(400).json({ message: 'OTP has expired.' });
            }
        } else {
            return res.status(400).json({ message: 'Old password (for change) or OTP (for reset) is required.' });
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash: newPasswordHash,
                otp: cleanOtp ? null : user.otp,
                otpExpiresAt: cleanOtp ? null : user.otpExpiresAt,
            },
        });

        const token = signUserToken(updatedUser);

        res.status(200).json({
            message: 'Password updated successfully.',
            hasPassword: true,
            token,
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to change password.', error: error.message });
    }
};

export const forgotPasswordValidators = [
    body('email').isEmail().withMessage('Please provide a valid email address.'),
];

export const forgotPassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { email } = req.body;
    try {
        const normalizedEmail = email.trim().toLowerCase();
        const user =
            (await prisma.user.findUnique({ where: { email: normalizedEmail } })) ||
            (await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } }));

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let otp = '';
        for (let i = 0; i < 4; i++) {
            otp += chars[Math.floor(Math.random() * chars.length)];
        }

        const otpExpiresAt = new Date(Date.now() + JAKARTA_OFFSET + 15 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                otp,
                otpExpiresAt,
            },
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
            to: user.email,
            subject: 'Psyche - Password Reset OTP',
            html: getPasswordResetTemplate(otp),
        });
        res.status(200).json({ message: 'OTP has been sent to your email.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to process forgot password request.', error: error.message });
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

        const user =
            (await prisma.user.findUnique({ where: { email } })) ||
            (await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }));

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
            where: { id: user.id },
            data: {
                isVerified: true,
                otp: null,
                otpExpiresAt: null,
            },
        });

        res.send(getVerificationSuccessHtml());
    } catch (error) {
        res.status(500).send(`<h1>Failed to verify account: ${error.message}</h1>`);
    }
};

export const verifyOtpValidators = [
    body('email').isEmail().withMessage('Please provide a valid email address.'),
    body('otp').customSanitizer((value) => value.replace(/\s/g, '')).isLength({ min: 4, max: 4 }).withMessage('OTP must be 4 characters.'),
];

export const verifyOtp = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { email, otp } = req.body;
    try {
        const normalizedEmail = email.trim().toLowerCase();
        const user =
            (await prisma.user.findUnique({ where: { email: normalizedEmail } })) ||
            (await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } }));

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        if (!user.otp || user.otp !== otp) {
            return res.status(400).json({ message: 'Invalid OTP.' });
        }

        if (getJakartaTime() > new Date(user.otpExpiresAt)) {
            return res.status(400).json({ message: 'OTP has expired.' });
        }

        res.status(200).json({ message: 'OTP verified successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to verify OTP.', error: error.message });
    }
};

export const googleRegister = async (req, res) => {
    let { email, username, firebaseUid, googleIdToken } = req.body;

    try {
        if (googleIdToken) {
            try {
                const verifiedGoogle = await verifyGoogleIdToken(googleIdToken);
                email = verifiedGoogle.email;
                if (!username) {
                    username = verifiedGoogle.name;
                }
                if (!firebaseUid) {
                    firebaseUid = verifiedGoogle.sub;
                }
            } catch (verifyError) {
                return res.status(401).json({ message: verifyError.message || 'Invalid Google ID token.' });
            }
        }

        if (!email || !firebaseUid) {
            return res.status(400).json({ message: 'Email and firebaseUid are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ message: 'Invalid email address.' });
        }

        const resolvedUsername = (username || normalizedEmail.split('@')[0]).trim();

        let existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: { equals: normalizedEmail, mode: 'insensitive' } },
                    { firebaseUid },
                ],
            },
        });

        if (existingUser) {
            // Link firebaseUid if not yet linked, and mark verified since Google verified the email
            const shouldUpdate =
                (!existingUser.firebaseUid && firebaseUid) ||
                existingUser.isVerified === false;

            if (shouldUpdate) {
                existingUser = await prisma.user.update({
                    where: { id: existingUser.id },
                    data: {
                        firebaseUid: existingUser.firebaseUid || firebaseUid,
                        isVerified: true,
                        otp: existingUser.isVerified === false ? null : existingUser.otp,
                        otpExpiresAt: existingUser.isVerified === false ? null : existingUser.otpExpiresAt,
                    },
                });
            }

            const hasPassword = hasUserPassword(existingUser);
            const token = signUserToken(existingUser);

            return res.status(200).json({
                message: 'Logged in successfully with Google.',
                email: existingUser.email,
                username: existingUser.username,
                userId: existingUser.id,
                firebaseUid: existingUser.firebaseUid,
                hasPassword,
                isNewUser: false,
                token,
            });
        }

        const newUser = await prisma.user.create({
            data: {
                username: resolvedUsername,
                email: normalizedEmail,
                passwordHash: null,
                firebaseUid,
                isVerified: true,
                createdAt: getJakartaTime(),
            },
        });

        const token = signUserToken(newUser);

        return res.status(201).json({
            message: 'User registered successfully with Google.',
            email: newUser.email,
            username: newUser.username,
            userId: newUser.id,
            firebaseUid: newUser.firebaseUid,
            hasPassword: false,
            isNewUser: true,
            token,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Google authentication failed', error: error.message });
    }
};

export const setPassword = async (req, res) => {
    const { firebaseUid, email, newPassword } = req.body;

    if (!newPassword) {
        return res.status(400).json({ message: 'newPassword is required.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    try {
        let user = null;

        // 1. Prefer authenticated JWT user if Authorization header is provided
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const tokenStr = authHeader.split(' ')[1];
            try {
                const payload = jwt.verify(tokenStr, process.env.JWT_SECRET || 'dev-secret');
                if (payload?.sub) {
                    user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
                }
            } catch (_) {
                // Fall back to firebaseUid/email lookup if token not used
            }
        }

        // 2. Fallback to firebaseUid or email lookup
        if (!user && firebaseUid) {
            user = await prisma.user.findUnique({ where: { firebaseUid } });
        }
        if (!user && email) {
            const normalizedEmail = email.trim().toLowerCase();
            user =
                (await prisma.user.findUnique({ where: { email: normalizedEmail } })) ||
                (await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } }));
        }

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        if (hasUserPassword(user)) {
            return res.status(400).json({ message: 'Password is already set. Please use change password instead.' });
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash: newPasswordHash,
            },
        });

        const token = signUserToken(updatedUser);

        return res.status(200).json({
            message: 'Password has been set successfully.',
            hasPassword: true,
            token,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to set password.', error: error.message });
    }
};

export const getMe = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: Number(userId) },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        return res.status(200).json({
            userId: user.id,
            username: user.username,
            email: user.email,
            firebaseUid: user.firebaseUid,
            isVerified: user.isVerified,
            hasPassword: hasUserPassword(user),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch user profile.', error: error.message });
    }
};

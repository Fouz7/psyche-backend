import {PrismaClient} from '../../generated/prisma/index.js';
import {body, validationResult} from 'express-validator';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';

const prisma = new PrismaClient();

export const register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    try {
        const {username, email, password} = req.body;
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await prisma.user.create({
            data: {username, email, passwordHash},
        });
        res.status(201).json({message: 'User created successfully', user: newUser});
    } catch (error) {
        if (error.code === 'P2002' && error.meta?.target?.includes('username')) {
            return res.status(400).json({message: 'Username already taken.'});
        }
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
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({message: 'Invalid password.'});
        }
        res.status(200).json({
            message: 'Logged in successfully',
            email: user.email,
            username: user.username,
            userId: user.id
        });
    } catch (error) {
        res.status(500).json({message: 'Login failed', error: error.message});
    }
};

export const changePasswordValidators = [
    body('email').isEmail().withMessage('Email is required.'),
    body('oldPassword').notEmpty().withMessage('Old password is required.'),
    body('newPassword').isLength({min: 6}).withMessage('New password must be at least 6 characters long.'),
];

export const changePassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }
    const {email, oldPassword, newPassword} = req.body;
    try {
        const user = await prisma.user.findUnique({where: {email}});
        if (!user) {
            return res.status(404).json({message: 'User not found.'});
        }
        const isPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({message: 'Old password is incorrect.'});
        }
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({where: {email}, data: {passwordHash: newPasswordHash}});
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
        const randomPassword = Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(randomPassword, 10);
        await prisma.user.update({where: {email}, data: {passwordHash}});
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
            subject: 'Your new password',
            text: `Your new password is: ${randomPassword}`,
        });
        res.status(200).json({message: 'A new password has been sent to your email or maybe in the spam folder :).'});
    } catch (error) {
        res.status(500).json({message: 'Failed to reset password.', error: error.message});
    }
};
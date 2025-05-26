import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { PrismaClient } from '../../generated/prisma/index.js';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

initializeApp({
    credential: cert(serviceAccount)
});

const prisma = new PrismaClient();

export const register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { username, email, password } = req.body;

        const userRecord = await getAuth().createUser({
            email: email,
            password: password,
            displayName: username,
        });

        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
            },
        });

        res.status(201).json({ message: 'User created successfully', user: newUser, firebaseUid: userRecord.uid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Registration failed', error: error.message });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({
            where: {
                email: email,
            },
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const firebaseToken = await getAuth().createCustomToken(user.id.toString());

        res.status(200).json({ message: 'Logged in successfully', firebaseToken: firebaseToken });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
};
import {initializeApp, cert} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {PrismaClient} from '../../generated/prisma/index.js';
import {body, validationResult} from 'express-validator';
import bcrypt from 'bcrypt';

initializeApp({
    credential: cert({
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        project_id: process.env.FIREBASE_PROJECT_ID,
    })
});

const prisma = new PrismaClient();

export const register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    try {
        const {username, email, password} = req.body;

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
                firebaseUid: userRecord.uid
            },
        });

        res.status(201).json({message: 'User created successfully', user: newUser, firebaseUid: userRecord.uid});
    } catch (error) {
        console.error(error);
        if (error.code === 'auth/email-already-exists') {
            return res.status(400).json({message: 'Email already in use by a Firebase account.'});
        }
        if (error.code === 'P2002' && error.meta?.target?.includes('username')) {
            return res.status(400).json({message: 'Username already taken.'});
        }
        if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
            return res.status(400).json({message: 'Email already taken in database.'});
        }
        res.status(500).json({message: 'Registration failed', error: error.message});
    }
};

// Validator for the login endpoint
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

        const user = await prisma.user.findUnique({
            where: {
                email: email,
            },
        });

        if (!user) {
            return res.status(401).json({message: 'Invalid email or password.'});
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({message: 'Invalid email or password.'});
        }

        // Generate a new Firebase custom token
        const newCustomToken = await getAuth().createCustomToken(user.firebaseUid);

        res.status(200).json({
            message: 'Logged in successfully',
            firebaseToken: newCustomToken,
            email: user.email,
            username: user.username,
            userId: user.id,
            firebaseUid: user.firebaseUid
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({message: 'Login failed', error: error.message});
    }
};

// Validator for the request password reset endpoint
export const requestPasswordResetValidators = [
    body('email').isEmail().withMessage('Please provide a valid email address.'),
];

export const requestPasswordReset = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    const {email} = req.body;

    try {
        // Check if user exists in Firebase (optional, but good practice)
        await getAuth().getUserByEmail(email);
        const link = await getAuth().generatePasswordResetLink(email);
        // You might want to send this link via email to the user
        // For now, just confirming the process would be initiated
        res.status(200).json({
            message: 'If your email address is registered with us, you will receive a password reset link shortly.',
            // passwordResetLink: link // Optionally return link for testing, remove for production
        });

    } catch (error) {
        console.error('Error in requestPasswordReset:', error);
        // Generic message to prevent email enumeration, even if user not found by Firebase
        res.status(200).json({
            message: 'If your email address is registered with us, you will receive a password reset link shortly.'
        });
    }
};

// Validators for the change password endpoint
export const changePasswordValidators = [
    body('idToken').notEmpty().withMessage('Firebase ID token is required.'), // This still expects an idToken
    body('newPassword').isLength({min: 6}).withMessage('New password must be at least 6 characters long.'),
];

export const changePassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    const {idToken, newPassword} = req.body;

    try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        await getAuth().updateUser(uid, {
            password: newPassword,
        });

        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: {firebaseUid: uid},
            data: {passwordHash: newPasswordHash},
        });

        res.status(200).json({message: 'Password updated successfully in Firebase and database.'});

    } catch (error) {
        console.error('Change password error:', error);
        if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error' || error.code === 'auth/id-token-revoked') {
            return res.status(401).json({message: 'Invalid or expired Firebase ID token.', error: error.message});
        }
        if (error.code === 'auth/user-not-found') {
            return res.status(404).json({message: 'User not found in Firebase.', error: error.message});
        }
        res.status(500).json({message: 'Failed to change password.', error: error.message});
    }
};
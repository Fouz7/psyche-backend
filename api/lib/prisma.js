import { PrismaClient } from '../../generated/prisma/index.js';

const globalForPrisma = globalThis;

export const prisma =
    globalForPrisma.__psychePrisma ||
    new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__psychePrisma = prisma;
}

export default prisma;

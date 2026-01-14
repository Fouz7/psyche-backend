import cron from 'node-cron';
import { PrismaClient } from '../../generated/prisma/index.js';

const prisma = new PrismaClient();

const JAKARTA_OFFSET = 7 * 60 * 60 * 1000;
const getJakartaTime = () => new Date(Date.now() + JAKARTA_OFFSET);

export const initOtpCleaner = () => {
    cron.schedule('0 0 * * *', async () => {
        console.log('Running daily OTP cleanup scheduler...');
        try {
            const currentTime = getJakartaTime();

            const result = await prisma.user.updateMany({
                where: {
                    otpExpiresAt: {
                        lt: currentTime,
                    },
                    NOT: {
                        otpExpiresAt: null
                    }
                },
                data: {
                    otp: null,
                    otpExpiresAt: null
                }
            });

            console.log(`[${currentTime.toISOString()}] Expired OTP cleanup successful. Columns cleared for ${result.count} users.`);
        } catch (error) {
            console.error('Error running OTP cleanup scheduler:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });
};


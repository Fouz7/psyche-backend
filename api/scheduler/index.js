import { initOtpCleaner } from './otp_cleaner.js';

export const initScheduler = () => {
    console.log('Initializing schedulers...');
    initOtpCleaner();
};


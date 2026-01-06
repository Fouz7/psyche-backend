import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let noDepDataUrl = '';
try {
    const imagePath = path.join(__dirname, 'no-dep.png');
    if (fs.existsSync(imagePath)) {
        const noDepImage = fs.readFileSync(imagePath).toString('base64');
        noDepDataUrl = `data:image/png;base64,${noDepImage}`;
    }
} catch (error) {
    console.error('Error loading no-dep.png:', error);
}

export const getVerificationSuccessHtml = () => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Verified</title>
  <style>
    body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f4f4; margin: 0; }
    .container { text-align: center; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    h1 { color: #15594F; margin-bottom: 10px; }
    p { color: #555; font-size: 18px; }
    .image-container img { width: 100px; height: auto; margin-bottom: 20px; }
    .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #15594F; color: white; text-decoration: none; border-radius: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="image-container">
        ${noDepDataUrl ? `<img src="${noDepDataUrl}" alt="Success" />` : '<div style="font-size: 50px; color: #15594F;">✓</div>'}
    </div>
    <h1>Account Verified!</h1>
    <p>Your account has been successfully verified.</p>
    <p>Please return to the application to login.</p>
  </div>
</body>
</html>
`;

export const getVerificationEmailHtml = (username, verificationLink) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid #15594F; border-radius: 10px; text-align: center;">
    <h2 style="color: #333;">Verify Your Account</h2>
    <h3 style="color: #555;">Hello, ${username}!</h3>
    <p style="color: #555; font-size: 16px;">Thank you for registering. Please click the button below to verify your account:</p>
    <div style="margin: 30px 0;">
        <a href="${verificationLink}" style="display: inline-block; padding: 12px 24px; background-color: #15594F; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Verify Account</a>
    </div>
    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #aaa; font-size: 12px;">&copy; Psyche</p>
</div>
`;


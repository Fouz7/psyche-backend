export const getPasswordResetTemplate = (otp) => {
    const colors = ['#15594F', '#641220', '#A1AACD', '#495057'];

    for (let i = colors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [colors[i], colors[j]] = [colors[j], colors[i]];
    }

    const coloredOtp = otp.toString().split('').map((char, index) => {
        const color = colors[index % colors.length];
        return `<span style="display: inline-block; width: 40px; height: 40px; line-height: 40px; text-align: center; margin: 0 5px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 24px; font-weight: bold; color: ${color}; background-color: #ffffff;">${char}</span>`;
    }).join('');

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid #15594F; border-radius: 10px;">
            <h2 style="color: #333; text-align: center;">Password Reset</h2>
            <p style="color: #555; font-size: 16px;">Hello,</p>
            <p style="color: #555; font-size: 16px;">You requested to reset your password. Use the OTP below to proceed:</p>
            <div style="text-align: center; margin: 30px 0;">
                ${coloredOtp}
            </div>
            <p style="color: #555; font-size: 14px;">This OTP is valid for <strong>15 minutes</strong>.</p>
            <p style="color: #888; font-size: 12px; margin-top: 20px; text-align: center;">If you did not request this, please ignore this email.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #aaa; font-size: 12px; text-align: center;">&copy; Psyche</p>
        </div>
    `;
};

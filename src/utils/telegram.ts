export async function sendTelegramAlert(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  // Logic to send message via Telegram Bot API
  console.log(`Sending alert: ${message}`);
}

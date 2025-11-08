// bot.js
import fetch from 'node-fetch';
import TelegramBot from 'node-telegram-bot-api';

// Replace with your Telegram bot token
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

// Your Vercel API endpoint
const API_URL = 'https://samai-pi.vercel.app/api/chat'; // replace with your deployed API URL

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Show typing indicator
  bot.sendChatAction(chatId, 'typing');

  try {
    // Call your existing API
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });

    const data = await response.json();

    bot.sendMessage(chatId, data.reply || "Sorry, I couldn't generate a response.");
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "Connection error. Please try again later.");
  }
});

console.log('Telegram bot is running...');
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

// Your Telegram Bot Token
const BOT_TOKEN = "8559167003:AAGg0sWPEoFyLWKg9BBfcLzJCoNA1hi1Sus";

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Groq API function
async function getGroqResponse(message) {
  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) {
      console.error("Groq API key not found in environment");
      return "⚠️ Groq API key is not configured. Please add GROQ_API_KEY in Vercel environment variables.";
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { 
            role: "system", 
            content: "You are a helpful AI assistant. Keep responses concise, friendly, and informative. Use markdown formatting when helpful." 
          },
          { role: "user", content: message }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      console.error(`Groq API error: ${response.status}`);
      return "🤖 I'm having trouble connecting to my AI brain right now. Please try again in a moment.";
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
    
  } catch (error) {
    console.error("Groq API Error:", error.message);
    return "🚫 Sorry, I encountered an error. Please try your request again.";
  }
}

// Handle /start command
bot.start((ctx) => {
  ctx.reply(
    "🤖 *AI Assistant Bot*\n\n" +
    "Hello! I'm an AI assistant powered by Groq's Llama 3.1.\n\n" +
    "*Available Commands:*\n" +
    "/start - Show this message\n" +
    "/help - How to use the bot\n" +
    "/about - About this bot\n\n" +
    "Just send me any message and I'll respond!\n\n" +
    "Try asking me:\n" +
    "• *What is AI?*\n" +
    "• *Tell me a joke*\n" +
    "• *Explain quantum computing*",
    { parse_mode: 'Markdown' }
  );
});

// Handle /help command
bot.help((ctx) => {
  ctx.reply(
    "💡 *How to use this bot:*\n\n" +
    "1. Simply type your question or message\n" +
    "2. I'll respond using AI\n" +
    "3. That's it!\n\n" +
    "*Examples:*\n" +
    "• Technology questions\n" +
    "• Study help\n" +
    "• Creative writing\n" +
    "• Problem solving\n" +
    "• General knowledge\n\n" +
    "I can help with almost anything! 🚀",
    { parse_mode: 'Markdown' }
  );
});

// Handle /about command
bot.command('about', (ctx) => {
  ctx.reply(
    "🤖 *About This Bot*\n\n" +
    "*Technology Stack:*\n" +
    "• Backend: Vercel Serverless Functions\n" +
    "• AI Engine: Groq Cloud\n" +
    "• Model: Llama 3.1 8B Instant\n\n" +
    "*Privacy:*\n" +
    "• No conversation history stored\n" +
    "• Messages processed in real-time\n" +
    "• No personal data saved\n\n" +
    "Built with ❤️ using modern AI technology.",
    { parse_mode: 'Markdown' }
  );
});

// Handle all text messages
bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;
  
  // Skip if it's a command
  if (userMessage.startsWith('/')) {
    return;
  }
  
  console.log(`Received message from ${chatId}: ${userMessage.substring(0, 50)}...`);
  
  try {
    // Show typing indicator
    await ctx.sendChatAction('typing');
    
    // Get AI response
    const reply = await getGroqResponse(userMessage);
    
    console.log(`Sending response to ${chatId} (length: ${reply.length})`);
    
    // Send response (split if too long for Telegram)
    if (reply.length > 4000) {
      const chunks = reply.match(/[\s\S]{1,4000}/g);
      for (let i = 0; i < chunks.length; i++) {
        await ctx.reply(chunks[i], { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } else {
      await ctx.reply(reply, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    }
    
  } catch (error) {
    console.error("Message handling error:", error);
    try {
      await ctx.reply("❌ Sorry, something went wrong. Please try your request again.");
    } catch (e) {
      console.error("Failed to send error message:", e);
    }
  }
});

// Handle errors
bot.catch((err, ctx) => {
  console.error(`Bot error for update ${ctx.updateType}:`, err);
});

// Export for Vercel
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Process Telegram update
    console.log('Received webhook request');
    await bot.handleUpdate(req.body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

// Telegram Bot Token (HARDCODED - REPLACE WITH YOUR TOKEN)
const BOT_TOKEN = "8559167003:AAGg0sWPEoFyLWKg9BBfcLzJCoNA1hi1Sus";

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Groq API function
async function getGroqResponse(message) {
  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) {
      console.error("Groq API key not found in environment");
      return "⚠️ API configuration error. Please check server setup.";
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
            content: "You are a helpful AI assistant. Keep responses concise, friendly, and informative." 
          },
          { role: "user", content: message }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      console.error(`Groq API error: ${response.status} - ${await response.text()}`);
      return "🤖 I'm having trouble connecting to my AI brain. Please try again in a moment.";
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
    
  } catch (error) {
    console.error("Groq API Error:", error);
    return "🚫 Sorry, I encountered an error while processing your request. Please try again.";
  }
}

// Handle /start command
bot.start((ctx) => {
  ctx.reply(
    "🤖 *Welcome to DeepSeek AI Bot!*\n\n" +
    "I'm powered by Groq's AI technology.\n\n" +
    "*How to use:*\n" +
    "• Just send me any message\n" +
    "• I'll respond using AI\n\n" +
    "*Commands:*\n" +
    "/start - Show this welcome message\n" +
    "/help - Get help information\n" +
    "/about - About this bot\n\n" +
    "Start by asking me anything! 💬",
    { parse_mode: 'Markdown' }
  );
});

// Handle /help command
bot.help((ctx) => {
  ctx.reply(
    "💡 *Help Guide*\n\n" +
    "*What I can do:*\n" +
    "• Answer questions\n" +
    "• Explain concepts\n" +
    "• Help with problem-solving\n" +
    "• Generate creative content\n\n" +
    "*Examples:*\n" +
    "• 'What is machine learning?'\n" +
    "• 'Explain quantum physics simply'\n" +
    "• 'Write a short poem about AI'\n" +
    "• 'Help me solve this math problem...'\n\n" +
    "Just type your question and press send! 🚀",
    { parse_mode: 'Markdown' }
  );
});

// Handle /about command
bot.command('about', (ctx) => {
  ctx.reply(
    "🤖 *DeepSeek AI Bot*\n\n" +
    "*Powered by:*\n" +
    "• Groq API\n" +
    "• Llama 3.1 8B Instant\n\n" +
    "*Features:*\n" +
    "• Fast AI responses\n" +
    "• Conversational interface\n" +
    "• No message history stored\n\n" +
    "This bot processes requests in real-time using cloud AI services.",
    { parse_mode: 'Markdown' }
  );
});

// Handle all text messages
bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  
  // Ignore commands that have been handled
  if (userMessage.startsWith('/')) {
    return;
  }
  
  try {
    // Show typing indicator
    await ctx.sendChatAction('typing');
    
    // Get AI response
    const reply = await getGroqResponse(userMessage);
    
    // Send response
    await ctx.reply(reply, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error("Message handling error:", error);
    ctx.reply("❌ Sorry, something went wrong while processing your message. Please try again.");
  }
});

// Handle errors
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply("⚠️ An unexpected error occurred. Please try your request again.");
});

// Start bot polling (for development)
if (process.env.NODE_ENV === 'development') {
  bot.launch().then(() => {
    console.log('🤖 Telegram bot is running in development mode!');
  });
}

// Export for Vercel
export default async function handler(req, res) {
  // For Vercel deployment, we'll use webhooks
  // You need to set webhook: https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-vercel-url.vercel.app/api/bot
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Process Telegram update
    await bot.handleUpdate(req.body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🤖 DeepSeek Bot initialized!');
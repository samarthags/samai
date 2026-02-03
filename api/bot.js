import { Telegraf } from 'telegraf';

// Your Telegram Bot Token
const BOT_TOKEN = "8559167003:AAGg0sWPEoFyLWKg9BBfcLzJCoNA1hi1Sus";

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Groq API function
async function getGroqResponse(message) {
  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) {
      console.error("❌ ERROR: Groq API key not found in environment");
      return "⚠️ Bot is still setting up. Please wait a moment and try again.";
    }

    console.log(`🤖 Sending to Groq: "${message.substring(0, 50)}..."`);
    
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
        max_tokens: 500
      })
    });

    console.log(`📡 Groq response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Groq API error ${response.status}:`, errorText);
      return "🤖 I'm having technical difficulties. Please try again in a moment.";
    }

    const data = await response.json();
    const reply = data.choices[0].message.content.trim();
    
    console.log(`✅ Got reply (${reply.length} chars)`);
    return reply;
    
  } catch (error) {
    console.error("❌ Groq API Error:", error.message);
    return "🚫 Sorry, I encountered an error. Please try again.";
  }
}

// Handle /start command
bot.start((ctx) => {
  console.log(`📱 /start command from ${ctx.chat.id}`);
  ctx.reply(
    "🤖 *AI Assistant Bot*\n\n" +
    "Hello! I'm back online and ready to help!\n\n" +
    "Just send me any message and I'll respond using AI.\n\n" +
    "Try asking:\n" +
    "• What is AI?\n" +
    "• Tell me a joke\n" +
    "• Explain something\n\n" +
    "I'm powered by Groq's fast AI technology!",
    { parse_mode: 'Markdown' }
  );
});

// Handle /help command
bot.help((ctx) => {
  console.log(`📱 /help command from ${ctx.chat.id}`);
  ctx.reply(
    "💡 *How to use:*\n\n" +
    "Just type any question or message and send it!\n\n" +
    "*Examples:*\n" +
    "• Technology questions\n" +
    "• Study help\n" +
    "• Creative writing\n" +
    "• General knowledge\n\n" +
    "That's it! Simple and easy. 🚀",
    { parse_mode: 'Markdown' }
  );
});

// Handle /status command
bot.command('status', (ctx) => {
  console.log(`📱 /status command from ${ctx.chat.id}`);
  const hasApiKey = !!process.env.GROQ_API_KEY;
  ctx.reply(
    `🤖 *Bot Status*\n\n` +
    `• *Online:* ✅ Yes\n` +
    `• *API Key:* ${hasApiKey ? '✅ Configured' : '❌ Missing'}\n` +
    `• *Messages:* Working\n` +
    `• *Powered by:* Groq AI\n\n` +
    `Bot is ${hasApiKey ? 'fully operational' : 'missing API key'}`,
    { parse_mode: 'Markdown' }
  );
});

// Handle all text messages
bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  
  console.log(`📱 Message from ${userId} in ${chatId}: "${userMessage}"`);
  
  // Skip if it's a command
  if (userMessage.startsWith('/')) {
    return;
  }
  
  try {
    // Show typing indicator
    await ctx.sendChatAction('typing');
    
    // Get AI response
    const reply = await getGroqResponse(userMessage);
    
    // Send response
    await ctx.reply(reply);
    
    console.log(`✅ Successfully replied to ${userId}`);
    
  } catch (error) {
    console.error("❌ Error handling message:", error);
    try {
      await ctx.reply("❌ Sorry, something went wrong. The developer has been notified.");
    } catch (e) {
      console.error("❌ Failed to send error message:", e);
    }
  }
});

// Handle errors
bot.catch((err, ctx) => {
  console.error(`❌ Bot error:`, err);
});

// Health check endpoint
bot.telegram.setWebhook = async (url) => {
  console.log(`🔗 Setting webhook to: ${url}`);
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${url}`);
    const data = await response.json();
    console.log('✅ Webhook set:', data);
    return data;
  } catch (error) {
    console.error('❌ Failed to set webhook:', error);
    throw error;
  }
};

// Export for Vercel
export default async function handler(req, res) {
  console.log(`🌐 ${req.method} request received`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    console.log('🔄 Handling OPTIONS preflight');
    return res.status(200).end();
  }
  
  // Health check endpoint
  if (req.method === 'GET') {
    console.log('🔍 Health check requested');
    return res.status(200).json({ 
      status: 'online',
      bot: 'Telegram Groq Bot',
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Log the request
    console.log('📦 Webhook body:', JSON.stringify(req.body, null, 2));
    
    // Process Telegram update
    await bot.handleUpdate(req.body);
    
    console.log('✅ Webhook processed successfully');
    return res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({ 
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
}

// Log startup
console.log('🤖 Bot initialized with token:', BOT_TOKEN.substring(0, 10) + '...');
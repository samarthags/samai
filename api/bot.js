import { Telegraf } from 'telegraf';

// Get credentials from environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Check if environment variables are set
if (!BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN environment variable is not set');
  throw new Error('BOT_TOKEN is required');
}

if (!GROQ_API_KEY) {
  console.error('❌ ERROR: GROQ_API_KEY environment variable is not set');
  throw new Error('GROQ_API_KEY is required');
}

console.log('✅ Environment variables loaded');
console.log('🤖 Bot initializing with Groq API...');

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Function to call Groq API
async function getGroqResponse(userMessage) {
  try {
    console.log('🤖 Calling Groq API...');
    
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
            content: "You are a helpful AI assistant. Be concise, friendly, and helpful." 
          },
          { role: "user", content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Groq API error:', response.status, error);
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Groq response received');
    return data.choices[0].message.content;
    
  } catch (error) {
    console.error('❌ Error calling Groq:', error.message);
    return "I'm having trouble connecting to the AI service. Please try again.";
  }
}

// Handle text messages
bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;
  
  console.log(`📱 Message from ${chatId}: "${userMessage}"`);
  
  // Skip commands
  if (userMessage.startsWith('/')) return;
  
  try {
    // Show typing indicator
    await ctx.sendChatAction('typing');
    
    // Get response from Groq
    const reply = await getGroqResponse(userMessage);
    
    console.log(`✅ Sending reply to ${chatId}`);
    
    // Send the response
    await ctx.reply(reply, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('❌ Error:', error);
    await ctx.reply("Sorry, I encountered an error. Please try again.");
  }
});

// Handle /start command
bot.start((ctx) => {
  console.log('🚀 /start command received');
  ctx.reply(
    `🤖 *AI Assistant Bot*\n\n` +
    `I'm powered by Groq's AI technology!\n\n` +
    `*Commands:*\n` +
    `/start - Show this message\n` +
    `/help - How to use the bot\n\n` +
    `Just send me any message and I'll respond!`,
    { parse_mode: 'Markdown' }
  );
});

// Handle /help command
bot.help((ctx) => {
  ctx.reply(
    `💡 *How to use:*\n\n` +
    `1. Type your question or message\n` +
    `2. I'll respond using AI\n` +
    `3. That's it!\n\n` +
    `*Examples:*\n` +
    `• What is machine learning?\n` +
    `• Write a short poem\n` +
    `• Explain quantum computing\n` +
    `• Help with homework`,
    { parse_mode: 'Markdown' }
  );
});

// Export for Vercel
export default async function handler(req, res) {
  console.log('\n=== REQUEST ===');
  console.log('Method:', req.method);
  console.log('Path:', req.url);
  console.log('Time:', new Date().toISOString());
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Health check
  if (req.method === 'GET') {
    console.log('✅ Health check');
    const hasBotToken = !!BOT_TOKEN;
    const hasGroqKey = !!GROQ_API_KEY;
    
    return res.status(200).json({
      status: 'online',
      bot: 'Telegram Groq Bot',
      timestamp: new Date().toISOString(),
      config: {
        bot_token_configured: hasBotToken,
        groq_key_configured: hasGroqKey,
        environment: process.env.NODE_ENV || 'production'
      },
      endpoint: '/api/bot.js',
      webhook_url: 'https://samaiapi.vercel.app/api/bot.js'
    });
  }
  
  // Handle Telegram webhook
  if (req.method === 'POST') {
    console.log('📦 Telegram webhook received');
    
    try {
      // Log the incoming update
      console.log('Update:', JSON.stringify(req.body, null, 2));
      
      // Process the update
      await bot.handleUpdate(req.body);
      
      console.log('✅ Webhook processed');
      return res.status(200).json({ ok: true });
      
    } catch (error) {
      console.error('❌ Webhook error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message 
      });
    }
  }
  
  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}

console.log('✅ Bot setup complete');
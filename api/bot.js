import { Telegraf } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const bot = new Telegraf(BOT_TOKEN);

// ==================== STORAGE ====================
// In production, use a database like Firebase/Redis
const userSessions = new Map(); // userId -> messages array
const userReminders = new Map(); // userId -> reminders array
const userQuizzes = new Map(); // userId -> current quiz

// ==================== CONVERSATION MEMORY ====================
function getSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, []);
  }
  return userSessions.get(userId);
}

function addToSession(userId, role, content) {
  const session = getSession(userId);
  session.push({ role, content });
  
  // Keep only last 6 messages for context
  if (session.length > 6) {
    session.shift();
  }
  
  return session;
}

function clearSession(userId) {
  userSessions.delete(userId);
  return { success: true, message: "Conversation memory cleared!" };
}

// ==================== REMINDER SYSTEM ====================
function parseReminderTime(timeStr) {
  // Parse time like: "30min", "2h", "1d", "tomorrow 9am"
  const now = new Date();
  
  if (timeStr.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const hourMatch = timeStr.match(/(\d+)(?:am|pm)/i);
    if (hourMatch) {
      let hour = parseInt(hourMatch[1]);
      if (timeStr.toLowerCase().includes('pm') && hour < 12) hour += 12;
      if (timeStr.toLowerCase().includes('am') && hour === 12) hour = 0;
      tomorrow.setHours(hour, 0, 0, 0);
    } else {
      tomorrow.setHours(9, 0, 0, 0); // Default 9 AM
    }
    return tomorrow.getTime() - now.getTime();
  }
  
  const match = timeStr.match(/(\d+)\s*(min|hour|h|d|day)/i);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    switch(unit) {
      case 'min': return value * 60 * 1000;
      case 'hour': case 'h': return value * 60 * 60 * 1000;
      case 'day': case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 30 * 60 * 1000; // Default 30 minutes
    }
  }
  
  return 30 * 60 * 1000; // Default 30 minutes
}

function addReminder(userId, time, task, chatId) {
  if (!userReminders.has(userId)) {
    userReminders.set(userId, []);
  }
  
  const reminders = userReminders.get(userId);
  const reminderId = Date.now();
  const timeout = parseReminderTime(time);
  
  const reminder = {
    id: reminderId,
    task,
    time: new Date(Date.now() + timeout),
    chatId,
    timeoutId: null
  };
  
  // Set the actual timeout
  reminder.timeoutId = setTimeout(async () => {
    try {
      await bot.telegram.sendMessage(
        chatId,
        `⏰ *REMINDER*\n\n${task}\n\n_Time: ${new Date().toLocaleTimeString()}_`,
        { parse_mode: 'Markdown' }
      );
      
      // Remove from list
      const userReminderList = userReminders.get(userId) || [];
      const index = userReminderList.findIndex(r => r.id === reminderId);
      if (index > -1) userReminderList.splice(index, 1);
      
    } catch (error) {
      console.error('Failed to send reminder:', error);
    }
  }, timeout);
  
  reminders.push(reminder);
  return reminder;
}

function listReminders(userId) {
  const reminders = userReminders.get(userId) || [];
  return reminders;
}

function cancelReminder(userId, reminderId) {
  const reminders = userReminders.get(userId) || [];
  const index = reminders.findIndex(r => r.id === reminderId);
  
  if (index > -1) {
    const reminder = reminders[index];
    clearTimeout(reminder.timeoutId);
    reminders.splice(index, 1);
    return { success: true, message: "Reminder cancelled!" };
  }
  
  return { success: false, message: "Reminder not found!" };
}

// ==================== QUIZ SYSTEM ====================
async function generateQuiz(topic, difficulty = 'medium') {
  const prompt = `Generate a quiz about "${topic}" with ${difficulty} difficulty.
  Return in this exact JSON format:
  {
    "topic": "${topic}",
    "difficulty": "${difficulty}",
    "questions": [
      {
        "question": "Question text here",
        "options": ["A", "B", "C", "D"],
        "correct": 0,
        "explanation": "Explanation here"
      }
    ]
  }
  
  Make exactly 5 questions. Each question must have 4 options.
  The "correct" field should be 0, 1, 2, or 3 (index of correct answer).
  Make it educational and fun!`;
  
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 2000
      })
    });
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error("Failed to parse quiz JSON");
    
  } catch (error) {
    console.error("Quiz generation error:", error);
    return null;
  }
}

function startQuiz(userId, quiz) {
  userQuizzes.set(userId, {
    ...quiz,
    currentQuestion: 0,
    score: 0,
    answers: [],
    startedAt: new Date()
  });
}

function answerQuestion(userId, answerIndex) {
  const quiz = userQuizzes.get(userId);
  if (!quiz) return null;
  
  const question = quiz.questions[quiz.currentQuestion];
  const isCorrect = answerIndex === question.correct;
  
  quiz.answers.push({
    questionIndex: quiz.currentQuestion,
    userAnswer: answerIndex,
    correct: isCorrect
  });
  
  if (isCorrect) quiz.score++;
  
  quiz.currentQuestion++;
  
  if (quiz.currentQuestion >= quiz.questions.length) {
    const result = {
      quiz,
      completed: true,
      total: quiz.questions.length,
      score: quiz.score,
      percentage: Math.round((quiz.score / quiz.questions.length) * 100),
      timeSpent: (new Date() - quiz.startedAt) / 1000
    };
    
    userQuizzes.delete(userId);
    return result;
  }
  
  return {
    quiz,
    completed: false,
    nextQuestion: quiz.questions[quiz.currentQuestion]
  };
}

// ==================== GROQ API FUNCTION ====================
async function getGroqResponse(userMessage, userId) {
  try {
    // Get conversation history
    const session = getSession(userId);
    const messages = [
      { 
        role: "system", 
        content: "You are a helpful AI assistant with memory. Remember the conversation history and provide contextual responses." 
      },
      ...session,
      { role: "user", content: userMessage }
    ];
    
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages,
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;
    
    // Add to conversation history
    addToSession(userId, "assistant", reply);
    
    return reply;
    
  } catch (error) {
    console.error("Groq API Error:", error.message);
    return "I'm having trouble connecting right now. Please try again!";
  }
}

// ==================== BOT COMMANDS ====================

// Enhanced /start with features overview
bot.start((ctx) => {
  const userId = ctx.from.id;
  
  const welcomeText = `
🎉 *Welcome to AI Assistant with Memory!* 🎉

✨ *New Features Added:*
• 🤖 **Conversation Memory** - I remember our chat
• ⏰ **Reminder System** - Set reminders with /remind
• 📚 **Quiz Generator** - Test your knowledge with /quiz
• 💭 **Context-aware** - Better, personalized responses

📋 *Available Commands:*
/start - Welcome message
/help - How to use all features
/memory - Manage conversation memory
/remind - Set a reminder
/quiz - Start a quiz
/listreminders - View your reminders
/cancelreminder - Cancel a reminder
/about - About this bot

💡 *Just chat normally for AI conversations!*
  `;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// Help command
bot.help((ctx) => {
  const helpText = `
💡 *Complete Feature Guide*

🤖 *Conversation Memory:*
• I remember last 6 messages in our chat
• Use /memory clear to reset memory
• Memory lasts until you clear it or restart

⏰ *Reminder System:*
• /remind 30min Buy milk
• /remind 2h Call John
• /remind tomorrow 9am Meeting
• /listreminders - View all
• /cancelreminder [ID] - Cancel

📚 *Quiz System:*
• /quiz science - Quiz about science
• /quiz history easy - Easy history quiz
• /quiz math hard - Hard math quiz
• Answer with A, B, C, or D
• Get score at the end!

💭 *Normal Chat:*
Just send any message for AI responses with memory!

❓ *Examples:*
"Explain quantum physics"
"Help me plan my day"
"What's the capital of France?"
  `;
  
  ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Memory management
bot.command('memory', (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  if (args[1] === 'clear') {
    const result = clearSession(userId);
    ctx.reply(result.message);
  } else {
    const session = getSession(userId);
    const messageCount = session.filter(msg => msg.role === 'user').length;
    
    ctx.reply(
      `🧠 *Conversation Memory*\n\n` +
      `• Messages remembered: ${messageCount}/6\n` +
      `• Memory status: ${messageCount > 0 ? '✅ Active' : '🔄 Empty'}\n` +
      `• Last message: ${session.length > 0 ? session[session.length-1].content.substring(0, 50) + '...' : 'None'}\n\n` +
      `Use /memory clear to reset memory`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Reminder command
bot.command('remind', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  if (args.length < 3) {
    return ctx.reply(
      `⏰ *Reminder Usage:*\n\n` +
      `/remind [time] [task]\n\n` +
      `*Examples:*\n` +
      `/remind 30min Buy milk\n` +
      `/remind 2h Call John\n` +
      `/remind tomorrow 9am Meeting\n` +
      `/remind 1d Pay bills`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const time = args[1];
  const task = args.slice(2).join(' ');
  
  const reminder = addReminder(userId, time, task, ctx.chat.id);
  
  ctx.reply(
    `✅ *Reminder Set!*\n\n` +
    `⏰ *Task:* ${task}\n` +
    `🕐 *Time:* ${reminder.time.toLocaleString()}\n` +
    `📝 *ID:* ${reminder.id}\n\n` +
    `Use /listreminders to view all reminders`,
    { parse_mode: 'Markdown' }
  );
});

// List reminders
bot.command('listreminders', (ctx) => {
  const userId = ctx.from.id;
  const reminders = listReminders(userId);
  
  if (reminders.length === 0) {
    return ctx.reply("📭 You have no active reminders.");
  }
  
  let reminderList = `📋 *Your Reminders (${reminders.length})*\n\n`;
  
  reminders.forEach((reminder, index) => {
    reminderList += `${index + 1}. *ID:* ${reminder.id}\n`;
    reminderList += `   *Task:* ${reminder.task}\n`;
    reminderList += `   *Time:* ${reminder.time.toLocaleString()}\n\n`;
  });
  
  reminderList += `Use /cancelreminder [ID] to cancel any reminder.`;
  
  ctx.reply(reminderList, { parse_mode: 'Markdown' });
});

// Cancel reminder
bot.command('cancelreminder', (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply("Please provide reminder ID: /cancelreminder [ID]\nUse /listreminders to see IDs");
  }
  
  const reminderId = parseInt(args[1]);
  const result = cancelReminder(userId, reminderId);
  
  ctx.reply(result.message);
});

// Quiz command
bot.command('quiz', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    return ctx.reply(
      `📚 *Quiz Generator*\n\n` +
      `/quiz [topic] [difficulty]\n\n` +
      `*Examples:*\n` +
      `/quiz science\n` +
      `/quiz history easy\n` +
      `/quiz math hard\n` +
      `/quiz geography medium\n\n` +
      `*Difficulties:* easy, medium, hard`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const topic = args[1];
  const difficulty = args[2] || 'medium';
  
  if (!['easy', 'medium', 'hard'].includes(difficulty.toLowerCase())) {
    return ctx.reply("Please use: easy, medium, or hard");
  }
  
  ctx.reply(`🎯 Generating ${difficulty} quiz about "${topic}"...`);
  
  const quiz = await generateQuiz(topic, difficulty);
  
  if (!quiz) {
    return ctx.reply("❌ Failed to generate quiz. Please try again!");
  }
  
  startQuiz(userId, quiz);
  const firstQuestion = quiz.questions[0];
  
  const questionText = `📚 *Quiz: ${quiz.topic}* (${quiz.difficulty})\n\n` +
    `Question 1/${quiz.questions.length}:\n` +
    `*${firstQuestion.question}*\n\n` +
    `A) ${firstQuestion.options[0]}\n` +
    `B) ${firstQuestion.options[1]}\n` +
    `C) ${firstQuestion.options[2]}\n` +
    `D) ${firstQuestion.options[3]}\n\n` +
    `*Reply with A, B, C, or D*`;
  
  ctx.reply(questionText, { parse_mode: 'Markdown' });
});

// Handle quiz answers (A, B, C, D)
bot.hears(['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd'], async (ctx) => {
  const userId = ctx.from.id;
  const quiz = userQuizzes.get(userId);
  
  if (!quiz) return; // Not in a quiz
  
  const answer = ctx.message.text.toUpperCase();
  const answerIndex = answer.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
  
  const result = answerQuestion(userId, answerIndex);
  
  if (!result) return;
  
  if (result.completed) {
    // Quiz completed
    const scoreText = result.score === result.total ? "🎉 Perfect Score!" :
                     result.percentage >= 70 ? "👍 Great Job!" :
                     result.percentage >= 50 ? "✅ Good Effort!" : "💪 Keep Practicing!";
    
    const completionText = `
🏁 *Quiz Completed!*

📊 *Results:*
• Score: ${result.score}/${result.total}
• Percentage: ${result.percentage}%
• Time: ${Math.round(result.timeSpent)} seconds
• ${scoreText}

📝 *Review Answers:*
${result.quiz.questions.map((q, i) => {
  const userAnswer = result.quiz.answers[i];
  const correctLetter = String.fromCharCode(65 + q.correct);
  const userLetter = String.fromCharCode(65 + userAnswer.userAnswer);
  return `${i+1}. ${userAnswer.correct ? '✅' : '❌'} You chose ${userLetter}, correct is ${correctLetter}`;
}).join('\n')}

🧠 *Want another quiz?* Use /quiz [topic]
    `;
    
    ctx.reply(completionText, { parse_mode: 'Markdown' });
    
  } else {
    // Next question
    const question = result.nextQuestion;
    const questionNum = result.quiz.currentQuestion + 1;
    const totalQuestions = result.quiz.questions.length;
    
    const questionText = `📝 *Question ${questionNum}/${totalQuestions}*\n\n` +
      `*${question.question}*\n\n` +
      `A) ${question.options[0]}\n` +
      `B) ${question.options[1]}\n` +
      `C) ${question.options[2]}\n` +
      `D) ${question.options[3]}\n\n` +
      `*Reply with A, B, C, or D*`;
    
    ctx.reply(questionText, { parse_mode: 'Markdown' });
  }
});

// Handle normal text messages with memory
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;
  
  // Skip if it's a command (handled above)
  if (userMessage.startsWith('/')) return;
  // Skip if it's a quiz answer (A, B, C, D)
  if (/^[A-Da-d]$/.test(userMessage)) return;
  
  // Add user message to session
  addToSession(userId, "user", userMessage);
  
  // Show typing indicator
  await ctx.sendChatAction('typing');
  
  // Get AI response with memory
  const reply = await getGroqResponse(userMessage, userId);
  
  // Send response
  await ctx.reply(reply, { parse_mode: 'Markdown' });
});

// Export for Vercel
export default async function handler(req, res) {
  console.log('\n=== REQUEST ===');
  console.log('Method:', req.method);
  console.log('Path:', req.url);
  
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      bot: 'Enhanced AI Bot',
      features: ['memory', 'reminders', 'quizzes'],
      timestamp: new Date().toISOString(),
      stats: {
        active_sessions: userSessions.size,
        active_reminders: Array.from(userReminders.values()).flat().length,
        active_quizzes: userQuizzes.size
      }
    });
  }
  
  // Handle Telegram webhook
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Webhook error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}

console.log('🤖 Enhanced Bot with Memory, Reminders & Quizzes loaded!');
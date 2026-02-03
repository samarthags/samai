import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const bot = new Telegraf(BOT_TOKEN);

// ==================== STORAGE ====================
const userSessions = new Map(); // userId -> {messages: [], quiz: {}, reminders: []}
const activeQuizzes = new Map(); // userId -> quiz session
const allReminders = new Map(); // userId -> reminders array
const quizStats = new Map(); // userId -> statistics

// ==================== HELPER FUNCTIONS ====================
function getUserData(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      messages: [],
      quiz: null,
      reminders: [],
      stats: {
        totalQuizzes: 0,
        totalCorrect: 0,
        totalQuestions: 0,
        currentStreak: 0,
        bestStreak: 0
      }
    });
  }
  return userSessions.get(userId);
}

// ==================== QUIZ SYSTEM (Like QuizBot) ====================
async function generateQuiz(topic, difficulty = 'medium', questionCount = 5) {
  const difficultyPoints = {
    easy: 10,
    medium: 15,
    hard: 25
  };
  
  const prompt = `Generate a ${questionCount}-question quiz about "${topic}" with ${difficulty} difficulty.
  
  FORMAT EACH QUESTION EXACTLY LIKE THIS:
  Q[number]: [Question text]
  A) [Option 1]
  B) [Option 2]
  C) [Option 3]
  D) [Option 4]
  Correct: [A/B/C/D]
  Explanation: [Brief explanation]
  
  Example:
  Q1: What is the capital of France?
  A) London
  B) Berlin
  C) Paris
  D) Madrid
  Correct: C
  Explanation: Paris is the capital and most populous city of France.
  
  Now create ${questionCount} questions about "${topic}". Make them educational and interesting.`;
  
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
        max_tokens: 3000
      })
    });
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Parse the quiz
    const questions = [];
    const lines = content.split('\n');
    let currentQuestion = null;
    
    for (const line of lines) {
      if (line.startsWith('Q')) {
        if (currentQuestion) questions.push(currentQuestion);
        const match = line.match(/Q\d+:\s*(.+)/);
        currentQuestion = {
          question: match ? match[1] : line.substring(line.indexOf(':') + 1).trim(),
          options: [],
          correct: -1,
          explanation: '',
          points: difficultyPoints[difficulty] || 15
        };
      } else if (line.startsWith('A)')) {
        currentQuestion.options.push(line.substring(3).trim());
      } else if (line.startsWith('B)')) {
        currentQuestion.options.push(line.substring(3).trim());
      } else if (line.startsWith('C)')) {
        currentQuestion.options.push(line.substring(3).trim());
      } else if (line.startsWith('D)')) {
        currentQuestion.options.push(line.substring(3).trim());
      } else if (line.startsWith('Correct:')) {
        const correctLetter = line.substring(8).trim();
        currentQuestion.correct = correctLetter.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
      } else if (line.startsWith('Explanation:')) {
        currentQuestion.explanation = line.substring(12).trim();
      }
    }
    
    if (currentQuestion) questions.push(currentQuestion);
    
    return {
      id: Date.now(),
      topic,
      difficulty,
      questions,
      currentQuestion: 0,
      score: 0,
      answers: [],
      startTime: Date.now(),
      totalPoints: questions.length * difficultyPoints[difficulty]
    };
    
  } catch (error) {
    console.error('Quiz generation error:', error);
    return null;
  }
}

function sendQuizQuestion(ctx, quiz, userId) {
  const question = quiz.questions[quiz.currentQuestion];
  const questionNum = quiz.currentQuestion + 1;
  const totalQuestions = quiz.questions.length;
  
  const questionText = `📝 *Question ${questionNum}/${totalQuestions}*\n` +
    `Topic: ${quiz.topic} | Difficulty: ${quiz.difficulty}\n` +
    `Points: ${question.points}\n\n` +
    `*${question.question}*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(`A) ${question.options[0]}`, `quiz_${quiz.id}_0`),
      Markup.button.callback(`B) ${question.options[1]}`, `quiz_${quiz.id}_1`)
    ],
    [
      Markup.button.callback(`C) ${question.options[2]}`, `quiz_${quiz.id}_2`),
      Markup.button.callback(`D) ${question.options[3]}`, `quiz_${quiz.id}_3`)
    ],
    [
      Markup.button.callback('⏭️ Skip Question', `quiz_${quiz.id}_skip`),
      Markup.button.callback('❌ End Quiz', `quiz_${quiz.id}_end`)
    ]
  ]);
  
  if (quiz.currentQuestion === 0) {
    ctx.reply(questionText, { parse_mode: 'Markdown', ...keyboard });
  } else {
    ctx.editMessageText(questionText, { parse_mode: 'Markdown', ...keyboard });
  }
}

function endQuiz(ctx, quiz, userId) {
  const userData = getUserData(userId);
  const timeTaken = Math.floor((Date.now() - quiz.startTime) / 1000);
  const percentage = Math.round((quiz.score / quiz.questions.length) * 100);
  
  // Update stats
  userData.stats.totalQuizzes++;
  userData.stats.totalQuestions += quiz.questions.length;
  userData.stats.totalCorrect += quiz.score;
  
  if (percentage === 100) {
    userData.stats.currentStreak++;
    if (userData.stats.currentStreak > userData.stats.bestStreak) {
      userData.stats.bestStreak = userData.stats.currentStreak;
    }
  } else {
    userData.stats.currentStreak = 0;
  }
  
  // Calculate grade
  let grade = 'F';
  if (percentage >= 90) grade = 'A+';
  else if (percentage >= 80) grade = 'A';
  else if (percentage >= 70) grade = 'B';
  else if (percentage >= 60) grade = 'C';
  else if (percentage >= 50) grade = 'D';
  
  // Results message
  let resultText = `🏁 *Quiz Completed!*\n\n`;
  resultText += `📊 *Final Score:* ${quiz.score}/${quiz.questions.length} (${percentage}%)\n`;
  resultText += `⭐ *Grade:* ${grade}\n`;
  resultText += `⏱️ *Time:* ${timeTaken} seconds\n`;
  resultText += `🎯 *Topic:* ${quiz.topic}\n`;
  resultText += `📈 *Difficulty:* ${quiz.difficulty}\n\n`;
  
  // Add review of questions
  resultText += `*Question Review:*\n`;
  quiz.questions.forEach((q, index) => {
    const userAnswer = quiz.answers[index];
    const correctLetter = String.fromCharCode(65 + q.correct);
    const userLetter = userAnswer ? String.fromCharCode(65 + userAnswer) : 'Skipped';
    const correctSymbol = userAnswer === q.correct ? '✅' : '❌';
    
    resultText += `${index + 1}. ${correctSymbol} You chose ${userLetter} (${correctLetter} was correct)\n`;
  });
  
  resultText += `\n📚 *Want another quiz?* Use /quiz [topic]`;
  
  const statsKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 View My Stats', 'view_stats')],
    [Markup.button.callback('🎯 New Quiz', 'new_quiz')]
  ]);
  
  activeQuizzes.delete(userId);
  ctx.editMessageText(resultText, { 
    parse_mode: 'Markdown',
    ...statsKeyboard
  });
}

// ==================== ADVANCED REMINDER SYSTEM ====================
function parseReminderTime(timeStr) {
  const now = Date.now();
  const timeUnits = {
    'min': 60 * 1000,
    'mins': 60 * 1000,
    'h': 60 * 60 * 1000,
    'hour': 60 * 60 * 1000,
    'hours': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
    'day': 24 * 60 * 60 * 1000,
    'days': 24 * 60 * 60 * 1000,
    'week': 7 * 24 * 60 * 60 * 1000,
    'weeks': 7 * 24 * 60 * 60 * 1000,
    'month': 30 * 24 * 60 * 60 * 1000,
    'months': 30 * 24 * 60 * 60 * 1000
  };
  
  // Parse relative time
  const match = timeStr.match(/(\d+)\s*(min|mins|h|hour|hours|d|day|days|week|weeks|month|months)/i);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    return value * timeUnits[unit];
  }
  
  // Parse specific time
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const period = timeMatch[3] ? timeMatch[3].toLowerCase() : '';
    
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const targetTime = new Date();
    targetTime.setHours(hours, minutes, 0, 0);
    
    if (targetTime.getTime() < now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }
    
    return targetTime.getTime() - now;
  }
  
  // Parse date
  const dateMatch = timeStr.match(/(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{4}))?/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1;
    const year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();
    
    const targetDate = new Date(year, month, day, 9, 0, 0);
    return targetDate.getTime() - now;
  }
  
  return 30 * 60 * 1000; // Default 30 minutes
}

function addReminder(userId, time, message, chatId, repeat = false, repeatInterval = null) {
  const reminderId = Date.now();
  const delay = parseReminderTime(time);
  const triggerTime = Date.now() + delay;
  
  const reminder = {
    id: reminderId,
    userId,
    chatId,
    message,
    triggerTime: new Date(triggerTime),
    repeat,
    repeatInterval,
    active: true,
    timeoutId: null
  };
  
  // Store reminder
  const userData = getUserData(userId);
  userData.reminders.push(reminder);
  
  // Set timeout
  reminder.timeoutId = setTimeout(async () => {
    try {
      await bot.telegram.sendMessage(
        chatId,
        `⏰ *REMINDER*\n\n${message}\n\n_Time: ${new Date().toLocaleString()}_`,
        { parse_mode: 'Markdown' }
      );
      
      // Handle repeating reminder
      if (reminder.repeat && reminder.active) {
        const newDelay = parseReminderTime(reminder.repeatInterval || '1d');
        reminder.triggerTime = new Date(Date.now() + newDelay);
        reminder.timeoutId = setTimeout(() => {
          bot.telegram.sendMessage(chatId, `⏰ *REPEATING REMINDER*\n\n${message}`);
        }, newDelay);
      } else {
        // Remove if not repeating
        const userData = getUserData(userId);
        const index = userData.reminders.findIndex(r => r.id === reminderId);
        if (index > -1) userData.reminders.splice(index, 1);
      }
    } catch (error) {
      console.error('Reminder error:', error);
    }
  }, delay);
  
  return reminder;
}

// ==================== AI CHATBOT WITH MEMORY ====================
async function getAIResponse(userMessage, userId, context = []) {
  const userData = getUserData(userId);
  
  // Add to conversation history
  userData.messages.push({ role: "user", content: userMessage });
  
  // Keep only last 10 messages
  if (userData.messages.length > 10) {
    userData.messages = userData.messages.slice(-10);
  }
  
  const messages = [
    { 
      role: "system", 
      content: `You are a helpful AI assistant with conversation memory. 
      You can also create quizzes and set reminders.
      
      Available commands users can use:
      - /quiz [topic] - Create a quiz
      - /remind [time] [message] - Set reminder
      - /myreminders - View reminders
      - /mystats - View quiz stats
      
      Be friendly, helpful, and remember the conversation context.` 
    },
    ...userData.messages
  ];
  
  try {
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
    
    const data = await response.json();
    const reply = data.choices[0].message.content;
    
    // Add assistant response to history
    userData.messages.push({ role: "assistant", content: reply });
    
    return reply;
    
  } catch (error) {
    console.error('AI error:', error);
    return "I'm having trouble connecting right now. Please try again!";
  }
}

// ==================== BOT COMMANDS ====================

// Start command
bot.start((ctx) => {
  const welcomeText = `
🤖 *Welcome to Ultimate AI Bot!* 🚀

I'm your all-in-one assistant with:

🎯 *Quiz System* (Like QuizBot)
• Interactive quizzes with buttons
• Multiple difficulties
• Score tracking & statistics
• Topic-based quiz generation

⏰ *Advanced Reminders*
• One-time & repeating reminders
• Flexible time formats
• Reminder management
• Snooze functionality

💬 *AI Chatbot with Memory*
• Remembers conversation history
• Context-aware responses
• 24/7 availability
• Powered by Groq AI

📋 *Commands:*
/start - Show this message
/quiz [topic] - Create a quiz
/remind [time] [message] - Set reminder
/myreminders - View reminders
/mystats - View quiz stats
/help - Detailed help

*Try me out!* Send any message or use commands.`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// Quiz command
bot.command('quiz', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    return ctx.reply(
      `🎯 *Quiz Creator*\n\n` +
      `Usage: /quiz [topic] [difficulty]\n\n` +
      `*Examples:*\n` +
      `/quiz electricity\n` +
      `/quiz science easy\n` +
      `/quiz history hard\n` +
      `/quiz python programming medium\n\n` +
      `*Difficulties:* easy, medium, hard\n` +
      `*Default:* medium`,
      { parse_mode: 'Markdown' }
    );
  }
  
  // Check if already in a quiz
  if (activeQuizzes.has(userId)) {
    return ctx.reply('⚠️ You already have an active quiz! Finish it first.');
  }
  
  // Parse arguments
  let topic = args[0];
  let difficulty = 'medium';
  
  // Check if last arg is difficulty
  const lastArg = args[args.length - 1].toLowerCase();
  if (['easy', 'medium', 'hard'].includes(lastArg)) {
    difficulty = lastArg;
    topic = args.slice(0, -1).join(' ');
  } else {
    topic = args.join(' ');
  }
  
  ctx.reply(`🎯 *Creating ${difficulty} quiz about "${topic}"...*\n⏳ Please wait...`, { parse_mode: 'Markdown' });
  
  const quiz = await generateQuiz(topic, difficulty);
  
  if (!quiz || quiz.questions.length === 0) {
    return ctx.reply('❌ Failed to generate quiz. Please try a different topic!');
  }
  
  activeQuizzes.set(userId, quiz);
  sendQuizQuestion(ctx, quiz, userId);
});

// Handle quiz answers
bot.action(/quiz_(\d+)_/, async (ctx) => {
  const userId = ctx.from.id;
  const [_, quizId, action] = ctx.callbackQuery.data.match(/quiz_(\d+)_(\d+|skip|end)/);
  const quiz = activeQuizzes.get(userId);
  
  if (!quiz || quiz.id.toString() !== quizId) {
    return ctx.answerCbQuery('This quiz is no longer active!');
  }
  
  if (action === 'skip') {
    quiz.answers.push(null);
    quiz.currentQuestion++;
  } else if (action === 'end') {
    return endQuiz(ctx, quiz, userId);
  } else {
    const answerIndex = parseInt(action);
    const isCorrect = answerIndex === quiz.questions[quiz.currentQuestion].correct;
    
    if (isCorrect) {
      quiz.score += quiz.questions[quiz.currentQuestion].points;
    }
    
    quiz.answers.push(answerIndex);
    quiz.currentQuestion++;
    
    // Show feedback
    const correctLetter = String.fromCharCode(65 + quiz.questions[quiz.currentQuestion - 1].correct);
    const userLetter = String.fromCharCode(65 + answerIndex);
    
    ctx.answerCbQuery(
      isCorrect ? 
      `✅ Correct! +${quiz.questions[quiz.currentQuestion - 1].points} points` : 
      `❌ Wrong! Correct answer was ${correctLetter}`
    );
  }
  
  // Check if quiz is complete
  if (quiz.currentQuestion >= quiz.questions.length) {
    endQuiz(ctx, quiz, userId);
  } else {
    // Send next question
    sendQuizQuestion(ctx, quiz, userId);
  }
});

// Stats command
bot.command('mystats', (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  const stats = userData.stats;
  
  const accuracy = stats.totalQuestions > 0 ? 
    Math.round((stats.totalCorrect / stats.totalQuestions) * 100) : 0;
  
  const statsText = `
📊 *Your Quiz Statistics*

🎯 *Performance:*
• Total Quizzes: ${stats.totalQuizzes}
• Questions Answered: ${stats.totalQuestions}
• Correct Answers: ${stats.totalCorrect}
• Accuracy: ${accuracy}%
• Current Streak: ${stats.currentStreak}
• Best Streak: ${stats.bestStreak}

🏆 *Achievements:*
${stats.totalQuizzes >= 10 ? '🎖️ Quiz Master (10+ quizzes)' : '🔒 Complete 10 quizzes'}
${stats.bestStreak >= 5 ? '🔥 Hot Streak (5 in a row)' : '🔒 Get 5 correct in a row'}
${accuracy >= 90 ? '⭐ Straight A Student (90%+)' : '🔒 Reach 90% accuracy'}

📈 *Keep learning and improving!*`;
  
  ctx.reply(statsText, { parse_mode: 'Markdown' });
});

// Advanced Reminder command
bot.command('remind', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 2) {
    return ctx.reply(
      `⏰ *Advanced Reminder System*\n\n` +
      `Usage: /remind [time] [message]\n\n` +
      `*Time Formats:*\n` +
      `• 30min - In 30 minutes\n` +
      `• 2h - In 2 hours\n` +
      `• 1d - In 1 day\n` +
      `• 14:30 - At 2:30 PM today/tomorrow\n` +
      `• tomorrow 9am - Tomorrow at 9 AM\n` +
      `• 15/12 - 15th December this year\n\n` +
      `*Advanced Features:*\n` +
      `/remind 1d "Workout" repeat - Repeats daily\n` +
      `/remind 1h "Drink water" repeat 2h - Repeats every 2 hours\n\n` +
      `*Examples:*\n` +
      `/remind 45min Take medicine\n` +
      `/remind tomorrow 8am Morning meeting\n` +
      `/remind 1d "Call mom" repeat`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const time = args[0];
  const hasRepeat = args.includes('repeat');
  let repeatIndex = args.indexOf('repeat');
  if (repeatIndex === -1) repeatIndex = args.length;
  
  const message = args.slice(1, repeatIndex).join(' ');
  const repeatInterval = hasRepeat && args[repeatIndex + 1] ? args[repeatIndex + 1] : '1d';
  
  const reminder = addReminder(
    ctx.from.id,
    time,
    message,
    ctx.chat.id,
    hasRepeat,
    repeatInterval
  );
  
  const repeatText = hasRepeat ? `(Repeats every ${repeatInterval})` : '';
  
  ctx.reply(
    `✅ *Reminder Set!*\n\n` +
    `📝 *Task:* ${message}\n` +
    `⏰ *Time:* ${reminder.triggerTime.toLocaleString()}\n` +
    `🆔 *ID:* ${reminder.id}\n` +
    `${repeatText}\n\n` +
    `Use /myreminders to manage reminders.`,
    { parse_mode: 'Markdown' }
  );
});

// View reminders
bot.command('myreminders', (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  const reminders = userData.reminders;
  
  if (reminders.length === 0) {
    return ctx.reply('📭 You have no active reminders.');
  }
  
  let reminderList = `📋 *Your Reminders (${reminders.length})*\n\n`;
  
  reminders.forEach((reminder, index) => {
    const repeatText = reminder.repeat ? `🔄 Repeats every ${reminder.repeatInterval}` : '⏰ One-time';
    reminderList += `${index + 1}. *ID:* ${reminder.id}\n`;
    reminderList += `   *Task:* ${reminder.message}\n`;
    reminderList += `   *Time:* ${reminder.triggerTime.toLocaleString()}\n`;
    reminderList += `   ${repeatText}\n\n`;
  });
  
  reminderList += `*Manage Reminders:*\n`;
  reminderList += `/cancelreminder [ID] - Cancel a reminder\n`;
  reminderList += `/snooze [ID] [time] - Snooze a reminder`;
  
  ctx.reply(reminderList, { parse_mode: 'Markdown' });
});

// Cancel reminder
bot.command('cancelreminder', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    return ctx.reply('Please provide reminder ID: /cancelreminder [ID]\nUse /myreminders to see IDs');
  }
  
  const reminderId = parseInt(args[0]);
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  
  const index = userData.reminders.findIndex(r => r.id === reminderId);
  
  if (index === -1) {
    return ctx.reply('❌ Reminder not found!');
  }
  
  const reminder = userData.reminders[index];
  clearTimeout(reminder.timeoutId);
  reminder.active = false;
  userData.reminders.splice(index, 1);
  
  ctx.reply(`✅ Reminder #${reminderId} cancelled successfully!`);
});

// Help command
bot.help((ctx) => {
  const helpText = `
🆘 *Complete Help Guide*

🎯 *QUIZ COMMANDS:*
/quiz [topic] - Create interactive quiz
/quiz [topic] [easy/medium/hard] - Quiz with difficulty
/mystats - View your quiz statistics

*Quiz Features:*
• Interactive buttons (A, B, C, D)
• Points based on difficulty
• Score tracking
• Question explanations
• Skip/End options

⏰ *REMINDER COMMANDS:*
/remind [time] [message] - Set reminder
/remind [time] [message] repeat - Repeat daily
/remind [time] [message] repeat [interval] - Custom repeat
/myreminders - View all reminders
/cancelreminder [ID] - Cancel reminder

*Time Examples:*
• 30min, 2h, 1d, 1week
• 14:30, 9:00am
• tomorrow 8am
• 25/12 (25th December)

💬 *AI CHAT:*
Just send any message for intelligent conversation!
• Remembers last 10 messages
• Context-aware responses
• Can answer questions on any topic

📊 *STATISTICS:*
Track your quiz performance with /mystats

❓ *Examples:*
"Explain quantum computing"
"/quiz space exploration"
"/remind 1h Take a break"
  `;
  
  ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Handle all text messages (AI Chat)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const message = ctx.message.text;
  
  // Skip if it's a command (handled above)
  if (message.startsWith('/')) return;
  
  // Show typing indicator
  await ctx.sendChatAction('typing');
  
  // Get AI response with memory
  const response = await getAIResponse(message, userId);
  
  // Send response
  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// Handle callback queries
bot.action('view_stats', (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  const stats = userData.stats;
  
  const accuracy = stats.totalQuestions > 0 ? 
    Math.round((stats.totalCorrect / stats.totalQuestions) * 100) : 0;
  
  const statsText = `
📊 *Quick Stats*

🎯 Quizzes: ${stats.totalQuizzes}
✅ Correct: ${stats.totalCorrect}/${stats.totalQuestions}
📈 Accuracy: ${accuracy}%
🔥 Streak: ${stats.currentStreak}
🏆 Best: ${stats.bestStreak}`;
  
  ctx.editMessageText(statsText, { 
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🎯 New Quiz', 'new_quiz')],
      [Markup.button.callback('🏠 Main Menu', 'main_menu')]
    ])
  });
});

bot.action('new_quiz', (ctx) => {
  ctx.editMessageText(
    `🎯 *Create New Quiz*\n\n` +
    `Send: /quiz [topic] [difficulty]\n\n` +
    `*Examples:*\n` +
    `/quiz physics\n` +
    `/quiz chemistry easy\n` +
    `/quiz biology hard`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('main_menu', (ctx) => {
  ctx.editMessageText(
    `🏠 *Main Menu*\n\n` +
    `Choose an option:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🎯 New Quiz', 'new_quiz')],
        [Markup.button.callback('⏰ Set Reminder', 'set_reminder')],
        [Markup.button.callback('📊 My Stats', 'view_stats')],
        [Markup.button.callback('🆘 Help', 'show_help')]
      ])
    }
  );
});

bot.action('set_reminder', (ctx) => {
  ctx.editMessageText(
    `⏰ *Set Reminder*\n\n` +
    `Send: /remind [time] [message]\n\n` +
    `*Examples:*\n` +
    `/remind 30min Take medicine\n` +
    `/remind tomorrow 9am Meeting\n` +
    `/remind 1d "Call friend" repeat`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('show_help', (ctx) => {
  ctx.editMessageText(
    `🆘 *Quick Help*\n\n` +
    `*Main Commands:*\n` +
    `/quiz - Create interactive quiz\n` +
    `/remind - Set advanced reminder\n` +
    `/myreminders - View reminders\n` +
    `/mystats - View quiz stats\n` +
    `/help - Detailed help guide\n\n` +
    `*Just chat normally for AI conversation!*`,
    { parse_mode: 'Markdown' }
  );
});

// Export for Vercel
export default async function handler(req, res) {
  console.log('Request received:', req.method);
  
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      bot: 'Ultimate AI Bot',
      features: ['quiz', 'reminders', 'ai-chat'],
      stats: {
        activeUsers: userSessions.size,
        activeQuizzes: activeQuizzes.size,
        totalReminders: Array.from(userSessions.values())
          .reduce((sum, user) => sum + user.reminders.length, 0)
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

console.log('🤖 Ultimate Bot with Quiz, Reminders & AI Chat loaded!');
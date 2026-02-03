import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const bot = new Telegraf(BOT_TOKEN);

// ==================== STORAGE ====================
const userSessions = new Map();
const activeQuizzes = new Map();
const allReminders = new Map();
const quizStats = new Map();
const sharedQuizzes = new Map(); // NEW: Store shared quizzes

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
        bestStreak: 0,
        quizzesCreated: 0,
        quizzesShared: 0
      }
    });
  }
  return userSessions.get(userId);
}

// NEW: Generate unique quiz ID
function generateQuizId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// NEW: Store shared quiz
function storeSharedQuiz(quizData) {
  const quizId = generateQuizId();
  sharedQuizzes.set(quizId, {
    ...quizData,
    id: quizId,
    createdAt: Date.now(),
    plays: 0,
    shares: 0,
    players: []
  });
  return quizId;
}

// NEW: Get shared quiz
function getSharedQuiz(quizId) {
  return sharedQuizzes.get(quizId);
}

// NEW: Track quiz play
function trackQuizPlay(quizId, userId, score) {
  const quiz = sharedQuizzes.get(quizId);
  if (quiz) {
    quiz.plays++;
    quiz.players.push({
      userId,
      score,
      playedAt: Date.now()
    });
    
    // Keep only last 100 players
    if (quiz.players.length > 100) {
      quiz.players = quiz.players.slice(-100);
    }
  }
}

// ==================== QUIZ SYSTEM ====================
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
  
  Now create ${questionCount} questions about "${topic}".`;
  
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
    
    const questions = [];
    const lines = content.split('\n');
    let currentQuestion = null;
    
    for (const line of lines) {
      if (line.startsWith('Q')) {
        if (currentQuestion) questions.push(currentQuestion);
        currentQuestion = {
          question: line.substring(line.indexOf(':') + 1).trim(),
          options: [],
          correct: -1,
          explanation: '',
          points: difficultyPoints[difficulty] || 15
        };
      } else if (line.startsWith('A)')) currentQuestion.options.push(line.substring(3).trim());
      else if (line.startsWith('B)')) currentQuestion.options.push(line.substring(3).trim());
      else if (line.startsWith('C)')) currentQuestion.options.push(line.substring(3).trim());
      else if (line.startsWith('D)')) currentQuestion.options.push(line.substring(3).trim());
      else if (line.startsWith('Correct:')) {
        const correctLetter = line.substring(8).trim();
        currentQuestion.correct = correctLetter.charCodeAt(0) - 65;
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
      Markup.button.callback('⏭️ Skip', `quiz_${quiz.id}_skip`),
      Markup.button.callback('❌ End', `quiz_${quiz.id}_end`)
    ]
  ]);
  
  if (quiz.currentQuestion === 0) {
    ctx.reply(questionText, { parse_mode: 'Markdown', ...keyboard });
  } else {
    ctx.editMessageText(questionText, { parse_mode: 'Markdown', ...keyboard });
  }
}

// NEW: Enhanced endQuiz with sharing options
function endQuiz(ctx, quiz, userId, isSharedQuiz = false, sharedQuizId = null) {
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
  
  // Track shared quiz play
  if (isSharedQuiz && sharedQuizId) {
    trackQuizPlay(sharedQuizId, userId, percentage);
  }
  
  let grade = 'F';
  if (percentage >= 90) grade = 'A+';
  else if (percentage >= 80) grade = 'A';
  else if (percentage >= 70) grade = 'B';
  else if (percentage >= 60) grade = 'C';
  else if (percentage >= 50) grade = 'D';
  
  let resultText = `🏁 *Quiz Completed!*\n\n`;
  resultText += `📊 *Score:* ${quiz.score}/${quiz.questions.length} (${percentage}%)\n`;
  resultText += `⭐ *Grade:* ${grade}\n`;
  resultText += `⏱️ *Time:* ${timeTaken} seconds\n`;
  resultText += `🎯 *Topic:* ${quiz.topic}\n`;
  resultText += `📈 *Difficulty:* ${quiz.difficulty}\n\n`;
  
  // Add question review
  resultText += `*Question Review:*\n`;
  quiz.questions.forEach((q, index) => {
    const userAnswer = quiz.answers[index];
    const correctLetter = String.fromCharCode(65 + q.correct);
    const userLetter = userAnswer ? String.fromCharCode(65 + userAnswer) : 'Skipped';
    const correctSymbol = userAnswer === q.correct ? '✅' : '❌';
    
    resultText += `${index + 1}. ${correctSymbol} You chose ${userLetter} (Correct: ${correctLetter})\n`;
  });
  
  // Store for sharing if not already shared
  let shareQuizId = null;
  if (!isSharedQuiz) {
    shareQuizId = storeSharedQuiz({
      ...quiz,
      creatorId: userId,
      creatorName: ctx.from.first_name
    });
    
    // Update creator stats
    userData.stats.quizzesCreated++;
  }
  
  // Create sharing keyboard
  const shareUrl = shareQuizId ? 
    `https://t.me/${ctx.botInfo.username}?start=quiz_${shareQuizId}` : 
    null;
  
  const keyboardButtons = [];
  
  if (shareQuizId) {
    keyboardButtons.push([
      Markup.button.callback('📤 Share Quiz', `share_${shareQuizId}`),
      Markup.button.callback('👥 See Shares', `shares_${shareQuizId}`)
    ]);
  }
  
  keyboardButtons.push(
    [Markup.button.callback('🎯 New Quiz', 'new_quiz')],
    [Markup.button.callback('📊 My Stats', 'view_stats')]
  );
  
  const keyboard = Markup.inlineKeyboard(keyboardButtons);
  
  // Add sharing info to message
  if (shareQuizId) {
    resultText += `\n✨ *Quiz Shared Successfully!*\n`;
    resultText += `🔗 *Share Code:* ${shareQuizId}\n`;
    resultText += `👥 *Share with friends to challenge them!*`;
  } else if (isSharedQuiz) {
    const sharedQuiz = getSharedQuiz(sharedQuizId);
    if (sharedQuiz) {
      resultText += `\n👑 *Shared Quiz Stats:*\n`;
      resultText += `🎮 Total Plays: ${sharedQuiz.plays}\n`;
      resultText += `📤 Shared: ${sharedQuiz.shares} times\n`;
      
      // Compare with creator's score
      const creatorScore = sharedQuiz.players.find(p => p.userId === sharedQuiz.creatorId);
      if (creatorScore) {
        resultText += `🏆 Creator's Score: ${creatorScore.score}%\n`;
        if (percentage > creatorScore.score) {
          resultText += `🎉 *You beat the creator!*\n`;
        } else if (percentage === creatorScore.score) {
          resultText += `🤝 *You tied with the creator!*\n`;
        }
      }
    }
  }
  
  activeQuizzes.delete(userId);
  ctx.editMessageText(resultText, { 
    parse_mode: 'Markdown',
    ...keyboard
  });
  
  // Return share URL for additional sharing options
  return shareUrl;
}

// ==================== REMINDER SYSTEM ====================
function parseReminderTime(timeStr) {
  const now = Date.now();
  const timeUnits = {
    'min': 60 * 1000, 'mins': 60 * 1000,
    'h': 60 * 60 * 1000, 'hour': 60 * 60 * 1000, 'hours': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000, 'day': 24 * 60 * 60 * 1000, 'days': 24 * 60 * 60 * 1000
  };
  
  const match = timeStr.match(/(\d+)\s*(min|mins|h|hour|hours|d|day|days)/i);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    return value * timeUnits[unit];
  }
  
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const period = timeMatch[3] ? timeMatch[3].toLowerCase() : '';
    
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const targetTime = new Date();
    targetTime.setHours(hours, minutes, 0, 0);
    if (targetTime.getTime() < now) targetTime.setDate(targetTime.getDate() + 1);
    
    return targetTime.getTime() - now;
  }
  
  return 30 * 60 * 1000;
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
  
  const userData = getUserData(userId);
  userData.reminders.push(reminder);
  
  reminder.timeoutId = setTimeout(async () => {
    try {
      await bot.telegram.sendMessage(
        chatId,
        `⏰ *REMINDER*\n\n${message}\n\n_Time: ${new Date().toLocaleString()}_`,
        { parse_mode: 'Markdown' }
      );
      
      if (reminder.repeat && reminder.active) {
        const newDelay = parseReminderTime(reminder.repeatInterval || '1d');
        reminder.triggerTime = new Date(Date.now() + newDelay);
        reminder.timeoutId = setTimeout(() => {
          bot.telegram.sendMessage(chatId, `⏰ *REPEATING REMINDER*\n\n${message}`);
        }, newDelay);
      } else {
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

// ==================== AI CHATBOT ====================
async function getAIResponse(userMessage, userId) {
  const userData = getUserData(userId);
  
  userData.messages.push({ role: "user", content: userMessage });
  
  if (userData.messages.length > 10) {
    userData.messages = userData.messages.slice(-10);
  }
  
  const messages = [
    { 
      role: "system", 
      content: `You are a helpful AI assistant. You can create quizzes and set reminders.
      
      Available commands:
      - /quiz [topic] - Create quiz
      - /remind [time] [message] - Set reminder
      - /myreminders - View reminders
      - /mystats - View stats
      - /sharedquiz [code] - Play shared quiz
      
      You can now SHARE quizzes with friends!` 
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
    
    userData.messages.push({ role: "assistant", content: reply });
    
    return reply;
    
  } catch (error) {
    console.error('AI error:', error);
    return "I'm having trouble connecting right now. Please try again!";
  }
}

// ==================== BOT COMMANDS ====================

bot.start(async (ctx) => {
  const args = ctx.message.text.split(' ');
  
  // Check if starting with shared quiz
  if (args.length > 1 && args[1].startsWith('quiz_')) {
    const quizId = args[1].replace('quiz_', '');
    const sharedQuiz = getSharedQuiz(quizId);
    
    if (sharedQuiz) {
      // Start the shared quiz
      const userId = ctx.from.id;
      const quiz = {
        ...sharedQuiz,
        id: Date.now(),
        currentQuestion: 0,
        score: 0,
        answers: [],
        startTime: Date.now(),
        totalPoints: sharedQuiz.questions.length * (sharedQuiz.difficulty === 'easy' ? 10 : 
                      sharedQuiz.difficulty === 'hard' ? 25 : 15)
      };
      
      activeQuizzes.set(userId, quiz);
      sendQuizQuestion(ctx, quiz, userId);
      return;
    } else {
      ctx.reply('❌ This quiz link has expired or is invalid.', { parse_mode: 'Markdown' });
    }
  }
  
  // Normal start command
  const welcomeText = `
🤖 *Ultimate Quiz Bot* 🚀

✨ **NEW: Quiz Sharing System!**
• Create quizzes and share with friends
• Challenge others with your quizzes
• Track who played your quizzes
• Compare scores with friends

🎯 **Quiz Features:**
• Interactive quizzes with buttons
• Multiple difficulties
• Score tracking & statistics
• Shareable quiz links

⏰ **Reminder System:**
• Smart reminders
• Flexible time formats
• Repeating reminders

💬 **AI Chat:**
• Smart conversations
• Context memory
• Quiz recommendations

📋 **Commands:**
/quiz [topic] - Create quiz
/sharedquiz [code] - Play shared quiz
/myshares - Your shared quizzes
/remind [time] [msg] - Set reminder
/myreminders - View reminders
/mystats - View statistics
/help - Detailed help

*Try creating and sharing a quiz!*`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// NEW: Play shared quiz command
bot.command('sharedquiz', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    return ctx.reply(
      `🎮 *Play Shared Quiz*\n\n` +
      `Usage: /sharedquiz [quiz-code]\n\n` +
      `*Get quiz codes from friends who shared quizzes*\n\n` +
      `*Examples:*\n` +
      `/sharedquiz ABC123\n` +
      `/sharedquiz XYZ789\n\n` +
      `Or click shared quiz links from friends!`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const quizId = args[0].toUpperCase();
  const sharedQuiz = getSharedQuiz(quizId);
  
  if (!sharedQuiz) {
    return ctx.reply(
      `❌ *Quiz Not Found*\n\n` +
      `Quiz code "${quizId}" is invalid or expired.\n\n` +
      `Make sure:\n` +
      `• Code is correct (6 characters)\n` +
      `• Quiz hasn't expired\n` +
      `• Ask friend to reshare the quiz`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const userId = ctx.from.id;
  
  // Check if already in a quiz
  if (activeQuizzes.has(userId)) {
    return ctx.reply('⚠️ Finish your current quiz first!');
  }
  
  ctx.reply(
    `🎮 *Playing Shared Quiz*\n\n` +
    `🎯 *Topic:* ${sharedQuiz.topic}\n` +
    `📈 *Difficulty:* ${sharedQuiz.difficulty}\n` +
    `👤 *Creator:* ${sharedQuiz.creatorName}\n` +
    `🎮 *Plays:* ${sharedQuiz.plays}\n\n` +
    `*Starting quiz...*`,
    { parse_mode: 'Markdown' }
  );
  
  const quiz = {
    ...sharedQuiz,
    id: Date.now(),
    currentQuestion: 0,
    score: 0,
    answers: [],
    startTime: Date.now(),
    totalPoints: sharedQuiz.questions.length * (sharedQuiz.difficulty === 'easy' ? 10 : 
                  sharedQuiz.difficulty === 'hard' ? 25 : 15)
  };
  
  activeQuizzes.set(userId, quiz);
  sendQuizQuestion(ctx, quiz, userId);
});

// NEW: View my shared quizzes
bot.command('myshares', (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  
  // Find quizzes created by this user
  const myQuizzes = Array.from(sharedQuizzes.entries())
    .filter(([_, quiz]) => quiz.creatorId === userId)
    .sort((a, b) => b[1].createdAt - a[1].createdAt)
    .slice(0, 10);
  
  if (myQuizzes.length === 0) {
    return ctx.reply(
      `📭 *No Shared Quizzes Yet*\n\n` +
      `Create and share your first quiz!\n\n` +
      `Use: /quiz [topic]\n` +
      `Then click "Share Quiz" after completion\n\n` +
      `Share with friends and track their scores!`,
      { parse_mode: 'Markdown' }
    );
  }
  
  let sharesText = `📤 *Your Shared Quizzes (${myQuizzes.length})*\n\n`;
  
  myQuizzes.forEach(([quizId, quiz], index) => {
    const shareUrl = `https://t.me/${ctx.botInfo.username}?start=quiz_${quizId}`;
    const avgScore = quiz.players.length > 0 ? 
      Math.round(quiz.players.reduce((sum, p) => sum + p.score, 0) / quiz.players.length) : 0;
    
    sharesText += `${index + 1}. *${quiz.topic}*\n`;
    sharesText += `   🔗 *Code:* \`${quizId}\`\n`;
    sharesText += `   📊 *Plays:* ${quiz.plays}\n`;
    sharesText += `   ⭐ *Avg Score:* ${avgScore}%\n`;
    sharesText += `   📤 *Shares:* ${quiz.shares}\n`;
    sharesText += `   🕐 *Created:* ${new Date(quiz.createdAt).toLocaleDateString()}\n\n`;
  });
  
  sharesText += `*Share Links:*\n`;
  sharesText += `Send the code to friends: \`/sharedquiz CODE\`\n`;
  sharesText += `Or share the direct link!`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎯 Create New Quiz', 'new_quiz')],
    [Markup.button.callback('📊 View Stats', 'view_stats')]
  ]);
  
  ctx.reply(sharesText, { 
    parse_mode: 'Markdown',
    ...keyboard 
  });
});

// Quiz command
bot.command('quiz', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    return ctx.reply(
      `🎯 *Quiz Creator*\n\n` +
      `Create quizzes and share with friends!\n\n` +
      `Usage: /quiz [topic] [difficulty]\n\n` +
      `*Examples:*\n` +
      `/quiz electricity\n` +
      `/quiz science easy\n` +
      `/quiz history hard\n\n` +
      `*After quiz, you can:*\n` +
      `• Share with friends\n` +
      `• Track who plays it\n` +
      `• Compare scores`,
      { parse_mode: 'Markdown' }
    );
  }
  
  if (activeQuizzes.has(userId)) {
    return ctx.reply('⚠️ Finish your current quiz first!');
  }
  
  let topic = args[0];
  let difficulty = 'medium';
  
  const lastArg = args[args.length - 1].toLowerCase();
  if (['easy', 'medium', 'hard'].includes(lastArg)) {
    difficulty = lastArg;
    topic = args.slice(0, -1).join(' ');
  } else {
    topic = args.join(' ');
  }
  
  ctx.reply(`🎯 *Creating ${difficulty} quiz about "${topic}"...*`, { parse_mode: 'Markdown' });
  
  const quiz = await generateQuiz(topic, difficulty);
  
  if (!quiz || quiz.questions.length === 0) {
    return ctx.reply('❌ Failed to generate quiz. Try a different topic!');
  }
  
  activeQuizzes.set(userId, quiz);
  sendQuizQuestion(ctx, quiz, userId);
});

// Reminder commands (unchanged)
bot.command('remind', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 2) {
    return ctx.reply(
      `⏰ *Reminder System*\n\n` +
      `Usage: /remind [time] [message]\n\n` +
      `*Examples:*\n` +
      `/remind 30min Drink water\n` +
      `/remind tomorrow 9am Meeting`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const time = args[0];
  const message = args.slice(1).join(' ');
  
  const reminder = addReminder(ctx.from.id, time, message, ctx.chat.id);
  
  ctx.reply(
    `✅ *Reminder Set!*\n\n` +
    `📝 *Task:* ${message}\n` +
    `⏰ *Time:* ${reminder.triggerTime.toLocaleString()}\n` +
    `🆔 *ID:* ${reminder.id}`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('myreminders', (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  const reminders = userData.reminders;
  
  if (reminders.length === 0) {
    return ctx.reply('📭 No active reminders.');
  }
  
  let reminderList = `📋 *Your Reminders (${reminders.length})*\n\n`;
  
  reminders.forEach((reminder, index) => {
    reminderList += `${index + 1}. *ID:* ${reminder.id}\n`;
    reminderList += `   *Task:* ${reminder.message}\n`;
    reminderList += `   *Time:* ${reminder.triggerTime.toLocaleString()}\n\n`;
  });
  
  reminderList += `*Manage:* /cancelreminder [ID]`;
  
  ctx.reply(reminderList, { parse_mode: 'Markdown' });
});

bot.command('mystats', (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  const stats = userData.stats;
  
  const accuracy = stats.totalQuestions > 0 ? 
    Math.round((stats.totalCorrect / stats.totalQuestions) * 100) : 0;
  
  const statsText = `
📊 *Your Statistics*

🎯 *Quiz Performance:*
• Total Quizzes: ${stats.totalQuizzes}
• Questions: ${stats.totalQuestions}
• Correct: ${stats.totalCorrect}
• Accuracy: ${accuracy}%
• Current Streak: ${stats.currentStreak}
• Best Streak: ${stats.bestStreak}

📤 *Sharing Stats:*
• Quizzes Created: ${stats.quizzesCreated}
• Quizzes Shared: ${stats.quizzesShared}
• Total Plays: ${stats.totalQuizzesCreated || 0}

💪 *Keep creating and sharing quizzes!*`;
  
  ctx.reply(statsText, { parse_mode: 'Markdown' });
});

bot.command('help', (ctx) => {
  const helpText = `
🆘 *Complete Help Guide*

🎯 *QUIZ SYSTEM:*
/quiz [topic] - Create quiz
/sharedquiz [code] - Play friend's quiz
/myshares - View your shared quizzes

*Sharing Features:*
• After quiz, click "Share Quiz"
• Get unique quiz code
• Share code or direct link
• Track who plays your quiz
• Compare scores with friends

⏰ *REMINDERS:*
/remind [time] [message]
/myreminders - View reminders
/cancelreminder [ID] - Cancel

📊 *STATS:*
/mystats - View statistics

💬 *AI CHAT:*
Just send any message!

❓ *Examples:*
"/quiz science"
"/sharedquiz ABC123"
"/remind 1h Take break"
  `;
  
  ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// ==================== HANDLERS ====================

// Handle quiz answers
bot.action(/quiz_(\d+)_/, async (ctx) => {
  const userId = ctx.from.id;
  const [_, quizId, action] = ctx.callbackQuery.data.match(/quiz_(\d+)_(\d+|skip|end)/);
  const quiz = activeQuizzes.get(userId);
  
  if (!quiz || quiz.id.toString() !== quizId) {
    return ctx.answerCbQuery('Quiz expired!');
  }
  
  // Check if this is a shared quiz
  const isSharedQuiz = quiz.sharedQuizId !== undefined;
  
  if (action === 'skip') {
    quiz.answers.push(null);
    quiz.currentQuestion++;
  } else if (action === 'end') {
    return endQuiz(ctx, quiz, userId, isSharedQuiz, quiz.sharedQuizId);
  } else {
    const answerIndex = parseInt(action);
    const isCorrect = answerIndex === quiz.questions[quiz.currentQuestion].correct;
    
    if (isCorrect) {
      quiz.score += quiz.questions[quiz.currentQuestion].points;
    }
    
    quiz.answers.push(answerIndex);
    quiz.currentQuestion++;
    
    const correctLetter = String.fromCharCode(65 + quiz.questions[quiz.currentQuestion - 1].correct);
    const userLetter = String.fromCharCode(65 + answerIndex);
    
    ctx.answerCbQuery(
      isCorrect ? 
      `✅ Correct! +${quiz.questions[quiz.currentQuestion - 1].points} points` : 
      `❌ Wrong! Correct: ${correctLetter}`
    );
  }
  
  if (quiz.currentQuestion >= quiz.questions.length) {
    endQuiz(ctx, quiz, userId, isSharedQuiz, quiz.sharedQuizId);
  } else {
    sendQuizQuestion(ctx, quiz, userId);
  }
});

// NEW: Handle share button
bot.action(/share_/, async (ctx) => {
  const quizId = ctx.callbackQuery.data.replace('share_', '');
  const quiz = getSharedQuiz(quizId);
  
  if (!quiz) {
    return ctx.answerCbQuery('Quiz expired!');
  }
  
  const shareUrl = `https://t.me/${ctx.botInfo.username}?start=quiz_${quizId}`;
  const shareText = `🎮 *Quiz Challenge!*\n\n` +
    `I challenge you to take my quiz!\n\n` +
    `🎯 *Topic:* ${quiz.topic}\n` +
    `📈 *Difficulty:* ${quiz.difficulty}\n` +
    `👤 *Created by:* ${ctx.from.first_name}\n\n` +
    `🔗 *Play here:* ${shareUrl}\n` +
    `🔢 *Or use code:* \`${quizId}\`\n\n` +
    `Can you beat my score? 💪`;
  
  // Update shares count
  quiz.shares++;
  
  // Update user stats
  const userData = getUserData(ctx.from.id);
  userData.stats.quizzesShared++;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.url('📱 Share on Telegram', `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`🎮 Quiz Challenge! Can you beat my score?`)}`),
    ],
    [
      Markup.button.callback('📋 Copy Code', `copy_${quizId}`),
      Markup.button.callback('👥 See Players', `players_${quizId}`)
    ]
  ]);
  
  await ctx.editMessageText(
    `📤 *Quiz Shared Successfully!*\n\n` +
    `🔗 *Share Link:* ${shareUrl}\n` +
    `🔢 *Share Code:* \`${quizId}\`\n\n` +
    `*Share Options:*\n` +
    `1. Send the link to friends\n` +
    `2. Or tell them to use: /sharedquiz ${quizId}\n\n` +
    `Track who plays and compare scores!`,
    {
      parse_mode: 'Markdown',
      ...keyboard
    }
  );
});

// NEW: Handle copy code
bot.action(/copy_/, async (ctx) => {
  const quizId = ctx.callbackQuery.data.replace('copy_', '');
  await ctx.answerCbQuery(`Code copied: ${quizId}`);
});

// NEW: Handle view players
bot.action(/players_/, async (ctx) => {
  const quizId = ctx.callbackQuery.data.replace('players_', '');
  const quiz = getSharedQuiz(quizId);
  
  if (!quiz || quiz.players.length === 0) {
    return ctx.answerCbQuery('No players yet!');
  }
  
  let playersText = `👥 *Quiz Players (${quiz.players.length})*\n\n`;
  
  // Show top 10 players
  const topPlayers = [...quiz.players]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  
  topPlayers.forEach((player, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    playersText += `${medal} Score: ${player.score}%\n`;
  });
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Back', `shares_${quizId}`)]
  ]);
  
  await ctx.editMessageText(playersText, {
    parse_mode: 'Markdown',
    ...keyboard
  });
});

// Handle other inline buttons
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
🏆 Best: ${stats.bestStreak}
📤 Shared: ${stats.quizzesShared} quizzes`;
  
  ctx.editMessageText(statsText, { 
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🎯 New Quiz', 'new_quiz')],
      [Markup.button.callback('📤 My Shares', 'my_shares')]
    ])
  });
});

bot.action('new_quiz', (ctx) => {
  ctx.editMessageText(
    `🎯 *Create New Quiz*\n\n` +
    `Send: /quiz [topic] [difficulty]\n\n` +
    `*After quiz, you can share it with friends!*`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('my_shares', (ctx) => {
  ctx.editMessageText(
    `📤 *My Shared Quizzes*\n\n` +
    `Send: /myshares\n\n` +
    `View all quizzes you've created and shared with friends!`,
    { parse_mode: 'Markdown' }
  );
});

// Handle all text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const message = ctx.message.text;
  
  if (message.startsWith('/')) return;
  if (/^[A-Da-d]$/.test(message)) return;
  
  await ctx.sendChatAction('typing');
  
  const response = await getAIResponse(message, userId);
  
  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// Export for Vercel
export default async function handler(req, res) {
  console.log('Request:', req.method);
  
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      bot: 'Quiz Bot with Sharing',
      features: ['quiz-sharing', 'reminders', 'ai-chat'],
      stats: {
        users: userSessions.size,
        activeQuizzes: activeQuizzes.size,
        sharedQuizzes: sharedQuizzes.size,
        totalReminders: Array.from(userSessions.values())
          .reduce((sum, user) => sum + user.reminders.length, 0)
      }
    });
  }
  
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

console.log('🤖 Quiz Bot with Sharing System loaded!');
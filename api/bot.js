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

// ==================== WEB SEARCH SYSTEM ====================
async function webSearch(query, maxResults = 5) {
  try {
    console.log(`🔍 Web searching: "${query}"`);
    
    // Try DuckDuckGo first (free, no API key needed)
    const ddgResponse = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );
    
    if (ddgResponse.ok) {
      const ddgData = await ddgResponse.json();
      
      // Check for instant answer
      if (ddgData.AbstractText) {
        return {
          success: true,
          source: 'DuckDuckGo',
          type: 'instant_answer',
          query: query,
          data: {
            summary: ddgData.AbstractText,
            source: ddgData.AbstractSource || 'Web',
            url: ddgData.AbstractURL,
            image: ddgData.Image ? `https://duckduckgo.com${ddgData.Image}` : null,
            related: ddgData.RelatedTopics ? 
              ddgData.RelatedTopics.slice(0, 3).map(topic => ({
                text: topic.Text,
                url: topic.FirstURL
              })) : []
          }
        };
      }
      
      // Check related topics
      if (ddgData.RelatedTopics && ddgData.RelatedTopics.length > 0) {
        const results = ddgData.RelatedTopics
          .filter(topic => topic.FirstURL && topic.Text)
          .slice(0, maxResults)
          .map(topic => ({
            title: topic.Text.split(' - ')[0] || topic.Text,
            snippet: topic.Text,
            url: topic.FirstURL,
            source: 'DuckDuckGo'
          }));
        
        if (results.length > 0) {
          return {
            success: true,
            source: 'DuckDuckGo',
            type: 'web_results',
            query: query,
            data: {
              results: results,
              total: results.length
            }
          };
        }
      }
    }
    
    // Fallback: Try Wikipedia
    const wikiResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`
    );
    
    if (wikiResponse.ok) {
      const wikiData = await wikiResponse.json();
      
      if (wikiData.extract) {
        return {
          success: true,
          source: 'Wikipedia',
          type: 'summary',
          query: query,
          data: {
            summary: wikiData.extract,
            title: wikiData.title,
            url: wikiData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
            image: wikiData.thumbnail?.source,
            fullUrl: wikiData.content_urls?.desktop?.page
          }
        };
      }
    }
    
    // If nothing found
    return {
      success: false,
      message: 'No information found on the web.',
      query: query
    };
    
  } catch (error) {
    console.error('Web search error:', error);
    return {
      success: false,
      message: 'Search service is temporarily unavailable.',
      error: error.message
    };
  }
}

async function getAIResponseWithWebSearch(userMessage, userId) {
  try {
    // First try web search for factual questions
    const isQuestion = /^(who|what|when|where|why|how)\s+/i.test(userMessage) || 
                      userMessage.includes('?');
    
    if (isQuestion) {
      const searchResult = await webSearch(userMessage);
      
      if (searchResult.success) {
        let context = '';
        
        if (searchResult.type === 'instant_answer' || searchResult.type === 'summary') {
          context = `Here's information from ${searchResult.source}:\n\n${searchResult.data.summary}\n\n`;
          if (searchResult.data.url) {
            context += `Source: ${searchResult.data.url}\n\n`;
          }
        } else if (searchResult.type === 'web_results') {
          context = `Here are web search results:\n\n`;
          searchResult.data.results.forEach((result, index) => {
            context += `${index + 1}. *${result.title}*\n`;
            if (result.snippet) context += `   ${result.snippet}\n`;
            if (result.url) context += `   ${result.url}\n\n`;
          });
        }
        
        // Combine web search with AI
        const messages = [
          { 
            role: "system", 
            content: `You are a helpful AI assistant. Use the web search results below to answer accurately. 
            If the information is not in the search results, say so clearly. 
            Always cite your sources when using web information.` 
          },
          { role: "user", content: context + `Based on this information, answer: ${userMessage}` }
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
        
        if (response.ok) {
          const data = await response.json();
          const reply = data.choices[0].message.content;
          
          // Add to conversation history
          const userData = getUserData(userId);
          userData.messages.push({ role: "user", content: userMessage });
          userData.messages.push({ role: "assistant", content: reply });
          
          // Keep only last 10 messages
          if (userData.messages.length > 10) {
            userData.messages = userData.messages.slice(-10);
          }
          
          return reply;
        }
      }
    }
    
    // Fallback to normal AI response
    return await getAIResponse(userMessage, userId);
    
  } catch (error) {
    console.error('AI with web search error:', error);
    return await getAIResponse(userMessage, userId);
  }
}

// ==================== AI CHATBOT WITH MEMORY ====================
async function getAIResponse(userMessage, userId) {
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
      You can also create quizzes, set reminders, and search the web.
      
      Available commands users can use:
      - /search [query] - Search the web
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
  
  quiz.questions.forEach((q, index) => {
    const userAnswer = quiz.answers[index];
    const correctLetter = String.fromCharCode(65 + q.correct);
    const userLetter = userAnswer ? String.fromCharCode(65 + userAnswer) : 'Skipped';
    const correctSymbol = userAnswer === q.correct ? '✅' : '❌';
    resultText += `${index + 1}. ${correctSymbol} You chose ${userLetter} (Correct: ${correctLetter})\n`;
  });
  
  resultText += `\n📚 *Want another quiz?* Use /quiz [topic]`;
  
  const statsKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 View Stats', 'view_stats')],
    [Markup.button.callback('🎯 New Quiz', 'new_quiz')]
  ]);
  
  activeQuizzes.delete(userId);
  ctx.editMessageText(resultText, { 
    parse_mode: 'Markdown',
    ...statsKeyboard
  });
}

// ==================== REMINDER SYSTEM ====================
function parseReminderTime(timeStr) {
  const now = Date.now();
  const timeUnits = {
    'min': 60 * 1000, 'mins': 60 * 1000,
    'h': 60 * 60 * 1000, 'hour': 60 * 60 * 1000, 'hours': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000, 'day': 24 * 60 * 60 * 1000, 'days': 24 * 60 * 60 * 1000,
    'week': 7 * 24 * 60 * 60 * 1000, 'weeks': 7 * 24 * 60 * 60 * 1000
  };
  
  const match = timeStr.match(/(\d+)\s*(min|mins|h|hour|hours|d|day|days|week|weeks)/i);
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

// ==================== BOT COMMANDS ====================

bot.start((ctx) => {
  const welcomeText = `
🤖 *Ultimate AI Assistant Bot* 🚀

🔍 **NEW: Web Search**
• /search [query] - Search the web
• Get real-time information
• Powered by DuckDuckGo & Wikipedia

🎯 **Quiz System** (Like QuizBot)
• /quiz [topic] - Interactive quizzes
• Multiple difficulties
• Score tracking

⏰ **Advanced Reminders**
• /remind [time] [message]
• Repeating reminders
• Flexible time formats

💬 **AI Chat with Memory**
• Remembers conversation
• Context-aware responses
• Powered by Groq AI

📋 **Commands:**
/search [query] - Web search
/quiz [topic] - Create quiz
/remind [time] [msg] - Set reminder
/myreminders - View reminders
/mystats - View quiz stats
/help - Detailed help

*Just send a message to chat!*`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// ==================== SEARCH COMMAND ====================
bot.command('search', async (ctx) => {
  const query = ctx.message.text.replace('/search ', '').trim();
  
  if (!query) {
    return ctx.reply(
      `🔍 *Web Search Command*\n\n` +
      `Usage: /search [your query]\n\n` +
      `*Examples:*\n` +
      `/search who is Elon Musk\n` +
      `/search latest AI news\n` +
      `/search weather in London\n` +
      `/search python programming tutorial\n\n` +
      `I'll search the web and provide accurate information!`,
      { parse_mode: 'Markdown' }
    );
  }
  
  await ctx.sendChatAction('typing');
  
  const searchResult = await webSearch(query);
  
  if (!searchResult.success) {
    return ctx.reply(`❌ *No results found for:* "${query}"\n\nTry a different search query.`, { parse_mode: 'Markdown' });
  }
  
  let response = `🔍 *Search Results for:* "${query}"\n`;
  response += `🌐 *Source:* ${searchResult.source}\n\n`;
  
  if (searchResult.type === 'instant_answer' || searchResult.type === 'summary') {
    response += `${searchResult.data.summary}\n\n`;
    
    if (searchResult.data.url) {
      response += `📚 *Source:* ${searchResult.data.url}\n`;
    }
    
    if (searchResult.data.image) {
      try {
        await ctx.replyWithPhoto(searchResult.data.image, {
          caption: response,
          parse_mode: 'Markdown'
        });
        return;
      } catch (error) {
        // If photo fails, send as text
        response += `\n🖼️ [Image available at source]`;
      }
    }
    
    if (searchResult.data.related && searchResult.data.related.length > 0) {
      response += `\n🔗 *Related:*\n`;
      searchResult.data.related.forEach((link, index) => {
        response += `${index + 1}. ${link.text}\n`;
      });
    }
    
  } else if (searchResult.type === 'web_results') {
    searchResult.data.results.forEach((result, index) => {
      response += `${index + 1}. *${result.title}*\n`;
      if (result.snippet) response += `   ${result.snippet}\n`;
      if (result.url) response += `   ${result.url}\n\n`;
    });
    
    response += `📊 *Found ${searchResult.data.total} results*\n`;
  }
  
  response += `\n💡 *Tip:* Ask follow-up questions for more details!`;
  
  // Split long messages
  if (response.length > 4000) {
    const parts = response.match(/[\s\S]{1,4000}/g);
    for (let i = 0; i < parts.length; i++) {
      await ctx.reply(parts[i], { 
        parse_mode: 'Markdown',
        disable_web_page_preview: i > 0
      });
      if (i < parts.length - 1) await new Promise(resolve => setTimeout(resolve, 100));
    }
  } else {
    await ctx.reply(response, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
  }
});

// ==================== QUIZ COMMAND ====================
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
      `/quiz history hard\n\n` +
      `*Difficulties:* easy, medium, hard`,
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

// ==================== REMINDER COMMAND ====================
bot.command('remind', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 2) {
    return ctx.reply(
      `⏰ *Reminder System*\n\n` +
      `Usage: /remind [time] [message]\n\n` +
      `*Time Formats:*\n` +
      `• 30min - In 30 minutes\n` +
      `• 2h - In 2 hours\n` +
      `• 1d - In 1 day\n` +
      `• 14:30 - At 2:30 PM\n` +
      `• tomorrow 9am - Tomorrow at 9 AM\n\n` +
      `*Examples:*\n` +
      `/remind 45min Take medicine\n` +
      `/remind tomorrow 8am Meeting\n` +
      `/remind 1d Call mom`,
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
    `🆔 *ID:* ${reminder.id}\n\n` +
    `Use /myreminders to manage.`,
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
    const repeatText = reminder.repeat ? '🔄 Repeating' : '⏰ One-time';
    reminderList += `${index + 1}. *ID:* ${reminder.id}\n`;
    reminderList += `   *Task:* ${reminder.message}\n`;
    reminderList += `   *Time:* ${reminder.triggerTime.toLocaleString()}\n`;
    reminderList += `   ${repeatText}\n\n`;
  });
  
  reminderList += `*Manage:* /cancelreminder [ID]`;
  
  ctx.reply(reminderList, { parse_mode: 'Markdown' });
});

bot.command('cancelreminder', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    return ctx.reply('Usage: /cancelreminder [ID]\nUse /myreminders to see IDs');
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
  
  ctx.reply(`✅ Reminder #${reminderId} cancelled!`);
});

bot.command('mystats', (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  const stats = userData.stats;
  
  const accuracy = stats.totalQuestions > 0 ? 
    Math.round((stats.totalCorrect / stats.totalQuestions) * 100) : 0;
  
  const statsText = `
📊 *Your Statistics*

🎯 *Quizzes:*
• Total Quizzes: ${stats.totalQuizzes}
• Questions: ${stats.totalQuestions}
• Correct: ${stats.totalCorrect}
• Accuracy: ${accuracy}%
• Streak: ${stats.currentStreak}
• Best Streak: ${stats.bestStreak}

💪 *Keep learning!*`;
  
  ctx.reply(statsText, { parse_mode: 'Markdown' });
});

bot.command('help', (ctx) => {
  const helpText = `
🆘 *Complete Help Guide*

🔍 *WEB SEARCH:*
/search [query] - Search web
/search Elon Musk - Person info
/search weather London - Weather
/search latest news - News

🎯 *QUIZ SYSTEM:*
/quiz [topic] - Create quiz
/quiz science - Science quiz
/quiz history easy - Easy history
/quiz math hard - Hard math
/mystats - View stats

⏰ *REMINDERS:*
/remind [time] [message]
/remind 30min Drink water
/remind tomorrow 9am Meeting
/myreminders - View all
/cancelreminder [ID] - Cancel

💬 *AI CHAT:*
Just send any message!
I remember last 10 messages
Can answer any question

❓ *Examples:*
"Explain quantum physics"
"/search who invented Python"
"/quiz space exploration"
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
    
    const correctLetter = String.fromCharCode(65 + quiz.questions[quiz.currentQuestion - 1].correct);
    const userLetter = String.fromCharCode(65 + answerIndex);
    
    ctx.answerCbQuery(
      isCorrect ? 
      `✅ Correct! +${quiz.questions[quiz.currentQuestion - 1].points} points` : 
      `❌ Wrong! Correct: ${correctLetter}`
    );
  }
  
  if (quiz.currentQuestion >= quiz.questions.length) {
    endQuiz(ctx, quiz, userId);
  } else {
    sendQuizQuestion(ctx, quiz, userId);
  }
});

// Handle inline buttons
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
      [Markup.button.callback('🔍 Search', 'do_search')]
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

bot.action('do_search', (ctx) => {
  ctx.editMessageText(
    `🔍 *Web Search*\n\n` +
    `Send: /search [query]\n\n` +
    `*Examples:*\n` +
    `/search Elon Musk\n` +
    `/search latest AI news\n` +
    `/search weather in Tokyo`,
    { parse_mode: 'Markdown' }
  );
});

// Handle all text messages (AI Chat with Web Search)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const message = ctx.message.text;
  
  // Skip if it's a command
  if (message.startsWith('/')) return;
  // Skip if it's a quiz answer
  if (/^[A-Da-d]$/.test(message)) return;
  
  await ctx.sendChatAction('typing');
  
  // Get AI response with web search for questions
  const response = await getAIResponseWithWebSearch(message, userId);
  
  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// Export for Vercel
export default async function handler(req, res) {
  console.log('Request:', req.method);
  
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      bot: 'Ultimate AI Assistant',
      features: ['web-search', 'quiz', 'reminders', 'ai-chat'],
      stats: {
        users: userSessions.size,
        activeQuizzes: activeQuizzes.size,
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

console.log('🤖 Ultimate Bot with Web Search loaded!');
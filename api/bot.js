import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ==================== ADVANCED MEMORY SYSTEM ====================
class IntelligentMemory {
  constructor(userId) {
    this.userId = userId;
    this.conversation = []; // Stores all messages
    this.facts = new Map(); // Stores learned facts: key -> {fact, context, timestamp}
    this.contextLinks = new Map(); // topic -> [related topics]
    this.lastTopics = [];
    this.userProfile = {
      name: '',
      interests: [],
      preferences: {}
    };
  }

  addMessage(role, content) {
    const message = {
      role,
      content,
      timestamp: Date.now(),
      entities: this.extractEntities(content)
    };
    
    this.conversation.push(message);
    
    // Keep conversation manageable
    if (this.conversation.length > 20) {
      this.conversation = this.conversation.slice(-20);
    }
    
    // Update last topics
    this.updateTopics(content);
    
    // Extract and store facts
    this.extractFacts(content);
    
    return message;
  }

  extractEntities(text) {
    const entities = {
      people: [],
      dates: [],
      times: [],
      topics: []
    };
    
    // Extract people (simple pattern)
    const peoplePatterns = [
      /\b(mr\.|ms\.|mrs\.|dr\.)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
      /\b(narendra\s+modi|elon\s+musk|samartha\s+gs|expo\s+ai)\b/gi
    ];
    
    // Extract dates
    const datePatterns = [
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/gi,
      /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/g,
      /\b(today|tomorrow|yesterday|next week|next month)\b/gi
    ];
    
    // Extract times
    const timePatterns = [
      /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi,
      /\b(\d+)\s*(o'clock|clock)\b/gi
    ];
    
    return entities;
  }

  extractFacts(text) {
    const lowerText = text.toLowerCase();
    
    // Learn about specific entities
    if (lowerText.includes('born') || lowerText.includes('birth')) {
      const bornMatch = text.match(/born\s+(?:on\s+)?([^,.]+)/i);
      if (bornMatch) {
        const entity = this.findEntityInText(text);
        if (entity) {
          this.facts.set(`${entity}_birth`, {
            fact: `Born on ${bornMatch[1].trim()}`,
            context: text,
            timestamp: Date.now()
          });
        }
      }
    }
    
    // Learn dates
    const dateMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i);
    if (dateMatch) {
      const date = `${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}`;
      const context = text.substring(0, 100);
      this.facts.set(`date_${Date.now()}`, {
        fact: `Date mentioned: ${date}`,
        context,
        timestamp: Date.now()
      });
    }
    
    // Store important statements
    if (text.includes(' is ') || text.includes(' are ') || text.includes(' was ') || text.includes(' were ')) {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
      sentences.forEach(sentence => {
        if (sentence.length > 20 && sentence.length < 200) {
          const key = `fact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.facts.set(key, {
            fact: sentence.trim(),
            context: 'User mentioned',
            timestamp: Date.now()
          });
        }
      });
    }
  }

  findEntityInText(text) {
    const entities = ['narendra modi', 'pm of india', 'elon musk', 'samartha gs', 'expo ai'];
    for (const entity of entities) {
      if (text.toLowerCase().includes(entity)) {
        return entity.replace(/\s+/g, '_');
      }
    }
    return null;
  }

  updateTopics(text) {
    // Simple topic extraction (in reality, use NLP)
    const topics = [];
    
    if (text.toLowerCase().includes('narendra modi') || text.toLowerCase().includes('pm of india')) {
      topics.push('narendra_modi', 'india_politics', 'prime_minister');
    }
    if (text.toLowerCase().includes('born') || text.toLowerCase().includes('birth')) {
      topics.push('birth', 'biography', 'personal_life');
    }
    if (text.toLowerCase().includes('ai') || text.toLowerCase().includes('artificial intelligence')) {
      topics.push('artificial_intelligence', 'technology');
    }
    if (text.toLowerCase().includes('remind') || text.toLowerCase().includes('reminder')) {
      topics.push('reminders', 'scheduling', 'time_management');
    }
    
    this.lastTopics = [...new Set([...this.lastTopics, ...topics])].slice(-10);
    
    // Create links between topics
    topics.forEach(topic => {
      if (!this.contextLinks.has(topic)) {
        this.contextLinks.set(topic, []);
      }
      topics.forEach(otherTopic => {
        if (topic !== otherTopic && !this.contextLinks.get(topic).includes(otherTopic)) {
          this.contextLinks.get(topic).push(otherTopic);
        }
      });
    });
  }

  getRelevantContext(query) {
    const relevantFacts = [];
    const queryLower = query.toLowerCase();
    
    // Find facts related to query
    for (const [key, factObj] of this.facts.entries()) {
      if (queryLower.includes(key.replace(/_/g, ' ')) || 
          factObj.fact.toLowerCase().includes(queryLower.split(' ')[0])) {
        relevantFacts.push(factObj.fact);
      }
    }
    
    // Find related messages
    const relatedMessages = [];
    for (let i = this.conversation.length - 1; i >= Math.max(0, this.conversation.length - 10); i--) {
      const msg = this.conversation[i];
      if (msg.role === 'user') {
        // Check if message is related
        const msgLower = msg.content.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
        const matchCount = queryWords.filter(word => msgLower.includes(word)).length;
        
        if (matchCount > 0) {
          relatedMessages.push({
            question: msg.content,
            answer: i + 1 < this.conversation.length ? this.conversation[i + 1].content : 'No answer yet'
          });
        }
      }
    }
    
    // Get linked topics
    const linkedTopics = [];
    this.lastTopics.forEach(topic => {
      if (queryLower.includes(topic.replace(/_/g, ' '))) {
        const links = this.contextLinks.get(topic) || [];
        linkedTopics.push(...links);
      }
    });
    
    return {
      facts: relevantFacts.slice(0, 3),
      previousQA: relatedMessages.slice(0, 2),
      linkedTopics: [...new Set(linkedTopics)].slice(0, 5),
      lastTopics: this.lastTopics.slice(-3)
    };
  }

  getConversationHistory() {
    // Return last 6 messages for context
    return this.conversation.slice(-6).map(msg => `${msg.role}: ${msg.content}`).join('\n');
  }
}

// Memory storage
const userMemories = new Map();

function getUserMemory(userId) {
  if (!userMemories.has(userId)) {
    userMemories.set(userId, new IntelligentMemory(userId));
  }
  return userMemories.get(userId);
}

// ==================== INTELLIGENT REMINDER PARSER ====================
class SmartReminderParser {
  parse(text) {
    const lowerText = text.toLowerCase();
    
    // Remove command and common phrases
    let cleanText = text.replace(/^\/?(remind|set|create)\s+(me\s+)?/i, '');
    cleanText = cleanText.replace(/\s+for\s+/gi, ' to ');
    cleanText = cleanText.replace(/\s+at\s+/gi, ' ');
    cleanText = cleanText.replace(/\s+on\s+/gi, ' ');
    cleanText = cleanText.replace(/\s+in\s+/gi, ' ');
    cleanText = cleanText.replace(/\s+after\s+/gi, ' ');
    
    // Parse time
    const timeInfo = this.extractTime(cleanText);
    
    // Extract task
    const task = this.extractTask(cleanText, timeInfo.usedWords);
    
    // Calculate trigger time
    const triggerTime = this.calculateTriggerTime(timeInfo);
    
    return {
      task,
      triggerTime,
      rawTime: timeInfo,
      originalText: text
    };
  }

  extractTime(text) {
    const now = new Date();
    const result = {
      type: 'relative', // 'absolute' or 'relative'
      date: null,
      time: null,
      offset: 0, // in milliseconds
      usedWords: []
    };
    
    const lowerText = text.toLowerCase();
    
    // Check for absolute dates: 22/jan/2024, 22-01-2024, 22 january 2024
    const dateFormats = [
      // DD/MM/YYYY or DD-MM-YYYY
      /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/,
      // DD Month YYYY
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i,
      // Month DD YYYY
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})\b/i
    ];
    
    for (const format of dateFormats) {
      const match = lowerText.match(format);
      if (match) {
        let day, month, year;
        
        if (format === dateFormats[0]) {
          day = parseInt(match[1]);
          month = parseInt(match[2]) - 1;
          year = parseInt(match[3]);
        } else if (format === dateFormats[1]) {
          day = parseInt(match[1]);
          month = this.monthToNumber(match[2]);
          year = parseInt(match[3]);
        } else {
          month = this.monthToNumber(match[1]);
          day = parseInt(match[2]);
          year = parseInt(match[3]);
        }
        
        result.date = new Date(year, month, day);
        result.type = 'absolute';
        result.usedWords.push(match[0]);
        break;
      }
    }
    
    // Check for time: 6:00pm, 18:00, 6pm
    const timePatterns = [
      /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i,
      /\b(\d{1,2})\s*(am|pm)\b/i,
      /\b(\d{1,2})\s*o['']?clock\b/i
    ];
    
    for (const pattern of timePatterns) {
      const match = lowerText.match(pattern);
      if (match) {
        let hours = parseInt(match[1]);
        let minutes = match[2] ? parseInt(match[2]) : 0;
        
        if (match[3]) {
          const period = match[3].toLowerCase();
          if (period === 'pm' && hours < 12) hours += 12;
          if (period === 'am' && hours === 12) hours = 0;
        }
        
        result.time = { hours, minutes };
        result.usedWords.push(match[0]);
        break;
      }
    }
    
    // Check for relative time: after 5 hours, in 30 minutes, 2 days
    const relativePatterns = [
      /\bafter\s+(\d+)\s+(hour|hr|h|minute|min|m|day|d|week|w|month|mon)\w*\b/i,
      /\bin\s+(\d+)\s+(hour|hr|h|minute|min|m|day|d|week|w|month|mon)\w*\b/i,
      /\b(\d+)\s+(hour|hr|h|minute|min|m|day|d|week|w|month|mon)\w*\b(?:\s+(?:from\s+now|later))?/i
    ];
    
    for (const pattern of relativePatterns) {
      const match = lowerText.match(pattern);
      if (match && !result.usedWords.some(w => w.includes(match[0]))) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase().charAt(0);
        
        switch(unit) {
          case 'h': result.offset += value * 60 * 60 * 1000; break;
          case 'm': result.offset += value * 60 * 1000; break;
          case 'd': result.offset += value * 24 * 60 * 60 * 1000; break;
          case 'w': result.offset += value * 7 * 24 * 60 * 60 * 1000; break;
          case 'n': // month
            const tempDate = new Date(now);
            tempDate.setMonth(tempDate.getMonth() + value);
            result.offset = tempDate.getTime() - now.getTime();
            break;
        }
        
        result.usedWords.push(match[0]);
      }
    }
    
    // Check for special words: today, tomorrow, next week
    const specialWords = {
      'now': 0,
      'today': 0,
      'tomorrow': 24 * 60 * 60 * 1000,
      'day after tomorrow': 2 * 24 * 60 * 60 * 1000,
      'next week': 7 * 24 * 60 * 60 * 1000,
      'next month': 30 * 24 * 60 * 60 * 1000
    };
    
    for (const [word, offset] of Object.entries(specialWords)) {
      if (lowerText.includes(word) && !result.usedWords.some(w => w.includes(word))) {
        result.offset += offset;
        result.usedWords.push(word);
        break;
      }
    }
    
    return result;
  }

  extractTask(text, timeWords) {
    let task = text;
    
    // Remove time-related words
    timeWords.forEach(word => {
      task = task.replace(new RegExp(word, 'gi'), '');
    });
    
    // Remove common prepositions
    const toRemove = ['remind', 'me', 'to', 'for', 'about', 'regarding', 'at', 'on', 'in', 'after'];
    toRemove.forEach(word => {
      task = task.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
    });
    
    // Clean up
    task = task.replace(/\s+/g, ' ').trim();
    task = task.replace(/^[,\s:-]+|[,\s:-]+$/g, '');
    
    // If empty, use default
    if (!task) {
      task = 'Task reminder';
    }
    
    // Capitalize first letter
    task = task.charAt(0).toUpperCase() + task.slice(1);
    
    return task;
  }

  calculateTriggerTime(timeInfo) {
    const now = new Date();
    let trigger = new Date(now.getTime() + timeInfo.offset);
    
    if (timeInfo.date) {
      trigger = new Date(timeInfo.date);
      if (timeInfo.time) {
        trigger.setHours(timeInfo.time.hours, timeInfo.time.minutes, 0, 0);
      } else {
        trigger.setHours(9, 0, 0, 0); // Default to 9 AM
      }
    } else if (timeInfo.time) {
      trigger.setHours(timeInfo.time.hours, timeInfo.time.minutes, 0, 0);
      // If time is in the past today, schedule for tomorrow
      if (trigger.getTime() < now.getTime()) {
        trigger.setDate(trigger.getDate() + 1);
      }
    }
    
    // If no specific time/date but has offset, add to now
    if (!timeInfo.date && !timeInfo.time && timeInfo.offset > 0) {
      trigger = new Date(now.getTime() + timeInfo.offset);
    }
    
    return trigger;
  }

  monthToNumber(monthStr) {
    const months = {
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };
    return months[monthStr.toLowerCase().substring(0, 3)];
  }
}

// ==================== EXPO AI RESPONSE ENGINE ====================
class ExpoAI {
  constructor() {
    this.brand = "🤖 **Expo AI**";
    this.developer = "**Samartha GS**";
    this.tagline = "Intelligent Assistant with Memory";
    this.model = "GS Model v2.0";
    this.origin = "From Sagara, Karnataka";
    this.role = "Full Stack Developer & AI Engineer";
  }

  async generateResponse(query, memoryContext) {
    // Get brand info
    const brandInfo = `${this.brand}\n` +
      `🧠 *Model:* ${this.model}\n` +
      `👨‍💻 *Created by:* ${this.developer}\n` +
      `📍 ${this.origin}\n` +
      `💼 ${this.role}\n\n`;
    
    // Analyze query
    const queryType = this.analyzeQuery(query);
    
    // Prepare context
    const context = this.prepareContext(query, memoryContext);
    
    // Generate response based on query type
    let response = '';
    
    switch(queryType) {
      case 'factual':
        response = this.generateFactualResponse(query, context);
        break;
      case 'personal':
        response = this.generatePersonalResponse(query, context);
        break;
      case 'analytical':
        response = this.generateAnalyticalResponse(query, context);
        break;
      case 'conversational':
        response = this.generateConversationalResponse(query, context);
        break;
      default:
        response = this.generateGeneralResponse(query, context);
    }
    
    // Add memory context if available
    if (context.hasMemory) {
      response += `\n\n${this.getMemoryNote(context)}`;
    }
    
    // Add brand footer (only on longer responses)
    if (response.length > 150) {
      response += `\n\n${brandInfo}`;
    }
    
    return response;
  }

  analyzeQuery(query) {
    const lower = query.toLowerCase();
    
    if (lower.match(/^(who|what|when|where|why|how)\s+/)) return 'factual';
    if (lower.includes('you') || lower.includes('your')) return 'personal';
    if (lower.includes('analyze') || lower.includes('compare') || lower.includes('difference')) return 'analytical';
    if (lower.match(/\?$/)) return 'conversational';
    
    return 'general';
  }

  prepareContext(query, memoryContext) {
    const context = {
      hasMemory: false,
      facts: [],
      previousQA: [],
      linkedTopics: [],
      query: query
    };
    
    if (memoryContext) {
      context.hasMemory = true;
      context.facts = memoryContext.facts || [];
      context.previousQA = memoryContext.previousQA || [];
      context.linkedTopics = memoryContext.linkedTopics || [];
      
      // Check if we've discussed this before
      const discussedBefore = context.previousQA.length > 0;
      if (discussedBefore) {
        context.previouslyDiscussed = true;
        context.previousAnswers = context.previousQA;
      }
    }
    
    return context;
  }

  generateFactualResponse(query, context) {
    const lower = query.toLowerCase();
    
    // Handle specific known facts
    if (lower.includes('narendra modi') || lower.includes('pm of india')) {
      return this.getNarendraModiResponse(query, context);
    }
    
    if (lower.includes('samartha gs') || lower.includes('expo ai')) {
      return this.getCreatorInfo();
    }
    
    if (lower.includes('born') && context.facts.length > 0) {
      return this.getBirthInfo(query, context);
    }
    
    // Generic factual response
    const responses = [
      `Based on available information:\n\n`,
      `Here's what I can tell you about that:\n\n`,
      `Let me provide you with accurate information:\n\n`
    ];
    
    let response = responses[Math.floor(Math.random() * responses.length)];
    
    // Use memory if available
    if (context.facts.length > 0) {
      response += `• ${context.facts.join('\n• ')}\n\n`;
    } else {
      response += `I understand you're asking about "${query}". This appears to be a factual inquiry. `;
      response += `For the most accurate and up-to-date information, I'd recommend checking reliable sources. `;
      response += `As Expo AI, I focus on providing context-aware assistance based on our conversation history.\n\n`;
      
      if (context.linkedTopics.length > 0) {
        response += `*Related topics we've discussed:* ${context.linkedTopics.join(', ')}`;
      }
    }
    
    return response;
  }

  generatePersonalResponse(query, context) {
    const lower = query.toLowerCase();
    
    if (lower.includes('who are you') || lower.includes('what are you')) {
      return this.getCreatorInfo();
    }
    
    if (lower.includes('your name') || lower.includes('you called')) {
      return `I'm **Expo AI**, an intelligent assistant created by **Samartha GS**. ` +
             `I'm built on the **GS Model** and designed to understand context and remember our conversations. ` +
             `My purpose is to provide helpful, accurate, and context-aware responses! 🚀`;
    }
    
    if (lower.includes('created you') || lower.includes('made you')) {
      return `I was created by **Samartha GS**, a Full Stack Developer and AI Engineer from Sagara, Karnataka. ` +
             `He developed the **GS Model** that powers my intelligence and memory capabilities. ` +
             `The goal was to build an AI that can actually remember conversations and provide relevant context!`;
    }
    
    return `As Expo AI, I'm here to assist you with intelligent responses. ` +
           `I can remember our conversation history and provide context-aware answers. ` +
           `What would you like to know or discuss today?`;
  }

  generateConversationalResponse(query, context) {
    // Check if this relates to previous discussion
    if (context.previouslyDiscussed) {
      const lastAnswer = context.previousAnswers[0];
      return `I recall we discussed something similar earlier. ` +
             `To build on our previous conversation: ${lastAnswer.answer.substring(0, 100)}...\n\n` +
             `Regarding your current question "${query}", I'd say...\n\n` +
             `*(I'm connecting this to our earlier discussion for better context)*`;
    }
    
    const responses = [
      `That's an interesting question! Let me think about it...\n\n`,
      `I appreciate you asking that. Here's my perspective:\n\n`,
      `Great question! Based on what we've discussed:\n\n`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)] +
           `I understand you're asking about "${query}". ` +
           `This seems to relate to ${context.linkedTopics.length > 0 ? context.linkedTopics[0] : 'our conversation'}. ` +
           `Would you like me to elaborate on any specific aspect?`;
  }

  generateGeneralResponse(query, context) {
    if (context.hasMemory && context.facts.length > 0) {
      return `I remember we talked about this before. ` +
             `Based on our previous conversation: ${context.facts[0]}\n\n` +
             `Regarding "${query}", I'd suggest...`;
    }
    
    return `Thanks for sharing that. As Expo AI, I'm designed to understand context and build on our conversations. ` +
           `I notice ${context.linkedTopics.length > 0 ? `we've discussed ${context.linkedTopics.join(', ')}` : 'this is a new topic'}. ` +
           `How can I assist you further with this?`;
  }

  getNarendraModiResponse(query, context) {
    let response = `**Narendra Modi** - 14th Prime Minister of India\n\n`;
    
    response += `**Full Name:** Narendra Damodardas Modi\n`;
    response += `**Born:** September 17, 1950\n`;
    response += `**Birth Place:** Vadnagar, Gujarat, India\n`;
    response += `**Political Party:** Bharatiya Janata Party (BJP)\n`;
    response += `**In Office Since:** May 26, 2014\n`;
    response += `**Previous Role:** Chief Minister of Gujarat (2001-2014)\n\n`;
    
    // Check memory for previous mentions
    if (context.facts.some(f => f.includes('born') || f.includes('birth'))) {
      response += `*I recall we discussed his birth details earlier in our conversation.*\n\n`;
    }
    
    response += `**Key Initiatives:**\n`;
    response += `• Digital India\n`;
    response += `• Make in India\n`;
    response += `• Swachh Bharat Abhiyan\n`;
    response += `• GST Implementation\n`;
    response += `• Demonetization\n\n`;
    
    response += `As Expo AI, I can provide more specific information if you're interested in any particular aspect of his leadership or policies.`;
    
    return response;
  }

  getBirthInfo(query, context) {
    // Check if we have birth info in memory
    const birthFacts = context.facts.filter(f => 
      f.toLowerCase().includes('born') || f.toLowerCase().includes('birth')
    );
    
    if (birthFacts.length > 0) {
      return `Based on our previous conversation:\n\n` +
             `**Birth Information:**\n` +
             `${birthFacts.map(f => `• ${f}`).join('\n')}\n\n` +
             `I remember we discussed this earlier. Would you like more details about their life or career?`;
    }
    
    return `You're asking about birth information. ` +
           `I don't have specific details in our current conversation memory. ` +
           `Could you tell me who you're referring to, so I can remember it for future conversations?`;
  }

  getCreatorInfo() {
    return `🤖 **Expo AI** - Intelligent Assistant\n\n` +
           `**Created by:** Samartha GS\n` +
           `**Role:** Full Stack Developer & AI Engineer\n` +
           `**Location:** Sagara, Karnataka, India\n` +
           `**Model:** GS Model v2.0\n\n` +
           `**About the Creator:**\n` +
           `• Full Stack Developer with expertise in AI/ML\n` +
           `• Built Expo AI with advanced memory capabilities\n` +
           `• Focus on context-aware intelligent responses\n` +
           `• From the beautiful town of Sagara\n\n` +
           `**Expo AI Features:**\n` +
           `✅ Conversation Memory\n` +
           `✅ Context Understanding\n` +
           `✅ Intelligent Reminders\n` +
           `✅ Natural Language Processing\n\n` +
           `I'm designed to remember our conversations and provide relevant, helpful responses!`;
  }

  getMemoryNote(context) {
    if (!context.hasMemory) return '';
    
    const notes = [];
    
    if (context.previouslyDiscussed) {
      notes.push(`🔗 *Connected to previous discussion*`);
    }
    
    if (context.facts.length > 0) {
      notes.push(`💭 *Using remembered facts*`);
    }
    
    if (context.linkedTopics.length > 0) {
      notes.push(`🧠 *Related topics: ${context.linkedTopics.slice(0, 3).join(', ')}*`);
    }
    
    if (notes.length > 0) {
      return `\n${notes.join(' | ')}`;
    }
    
    return '';
  }
}

// ==================== REMINDER SYSTEM ====================
const reminderParser = new SmartReminderParser();
const expoAI = new ExpoAI();

function addReminder(userId, reminderData, chatId) {
  if (!allReminders.has(userId)) {
    allReminders.set(userId, []);
  }
  
  const reminders = allReminders.get(userId);
  const reminderId = Date.now();
  
  const reminder = {
    id: reminderId,
    userId,
    chatId,
    task: reminderData.task,
    triggerTime: reminderData.triggerTime,
    createdAt: new Date(),
    active: true,
    timeoutId: null
  };
  
  // Calculate delay
  const delay = reminderData.triggerTime.getTime() - Date.now();
  
  if (delay > 0) {
    reminder.timeoutId = setTimeout(async () => {
      try {
        await bot.telegram.sendMessage(
          chatId,
          `⏰ **Reminder from Expo AI**\n\n` +
          `**Task:** ${reminder.task}\n` +
          `**Set on:** ${reminder.createdAt.toLocaleString()}\n` +
          `**Time:** ${new Date().toLocaleString()}\n\n` +
          `_Remembered and delivered by Expo AI_`,
          { parse_mode: 'Markdown' }
        );
        
        // Remove completed reminder
        const userReminders = allReminders.get(userId) || [];
        const index = userReminders.findIndex(r => r.id === reminderId);
        if (index > -1) userReminders.splice(index, 1);
        
      } catch (error) {
        console.error('Reminder error:', error);
      }
    }, delay);
  }
  
  reminders.push(reminder);
  return reminder;
}

// ==================== BOT COMMANDS ====================

bot.start((ctx) => {
  const welcomeText = `🤖 **Welcome to Expo AI!** 🚀\n\n` +
    `I'm an intelligent assistant created by **Samartha GS**.\n\n` +
    `✨ **Key Features:**\n` +
    `• 🧠 **Advanced Memory** - I remember our conversations\n` +
    `• 🔗 **Context Awareness** - Connect related discussions\n` +
    `• ⏰ **Smart Reminders** - Natural language parsing\n` +
    `• 💭 **Intelligent Responses** - Tailored to you\n\n` +
    `**Created by:** Samartha GS\n` +
    `**Model:** GS Model v2.0\n` +
    `**From:** Sagara, Karnataka\n` +
    `**Role:** Full Stack Developer & AI Engineer\n\n` +
    `📋 **Commands:**\n` +
    `Just chat normally - I remember everything!\n` +
    `/remind [natural language] - Set smart reminder\n` +
    `/myreminders - View your reminders\n` +
    `/memory - View conversation memory\n` +
    `/about - About Expo AI\n\n` +
    `*Try asking about Narendra Modi, then ask when he was born!*`;
  
  ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// Intelligent Reminder Command
bot.command('remind', async (ctx) => {
  const query = ctx.message.text.replace(/^\/remind\s*/i, '').trim();
  
  if (!query) {
    return ctx.reply(
      `⏰ **Smart Reminder System**\n\n` +
      `I can understand natural language! Examples:\n\n` +
      `• \`/remind me at 6:00pm for drinking water\`\n` +
      `• \`/remind me after 5 hours for walk\`\n` +
      `• \`/remind for milk in 22/jan/2024\`\n` +
      `• \`/remind tomorrow 9am meeting with team\`\n` +
      `• \`/remind in 30 minutes to take medicine\`\n\n` +
      `Just tell me what and when in natural language!`,
      { parse_mode: 'Markdown' }
    );
  }
  
  try {
    // Parse the reminder
    const parsed = reminderParser.parse(query);
    
    if (!parsed.task || !parsed.triggerTime) {
      return ctx.reply(
        `❌ I couldn't understand that reminder format.\n\n` +
        `Try something like:\n` +
        `\`/remind tomorrow at 3pm for gym\`\n` +
        `\`/remind in 2 hours to call mom\``,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Add the reminder
    const reminder = addReminder(ctx.from.id, parsed, ctx.chat.id);
    
    const response = `✅ **Smart Reminder Created!**\n\n` +
      `**Task:** ${parsed.task}\n` +
      `**Time:** ${reminder.triggerTime.toLocaleString()}\n` +
      `**Parsed from:** "${parsed.originalText}"\n\n` +
      `**How I understood it:**\n` +
      `• Date/Time: ${parsed.rawTime.date ? parsed.rawTime.date.toDateString() : 'Not specified'}\n` +
      `• Time: ${parsed.rawTime.time ? `${parsed.rawTime.time.hours}:${parsed.rawTime.time.minutes.toString().padStart(2, '0')}` : 'Not specified'}\n` +
      `• Offset: ${parsed.rawTime.offset > 0 ? `${Math.round(parsed.rawTime.offset / (60 * 1000))} minutes from now` : 'Immediate'}\n\n` +
      `_Expo AI will remind you at the scheduled time!_`;
    
    ctx.reply(response, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Reminder parsing error:', error);
    ctx.reply(
      `❌ Error creating reminder.\n\n` +
      `Please try a simpler format:\n` +
      `\`/remind [time] [task]\`\n\n` +
      `Example: \`/remind 6pm drink water\``,
      { parse_mode: 'Markdown' }
    );
  }
});

// View reminders
bot.command('myreminders', (ctx) => {
  const userId = ctx.from.id;
  const reminders = allReminders.get(userId) || [];
  
  if (reminders.length === 0) {
    return ctx.reply(
      `📭 **No Active Reminders**\n\n` +
      `You don't have any reminders set.\n\n` +
      `Try: \`/remind [natural language reminder]\`\n` +
      `Example: \`/remind tomorrow at 9am for meeting\``,
      { parse_mode: 'Markdown' }
    );
  }
  
  let reminderList = `⏰ **Your Reminders (${reminders.length})**\n\n`;
  
  reminders.forEach((reminder, index) => {
    const timeLeft = reminder.triggerTime.getTime() - Date.now();
    const hoursLeft = Math.max(0, Math.floor(timeLeft / (60 * 60 * 1000)));
    const minutesLeft = Math.max(0, Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000)));
    
    reminderList += `${index + 1}. **${reminder.task}**\n`;
    reminderList += `   🕐 ${reminder.triggerTime.toLocaleString()}\n`;
    reminderList += `   ⏳ ${hoursLeft}h ${minutesLeft}m remaining\n`;
    reminderList += `   📅 Set: ${reminder.createdAt.toLocaleDateString()}\n\n`;
  });
  
  ctx.reply(reminderList, { parse_mode: 'Markdown' });
});

// Memory command
bot.command('memory', (ctx) => {
  const userId = ctx.from.id;
  const memory = getUserMemory(userId);
  
  const memoryInfo = `🧠 **Expo AI Memory System**\n\n` +
    `**Your Conversation Memory:**\n` +
    `• Messages stored: ${memory.conversation.length}\n` +
    `• Facts remembered: ${memory.facts.size}\n` +
    `• Topics discussed: ${memory.lastTopics.length}\n` +
    `• Context links: ${memory.contextLinks.size}\n\n` +
    `**Recent Topics:**\n` +
    `${memory.lastTopics.slice(-5).map(t => `• ${t.replace(/_/g, ' ')}`).join('\n') || 'None yet'}\n\n` +
    `**How Memory Works:**\n` +
    `I remember facts, dates, people, and topics from our conversation.\n` +
    `When you ask related questions, I connect them to previous discussions.\n` +
    `This helps me provide context-aware, intelligent responses!\n\n` +
    `*Try asking about something we've discussed before!*`;
  
  ctx.reply(memoryInfo, { parse_mode: 'Markdown' });
});

// About command
bot.command('about', (ctx) => {
  const aboutText = expoAI.getCreatorInfo();
  ctx.reply(aboutText, { parse_mode: 'Markdown' });
});

// Handle all text messages with intelligent responses
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;
  
  // Skip commands
  if (userMessage.startsWith('/')) return;
  
  // Get user's memory
  const memory = getUserMemory(userId);
  
  // Add user message to memory
  memory.addMessage('user', userMessage);
  
  // Get relevant context from memory
  const context = memory.getRelevantContext(userMessage);
  
  // Show typing indicator
  await ctx.sendChatAction('typing');
  
  // Generate intelligent response
  const response = await expoAI.generateResponse(userMessage, context);
  
  // Add AI response to memory
  memory.addMessage('assistant', response);
  
  // Send response
  await ctx.reply(response, { parse_mode: 'Markdown' });
});

// Export for Vercel
export default async function handler(req, res) {
  console.log('Request:', req.method);
  
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      ai: 'Expo AI by Samartha GS',
      model: 'GS Model v2.0',
      features: ['intelligent-memory', 'smart-reminders', 'context-aware'],
      stats: {
        activeUsers: userMemories.size,
        totalReminders: Array.from(allReminders.values()).reduce((sum, arr) => sum + arr.length, 0)
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

console.log('🤖 Expo AI by Samartha GS - Advanced Memory System loaded!');
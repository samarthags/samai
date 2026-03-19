// ===== IMPORTS ===== import { Telegraf } from "telegraf"; import mongoose from "mongoose";

// ===== ENV ===== const bot = new Telegraf(process.env.BOT_TOKEN); const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== MONGODB CONNECT ===== mongoose.connect(process.env.MONGO_URL) .then(() => console.log("MongoDB Connected")) .catch(err => console.error(err));

// ===== SCHEMAS ===== const userSchema = new mongoose.Schema({ userId: String, name: String, joinedAt: Date, premium: { type: Boolean, default: false } });

const chatSchema = new mongoose.Schema({ userId: String, history: Array });

const knowledgeSchema = new mongoose.Schema({ text: String });

const User = mongoose.model("User", userSchema); const Chat = mongoose.model("Chat", chatSchema); const Knowledge = mongoose.model("Knowledge", knowledgeSchema);

// ===== CONTENT FILTER ===== const bannedWords = ["hate", "kill", "terror", "porn"];

function isSafe(text) { const lower = text.toLowerCase(); return !bannedWords.some(word => lower.includes(word)); }

// ===== SIMPLE SEMANTIC SEARCH ===== function simpleSearch(query, knowledgeList) { return knowledgeList .map(k => ({ text: k.text, score: query.split(" ").filter(w => k.text.toLowerCase().includes(w)).length })) .sort((a, b) => b.score - a.score) .slice(0, 3) .map(k => k.text) .join("\n"); }

// ===== AI RESPONSE ===== async function getAIResponse(userId, message) { if (!isSafe(message)) { return "Your message violates content policy."; }

let chat = await Chat.findOne({ userId }); if (!chat) chat = await Chat.create({ userId, history: [] });

chat.history.push({ role: "user", content: message }); if (chat.history.length > 12) chat.history.shift();

const knowledgeData = await Knowledge.find(); const relevantKnowledge = simpleSearch(message.toLowerCase(), knowledgeData);

const systemMessage = ` You are Expo AI, a smart assistant. Use this knowledge if relevant: ${relevantKnowledge}

Be helpful and clear

Give step-by-step answers when needed

Be concise when possible `;

const res = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: Bearer ${GROQ_API_KEY}, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.1-70b-versatile", messages: [ { role: "system", content: systemMessage }, ...chat.history ], temperature: 0.7 }) });

const data = await res.json(); const reply = data.choices?.[0]?.message?.content || "Error";

chat.history.push({ role: "assistant", content: reply }); await chat.save();

return reply; }


// ===== START ===== bot.start(async (ctx) => { const userId = String(ctx.from.id); const name = ctx.from.first_name;

let user = await User.findOne({ userId }); if (!user) { await User.create({ userId, name, joinedAt: new Date() }); }

ctx.reply(Hi ${name}! Expo AI is ready. 🚀); });

// ===== RESET MEMORY ===== bot.command("reset", async (ctx) => { const userId = String(ctx.from.id); await Chat.deleteOne({ userId }); ctx.reply("Memory cleared."); });

// ===== PREMIUM ===== bot.command("premium", async (ctx) => { const userId = String(ctx.from.id); await User.updateOne({ userId }, { premium: true }); ctx.reply("You are now a premium user! 💎"); });

// ===== MESSAGE HANDLER ===== bot.on("text", async (ctx) => { const userId = String(ctx.from.id); const message = ctx.message.text;

const user = await User.findOne({ userId });

if (!user) return ctx.reply("Please restart bot with /start");

// Free vs Premium limit if (!user.premium && message.length > 300) { return ctx.reply("Upgrade to premium for long messages."); }

try { const reply = await getAIResponse(userId, message); ctx.reply(reply); } catch (err) { console.error(err); ctx.reply("Error processing request."); } });

// ===== WEBHOOK ===== export default async function handler(req, res) { if (req.method === "POST") { await bot.handleUpdate(req.body); res.status(200).send("ok"); } else { res.status(200).send("Expo AI running"); } }
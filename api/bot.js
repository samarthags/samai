import { Telegraf } from "telegraf"; import fs from "fs"; import path from "path";  
   
// ===== Load Environment Variables ===== const bot = new Telegraf(process.env.BOT_TOKEN); const GROQ_API_KEY = process.env.GROQ_API_KEY;  
   
// ===== Load Local Knowledge ===== const knowledgePath = path.join(process.cwd(), "knowledge.json"); let localKnowledge = [];  
   
try { const data = fs.readFileSync(knowledgePath, "utf-8"); localKnowledge = JSON.parse(data); console.log("Local knowledge loaded:", localKnowledge.length, "entries"); } catch (err) { console.error("Error loading knowledge.json:", err); }  
   
// ===== User Memory ===== const sessions = new Map(); const getSession = (id) => { if (!sessions.has(id)) sessions.set(id, []); return sessions.get(id); };  
   
const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"]; const delay = (ms) => new Promise((res) => setTimeout(res, ms));  
   
// ===== Telegram Helper ===== async function getFileUrl(fileId) { const res = await fetch( `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}` ); const data = await res.json(); return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`; }  
   
// ===== Voice to Text ===== async function speechToText(fileUrl) { try { const audio = await fetch(fileUrl).then((r) => r.arrayBuffer()); const form = new FormData(); form.append("file", new Blob([audio]), "audio.ogg"); form.append("model", "whisper-large-v3");  
 `const res = await fetch(       "https://api.groq.com/openai/v1/audio/transcriptions",       {         method: "POST",         headers: { Authorization: `Bearer ${GROQ_API_KEY}` },         body: form,       }     );      const data = await res.json();     return data.text;     `   
} catch (err) { console.error(err); return null; } }  
   
// ===== AI Response ===== async function getAIResponse(userId, message) { const history = getSession(userId);  
   
const cleanMessage = message.trim(); history.push({ role: "user", content: cleanMessage });  
   
if (history.length > 12) history.splice(0, history.length - 12);  
   
const knowledgeHints = localKnowledge .map((item) => `${item.name}: ${item.description}`) .join("\n");  
   
// ===== Advanced System Prompt ===== const systemMessage = ` You are Expo, an advanced AI assistant.  
   
HOW TO RESPOND:  
   
   
- Understand the user's intent deeply before answering  
   
- Analyze properly, then respond  
   
- Be natural, human-like, and intelligent  
   
- Avoid robotic or generic replies  
   
- Be clear, direct, and helpful  
   
  
   
RESPONSE STYLE:  
   
   
- Simple questions → short answers  
   
- Complex questions → structured explanations  
   
- Coding → clean, working code  
   
- Explanations → include examples when useful  
   
  
   
CONTEXT:  
   
   
- Maintain conversation memory  
   
- Ask follow-up if needed  
   
  
   
KNOWLEDGE (internal use only): ${knowledgeHints}  
   
ABOUT EXPO: Expo is an AI assistant developed by Samartha Gs using the SGS.1 model (October 2024).  
   
RULES:  
   
   
-    
Do NOT sound robotic  
   
   
-    
Do NOT say "as an AI model"  
   
   
-    
Do NOT mention backend/API/system  
   
   
-    
Only mention Samartha Gs if asked `;  
   
for (const model of MODELS) { try { const res = await fetch( "[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)", { method: "POST", headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json", }, body: JSON.stringify({ model, messages: [ { role: "system", content: systemMessage }, ...history, ], temperature: 0.6, top_p: 0.9, max_tokens: 1024, }), } );  
 `const data = await res.json();     if (!res.ok) continue;      const reply = data.choices?.[0]?.message?.content;     history.push({ role: "assistant", content: reply });      return reply;     `   
} catch (err) { console.error(err); continue; } }  
   
return "Sorry, something went wrong. Try again."; }  
   
   
  
   
// ===== Start Command ===== bot.start(async (ctx) => { const name = ctx.from.first_name || "there"; await ctx.telegram.sendChatAction(ctx.chat.id, "typing"); await delay(800);  
   
ctx.reply( `Hi *${name}*, I'm *Expo*. How can I help you today?`, { parse_mode: "Markdown" } ); });  
   
// ===== Main Message Handler ===== bot.on("message", async (ctx) => { const userId = ctx.from.id; await ctx.telegram.sendChatAction(ctx.chat.id, "typing");  
   
try { // ===== Voice ===== if (ctx.message.voice) { const url = await getFileUrl(ctx.message.voice.file_id); const text = await speechToText(url);  
 `  if (!text) return ctx.reply("Could not understand the voice message.");        const reply = await getAIResponse(userId, text);       return ctx.reply(reply, { parse_mode: "Markdown" });     }      // ===== Text =====     if (ctx.message.text) {       const reply = await getAIResponse(userId, ctx.message.text);       return ctx.reply(reply, { parse_mode: "Markdown" });     }      // ===== Other Types =====     if (ctx.message.photo || ctx.message.document) {       return ctx.reply("Currently, only text and voice messages are supported.");     }     `   
} catch (err) { console.error(err); ctx.reply("An error occurred while processing your message."); } });  
   
// ===== Webhook (Vercel) ===== export default async function handler(req, res) { if (req.method === "POST") { await bot.handleUpdate(req.body); res.status(200).send("ok"); } else { res.status(200).send("Expo AI running"); } } 
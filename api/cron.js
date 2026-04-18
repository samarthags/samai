// ═══════════════════════════════════════════════════════════════
//   📣 api/cron.js — Daily Broadcast to ALL Users
//   Triggered automatically by Vercel Cron (once per day 9 AM)
//   Also callable manually: GET /api/cron?secret=YOUR_SECRET
// ═══════════════════════════════════════════════════════════════

import { getAllUsers, sendToChat } from "./bot.js";

const BOT_NAME   = "Samartha AI";
const BOT_HANDLE = process.env.BOT_USERNAME || "samarthaai_bot";
const SECRET     = process.env.CRON_SECRET  || "samartha-secret";
const sleep      = (ms) => new Promise(r => setTimeout(r, ms));

// ── Daily broadcast messages (rotated by day of week) ──────────
const DAILY = [
  // Sunday
  `🌅 *Good morning from ${BOT_NAME}!*\n\nStart your week strong — ask me anything!\n💻 Code  •  ✍️ Write  •  🌍 Translate  •  🧮 Math\n\n_Share me with a friend_ 👉 @${BOT_HANDLE}`,
  // Monday
  `💪 *Monday motivation from ${BOT_NAME}!*\n\nI'm here to make your week easier.\nGot a task, question, or problem? Just ask! 🚀\n\n_Know someone who needs AI help?_ 👉 @${BOT_HANDLE}`,
  // Tuesday
  `🧠 *${BOT_NAME} Tip — Tuesday*\n\nDid you know you can send me a *voice message*?\nI'll transcribe it and answer — fully hands-free! 🎙️\n\n_Invite a friend_ 👉 @${BOT_HANDLE}`,
  // Wednesday
  `🌟 *Midweek check-in from ${BOT_NAME}*\n\nHalfway through the week! Need help with:\n📝 Writing or editing?\n💻 A coding problem?\n📚 Understanding a topic?\n\nJust ask! 👇\n\n_Share with someone_ 👉 @${BOT_HANDLE}`,
  // Thursday
  `🖼️ *${BOT_NAME} Thursday Tip*\n\nSend me any *image* and I'll analyze it with Sarvam AI!\nAsk questions about the image in the caption too.\n\n_Try it and share the bot_ 👉 @${BOT_HANDLE}`,
  // Friday
  `🎉 *Happy Friday from ${BOT_NAME}!*\n\nWeekend planning? I can help with:\n🗺️ Travel ideas  •  📖 Book recs  •  🍕 Recipes\n🎬 Movie suggestions  •  💡 Creative projects\n\n_Tag a friend who'd love this_ 👉 @${BOT_HANDLE}`,
  // Saturday
  `☀️ *Weekend vibes from ${BOT_NAME}!*\n\nRelax and explore — ask me anything curious today.\nScience, history, philosophy, stories... anything goes! 🌍\n\n_Share ${BOT_NAME} with someone special_ 👉 @${BOT_HANDLE}`,
];

// ── Share keyboard attached to daily broadcast ─────────────────
function shareBtn() {
  return {
    inline_keyboard: [[
      {
        text: "🔗 Share Samartha AI",
        url : `https://t.me/share/url?url=https://t.me/${BOT_HANDLE}&text=${encodeURIComponent(`🤖 Meet *${BOT_NAME}* — AI by Samartha!\nText, voice & image support!\n👉 @${BOT_HANDLE}`)}`,
      },
      { text: "💬 Chat Now", callback_data: "new_chat" },
    ]],
  };
}

// ── Main broadcast function ─────────────────────────────────────
async function runBroadcast() {
  const users = getAllUsers();
  if (!users.length) return { sent: 0, failed: 0, message: "No users registered yet" };

  const dayOfWeek = new Date().getDay(); // 0 = Sunday
  const msg = DAILY[dayOfWeek];

  let sent = 0, failed = 0;

  for (const user of users) {
    try {
      await sendToChat(user.chatId, msg, { reply_markup: shareBtn() });
      sent++;
    } catch (err) {
      console.error(`Broadcast failed for ${user.chatId}:`, err.message);
      failed++;
    }
    // Rate limit: 30 messages/sec max for Telegram broadcast
    await sleep(50);
  }

  return { sent, failed, total: users.length };
}

// ═══════════════════════════════════════════════════════════════
//  VERCEL ENTRY POINT
// ═══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Verify it's Vercel cron OR manual call with secret
  const authHeader = req.headers["authorization"];
  const querySecret = req.query?.secret;
  const isVercelCron = authHeader === `Bearer ${SECRET}`;
  const isManual = querySecret === SECRET;

  if (!isVercelCron && !isManual) {
    return res.status(401).json({ error: "Unauthorized. Pass ?secret=YOUR_CRON_SECRET" });
  }

  try {
    console.log("Starting daily broadcast...");
    const result = await runBroadcast();
    console.log("Broadcast complete:", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("Broadcast error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

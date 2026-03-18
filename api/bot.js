import { Telegraf, Markup } from "telegraf";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const bot = new Telegraf(process.env.BOT_TOKEN);

// =================== STORAGE ===================
const users = new Map(); 
// Structure: { userId: { name, joinedAt, reminders: [], tasks: [] } }

// =================== HELPERS ===================
function getUser(userId, name) {
  if (!users.has(userId)) {
    users.set(userId, { name, joinedAt: new Date(), reminders: [], tasks: [] });
  }
  return users.get(userId);
}

function parseTimeString(timeStr) {
  timeStr = timeStr.toLowerCase();
  const now = dayjs();

  // Relative time: 30min, 2h
  const relative = timeStr.match(/(\d+)\s*(s|m|h|d)/);
  if (relative) {
    const value = parseInt(relative[1]);
    const unit = relative[2];
    return now.add(value, unit).toDate();
  }

  // Absolute date & time: 10pm 22 March 2026
  const absoluteFormats = [
    "hA D MMMM YYYY",
    "HH:mm D MMMM YYYY",
    "hA D MMM YYYY",
    "HH:mm D MMM YYYY"
  ];

  for (let fmt of absoluteFormats) {
    const parsed = dayjs(timeStr, fmt, true);
    if (parsed.isValid()) return parsed.toDate();
  }

  return now.add(30, "minute").toDate(); // fallback
}

function scheduleReminder(userId, chatId, message, time) {
  const user = users.get(userId);
  const reminderId = Date.now();

  const reminder = {
    id: reminderId,
    message,
    triggerAt: time,
  };

  user.reminders.push(reminder);

  const delayMs = time.getTime() - Date.now();
  setTimeout(() => {
    bot.telegram.sendMessage(
      chatId,
      `⏰ *Reminder:* ${message}\n_Time: ${dayjs(time).format("DD MMM YYYY, h:mm A")}_`,
      { parse_mode: "Markdown" }
    );

    const index = user.reminders.findIndex((r) => r.id === reminderId);
    if (index !== -1) user.reminders.splice(index, 1);
  }, delayMs);

  return reminder;
}

async function typingDelay(text) {
  const len = text.length;
  if (len < 50) return 800;
  if (len < 150) return 1500;
  if (len < 300) return 2500;
  return 3500;
}

// =================== START ===================
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  getUser(ctx.from.id, name);

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await new Promise(r => setTimeout(r, 2000));

  ctx.reply(`Hi *${name}*. I am *Expo*. Feel free to ask anything.`, {
    parse_mode: "Markdown",
  });
});

// =================== REMINDERS ===================
bot.command("remind", (ctx) => {
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) return ctx.reply("Usage: /remind [time] [message]");

  const match = text.match(/^(.+?)\s+(.+)$/);
  if (!match) return ctx.reply("Could not parse time and message.");

  const timeStr = match[1];
  const message = match[2];

  const triggerTime = parseTimeString(timeStr);

  scheduleReminder(ctx.from.id, ctx.chat.id, message, triggerTime);

  ctx.reply(
    `✅ Reminder set!\n⏰ Time: ${dayjs(triggerTime).format(
      "DD MMM YYYY, h:mm A"
    )}\n📝 Task: ${message}`,
    { parse_mode: "Markdown" }
  );
});

bot.command("myreminders", (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user.reminders.length)
    return ctx.reply("📭 You have no active reminders.");

  let text = `📋 *Your Reminders:*\n\n`;
  user.reminders.forEach((r, idx) => {
    text += `${idx + 1}. 📝 ${r.message}\n   ⏰ ${dayjs(r.triggerAt).format(
      "DD MMM YYYY, h:mm A"
    )}\n\n`;
  });
  ctx.reply(text, { parse_mode: "Markdown" });
});

bot.command("cancelreminder", (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (!args.length) return ctx.reply("Usage: /cancelreminder [number]");

  const user = getUser(ctx.from.id);
  const index = parseInt(args[0]) - 1;

  if (index < 0 || index >= user.reminders.length)
    return ctx.reply("Invalid reminder number.");

  const removed = user.reminders.splice(index, 1)[0];
  ctx.reply(`✅ Removed reminder: ${removed.message}`);
});

// =================== TODO SYSTEM ===================
bot.command("todo_add", (ctx) => {
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) return ctx.reply("Usage: /todo_add [task description]");

  const user = getUser(ctx.from.id);
  user.tasks.push({ id: Date.now(), task: text, done: false });

  ctx.reply(`✅ Task added: ${text}`);
});

bot.command("todo_list", (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user.tasks.length) return ctx.reply("📭 No tasks yet.");

  let text = `📋 *Your To-Do List:*\n\n`;
  user.tasks.forEach((t, idx) => {
    const status = t.done ? "✅" : "❌";
    text += `${idx + 1}. ${status} ${t.task}\n`;
  });
  ctx.reply(text, { parse_mode: "Markdown" });
});

bot.command("todo_done", (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (!args.length) return ctx.reply("Usage: /todo_done [task number]");

  const user = getUser(ctx.from.id);
  const index = parseInt(args[0]) - 1;

  if (index < 0 || index >= user.tasks.length) return ctx.reply("Invalid task number.");

  user.tasks[index].done = true;
  ctx.reply(`✅ Marked done: ${user.tasks[index].task}`);
});

// =================== BROADCAST ===================
bot.command("broadcast", (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return ctx.reply("❌ Not authorized.");

  const message = ctx.message.text.split(" ").slice(1).join(" ");
  if (!message) return ctx.reply("Usage: /broadcast [message]");

  let count = 0;
  users.forEach((u, id) => {
    bot.telegram.sendMessage(id, `📢 Broadcast:\n\n${message}`);
    count++;
  });

  ctx.reply(`✅ Broadcast sent to ${count} users.`);
});

// =================== AI CHAT PLACEHOLDER ===================
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await new Promise(r => setTimeout(r, 1500));
  ctx.reply("🤖 Expo AI responding... (AI integration coming)");
});

// =================== IMAGE / FILE ===================
bot.on("message", (ctx) => {
  if (ctx.message.photo) return ctx.reply("SamServer can't analyze images yet.");
  if (ctx.message.document)
    return ctx.reply("📎 File received. Analysis coming soon.");
});

// =================== SERVER HANDLER ===================
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI Running 🚀");
  }
}
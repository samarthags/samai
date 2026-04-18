const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const URL   = process.env.VERCEL_URL;
if (!TOKEN || !URL) { console.error("Set TELEGRAM_BOT_TOKEN and VERCEL_URL first."); process.exit(1); }
const webhookUrl = `${URL}/api/bot`;
const res  = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message","callback_query"], drop_pending_updates: true }),
});
const data = await res.json();
console.log(data.ok ? `✅ Webhook set → ${webhookUrl}` : `❌ Failed: ${data.description}`);

// main.ts - A simple Telegram bot for encrypting proxy subscription URLs into Happ encrypted links (happ://crypt3/...)
// Using the official free Happ crypto API: https://crypto.happ.su/api.php
// 
// Instructions:
// 1. Create a Telegram bot with @BotFather and get your BOT_TOKEN.
// 2. Save this file as main.ts
// 3. Run: deno run --allow-net main.ts
// 4. (Optional) Set BOT_TOKEN as environment variable for security:
//    export BOT_TOKEN=your:token_here && deno run --allow-net main.ts
// 
// The bot will:
// - Respond to /start with instructions
// - Encrypt any message that contains "http://" or "https://" using the official Happ API
// - Reply with the encrypted Happ link or an error message

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "REPLACE_WITH_YOUR_BOT_TOKEN";
if (BOT_TOKEN.includes("REPLACE")) {
  console.error("Please set your BOT_TOKEN (environment variable or replace in code).");
  Deno.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const HAPP_CRYPTO_API = "https://crypto.happ.su/api.php";

async function sendMessage(chatId: number, text: string, options: any = {}) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...options,
    }),
  });
}

async function encryptUrl(url: string): Promise<string> {
  const response = await fetch(HAPP_CRYPTO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const result = await response.text();

  if (!response.ok) {
    return `❌ Encryption failed (API error ${response.status}):\n${result.trim() || "No details"}`;
  }

  const encrypted = result.trim();
  if (encrypted.startsWith("happ://")) {
    return `✅ Encrypted Happ link:\n\n<code>${encrypted}</code>`;
  } else {
    return `⚠️ API response (possibly an error):\n${encrypted}`;
  }
}

async function main() {
  let offset = 0;
  console.log("Happ Encryption Bot started...");

  while (true) {
    try {
      const res = await fetch(
        `${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`,
      );
      const data = await res.json();

      if (!data.ok) {
        console.error("Telegram API error:", data);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const update of data.result) {
        offset = update.update_id + 1;

        const message = update.message;
        if (!message || !message.text) continue;

        const chatId = message.chat.id;
        const text = message.text.trim();

        // Send "typing" action
        await fetch(`${TELEGRAM_API}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "typing" }),
        });

        if (text === "/start" || text === "/help") {
          await sendMessage(
            chatId,
            "<b>Happ Encryption Bot</b>\n\n" +
              "Send me any proxy subscription URL (must contain http:// or https://),\n" +
              "and I will encrypt it using the official Happ API into a secure <code>happ://crypt3/...</code> link.\n\n" +
              "This hides the server details and works only in the Happ app.",
          );
          continue;
        }

        // Check if it looks like a URL
        if (text.includes("http://") || text.includes("https://")) {
          const encrypted = await encryptUrl(text);
          await sendMessage(chatId, encrypted);
        } else {
          await sendMessage(
            chatId,
            "Please send a valid subscription URL containing <code>http://</code> or <code>https://</code>.\n" +
              "Use /start for more info.",
          );
        }
      }
    } catch (err) {
      console.error("Error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main();
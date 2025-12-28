// main.ts
// 🤖 Happ Encryption Bot
// 🔐 Encrypts proxy URLs/node links into secure Happ format (RSA-4096)
// 📱 Uses official public encryption API
// 👋 Greets users on /start

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HAPP_API_URL = "https://crypto.happ.su/api.php";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Helper Functions --------------------
async function sendMessage(chatId: string, text: string, parseMode = "HTML") {
  try {
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    };
    
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Failed to send message:", data);
      return null;
    }
    return data.result;
  } catch (err) {
    console.error("Failed to send message:", err);
    return null;
  }
}

async function encryptUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(HAPP_API_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ url: url.trim() }),
    });

    if (!response.ok) {
      console.error("API request failed:", response.status);
      return null;
    }

    const data = await response.json();

    // API returns { "url": "happ://crypt3/..." }
    if (data.url) {
      return data.url;
    }

    // Fallback if response is plain string
    if (typeof data === "string") {
      return data;
    }

    // If error object
    if (data.error) {
      console.error("API error:", data.error);
      return null;
    }

    return null;
  } catch (err) {
    console.error("Encryption failed:", err);
    return null;
  }
}

function isProxyLink(text: string): boolean {
  const trimmed = text.trim();
  const proxyPrefixes = [
    "http://", "https://",
    "vmess://", "vless://", "trojan://", "ss://", "shadowsocks://",
    "hysteria://", "hysteria2://", "tuic://", "warp://"
  ];
  return proxyPrefixes.some(prefix => trimmed.toLowerCase().startsWith(prefix));
}

// -------------------- Webhook Handler --------------------
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  
  try {
    const update = await req.json();
    
    const msg = update.message;
    if (!msg) return new Response("ok");
    
    const chatId = String(msg.chat.id);
    const text = msg.text?.trim() || "";
    
    if (!text) {
      return new Response("ok");
    }

    // Handle /start command
    if (text === "/start") {
      const greeting = `<b>👋 Welcome to Happ Encryption Bot!</b>\n\n` +
        `This bot encrypts your proxy links using the <b>official Happ RSA-4096 encryption</b> (crypt3).\n\n` +
        `<b>How to use:</b>\n` +
        `• Simply send me a proxy subscription URL or node link\n` +
        `  Examples:\n` +
        `  - https://example.com/subscription\n` +
        `  - vmess://...\n` +
        `  - vless://...\n\n` +
        `<b>Note:</b> Encrypted links hide server details and can only be added in the official <b>Happ Proxy Utility</b> app.`;

      await sendMessage(chatId, greeting);
      return new Response("ok");
    }

    // Check if the message looks like a proxy link
    if (isProxyLink(text)) {
      await sendMessage(chatId, "🔐 Encrypting your link...\nThis may take a few seconds.");

      const encrypted = await encryptUrl(text);

      if (encrypted) {
        const responseText = `<b>✅ Successfully Encrypted!</b>\n\n` +
          `<b>Original Link:</b>\n<pre>${text}</pre>\n\n` +
          `<b>Encrypted Happ Link:</b>\n<pre>${encrypted}</pre>\n\n` +
          `You can now share this secure link. It works only in the official Happ app.`;

        await sendMessage(chatId, responseText);
      } else {
        await sendMessage(chatId, `<b>❌ Encryption Failed</b>\n\n` +
          `The provided link could not be encrypted.\n\n` +
          `Please ensure it's a valid proxy subscription URL or node link and try again.`);
      }
    } else {
      await sendMessage(chatId, `<b>❌ Invalid Input</b>\n\n` +
        `Please send a valid proxy link starting with:\n` +
        `- https:// or http://\n` +
        `- vmess:// vless:// trojan:// ss:// etc.\n\n` +
        `Use /start for instructions.`);
    }
    
  } catch (err) {
    console.error("Error handling update:", err);
  }
  
  return new Response("ok");
});
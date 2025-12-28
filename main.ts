// main.ts
// 🤖 Happ Encryption Bot (Webhook Version)
// 🔐 Encrypts proxy URLs/node links into secure Happ format (RSA-4096 crypt3)
// 📱 Uses official public encryption API: https://crypto.happ.su/api.php
// 🚀 Webhook-based (efficient, no polling)
// 👋 Greets users on /start and supports many proxy protocols

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HAPP_API_URL = "https://crypto.happ.su/api.php";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set. Set it as an environment variable.");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Helper Functions --------------------
async function sendMessage(chatId: string, text: string, parseMode = "HTML") {
  try {
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    };
    
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Failed to send message:", data);
    }
  } catch (err) {
    console.error("Failed to send message:", err);
  }
}

async function encryptUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(HAPP_API_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: url.trim() }),
    });

    if (!response.ok) {
      console.error("API request failed:", response.status, await response.text());
      return null;
    }

    const text = await response.text();
    let encrypted: string | null = null;

    // Try to parse as JSON first (some responses are {"url": "happ://..."})
    try {
      const json = JSON.parse(text);
      if (typeof json === "object" && json !== null && json.url && typeof json.url === "string") {
        encrypted = json.url.trim();
      } else if (json.error) {
        console.error("API error:", json.error);
        return null;
      }
    } catch {
      // Not JSON – fall back to plain text response
    }

    // If not from JSON, use raw text
    if (!encrypted) {
      encrypted = text.trim();
    }

    // Validate it looks like a Happ link
    if (encrypted.startsWith("happ://")) {
      return encrypted;
    }

    console.error("Invalid response (not a Happ link):", encrypted);
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
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  
  try {
    const update = await req.json();
    
    const msg = update.message;
    if (!msg || !msg.text) {
      return new Response("ok");
    }
    
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    
    // Handle /start command
    if (text === "/start" || text === "/help") {
      const greeting = `<b>👋 Welcome to Happ Encryption Bot!</b>\n\n` +
        `This bot encrypts your proxy links using the <b>official Happ RSA-4096 encryption</b> (crypt3).\n\n` +
        `<b>How to use:</b>\n` +
        `• Send me a proxy subscription URL or single node link\n` +
        `  Supported formats:\n` +
        `  - https://... or http://...\n` +
        `  - vmess://...\n` +
        `  - vless://...\n` +
        `  - trojan://...\n` +
        `  - ss://... or shadowsocks://...\n` +
        `  - hysteria://... / hysteria2://...\n` +
        `  - tuic://... / warp://...\n\n` +
        `<b>Note:</b> Encrypted links hide server details and work <b>only in the official Happ Proxy Utility app</b>.`;

      await sendMessage(chatId, greeting);
      return new Response("ok");
    }

    // Check if it's a proxy link
    if (isProxyLink(text)) {
      await sendMessage(chatId, "🔐 Encrypting your link...\nThis may take a few seconds.");

      const encrypted = await encryptUrl(text);

      if (encrypted) {
        const responseText = `<b>✅ Successfully Encrypted!</b>\n\n` +
          `<b>Encrypted Happ Link:</b>\n<pre>${encrypted}</pre>\n\n` +
          `<i>You can now safely share this link. It only works in the official Happ app.</i>`;

        await sendMessage(chatId, responseText);
      } else {
        await sendMessage(chatId, `<b>❌ Encryption Failed</b>\n\n` +
          `The link could not be encrypted. Possible reasons:\n` +
          `• Invalid or unsupported format\n` +
          `• API temporary issue\n\n` +
          `Please check the link and try again.`);
      }
    } else {
      await sendMessage(chatId, `<b>❌ Invalid Input</b>\n\n` +
        `Please send a valid proxy link (subscription URL or node).\n\n` +
        `Supported prefixes: https://, vmess://, vless://, trojan://, ss://, etc.\n\n` +
        `Use /start for full instructions.`);
    }
    
  } catch (err) {
    console.error("Error handling update:", err);
  }
  
  return new Response("ok");
});
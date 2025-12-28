// main.ts
// 🤖 Advanced Happ Encryption Bot (Webhook Version)
// 🔐 Encrypts single or multiple proxy links into Happ crypt3 format (RSA-4096)
// 📱 Official API: https://crypto.happ.su/api.php
// ✨ Features: Multiple links, Inline mode, Copy-friendly formatting, "Encrypt More" button

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const HAPP_API_URL = "https://crypto.happ.su/api.php";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set. Set it as an environment variable.");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Helper Functions --------------------
async function sendMessage(chatId: string, text: string, extra: any = {}) {
  try {
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    };

    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("Send message failed:", await res.text());
    }
  } catch (err) {
    console.error("Send message error:", err);
  }
}

async function answerInlineQuery(inlineQueryId: string, results: any[], extra: any = {}) {
  try {
    const body: any = {
      inline_query_id: inlineQueryId,
      results: JSON.stringify(results),
      cache_time: 0,
      ...extra,
    };

    const res = await fetch(`${API}/answerInlineQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("Answer inline failed:", await res.text());
    }
  } catch (err) {
    console.error("Answer inline error:", err);
  }
}

async function encryptUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(HAPP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });

    if (!response.ok) {
      console.error("API error:", response.status, await response.text());
      return null;
    }

    const responseText = await response.text();
    let encrypted: string | null = null;

    // Try JSON response first ({"url": "happ://..."} or {"error": "..."})
    try {
      const json = JSON.parse(responseText);
      if (json.url && typeof json.url === "string") {
        encrypted = json.url.trim();
      } else if (json.error) {
        console.error("API error message:", json.error);
        return null;
      }
    } catch {
      // Not JSON
    }

    // Fallback to plain text response
    if (!encrypted && responseText.trim().startsWith("happ://")) {
      encrypted = responseText.trim();
    }

    if (encrypted && encrypted.startsWith("happ://crypt3/")) {
      return encrypted;
    }

    console.error("Unexpected API response:", responseText);
    return null;
  } catch (err) {
    console.error("Encryption exception:", err);
    return null;
  }
}

function isProxyLink(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const prefixes = [
    "http://", "https://",
    "vmess://", "vless://", "trojan://", "ss://", "shadowsocks://",
    "hysteria://", "hysteria2://", "tuic://", "warp://",
  ];
  return prefixes.some(p => trimmed.toLowerCase().startsWith(p));
}

// Common inline keyboard
const encryptMoreKeyboard = {
  inline_keyboard: [[
    { text: "🔄 Encrypt More", switch_inline_query: "" },
  ]],
};

// -------------------- Webhook Handler --------------------
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const update = await req.json();

    // Handle regular messages
    if (update.message?.text) {
      const chatId = String(update.message.chat.id);
      let text = update.message.text.trim();

      if (text === "/start" || text === "/help") {
        const greeting = `<b>👋 Welcome to Happ Encryption Bot!</b>\n\n` +
          `🔐 I encrypt proxy links using the <b>official Happ RSA-4096 (crypt3)</b> encryption.\n\n` +
          `<b>Features:</b>\n` +
          `• Send <b>one or multiple links</b> (one per line)\n` +
          `• Use me in <b>inline mode</b> (@yourbot link) for private encryption\n` +
          `• Easy copy with code blocks\n\n` +
          `<b>Supported formats:</b> https://, vmess://, vless://, trojan://, ss://, etc.\n\n` +
          `<i>Encrypted links work only in the official Happ Proxy Utility app.</i>`;

        await sendMessage(chatId, greeting);
        return new Response("ok");
      }

      // Extract potential links (split by lines)
      const lines = text.split("\n").map(l => l.trim()).filter(l => l);
      const links = lines.filter(isProxyLink);

      if (links.length === 0) {
        await sendMessage(chatId, `<b>❌ No valid proxy links found</b>\n\n` +
          `Please send links starting with https://, vmess://, vless://, etc.\n\n` +
          `Use /start for help.`);
        return new Response("ok");
      }

      await sendMessage(chatId, `🔐 Encrypting ${links.length} link${links.length > 1 ? "s" : ""}...`);

      const encryptionResults = await Promise.all(links.map(encryptUrl));
      const successful = encryptionResults
        .map((enc, i) => enc ? { orig: links[i], enc } : null)
        .filter(Boolean) as { orig: string; enc: string }[];

      const failedCount = links.length - successful.length;

      let responseText = `<b>✅ Encryption Complete!</b>\n\n`;

      if (successful.length === 0) {
        responseText = `<b>❌ All encryptions failed</b>\n\nTry again with valid links.`;
      } else if (successful.length === 1) {
        responseText += `<b>Encrypted Happ Link:</b>\n<pre>${successful[0].enc}</pre>\n\n` +
          `<i>Tap & hold to copy • Works only in Happ app</i>`;
      } else {
        responseText += `<b>${successful.length} Encrypted Links:</b>\n\n`;
        successful.forEach((item, i) => {
          responseText += `${i + 1}. <pre>${item.enc}</pre>\n\n`;
        });
        responseText += `<i>Tap & hold each link to copy</i>`;
      }

      if (failedCount > 0) {
        responseText += `\n\n⚠️ <b>${failedCount} link${failedCount > 1 ? "s" : ""} failed</b>`;
      }

      await sendMessage(chatId, responseText, {
        reply_markup: JSON.stringify(encryptMoreKeyboard),
      });
    }

    // Handle inline queries
    else if (update.inline_query) {
      const query = update.inline_query.query.trim();
      const inlineId = update.inline_query.id;

      if (!isProxyLink(query)) {
        // Return a helpful article for invalid input
        const results = [{
          type: "article",
          id: "invalid",
          title: "❌ Invalid Proxy Link",
          input_message_content: {
            message_text: `<b>❌ Invalid input</b>\n\nSend a valid proxy link starting with https://, vmess://, vless://, etc.`,
            parse_mode: "HTML",
          },
        }];
        await answerInlineQuery(inlineId, results);
        return new Response("ok");
      }

      const encrypted = await encryptUrl(query);

      if (!encrypted) {
        const results = [{
          type: "article",
          id: "failed",
          title: "❌ Encryption Failed",
          input_message_content: {
            message_text: `<b>❌ Encryption failed</b>\n\nThe link could not be encrypted. Try again or check the format.`,
            parse_mode: "HTML",
          },
        }];
        await answerInlineQuery(inlineId, results);
        return new Response("ok");
      }

      const results = [{
        type: "article",
        id: "encrypted",
        title: "✅ Encrypted Happ Link",
        description: encrypted.substring(0, 80) + "...",
        input_message_content: {
          message_text: `<b>✅ Encrypted Happ Link</b>\n\n<pre>${encrypted}</pre>\n\n<i>Tap & hold to copy • Shared via inline mode</i>`,
          parse_mode: "HTML",
        },
        reply_markup: encryptMoreKeyboard,
      }];

      await answerInlineQuery(inlineId, results);
    }

  } catch (err) {
    console.error("Update handling error:", err);
  }

  return new Response("ok");
});
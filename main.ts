// main.ts
// 🤖 Happ Code Decryption Bot (Improved Version)
// 🔓 Decrypts plain base64 Happ codes
// 🔒 Informs about RSA-encrypted links (crypt/crypt2/crypt3) which require the official app
// ❌ No public API exists for decrypting RSA-encrypted links

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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

// Safe base64/base64url decoding
function safeBase64Decode(input: string): string | null {
  try {
    let b64 = input.trim()
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    while (b64.length % 4) {
      b64 += '=';
    }
    
    const bytes = decodeBase64(b64);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isProxyUrl(text: string): boolean {
  const trimmed = text.trim();
  const proxyPrefixes = [
    "http://", "https://",
    "vmess://", "vless://", "trojan://", "ss://", "shadowsocks://",
    "hysteria://", "hysteria2://", "tuic://"
  ];
  return proxyPrefixes.some(prefix => trimmed.startsWith(prefix)) ||
         trimmed.includes("://") && (trimmed.includes("remarks=") || trimmed.includes("obfs="));
}

async function tryDecrypt(code: string): Promise<string | null> {
  const decoded = safeBase64Decode(code);
  if (decoded && isProxyUrl(decoded)) {
    return decoded;
  }
  return null;
}

function extractCode(text: string): string | null {
  // Match happ://crypt*/BASE64
  const uriMatch = text.match(/happ:\/\/crypt\d*\/([A-Za-z0-9+_\/.-]+=*)?/i);
  if (uriMatch && uriMatch[1]) {
    return uriMatch[1];
  }

  // Fallback: the whole message looks like a base64 code
  const clean = text.trim();
  if (/^[A-Za-z0-9+_\/.-]+=*$/.test(clean) && clean.length >= 20) {
    return clean;
  }

  return null;
}

function getCryptVersion(text: string): string | null {
  const match = text.match(/happ:\/\/(crypt\d*)\//i);
  return match ? match[1] : null;
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
    
    if (!text || text.startsWith('/')) {
      return new Response("ok");
    }
    
    const code = extractCode(text);
    const cryptVersion = getCryptVersion(text);
    
    if (code) {
      await sendMessage(chatId, "🔓 Attempting to decrypt Happ code...");
      
      const decrypted = await tryDecrypt(code);
      
      if (decrypted) {
        const responseText = `<b>✅ Successfully Decrypted!</b>\n\n` +
          `<b>Original:</b>\n<pre>${text}</pre>\n\n` +
          `<b>Decrypted:</b>\n<pre>${decrypted}</pre>`;
        
        await sendMessage(chatId, responseText);
      } else {
        let responseText = `<b>❌ Cannot Decrypt This Code</b>\n\n`;
        
        if (cryptVersion && cryptVersion >= "crypt") {
          responseText += `This is an RSA-encrypted link (<code>${cryptVersion}</code>).\n\n` +
            `Modern Happ links use RSA encryption with private keys embedded in the official app.\n\n` +
            `<b>There is no public API or tool to decrypt these outside the official Happ Proxy Utility app.</b>\n\n` +
            `Please import the link directly into the official Happ app to use it.`;
        } else {
          responseText += `This appears to be a base64-encoded code, but decoding did not yield a valid proxy/subscription URL.\n\n` +
            `It may be an invalid code or a newer encrypted format.`;
        }
        
        await sendMessage(chatId, responseText);
      }
    } else {
      await sendMessage(chatId, `<b>❌ Not a Recognized Happ Code</b>\n\n` +
        `Please send a valid Happ link or base64 code.\n\n` +
        `• Simple base64 codes can be decrypted here.\n` +
        `• Encrypted links (<code>happ://crypt...</code>) must be added in the official Happ app.`, "HTML");
    }
    
  } catch (err) {
    console.error("Error handling update:", err);
  }
  
  return new Response("ok");
});
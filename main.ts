// main.ts
// 🤖 Happ Code Decryption Bot (Fixed Version)
// 🔓 Attempts to decrypt Happ codes/links
// ✅ Handles full happ://crypt... links and plain base64/base64url codes
// ❌ Informs users about RSA-encrypted links (cannot decrypt publicly)

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

// Safe base64/base64url decoding with padding fix
function safeBase64Decode(input: string): string | null {
  try {
    let b64 = input.trim()
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    while (b64.length % 4) {
      b64 += '=';
    }
    
    const bytes = decodeBase64(b64);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function decryptHappCode(code: string): Promise<string | null> {
  const decoded = safeBase64Decode(code);
  
  if (!decoded) return null;
  
  // Check if it looks like a proxy subscription URL or protocol link
  const trimmed = decoded.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("vmess://") ||
    trimmed.startsWith("vless://") ||
    trimmed.startsWith("trojan://") ||
    trimmed.startsWith("ss://") ||
    trimmed.startsWith("shadowsocks://")
  ) {
    return trimmed;
  }
  
  return null;
}

function extractHappCode(text: string): string | null {
  // Extract base64 part from happ://crypt.../BASE64
  const uriMatch = text.match(/happ:\/\/crypt\d*\/([A-Za-z0-9+_\/.-]+=*)/i);
  if (uriMatch) {
    return uriMatch[1];
  }
  
  // Fallback: whole text is likely the code (base64/base64url)
  const clean = text.trim();
  if (/^[A-Za-z0-9+_\/.-]+=*$/i.test(clean) && clean.length >= 20) {
    return clean;
  }
  
  return null;
}

function isEncryptedHappLink(text: string): boolean {
  return /happ:\/\/crypt\d*\//i.test(text);
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
    
    const potentialCode = extractHappCode(text);
    
    if (potentialCode) {
      await sendMessage(chatId, "🔓 Decrypting Happ code...");
      
      const decrypted = await decryptHappCode(potentialCode);
      
      if (decrypted) {
        const responseText = `<b>✅ Successfully Decrypted!</b>\n\n` +
          `<b>Original:</b>\n<pre>${text}</pre>\n\n` +
          `<b>Decrypted URL:</b>\n<pre>${decrypted}</pre>`;
        
        await sendMessage(chatId, responseText);
      } else {
        let responseText;
        if (isEncryptedHappLink(text)) {
          responseText = `<b>❌ Encrypted Happ Link Detected</b>\n\n` +
            `This is an RSA-encrypted link (happ://crypt...).\n\n` +
            `Such links use embedded private keys and can <b>only be decrypted inside the official Happ Proxy Utility app</b>.\n\n` +
            `Public decryption is not possible. Please add the link directly in the Happ app.`;
        } else {
          responseText = `<b>❌ Invalid or Undecryptable Code</b>\n\n` +
            `This doesn't appear to be a valid decryptable Happ code.\n\n` +
            `Note: Modern encrypted links (happ://crypt3/...) cannot be decrypted publicly.`;
        }
        
        await sendMessage(chatId, responseText);
      }
    } else {
      await sendMessage(chatId, `<b>❌ Not a Happ Code</b>\n\n` +
        `Please send a valid Happ link or code.\n\n` +
        `Examples:\n` +
        `- happ://crypt3/ABC... (encrypted – add in official app)\n` +
        `- Long base64 string (may be decryptable)`, "HTML");
    }
    
  } catch (err) {
    console.error("Error handling update:", err);
  }
  
  return new Response("ok");
});
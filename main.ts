// main.ts
// 🤖 Happ Code Decryption Bot
// 🔓 Decrypts Happ codes sent by users
// ❌ Replies "Invalid" if not a Happ code
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Happ API --------------------
const HAPP_API_URL = "https://crypto.happ.su/api.php";

// -------------------- Helper Functions --------------------
async function sendMessage(chatId: string, text: string, parseMode = "Markdown") {
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

async function decryptHappCode(happCode: string): Promise<string | null> {
  try {
    // Try to decrypt using Happ API
    const response = await fetch(HAPP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ code: happCode }),
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Check various possible response formats from Happ API
      if (data.url) return data.url;
      if (data.decrypted_url) return data.decrypted_url;
      if (data.decrypted) return data.decrypted;
      if (data.link) return data.link;
      if (data.original_url) return data.original_url;
    }
    
    // If API fails or returns unexpected format, try base64 decode
    try {
      const decodedBytes = decodeBase64(happCode);
      const decoder = new TextDecoder();
      const decodedText = decoder.decode(decodedBytes);
      
      // Check if it looks like a URL
      if (decodedText.startsWith("http://") || decodedText.startsWith("https://")) {
        return decodedText;
      }
      
      // If not a URL, return the decoded text anyway
      return decodedText;
    } catch (base64Err) {
      console.error("Failed to base64 decode:", base64Err);
      return null;
    }
    
  } catch (err) {
    console.error("Failed to decrypt Happ code via API:", err);
    
    // Fallback: try direct base64 decoding
    try {
      const decodedBytes = decodeBase64(happCode);
      const decoder = new TextDecoder();
      return decoder.decode(decodedBytes);
    } catch (base64Err) {
      console.error("Fallback base64 decoding also failed:", base64Err);
      return null;
    }
  }
}

function looksLikeHappCode(text: string): boolean {
  const cleanText = text.trim();
  
  // Check if it's base64 encoded (alphanumeric, +, /, = padding)
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  
  // Check for common Happ code patterns
  const happPatterns = [
    /^[A-Za-z0-9+/]{20,}$/, // Minimum 20 chars of base64
    /^happ_/i, // Starts with happ_
    /^[A-Za-z0-9+/=]{30,}$/, // Long base64 strings
  ];
  
  // Check if it matches base64 pattern and has reasonable length
  if (base64Regex.test(cleanText) && cleanText.length >= 10) {
    return true;
  }
  
  // Check other patterns
  for (const pattern of happPatterns) {
    if (pattern.test(cleanText)) {
      return true;
    }
  }
  
  return false;
}

// -------------------- Webhook Handler --------------------
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  
  try {
    const update = await req.json();
    
    // Handle regular messages
    const msg = update.message;
    if (!msg) return new Response("ok");
    
    const chatId = String(msg.chat.id);
    const text = msg.text?.trim() || "";
    
    // Skip empty messages or commands
    if (!text || text.startsWith('/')) {
      return new Response("ok");
    }
    
    // Check if it looks like a Happ code
    if (looksLikeHappCode(text)) {
      // Show decrypting message
      await sendMessage(chatId, "🔓 Decrypting Happ code...");
      
      // Attempt to decrypt
      const decrypted = await decryptHappCode(text);
      
      if (decrypted) {
        // Successfully decrypted
        const responseText = `✅ **Successfully Decrypted!**\n\n` +
                           `**Original Code:**\n\`\`\`\n${text}\n\`\`\`\n\n` +
                           `**Decrypted URL:**\n\`\`\`\n${decrypted}\n\`\`\``;
        
        await sendMessage(chatId, responseText, "Markdown");
      } else {
        // Failed to decrypt
        await sendMessage(chatId, "❌ **Invalid Happ Code**\n\nThis doesn't appear to be a valid Happ code or could not be decrypted. Please check the code and try again.", "Markdown");
      }
      
    } else {
      // Not a Happ code
      await sendMessage(chatId, "❌ **Invalid Input**\n\nThis doesn't appear to be a valid Happ code.\n\nHapp codes are usually base64 encoded strings (alphanumeric with +, /, and = characters).", "Markdown");
    }
    
  } catch (err) {
    console.error("Error handling update:", err);
  }
  
  return new Response("ok");
});
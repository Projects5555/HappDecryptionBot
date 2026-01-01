// main.ts
// Telegram Tic-Tac-Toe Bot (Deno)
// Features: EN/RU, Trophy/Star PvP, Admin Panel, Star Management (Username/ID), Deno KV.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// --- CONFIGURATION ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const ADMIN_USERNAME = "Masakoff"; // The admin username (without @)

// --- KV DATABASE ---
const kv = await Deno.openKv();

// --- TYPES ---
type Lang = "en" | "ru";

interface UserProfile {
  id: number;
  username?: string;
  firstName: string;
  language: Lang | null;
  trophies: number;
  stars: number;
  matchesPlayed: number;
  wins: number;
  lastDailyBonus: number;
}

interface Match {
  id: string;
  p1: number;
  p2: number;
  type: "trophy" | "star";
  board: string[];
  turn: number;
  p1Mark: "X";
  p2Mark: "O";
  rounds: number;
  wins: { [userId: number]: number };
  msgIds: { [userId: number]: number };
  active: boolean;
}

// --- LOCALIZATION ---
const TEXTS = {
  en: {
    choose_lang: "👋 Welcome! Please choose your language:",
    menu: "🎮 Main Menu\n\n🏆 Trophies: {t}\n⭐️ Stars: {s}",
    btn_trophy: "🏆 Play for Trophies",
    btn_star: "⭐️ Play for Stars (1⭐️)",
    btn_profile: "👤 Profile",
    btn_leaderboard: "🏅 Leaderboard",
    btn_bonus: "🎁 Daily Bonus",
    searching: "🔍 Searching for an opponent...",
    joined_queue: "✅ Added to matchmaking queue.",
    match_found: "⚔️ Match found! Game starting...",
    your_turn: "🟢 Your turn ({mark})",
    opp_turn: "🔴 Opponent's turn",
    win_match: "🏆 YOU WON THE MATCH!\n+{reward} {currency}",
    lose_match: "😢 YOU LOST THE MATCH.\n-{lost} {currency}",
    draw_match: "🤝 Match ended in a draw.",
    bonus_claimed: "🎁 You received 10 Stars and 5 Trophies!",
    bonus_wait: "⏳ Come back later for your bonus.",
    insufficient_stars: "❌ Not enough stars (Need 1).",
    withdraw_btn: "💸 Request Withdrawal (Min 50)",
    withdraw_sent: "✅ Withdrawal request sent to admin.",
    withdraw_fail: "❌ Cannot withdraw (Min 50).",
    surrender: "🏳️ Surrender"
  },
  ru: {
    choose_lang: "👋 Добро пожаловать! Выберите язык:",
    menu: "🎮 Главное меню\n\n🏆 Кубки: {t}\n⭐️ Звезды: {s}",
    btn_trophy: "🏆 Играть на Кубки",
    btn_star: "⭐️ Играть на Звезды (1⭐️)",
    btn_profile: "👤 Профиль",
    btn_leaderboard: "🏅 Топ игроков",
    btn_bonus: "🎁 Ежедневный бонус",
    searching: "🔍 Поиск соперника...",
    joined_queue: "✅ Вы в очереди поиска.",
    match_found: "⚔️ Соперник найден! Игра начинается...",
    your_turn: "🟢 Ваш ход ({mark})",
    opp_turn: "🔴 Ход соперника",
    win_match: "🏆 ВЫ ВЫИГРАЛИ МАТЧ!\n+{reward} {currency}",
    lose_match: "😢 ВЫ ПРОИГРАЛИ МАТЧ.\n-{lost} {currency}",
    draw_match: "🤝 Матч закончился вничью.",
    bonus_claimed: "🎁 Вы получили 10 Звезд и 5 Кубков!",
    bonus_wait: "⏳ Бонус пока недоступен.",
    insufficient_stars: "❌ Недостаточно звезд (Нужна 1).",
    withdraw_btn: "💸 Запросить вывод (Мин 50)",
    withdraw_sent: "✅ Заявка отправлена админу.",
    withdraw_fail: "❌ Нельзя вывести (Мин 50).",
    surrender: "🏳️ Сдаться"
  }
};

// --- RUNTIME STATE ---
const activeMatches: Map<string, Match> = new Map();
const trophyQueue: number[] = [];
const starQueue: number[] = [];
let adminChatId: number | null = null;

// --- HELPERS ---

function t(lang: Lang | null, key: keyof typeof TEXTS["en"], params: Record<string, any> = {}): string {
  const l = lang || "en";
  let str = TEXTS[l][key] || TEXTS["en"][key];
  for (const k in params) str = str.replace(`{${k}}`, String(params[k]));
  return str;
}

async function api(method: string, payload: any) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

async function getProfile(userId: number): Promise<UserProfile> {
  const res = await kv.get<UserProfile>(["users", userId]);
  return res.value || {
    id: userId,
    firstName: "Player",
    language: null,
    trophies: 0,
    stars: 5,
    matchesPlayed: 0,
    wins: 0,
    lastDailyBonus: 0
  };
}

async function saveProfile(profile: UserProfile) {
  await kv.set(["users", profile.id], profile);
  await kv.set(["leaderboard", "trophies", profile.id], profile.trophies);
  await kv.set(["leaderboard", "stars", profile.id], profile.stars);
  if (profile.username) {
    await kv.set(["usernames", profile.username.toLowerCase()], profile.id);
  }
}

async function getUserId(input: string | number): Promise<number | null> {
  if (!isNaN(Number(input))) return Number(input);
  const cleanUsername = String(input).replace("@", "").toLowerCase();
  const res = await kv.get<number>(["usernames", cleanUsername]);
  return res.value;
}

// --- GAME LOGIC ---

function checkWin(board: string[]): string | null {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.includes("") ? null : "draw";
}

function getBoardMarkup(match: Match) {
  const keyboard = [];
  for (let i = 0; i < 3; i++) {
    const row = [];
    for (let j = 0; j < 3; j++) {
      const idx = i * 3 + j;
      const val = match.board[idx];
      row.push({ text: val === "" ? " " : (val === "X" ? "❌" : "⭕"), callback_data: `gm:${match.id}:${idx}` });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: "🏳️", callback_data: `surr:${match.id}` }]);
  return { inline_keyboard: keyboard };
}

async function sendMatchUpdate(match: Match) {
  const p1 = await getProfile(match.p1);
  const p2 = await getProfile(match.p2);
  const update = async (uid: number, opp: string, mark: string) => {
    const lang = (uid === p1.id ? p1.language : p2.language);
    const isTurn = match.turn === uid;
    const text = `Round ${match.rounds}/3 | Score: ${match.wins[match.p1]}-${match.wins[match.p2]}\nVS ${opp}\n\n` +
                 t(lang, isTurn ? "your_turn" : "opp_turn", { mark });
    
    if (match.msgIds[uid]) {
        const res = await api("editMessageText", { chat_id: uid, message_id: match.msgIds[uid], text, reply_markup: getBoardMarkup(match) });
        if (res.ok) return;
    }
    const res = await api("sendMessage", { chat_id: uid, text, reply_markup: getBoardMarkup(match) });
    if (res.result) match.msgIds[uid] = res.result.message_id;
  };
  await update(match.p1, p2.firstName, "❌");
  await update(match.p2, p1.firstName, "⭕");
}

async function endRound(match: Match, winnerMark: string | "draw") {
  if (winnerMark === "X") match.wins[match.p1]++;
  if (winnerMark === "O") match.wins[match.p2]++;

  const p1Wins = match.wins[match.p1], p2Wins = match.wins[match.p2];
  let mWin: number | null = null, mLose: number | null = null, isDraw = false;

  if (p1Wins >= 2) { mWin = match.p1; mLose = match.p2; }
  else if (p2Wins >= 2) { mWin = match.p2; mLose = match.p1; }
  else if (match.rounds >= 3) {
    if (p1Wins > p2Wins) { mWin = match.p1; mLose = match.p2; }
    else if (p2Wins > p1Wins) { mWin = match.p2; mLose = match.p1; }
    else isDraw = true;
  }

  if (mWin || isDraw) {
    activeMatches.delete(match.id);
    const p1 = await getProfile(match.p1), p2 = await getProfile(match.p2);
    if (isDraw) {
      if (match.type === "star") { p1.stars += 1; p2.stars += 1; await saveProfile(p1); await saveProfile(p2); }
      await api("sendMessage", { chat_id: match.p1, text: t(p1.language, "draw_match") });
      await api("sendMessage", { chat_id: match.p2, text: t(p2.language, "draw_match") });
    } else {
      const wP = mWin === p1.id ? p1 : p2, lP = mWin === p1.id ? p2 : p1;
      wP.matchesPlayed++; wP.wins++; lP.matchesPlayed++;
      if (match.type === "trophy") { wP.trophies++; lP.trophies = Math.max(0, lP.trophies - 1); }
      else { wP.stars += 1.5; } // Winner gets 1.5 (Profit 0.5 + Return 1.0)
      await saveProfile(wP); await saveProfile(lP);
      await api("sendMessage", { chat_id: wP.id, text: t(wP.language, "win_match", { reward: match.type === "star" ? 1.5 : 1, currency: match.type }) });
      await api("sendMessage", { chat_id: lP.id, text: t(lP.language, "lose_match", { lost: 1, currency: match.type }) });
    }
    setTimeout(() => { sendMainMenu(match.p1); sendMainMenu(match.p2); }, 1500);
  } else {
    match.rounds++; match.board = Array(9).fill(""); match.turn = match.rounds % 2 !== 0 ? match.p1 : match.p2;
    await sendMatchUpdate(match);
  }
}

async function tryMatchmaking() {
  if (trophyQueue.length >= 2) createMatch(trophyQueue.shift()!, trophyQueue.shift()!, "trophy");
  if (starQueue.length >= 2) createMatch(starQueue.shift()!, starQueue.shift()!, "star");
}

async function createMatch(u1: number, u2: number, type: "trophy" | "star") {
  const mid = crypto.randomUUID();
  const match: Match = { id: mid, p1: u1, p2: u2, type, board: Array(9).fill(""), turn: u1, p1Mark: "X", p2Mark: "O", rounds: 1, wins: { [u1]: 0, [u2]: 0 }, msgIds: {}, active: true };
  activeMatches.set(mid, match);
  const p1 = await getProfile(u1), p2 = await getProfile(u2);
  await api("sendMessage", { chat_id: u1, text: t(p1.language, "match_found") });
  await api("sendMessage", { chat_id: u2, text: t(p2.language, "match_found") });
  await sendMatchUpdate(match);
}

// --- MENUS ---

async function sendMainMenu(uid: number) {
  const p = await getProfile(uid);
  if (!p.language) return sendLangSelection(uid);
  const kb = {
    inline_keyboard: [
      [{ text: t(p.language, "btn_trophy"), callback_data: "play:trophy" }],
      [{ text: t(p.language, "btn_star"), callback_data: "play:star" }],
      [{ text: t(p.language, "btn_profile"), callback_data: "menu:profile" }, { text: t(p.language, "btn_leaderboard"), callback_data: "menu:leaderboard" }],
      [{ text: t(p.language, "btn_bonus"), callback_data: "menu:bonus" }]
    ]
  };
  await api("sendMessage", { chat_id: uid, text: t(p.language, "menu", { t: p.trophies, s: p.stars }), reply_markup: kb });
}

async function sendLangSelection(uid: number) {
  await api("sendMessage", { chat_id: uid, text: "Choose Language / Выберите язык",
    reply_markup: { inline_keyboard: [[{ text: "English", callback_data: "lang:en" }, { text: "Русский", callback_data: "lang:ru" }]] }
  });
}

// --- UPDATED ADMIN PANEL ---
async function sendAdminPanel(userId: number) {
  const stats = await kv.get<number>(["stats", "total_matches"]);
  const text = `🕵️‍♂️ **Admin Panel (@${ADMIN_USERNAME})**\n\nMatches: ${stats.value || 0}\n\n**Commands:**\n\`/add_stars @user 10\`\n\`/add_stars 12345 50\``;
  await api("sendMessage", { chat_id: userId, text, parse_mode: "Markdown" });
}

// --- MAIN HANDLER ---

async function handleUpdate(upd: any) {
  if (upd.message) {
    const { from, text } = upd.message;
    const p = await getProfile(from.id);
    p.username = from.username; p.firstName = from.first_name;
    await saveProfile(p);

    if (from.username === ADMIN_USERNAME) {
      adminChatId = from.id;
      await kv.set(["config", "admin_id"], from.id);
    }

    if (text === "/start") return sendMainMenu(from.id);
    if (text === "/admin" && from.username === ADMIN_USERNAME) return sendAdminPanel(from.id);
    
    // RE-INTEGRATED FIXED STAR COMMAND
    if (text?.startsWith("/add_stars")) {
       if (from.username !== ADMIN_USERNAME) return;
       const parts = text.split(/\s+/);
       if (parts.length !== 3) return api("sendMessage", { chat_id: from.id, text: "Usage: `/add_stars [@user/id] [amount]`", parse_mode: "Markdown" });
       
       const targetId = await getUserId(parts[1]);
       const amt = parseFloat(parts[2]);
       
       if (!targetId || isNaN(amt)) return api("sendMessage", { chat_id: from.id, text: "❌ Error: User not found or invalid amount." });
       
       const tP = await getProfile(targetId);
       tP.stars += amt; await saveProfile(tP);
       await api("sendMessage", { chat_id: from.id, text: `✅ Added **${amt}** stars to ${tP.firstName}.`, parse_mode: "Markdown" });
       await api("sendMessage", { chat_id: targetId, text: `⭐️ Admin added **${amt}** stars to your balance!`, parse_mode: "Markdown" });
    }

  } else if (upd.callback_query) {
    const { from, data, id, message } = upd.callback_query;
    const p = await getProfile(from.id);

    if (data.startsWith("lang:")) {
      p.language = data.split(":")[1] as Lang;
      await saveProfile(p);
      await api("answerCallbackQuery", { callback_query_id: id });
      return sendMainMenu(from.id);
    }

    if (data === "menu:profile") {
        const txt = `👤 **Profile**\n\nID: \`${p.id}\`\n🏆 Trophies: ${p.trophies}\n⭐️ Stars: ${p.stars}\n📊 Matches: ${p.matchesPlayed}\n🏅 Wins: ${p.wins}`;
        await api("sendMessage", { chat_id: from.id, text: txt, parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: t(p.language, "withdraw_btn"), callback_data: "withdraw" }]] } });
    }

    if (data === "withdraw") {
        if (p.stars >= 50) {
            p.stars -= 50; await saveProfile(p);
            const rid = crypto.randomUUID();
            await kv.set(["withdrawals", rid], { userId: from.id, amount: 50 });
            await api("answerCallbackQuery", { callback_query_id: id, text: t(p.language, "withdraw_sent"), show_alert: true });
            if (adminChatId) await api("sendMessage", { chat_id: adminChatId, text: `💸 **Withdrawal Request**\nUser: ${from.id}\nAmt: 50`, reply_markup: { inline_keyboard: [[{ text: "✅ Pay", callback_data: `ap:${rid}:${from.id}` }]] } });
        } else {
            await api("answerCallbackQuery", { callback_query_id: id, text: t(p.language, "withdraw_fail"), show_alert: true });
        }
    }

    if (data.startsWith("ap:")) { // Admin Pay
        if (from.id !== adminChatId) return;
        const [_, rid, tid] = data.split(":");
        await kv.delete(["withdrawals", rid]);
        await api("editMessageText", { chat_id: from.id, message_id: message.message_id, text: "✅ Paid." });
        await api("sendMessage", { chat_id: parseInt(tid), text: "✅ Your withdrawal has been processed!" });
    }

    if (data.startsWith("play:")) {
      const type = data.split(":")[1];
      if (type === "star" && p.stars < 1) return api("answerCallbackQuery", { callback_query_id: id, text: t(p.language, "insufficient_stars"), show_alert: true });
      if (type === "star") { p.stars -= 1; await saveProfile(p); starQueue.push(from.id); }
      else trophyQueue.push(from.id);
      await api("sendMessage", { chat_id: from.id, text: t(p.language, "joined_queue") });
      await tryMatchmaking();
    }

    if (data.startsWith("gm:")) {
      const [_, mid, idx] = data.split(":");
      const match = activeMatches.get(mid);
      if (!match || match.turn !== from.id || match.board[Number(idx)] !== "") return api("answerCallbackQuery", { callback_query_id: id });
      match.board[Number(idx)] = match.turn === match.p1 ? "X" : "O";
      const win = checkWin(match.board);
      if (win) await endRound(match, win);
      else { match.turn = match.turn === match.p1 ? match.p2 : match.p1; await sendMatchUpdate(match); }
      await api("answerCallbackQuery", { callback_query_id: id });
    }

    if (data === "menu:bonus") {
      const now = Date.now();
      if (now - p.lastDailyBonus > 86400000) {
        p.stars += 10; p.trophies += 5; p.lastDailyBonus = now; await saveProfile(p);
        await api("answerCallbackQuery", { callback_query_id: id, text: t(p.language, "bonus_claimed"), show_alert: true });
        return sendMainMenu(from.id);
      }
      await api("answerCallbackQuery", { callback_query_id: id, text: t(p.language, "bonus_wait"), show_alert: true });
    }
  }
}

// --- SERVER ---
serve(async (req) => {
  if (req.method === "POST") {
    try { await handleUpdate(await req.json()); } catch (e) { console.error(e); }
  }
  return new Response("OK");
});
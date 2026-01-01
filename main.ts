// main.ts
// Telegram Tic-Tac-Toe Bot (Deno)
// Features: EN/RU, PvP (Trophy/Stars), Admin Panel, Star Management, Username Search.
// Run: deno run --allow-net --allow-env --unstable-kv main.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// --- CONFIGURATION ---
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const ADMIN_USERNAME = "Masakoff"; 

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
  lastSeen: number;
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
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) { console.error(`API Error ${method}:`, e); }
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
    lastDailyBonus: 0,
    lastSeen: Date.now()
  };
}

async function saveProfile(profile: UserProfile) {
  profile.lastSeen = Date.now();
  await kv.set(["users", profile.id], profile);
  await kv.set(["leaderboard", "trophies", profile.id], profile.trophies);
  if (profile.username) {
    await kv.set(["usernames", profile.username.toLowerCase()], profile.id);
  }
}

async function resolveUserId(input: string): Promise<number | null> {
  if (!isNaN(parseInt(input))) return parseInt(input);
  const cleanUsername = input.replace("@", "").toLowerCase();
  const res = await kv.get<number>(["usernames", cleanUsername]);
  return res.value || null;
}

// --- GAME LOGIC ---

function checkWin(board: string[]): string | null {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
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
  keyboard.push([{ text: "🏳️ Surrender", callback_data: `surr:${match.id}` }]);
  return { inline_keyboard: keyboard };
}

async function sendMatchUpdate(match: Match) {
  const [p1, p2] = await Promise.all([getProfile(match.p1), getProfile(match.p2)]);

  const update = async (uid: number, opp: UserProfile, mark: string) => {
    const lang = uid === p1.id ? p1.language : p2.language;
    const isTurn = match.turn === uid;
    const status = isTurn ? t(lang, "your_turn", { mark }) : t(lang, "opp_turn");
    const text = `Round ${match.rounds}/3 | Score: ${match.wins[match.p1]}-${match.wins[match.p2]}\nVS ${opp.firstName}\n\n${status}`;

    const payload = { chat_id: uid, text, reply_markup: getBoardMarkup(match) };

    if (match.msgIds[uid]) {
      const res = await api("editMessageText", { ...payload, message_id: match.msgIds[uid] });
      if (res?.ok) return;
    }

    const res = await api("sendMessage", payload);
    if (res?.result) match.msgIds[uid] = res.result.message_id;
  };

  await Promise.all([update(match.p1, p2, "❌"), update(match.p2, p1, "⭕")]);
}

async function endRound(match: Match, winnerMark: string | "draw") {
  if (winnerMark === "X") match.wins[match.p1]++;
  if (winnerMark === "O") match.wins[match.p2]++;

  const p1Wins = match.wins[match.p1], p2Wins = match.wins[match.p2];
  let mWinner: number | null = null, mLoser: number | null = null, isDraw = false;

  if (p1Wins >= 2) [mWinner, mLoser] = [match.p1, match.p2];
  else if (p2Wins >= 2) [mWinner, mLoser] = [match.p2, match.p1];
  else if (match.rounds >= 3) {
    if (p1Wins === p2Wins) isDraw = true;
    else [mWinner, mLoser] = p1Wins > p2Wins ? [match.p1, match.p2] : [match.p2, match.p1];
  }

  if (mWinner || isDraw) {
    activeMatches.delete(match.id);
    const [p1, p2] = await Promise.all([getProfile(match.p1), getProfile(match.p2)]);

    if (isDraw) {
      if (match.type === "star") { p1.stars += 1; p2.stars += 1; await Promise.all([saveProfile(p1), saveProfile(p2)]); }
      await Promise.all([
        api("sendMessage", { chat_id: match.p1, text: t(p1.language, "draw_match") }),
        api("sendMessage", { chat_id: match.p2, text: t(p2.language, "draw_match") })
      ]);
    } else {
      const winP = mWinner === p1.id ? p1 : p2;
      const loseP = mWinner === p1.id ? p2 : p1;
      winP.wins++; winP.matchesPlayed++; loseP.matchesPlayed++;

      const reward = match.type === "trophy" ? 1 : 1.5;
      if (match.type === "trophy") {
        winP.trophies += 1;
        loseP.trophies = Math.max(0, loseP.trophies - 1);
      } else {
        winP.stars += 1.5;
      }

      await Promise.all([saveProfile(winP), saveProfile(loseP)]);
      await Promise.all([
        api("sendMessage", { chat_id: winP.id, text: t(winP.language, "win_match", { reward, currency: match.type }) }),
        api("sendMessage", { chat_id: loseP.id, text: t(loseP.language, "lose_match", { lost: 1, currency: match.type }) })
      ]);
    }
    setTimeout(() => { sendMainMenu(match.p1); sendMainMenu(match.p2); }, 1500);
  } else {
    match.rounds++;
    match.board = Array(9).fill("");
    match.turn = match.rounds % 2 !== 0 ? match.p1 : match.p2;
    await sendMatchUpdate(match);
  }
}

async function tryMatchmaking() {
  if (trophyQueue.length >= 2) createMatch(trophyQueue.shift()!, trophyQueue.shift()!, "trophy");
  if (starQueue.length >= 2) createMatch(starQueue.shift()!, starQueue.shift()!, "star");
}

async function createMatch(p1: number, p2: number, type: "trophy" | "star") {
  const match: Match = {
    id: crypto.randomUUID(), p1, p2, type, board: Array(9).fill(""),
    turn: p1, p1Mark: "X", p2Mark: "O", rounds: 1, wins: { [p1]: 0, [p2]: 0 }, msgIds: {}
  };
  activeMatches.set(match.id, match);
  await sendMatchUpdate(match);
}

// --- MENUS ---

async function sendMainMenu(userId: number) {
  const p = await getProfile(userId);
  if (!p.language) return sendLangSelection(userId);
  const kb = {
    inline_keyboard: [
      [{ text: t(p.language, "btn_trophy"), callback_data: "play:trophy" }],
      [{ text: t(p.language, "btn_star"), callback_data: "play:star" }],
      [{ text: t(p.language, "btn_profile"), callback_data: "menu:profile" }, { text: t(p.language, "btn_leaderboard"), callback_data: "menu:leaderboard" }],
      [{ text: t(p.language, "btn_bonus"), callback_data: "menu:bonus" }]
    ]
  };
  await api("sendMessage", { chat_id: userId, text: t(p.language, "menu", { t: p.trophies, s: p.stars }), reply_markup: kb });
}

async function sendLangSelection(userId: number) {
  await api("sendMessage", {
    chat_id: userId, text: "Choose Language / Выберите язык",
    reply_markup: { inline_keyboard: [[{ text: "🇺🇸 EN", callback_data: "lang:en" }, { text: "🇷🇺 RU", callback_data: "lang:ru" }]] }
  });
}

// --- HANDLERS ---

async function handleUpdate(upd: any) {
  if (upd.message) {
    const { from, text } = upd.message;
    if (from.username === ADMIN_USERNAME) adminChatId = from.id;

    if (text === "/start") {
      const p = await getProfile(from.id);
      p.username = from.username; p.firstName = from.first_name;
      await saveProfile(p);
      return p.language ? sendMainMenu(from.id) : sendLangSelection(from.id);
    }

    if (text?.startsWith("/add_stars") && from.username === ADMIN_USERNAME) {
      const [_, target, amt] = text.split(" ");
      const uid = await resolveUserId(target);
      if (uid && !isNaN(parseFloat(amt))) {
        const p = await getProfile(uid);
        p.stars += parseFloat(amt);
        await saveProfile(p);
        api("sendMessage", { chat_id: from.id, text: `✅ Added ${amt} stars to ${target}` });
      }
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
      const txt = `👤 **Profile**\nID: \`${p.id}\`\n🏆 Trophies: ${p.trophies}\n⭐️ Stars: ${p.stars}`;
      return api("sendMessage", { chat_id: from.id, text: txt, parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "Withdraw", callback_data: "withdraw" }]] } });
    }

    if (data === "menu:leaderboard") {
        const iter = kv.list({ prefix: ["leaderboard", "trophies"] }, { limit: 10, reverse: true });
        let txt = "🏅 **Top 10 Trophies**\n";
        for await (const entry of iter) txt += `• ID:${entry.key[2]} — 🏆 ${entry.value}\n`;
        return api("sendMessage", { chat_id: from.id, text: txt });
    }

    if (data.startsWith("play:")) {
      const type = data.split(":")[1];
      if (type === "star" && p.stars < 1) return api("answerCallbackQuery", { callback_query_id: id, text: t(p.language, "insufficient_stars"), show_alert: true });
      if (type === "star") { p.stars -= 1; await saveProfile(p); starQueue.push(from.id); }
      else trophyQueue.push(from.id);
      await api("answerCallbackQuery", { callback_query_id: id, text: t(p.language, "joined_queue") });
      return tryMatchmaking();
    }

    if (data.startsWith("gm:")) {
      const [_, mid, idx] = data.split(":");
      const match = activeMatches.get(mid);
      if (!match || match.turn !== from.id || match.board[parseInt(idx)] !== "") return;
      match.board[parseInt(idx)] = match.turn === match.p1 ? "X" : "O";
      const win = checkWin(match.board);
      win ? await endRound(match, win) : (match.turn = match.turn === match.p1 ? match.p2 : match.p1, await sendMatchUpdate(match));
      return api("answerCallbackQuery", { callback_query_id: id });
    }

    if (data.startsWith("surr:")) {
        const match = activeMatches.get(data.split(":")[1]);
        if (match) await endRound(match, from.id === match.p1 ? "O" : "X");
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
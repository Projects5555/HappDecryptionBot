// main.ts
// Telegram Tic-Tac-Toe Bot (Deno)
// Features: EN/RU Language, Trophy PvP, Star PvP (Betting), Admin Panel, Withdrawals, Deno KV.
//
// Run: deno run --allow-net --allow-env --unstable-kv main.ts

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
  language: Lang | null; // null means not selected yet
  trophies: number;
  stars: number;
  matchesPlayed: number;
  wins: number;
  lastDailyBonus: number; // timestamp
  lastActive: number;
}

interface Match {
  id: string;
  p1: number;
  p2: number;
  type: "trophy" | "star";
  board: string[]; // 9 cells, "" or "X" or "O"
  turn: number; // User ID whose turn it is
  p1Mark: "X";
  p2Mark: "O";
  rounds: number; // Current round number (1, 2, 3)
  wins: { [userId: number]: number }; // Round wins
  msgIds: { [userId: number]: number }; // To edit messages
  active: boolean;
}

interface QueueEntry {
  userId: number;
  joinTime: number;
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
    win_round: "🎉 You won this round!",
    lose_round: "💀 You lost this round.",
    draw_round: "🤝 Round draw.",
    win_match: "🏆 YOU WON THE MATCH!\n+{reward} {currency}",
    lose_match: "😢 YOU LOST THE MATCH.\n-{lost} {currency}",
    draw_match: "🤝 Match ended in a draw.",
    bonus_claimed: "🎁 You received 10 Stars and 5 Trophies!",
    bonus_wait: "⏳ Come back later for your bonus.",
    insufficient_stars: "❌ Not enough stars (Need 1).",
    withdraw_info: "💸 To withdraw, you need at least 50 Stars.\nYour balance: {s}",
    withdraw_btn: "💸 Request Withdrawal",
    withdraw_sent: "✅ Withdrawal request sent to admin.",
    withdraw_fail: "❌ Cannot withdraw (Min 50).",
    game_over: "🏁 Game Over",
    surrender: "🏳️ Surrender",
    game_header: "Round {rounds}/3 | Score: {score}\nVS {opp}\n\n{turnText}",
    profile: "👤 **Profile**\n\nID: `{id}`\n🏆 Trophies: {trophies}\n⭐️ Stars: {stars}\n📊 Matches: {matchesPlayed}\n🏅 Wins: {wins}",
    leaderboard_title: "🏅 **Top 10 Trophies**\n\n",
    leaderboard_entry: "{i}. ID:{uid} - 🏆 {score}\n",
    admin_panel: "🕵️‍♂️ **Admin Panel (@Masakoff)**\n\nUsers: {totalUsers}\nActive (24h): {active24h}\nMatches: {matches}\n\nCommands:\n/add_stars [id] [amount]\n/remove_stars [id] [amount]",
    add_stars_confirm: "Added {amt} stars to {uid}. New balance: {bal}",
    add_stars_notify: "Admin added {amt} stars to your balance.",
    remove_stars_confirm: "Removed {amt} stars from {uid}. New balance: {bal}",
    remove_stars_notify: "Admin removed {amt} stars from your balance.",
    withdraw_request: "💸 **Withdrawal Request**\nUser: {user}\nAmount: {amt} Stars\nReqID: {reqid}",
    admin_complete_btn: "✅ Complete",
    withdraw_complete_admin: "✅ Withdrawal Completed.",
    withdraw_complete_user: "✅ Your withdrawal of {amt} Stars has been completed!",
    stake_returned: "Stake returned.",
    you_surrendered: "You surrendered!",
    trophies: "Trophies",
    stars: "Stars",
    queue_timeout: "⌛ Search timed out. No opponent found within 1 minute."
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
    win_round: "🎉 Вы выиграли раунд!",
    lose_round: "💀 Вы проиграли раунд.",
    draw_round: "🤝 Раунд вничью.",
    win_match: "🏆 ВЫ ВЫИГРАЛИ МАТЧ!\n+{reward} {currency}",
    lose_match: "😢 ВЫ ПРОИГРАЛИ МАТЧ.\n-{lost} {currency}",
    draw_match: "🤝 Матч закончился вничью.",
    bonus_claimed: "🎁 Вы получили 10 Звезд и 5 Кубков!",
    bonus_wait: "⏳ Бонус пока недоступен.",
    insufficient_stars: "❌ Недостаточно звезд (Нужна 1).",
    withdraw_info: "💸 Для вывода нужно минимум 50 Звезд.\nБаланс: {s}",
    withdraw_btn: "💸 Запросить вывод",
    withdraw_sent: "✅ Заявка отправлена админу.",
    withdraw_fail: "❌ Нельзя вывести (Мин 50).",
    game_over: "🏁 Игра окончена",
    surrender: "🏳️ Сдаться",
    game_header: "Раунд {rounds}/3 | Счёт: {score}\nПротив {opp}\n\n{turnText}",
    profile: "👤 **Профиль**\n\nID: `{id}`\n🏆 Кубки: {trophies}\n⭐️ Звёзды: {stars}\n📊 Матчи: {matchesPlayed}\n🏅 Победы: {wins}",
    leaderboard_title: "🏅 **Топ 10 по кубкам**\n\n",
    leaderboard_entry: "{i}. ID:{uid} - 🏆 {score}\n",
    admin_panel: "🕵️‍♂️ **Панель админа (@Masakoff)**\n\nПользователей: {totalUsers}\nАктивных (24ч): {active24h}\nМатчей: {matches}\n\nКоманды:\n/add_stars [id] [amount]\n/remove_stars [id] [amount]",
    add_stars_confirm: "Добавлено {amt} звёзд пользователю {uid}. Новый баланс: {bal}",
    add_stars_notify: "Админ добавил {amt} звёзд на ваш баланс.",
    remove_stars_confirm: "Удалено {amt} звёзд у {uid}. Новый баланс: {bal}",
    remove_stars_notify: "Админ удалил {amt} звёзд с вашего баланса.",
    withdraw_request: "💸 **Запрос на вывод**\nПользователь: {user}\nСумма: {amt} звёзд\nReqID: {reqid}",
    admin_complete_btn: "✅ Завершить",
    withdraw_complete_admin: "✅ Вывод завершён.",
    withdraw_complete_user: "✅ Ваш вывод {amt} звёзд завершён!",
    stake_returned: "Ставка возвращена.",
    you_surrendered: "Вы сдались!",
    trophies: "кубков",
    stars: "звёзд",
    queue_timeout: "⌛ Поиск прерван. Соперник не найден за 1 минуту."
  }
};

// --- RUNTIME STATE ---
// We keep active matches in memory for speed, profiles in KV
const activeMatches: Map<string, Match> = new Map();
let trophyQueue: QueueEntry[] = [];
let starQueue: QueueEntry[] = [];
let adminChatId: number | null = null; // Discovered dynamically

// --- HELPERS ---

function t(lang: Lang | null, key: keyof typeof TEXTS["en"], params: Record<string, any> = {}): string {
  const l = lang || "en";
  let str = TEXTS[l][key];
  for (const k in params) {
    str = str.replace(`{${k}}`, String(params[k]));
  }
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
  } catch (e) {
    console.error(`API Error ${method}:`, e);
  }
}

async function getProfile(userId: number): Promise<UserProfile> {
  const res = await kv.get<UserProfile>(["users", userId]);
  if (res.value) return res.value;
  // Default profile
  return {
    id: userId,
    firstName: "Player",
    language: null,
    trophies: 0,
    stars: 5, // Start with 5 stars bonus
    matchesPlayed: 0,
    wins: 0,
    lastDailyBonus: 0,
    lastActive: Date.now()
  };
}

async function saveProfile(profile: UserProfile) {
  await kv.set(["users", profile.id], profile);
  // Also index for leaderboard
  await kv.set(["leaderboard", "trophies", profile.id], profile.trophies);
  await kv.set(["leaderboard", "stars", profile.id], profile.stars);
}

// --- QUEUE CLEANUP ---
async function cleanQueues() {
  const now = Date.now();
  const clean = async (queue: QueueEntry[], isStar: boolean) => {
    const newQueue: QueueEntry[] = [];
    for (const entry of queue) {
      if (now - entry.joinTime > 60000) {
        const p = await getProfile(entry.userId);
        let msg = t(p.language, "queue_timeout");
        if (isStar) {
          p.stars += 1;
          await saveProfile(p);
          msg += "\n" + t(p.language, "stake_returned");
        }
        await api("sendMessage", { chat_id: entry.userId, text: msg });
      } else {
        newQueue.push(entry);
      }
    }
    return newQueue;
  };
  trophyQueue = await clean(trophyQueue, false);
  starQueue = await clean(starQueue, true);
}

setInterval(() => cleanQueues(), 10000);

// --- GAME LOGIC ---

function checkWin(board: string[]): string | null {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (!board.includes("")) return "draw";
  return null;
}

function getBoardMarkup(match: Match, lang: Lang) {
  const keyboard = [];
  for (let i = 0; i < 3; i++) {
    const row = [];
    for (let j = 0; j < 3; j++) {
      const idx = i * 3 + j;
      const val = match.board[idx];
      const text = val === "" ? " " : val === "X" ? "❌" : "⭕";
      row.push({ text: text, callback_data: `gm:${match.id}:${idx}` });
    }
    keyboard.push(row);
  }
  // Surrender button
  keyboard.push([{ text: t(lang, "surrender"), callback_data: `surr:${match.id}` }]);
  return { inline_keyboard: keyboard };
}

async function sendMatchUpdate(match: Match) {
  const p1 = await getProfile(match.p1);
  const p2 = await getProfile(match.p2);

  const send = async (userId: number, oppName: string, mark: string) => {
    const lang = (p1.id === userId ? p1.language : p2.language) as Lang;
    const isTurn = match.turn === userId;
    const turnText = isTurn 
      ? t(lang, "your_turn", { mark })
      : t(lang, "opp_turn");
    
    const header = t(lang, "game_header", {
      rounds: match.rounds,
      score: `${match.wins[match.p1]}-${match.wins[match.p2]}`,
      opp: oppName,
      turnText
    });
    
    // Attempt edit, if fail (message too old/missing) send new
    if (match.msgIds[userId]) {
      const res = await api("editMessageText", {
        chat_id: userId,
        message_id: match.msgIds[userId],
        text: header,
        reply_markup: getBoardMarkup(match, lang)
      });
      if (!res.ok) match.msgIds[userId] = 0; // Trigger resend if edit failed
    } 
    
    if (!match.msgIds[userId]) {
      const res = await api("sendMessage", {
        chat_id: userId,
        text: header,
        reply_markup: getBoardMarkup(match, lang)
      });
      if (res.result) match.msgIds[userId] = res.result.message_id;
    }
  };

  await send(match.p1, p2.firstName, "❌");
  await send(match.p2, p1.firstName, "⭕");
}

async function endRound(match: Match, winnerMark: string | "draw") {
  const p1 = await getProfile(match.p1);
  const p2 = await getProfile(match.p2);
  
  // Logic: Best of 3
  if (winnerMark === "X") match.wins[match.p1]++;
  if (winnerMark === "O") match.wins[match.p2]++;

  // Check Match Over
  const p1Wins = match.wins[match.p1];
  const p2Wins = match.wins[match.p2];
  let matchWinner: number | null = null;
  let matchLoser: number | null = null;
  let isDraw = false;

  if (p1Wins >= 2) { matchWinner = match.p1; matchLoser = match.p2; }
  else if (p2Wins >= 2) { matchWinner = match.p2; matchLoser = match.p1; }
  else if (match.rounds >= 3) {
    if (p1Wins > p2Wins) { matchWinner = match.p1; matchLoser = match.p2; }
    else if (p2Wins > p1Wins) { matchWinner = match.p2; matchLoser = match.p1; }
    else isDraw = true;
  }

  if (matchWinner !== null || isDraw) {
    // End Match
    activeMatches.delete(match.id);
    
    if (isDraw) {
        // Tie logic
        let drawTextP1 = t(p1.language, "draw_match");
        let drawTextP2 = t(p2.language, "draw_match");
        // Return stake for stars?
        if (match.type === "star") {
           // Return the 1 star to each
           p1.stars += 1; p2.stars += 1;
           await saveProfile(p1); await saveProfile(p2);
           drawTextP1 += "\n" + t(p1.language, "stake_returned");
           drawTextP2 += "\n" + t(p2.language, "stake_returned");
        }
        await api("sendMessage", { chat_id: match.p1, text: drawTextP1 });
        await api("sendMessage", { chat_id: match.p2, text: drawTextP2 });
    } else if (matchWinner && matchLoser) {
        const winnerProfile = matchWinner === match.p1 ? p1 : p2;
        const loserProfile = matchWinner === match.p1 ? p2 : p1;

        winnerProfile.matchesPlayed++;
        winnerProfile.wins++;
        loserProfile.matchesPlayed++;

        let reward = 0;
        let lost = 0;
        const currencyKey = match.type === "trophy" ? "trophies" : "stars";
        const currency = t(winnerProfile.language, currencyKey);

        if (match.type === "trophy") {
            reward = 1; lost = 1;
            winnerProfile.trophies += 1;
            loserProfile.trophies = Math.max(0, loserProfile.trophies - 1);
        } else {
            // Star match
            reward = 1.5; lost = 1;
            winnerProfile.stars += 1.5;
            // Loser already paid 1 star to enter, so we don't deduct again, just don't refund.
        }

        await saveProfile(winnerProfile);
        await saveProfile(loserProfile);

        await api("sendMessage", { 
            chat_id: winnerProfile.id, 
            text: t(winnerProfile.language, "win_match", { reward, currency }) 
        });
        await api("sendMessage", { 
            chat_id: loserProfile.id, 
            text: t(loserProfile.language, "lose_match", { lost, currency: t(loserProfile.language, currencyKey) }) 
        });

        // Admin stats update
        const statsKey = ["stats", "total_matches"];
        const cur = await kv.get<number>(statsKey);
        await kv.set(statsKey, (cur.value || 0) + 1);
    }

    // Send Main Menu again
    setTimeout(() => sendMainMenu(match.p1), 1000);
    setTimeout(() => sendMainMenu(match.p2), 1000);

  } else {
    // Next Round
    match.rounds++;
    match.board = Array(9).fill("");
    // Swap turn
    match.turn = match.rounds % 2 !== 0 ? match.p1 : match.p2;
    await sendMatchUpdate(match);
  }
}

async function tryMatchmaking() {
  // Trophy Queue
  if (trophyQueue.length >= 2) {
    const e1 = trophyQueue.shift()!;
    const e2 = trophyQueue.shift()!;
    if (e1.userId === e2.userId) {
      trophyQueue.push(e1); // Push back one
      return;
    }
    createMatch(e1.userId, e2.userId, "trophy");
  }

  // Star Queue
  if (starQueue.length >= 2) {
    const e1 = starQueue.shift()!;
    const e2 = starQueue.shift()!;
    if (e1.userId === e2.userId) {
      starQueue.push(e1);
      return;
    }
    createMatch(e1.userId, e2.userId, "star");
  }
}

async function createMatch(p1Id: number, p2Id: number, type: "trophy" | "star") {
  const matchId = crypto.randomUUID();
  const match: Match = {
    id: matchId,
    p1: p1Id,
    p2: p2Id,
    type,
    board: Array(9).fill(""),
    turn: p1Id,
    p1Mark: "X",
    p2Mark: "O",
    rounds: 1,
    wins: { [p1Id]: 0, [p2Id]: 0 },
    msgIds: {},
    active: true
  };
  
  activeMatches.set(matchId, match);

  // Notify
  const p1 = await getProfile(p1Id);
  const p2 = await getProfile(p2Id);
  
  await api("sendMessage", { chat_id: p1Id, text: t(p1.language, "match_found") });
  await api("sendMessage", { chat_id: p2Id, text: t(p2.language, "match_found") });

  await sendMatchUpdate(match);
}

// --- MENUS ---

async function sendMainMenu(userId: number) {
  const p = await getProfile(userId);
  if (!p.language) return sendLangSelection(userId);

  const text = t(p.language, "menu", { t: p.trophies, s: p.stars });
  const kb = {
    inline_keyboard: [
      [{ text: t(p.language, "btn_trophy"), callback_data: "play:trophy" }],
      [{ text: t(p.language, "btn_star"), callback_data: "play:star" }],
      [{ text: t(p.language, "btn_profile"), callback_data: "menu:profile" }, { text: t(p.language, "btn_leaderboard"), callback_data: "menu:leaderboard" }],
      [{ text: t(p.language, "btn_bonus"), callback_data: "menu:bonus" }]
    ]
  };
  await api("sendMessage", { chat_id: userId, text, reply_markup: kb });
}

async function sendLangSelection(userId: number) {
  await api("sendMessage", {
    chat_id: userId,
    text: TEXTS.en.choose_lang + "\n" + TEXTS.ru.choose_lang,
    reply_markup: {
      inline_keyboard: [[
        { text: "🇺🇸 English", callback_data: "lang:en" },
        { text: "🇷🇺 Русский", callback_data: "lang:ru" }
      ]]
    }
  });
}

async function sendAdminPanel(userId: number) {
  const p = await getProfile(userId);
  // Calculate Stats
  const usersIt = kv.list({ prefix: ["users"] });
  let totalUsers = 0;
  let active24h = 0;
  const now = Date.now();
  for await (const entry of usersIt) {
    totalUsers++;
    const u = entry.value as UserProfile;
    if (u.lastActive > now - 86400000) active24h++;
  }
  
  const matches = (await kv.get<number>(["stats", "total_matches"])).value || 0;
  
  const text = t(p.language, "admin_panel", { totalUsers, active24h, matches });
  await api("sendMessage", { chat_id: userId, text, parse_mode: "Markdown" });
}

// --- HANDLERS ---

async function handleUpdate(update: any) {
  let userId: number | undefined;
  let username: string | undefined;

  if (update.message) {
    const m = update.message;
    userId = m.from.id;
    username = m.from.username;
  } else if (update.callback_query) {
    const cb = update.callback_query;
    userId = cb.from.id;
    username = cb.from.username;
  }

  if (!userId) return;

  // Update lastActive
  let p = await getProfile(userId);
  p.lastActive = Date.now();
  await saveProfile(p);

  // Save Admin ID if username matches
  if (username === ADMIN_USERNAME) {
      adminChatId = userId;
      await kv.set(["config", "admin_id"], userId);
  }

  if (update.message) {
    const m = update.message;
    const text = m.text || "";

    if (text === "/start") {
      // Initialize or fetch user
      p = await getProfile(userId);
      p.username = username;
      p.firstName = m.from.first_name;
      await saveProfile(p);
      
      if (!p.language) {
        await sendLangSelection(userId);
      } else {
        await sendMainMenu(userId);
      }
    } else if (text === "/admin") {
      if (username === ADMIN_USERNAME) {
        await sendAdminPanel(userId);
      }
    } else if (text.startsWith("/add_stars") && username === ADMIN_USERNAME) {
       const parts = text.split(" ");
       if(parts.length === 3) {
           const targetId = parseInt(parts[1]);
           const amt = parseFloat(parts[2]);
           const targetP = await getProfile(targetId);
           targetP.stars += amt;
           await saveProfile(targetP);
           await api("sendMessage", { chat_id: userId, text: t(p.language, "add_stars_confirm", {amt, uid: targetId, bal: targetP.stars})});
           await api("sendMessage", { chat_id: targetId, text: t(targetP.language, "add_stars_notify", {amt})});
       }
    } else if (text.startsWith("/remove_stars") && username === ADMIN_USERNAME) {
       const parts = text.split(" ");
       if(parts.length === 3) {
           const targetId = parseInt(parts[1]);
           const amt = parseFloat(parts[2]);
           const targetP = await getProfile(targetId);
           targetP.stars = Math.max(0, targetP.stars - amt);
           await saveProfile(targetP);
           await api("sendMessage", { chat_id: userId, text: t(p.language, "remove_stars_confirm", {amt, uid: targetId, bal: targetP.stars})});
           await api("sendMessage", { chat_id: targetId, text: t(targetP.language, "remove_stars_notify", {amt})});
       }
    }
  } else if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data;
    const msgId = cb.message.message_id;

    p = await getProfile(userId);
    
    if (data.startsWith("lang:")) {
      const lang = data.split(":")[1] as Lang;
      p.language = lang;
      await saveProfile(p);
      await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Language saved!" });
      await sendMainMenu(userId);
    } 
    else if (data === "menu:profile") {
      const txt = t(p.language, "profile", { 
        id: p.id, 
        trophies: p.trophies, 
        stars: p.stars, 
        matchesPlayed: p.matchesPlayed, 
        wins: p.wins 
      });
      const kb = { inline_keyboard: [[{ text: t(p.language, "withdraw_btn"), callback_data: "withdraw" }]] };
      await api("sendMessage", { chat_id: userId, text: txt, parse_mode: "Markdown", reply_markup: kb });
    }
    else if (data === "menu:bonus") {
       const now = Date.now();
       if (now - p.lastDailyBonus > 86400000) { // 24 hours
           p.stars += 10;
           p.trophies += 5;
           p.lastDailyBonus = now;
           await saveProfile(p);
           await api("answerCallbackQuery", { callback_query_id: cb.id, text: t(p.language, "bonus_claimed"), show_alert: true });
       } else {
           await api("answerCallbackQuery", { callback_query_id: cb.id, text: t(p.language, "bonus_wait"), show_alert: true });
       }
    }
    else if (data === "menu:leaderboard") {
        const entries: {uid: number, score: number}[] = [];
        for await (const entry of kv.list({ prefix: ["leaderboard", "trophies"] })) {
          entries.push({ uid: entry.key[2] as number, score: entry.value as number });
        }
        entries.sort((a, b) => b.score - a.score);
        let txt = t(p.language, "leaderboard_title");
        entries.slice(0, 10).forEach((e, index) => {
          txt += t(p.language, "leaderboard_entry", { i: index + 1, uid: e.uid, score: e.score });
        });
        await api("sendMessage", { chat_id: userId, text: txt, parse_mode: "Markdown" });
    }
    else if (data === "withdraw") {
        if (p.stars >= 50) {
            // Initiate withdrawal - fixed 50 for simplicity
            p.stars -= 50;
            await saveProfile(p);
            
            // Store request
            const reqId = crypto.randomUUID();
            await kv.set(["withdrawals", reqId], { userId, amount: 50, status: "pending" });
            
            await api("sendMessage", { chat_id: userId, text: t(p.language, "withdraw_sent") });
            
            // Notify Admin
            if (!adminChatId) {
                 const res = await kv.get(["config", "admin_id"]);
                 if (res.value) adminChatId = res.value as number;
            }
            
            if (adminChatId) {
                const adminP = await getProfile(adminChatId);
                await api("sendMessage", { 
                    chat_id: adminChatId, 
                    text: t(adminP.language, "withdraw_request", { user: userId, amt: 50, reqid: reqId }),
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[{ text: t(adminP.language, "admin_complete_btn"), callback_data: `admin_pay:${reqId}:${userId}` }]]
                    }
                });
            }
        } else {
             await api("answerCallbackQuery", { callback_query_id: cb.id, text: t(p.language, "withdraw_fail"), show_alert: true });
        }
    }
    else if (data.startsWith("admin_pay:")) {
        // format: admin_pay:reqId:userId
        if (userId !== adminChatId) return;
        const [_, reqId, targetUserStr] = data.split(":");
        const targetId = parseInt(targetUserStr);
        const targetP = await getProfile(targetId);
        
        await kv.delete(["withdrawals", reqId]);
        await api("editMessageText", { chat_id: userId, message_id: msgId, text: t(p.language, "withdraw_complete_admin") });
        await api("sendMessage", { chat_id: targetId, text: t(targetP.language, "withdraw_complete_user", {amt: 50}) });
    }
    else if (data.startsWith("play:")) {
        const type = data.split(":")[1];
        
        // Anti-cheat: Check if already in queue or game
        let inGame = false;
        for (const m of activeMatches.values()) {
            if (m.p1 === userId || m.p2 === userId) inGame = true;
        }
        const inTrophyQueue = trophyQueue.some(e => e.userId === userId);
        const inStarQueue = starQueue.some(e => e.userId === userId);
        if (inGame || inTrophyQueue || inStarQueue) {
            await api("answerCallbackQuery", { callback_query_id: cb.id, text: "⚠️ You are already in a game or queue!", show_alert: true });
            return;
        }

        if (type === "star") {
            if (p.stars < 1) {
                await api("answerCallbackQuery", { callback_query_id: cb.id, text: t(p.language, "insufficient_stars"), show_alert: true });
                return;
            }
            // Deduct stake immediately
            p.stars -= 1;
            await saveProfile(p);
            starQueue.push({ userId, joinTime: Date.now() });
        } else {
            trophyQueue.push({ userId, joinTime: Date.now() });
        }
        
        await api("sendMessage", { chat_id: userId, text: t(p.language, "joined_queue") });
        await tryMatchmaking();
    }
    else if (data.startsWith("gm:")) {
        // Game Move: gm:matchId:cellIndex
        const [_, matchId, cellIdxStr] = data.split(":");
        const cellIdx = parseInt(cellIdxStr);
        const match = activeMatches.get(matchId);
        
        if (!match) {
             await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Game not found." });
             return;
        }
        if (match.turn !== userId) {
             await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Not your turn!", show_alert: true });
             return;
        }
        if (match.board[cellIdx] !== "") {
             await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Cell occupied!", show_alert: true });
             return;
        }
        
        // Execute Move
        const mark = match.turn === match.p1 ? match.p1Mark : match.p2Mark;
        match.board[cellIdx] = mark;
        
        // Check Round Win
        const win = checkWin(match.board);
        if (win) {
            let alertText: string;
            if (win === "draw") {
              alertText = t(p.language, "draw_round");
            } else {
              alertText = t(p.language, "win_round");
            }
            await api("answerCallbackQuery", { callback_query_id: cb.id, text: alertText, show_alert: true });
            await endRound(match, win);
        } else {
            // Next turn
            match.turn = match.turn === match.p1 ? match.p2 : match.p1;
            await sendMatchUpdate(match);
            await api("answerCallbackQuery", { callback_query_id: cb.id });
        }
    }
    else if (data.startsWith("surr:")) {
        const matchId = data.split(":")[1];
        const match = activeMatches.get(matchId);
        if (match && (match.p1 === userId || match.p2 === userId)) {
            await api("answerCallbackQuery", { callback_query_id: cb.id, text: t(p.language, "you_surrendered"), show_alert: true });
            const winnerId = userId === match.p1 ? match.p2 : match.p1;
            // Force win for opponent for the whole match
            match.wins[winnerId] = 2;
            match.wins[userId] = 0;
            // Reuse endRound logic with "fake" winner mark to trigger finishMatch
            const winnerMark = winnerId === match.p1 ? "X" : "O";
            await endRound(match, winnerMark);
        }
    }
  }
}

// --- SERVER ---

console.log(`Bot running... Admin: ${ADMIN_USERNAME}`);

serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === "POST") {
      const update = await req.json();
      await handleUpdate(update);
    }
    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response("Error", { status: 500 });
  }
});
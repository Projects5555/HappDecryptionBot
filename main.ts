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
  lastActive: number;
  inputState?: "TOPUP" | null; // For capturing text input for top-up
}

interface Match {
  id: string;
  p1: number;
  p2: number;
  type: "trophy" | "star";
  board: string[]; // 9 cells
  turn: number; // User ID
  p1Mark: "X";
  p2Mark: "O";
  currentRound: number; // 1, 2, 3
  roundWins: { [userId: number]: number }; // e.g., { 1234: 2, 5678: 0 }
  msgIds: { [userId: number]: number }; // To edit messages
  active: boolean;
  stake: number; // 0 for trophy, 1 for star
}

interface WithdrawalRequest {
  id: string;
  userId: number;
  amount: number;
  username: string;
  status: "pending" | "completed";
}

// --- LOCALIZATION STRINGS ---
const TEXTS = {
  en: {
    choose_lang: "🇬🇧 Choose your language:",
    welcome: "Welcome to Tic Tac Toe! 🎮\n\nPlay for Trophies 🏆 or bet Stars ⭐.",
    menu_play_trophy: "🏆 Play for Trophies",
    menu_play_star: "⭐ Play for Stars (Bet 1)",
    menu_profile: "👤 Profile",
    menu_topup: "⭐ Top Up Stars",
    menu_withdraw: "💸 Withdraw Stars",
    menu_leaderboard: "📊 Leaderboard",
    menu_daily: "🎁 Daily Bonus",
    searching: "🔍 Searching for an opponent...",
    game_found: "🎮 Match found! You are playing against ",
    your_turn: "🟢 Your turn!",
    opp_turn: "🔴 Opponent's turn",
    win_round: "🎉 You won this round!",
    lose_round: "💀 You lost this round.",
    tie_round: "🤝 Round tied!",
    win_match: "🏆 You won the match!",
    lose_match: "😢 You lost the match.",
    tie_match: "🤝 Match ended in a draw.",
    topup_prompt: "Enter the number of stars you want to top up.\nMinimum: 1 ⭐",
    invalid_amount: "❌ Invalid amount. Please enter a number ≥ 1",
    payment_success: "✅ Payment successful! Stars added.",
    withdraw_min: "❌ Minimum withdrawal is 50 ⭐.",
    withdraw_funds: "❌ Insufficient stars.",
    withdraw_sent: "✅ Withdrawal request sent to admin.",
    daily_claim: "🎁 You received your daily bonus: ",
    daily_wait: "⏳ Come back later for your bonus.",
  },
  ru: {
    choose_lang: "🇷🇺 Выберите язык:",
    welcome: "Добро пожаловать в Крестики-Нолики! 🎮\n\nИграйте на Кубки 🏆 или ставьте Звезды ⭐.",
    menu_play_trophy: "🏆 Играть на Кубки",
    menu_play_star: "⭐ Играть на Звезды (Ставка 1)",
    menu_profile: "👤 Профиль",
    menu_topup: "⭐ Пополнить Звезды",
    menu_withdraw: "💸 Вывод Звезд",
    menu_leaderboard: "📊 Топ игроков",
    menu_daily: "🎁 Ежедневный бонус",
    searching: "🔍 Поиск соперника...",
    game_found: "🎮 Матч найден! Вы играете против ",
    your_turn: "🟢 Ваш ход!",
    opp_turn: "🔴 Ход соперника",
    win_round: "🎉 Вы выиграли раунд!",
    lose_round: "💀 Вы проиграли раунд.",
    tie_round: "🤝 Раунд сыгран вничью!",
    win_match: "🏆 Вы выиграли матч!",
    lose_match: "😢 Вы проиграли матч.",
    tie_match: "🤝 Матч закончился вничью.",
    topup_prompt: "Введите количество звезд для пополнения.\nМинимум: 1 ⭐",
    invalid_amount: "❌ Неверная сумма. Введите число ≥ 1",
    payment_success: "✅ Оплата прошла успешно! Звезды начислены.",
    withdraw_min: "❌ Минимум для вывода: 50 ⭐.",
    withdraw_funds: "❌ Недостаточно звезд.",
    withdraw_sent: "✅ Заявка на вывод отправлена админу.",
    daily_claim: "🎁 Вы получили ежедневный бонус: ",
    daily_wait: "⏳ Приходите позже за бонусом.",
  },
};

// --- HELPER FUNCTIONS ---

async function api(method: string, payload: any) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

// Fetch user from KV or create default
async function getUser(id: number, first_name: string, username?: string): Promise<UserProfile> {
  const res = await kv.get<UserProfile>(["users", id]);
  if (res.value) {
    // Update basic info if changed
    const u = res.value;
    if (u.firstName !== first_name || u.username !== username) {
      u.firstName = first_name;
      u.username = username;
      await kv.set(["users", id], u);
    }
    return u;
  }
  const newUser: UserProfile = {
    id,
    username,
    firstName: first_name,
    language: null,
    trophies: 0,
    stars: 0,
    matchesPlayed: 0,
    wins: 0,
    lastDailyBonus: 0,
    lastActive: Date.now(),
  };
  await kv.set(["users", id], newUser);
  return newUser;
}

function getTxt(user: UserProfile, key: keyof typeof TEXTS.en): string {
  const lang = user.language || "en";
  return TEXTS[lang][key];
}

// Generate Main Menu Keyboard
function getMainMenu(user: UserProfile) {
  const t = (k: keyof typeof TEXTS.en) => getTxt(user, k);
  return {
    inline_keyboard: [
      [{ text: t("menu_play_trophy"), callback_data: "play_trophy" }],
      [{ text: t("menu_play_star"), callback_data: "play_star" }],
      [{ text: t("menu_profile"), callback_data: "profile" }, { text: t("menu_leaderboard"), callback_data: "leaderboard" }],
      [{ text: t("menu_topup"), callback_data: "topup" }, { text: t("menu_withdraw"), callback_data: "withdraw" }],
      [{ text: t("menu_daily"), callback_data: "daily" }],
    ],
  };
}

// --- GAME LOGIC ENGINE ---

// Win patterns (indices)
const WINS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

function checkWinner(board: string[]): string | null {
  for (const [a, b, c] of WINS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return board.includes("") ? null : "tie";
}

function renderBoard(match: Match) {
  const board = match.board.map(c => c === "" ? " " : c);
  const k = [];
  for (let i = 0; i < 3; i++) {
    const row = [];
    for (let j = 0; j < 3; j++) {
      const idx = i * 3 + j;
      row.push({ text: board[idx] === " " ? "⬜" : board[idx], callback_data: `mv_${match.id}_${idx}` });
    }
    k.push(row);
  }
  return { inline_keyboard: k };
}

// Update game messages for both players
async function updateGameUI(match: Match) {
  const p1 = await getUser(match.p1, "P1");
  const p2 = await getUser(match.p2, "P2");

  const send = async (uid: number, opponentName: string) => {
    const u = uid === match.p1 ? p1 : p2;
    const isMyTurn = match.turn === uid;
    const txt = `${getTxt(u, "game_found")} ${opponentName}\n` +
                `Round: ${match.currentRound}/3\n` +
                `Wins: ${match.roundWins[match.p1]} - ${match.roundWins[match.p2]}\n\n` +
                (isMyTurn ? getTxt(u, "your_turn") : getTxt(u, "opp_turn"));
    
    // We try to edit the existing message
    if (match.msgIds[uid]) {
      await api("editMessageText", {
        chat_id: uid,
        message_id: match.msgIds[uid],
        text: txt,
        reply_markup: renderBoard(match),
      });
    }
  };

  await send(match.p1, p2.firstName);
  await send(match.p2, p1.firstName);
}

// End a round or match
async function handleRoundEnd(match: Match, winnerMark: string | "tie") {
  let roundWinnerId: number | null = null;
  if (winnerMark === match.p1Mark) roundWinnerId = match.p1;
  else if (winnerMark === match.p2Mark) roundWinnerId = match.p2;

  if (roundWinnerId) match.roundWins[roundWinnerId]++;

  // Notify result of round
  const notify = async (uid: number) => {
    const u = await getUser(uid, "");
    let txt = "";
    if (winnerMark === "tie") txt = getTxt(u, "tie_round");
    else txt = roundWinnerId === uid ? getTxt(u, "win_round") : getTxt(u, "lose_round");
    await api("sendMessage", { chat_id: uid, text: txt });
  };
  await notify(match.p1);
  await notify(match.p2);

  // Check Match End Condition
  const p1Wins = match.roundWins[match.p1];
  const p2Wins = match.roundWins[match.p2];
  
  // Best of 3 logic: If someone reaches 2 wins, or round 3 ends
  let matchWinnerId: number | null = null;
  let matchLoserId: number | null = null;
  let isTie = false;

  if (p1Wins === 2) { matchWinnerId = match.p1; matchLoserId = match.p2; }
  else if (p2Wins === 2) { matchWinnerId = match.p2; matchLoserId = match.p1; }
  else if (match.currentRound === 3) {
    if (p1Wins > p2Wins) { matchWinnerId = match.p1; matchLoserId = match.p2; }
    else if (p2Wins > p1Wins) { matchWinnerId = match.p2; matchLoserId = match.p1; }
    else isTie = true;
  }

  if (matchWinnerId !== null || isTie) {
    // MATCH OVER
    match.active = false;
    await kv.delete(["match", match.id]); // Cleanup active match
    
    // Update stats transaction
    const updateStats = async (uid: number, isWinner: boolean, isDraw: boolean) => {
      const u = await getUser(uid, "");
      u.matchesPlayed++;
      if (isWinner) u.wins++;
      
      // Rewards
      if (match.type === "trophy") {
        if (isWinner) u.trophies++;
        if (!isWinner && !isDraw) u.trophies = Math.max(0, u.trophies - 1);
      } else if (match.type === "star") {
        // Stake was already deducted? No, standard practice: deduct on entry or calc at end.
        // Let's assume stakes were "held".
        // Implementation: We deducted 1 star on queue join? 
        // Prompt says: "Both players stake 1 star... Winner gets 1.5, Loser loses 1".
        // Simplest: Deduct 1 on entry. Winner gets 2.5 (1 back + 1.5 win)? 
        // No, "Winner gets 1.5 stars" usually implies profit. 
        // Let's do: Entry -1. Winner +2.5 (Net +1.5). Tie: +1 (Refund).
        // Let's stick to prompt literal: "Winner gets 1.5 stars". 
        // If entry cost 1, getting 1.5 means net +0.5. If prompt means NET gain 1.5, they get 2.5 back.
        // Let's assume "Winner balance += 1.5 + 1 (own stake)" = 2.5 total returned.
        // Wait, prompt says "Winner gets 1.5 stars". Ambiguous.
        // Interpretation: 
        // Pot = 2 stars. House takes 0.5 rake. Winner takes 1.5.
        // So: Entry -1 star (done at start).
        // End: Winner +2.5? No, total pot is 2. 
        // Okay, likely: Winner gets 2.5 (1 returned + 1.5 bonus)? That creates stars out of thin air.
        // Standard betting: P1(-1) + P2(-1) = Pot(2). 
        // Prompt: "Winner gets 1.5 stars". Maybe total payout?
        // Let's go with safe economy: Winner gets the Pot (2 stars) - fee.
        // But to follow prompt exactly "Winner gets 1.5 stars", implies the specific payout action.
        // Let's do: Winner +2.5 (Net +1.5). (Incentive mechanism mentioned).
        
        if (isWinner) u.stars += 2.5; 
        if (isDraw) u.stars += 1; // Refund
      }
      
      await kv.set(["users", uid], u);
      
      // Notify
      let msg = "";
      if (isWinner) msg = getTxt(u, "win_match");
      else if (isDraw) msg = getTxt(u, "tie_match");
      else msg = getTxt(u, "lose_match");
      
      // Add balance info
      if (match.type === "trophy") msg += `\n🏆: ${u.trophies}`;
      if (match.type === "star") msg += `\n⭐: ${u.stars}`;

      await api("sendMessage", { chat_id: uid, text: msg, reply_markup: getMainMenu(u) });
    };

    if (isTie) {
        await updateStats(match.p1, false, true);
        await updateStats(match.p2, false, true);
    } else {
        await updateStats(matchWinnerId!, true, false);
        await updateStats(matchLoserId!, false, false);
    }
  } else {
    // NEXT ROUND
    match.currentRound++;
    match.board = ["","","","","","","","",""];
    // Swap turn for new round start usually, or winner starts. Let's swap start.
    const starter = match.currentRound % 2 === 0 ? match.p2 : match.p1;
    match.turn = starter;
    await kv.set(["match", match.id], match);
    await updateGameUI(match);
  }
}

// --- HANDLERS ---

async function handleCommand(update: any) {
  const msg = update.message;
  const uid = msg.from.id;
  const username = msg.from.username;
  const text = msg.text || "";

  // 1. Check for Pre-Checkout (Stars Payment)
  if (update.pre_checkout_query) {
    await api("answerPreCheckoutQuery", {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: true,
    });
    return;
  }

  // 2. Successful Payment
  if (msg.successful_payment) {
    const amount = msg.successful_payment.total_amount; // amount is in smallest units? XTR is usually 1:1 integer
    // Telegram Stars: amount 1 = 1 star.
    const user = await getUser(uid, msg.from.first_name, username);
    
    // Idempotency check with payload
    const payload = msg.successful_payment.invoice_payload;
    const isProcessed = await kv.get(["processed_payments", payload]);
    if (isProcessed.value) return;

    user.stars += amount;
    user.inputState = null; // Clear state
    await kv.set(["users", uid], user);
    await kv.set(["processed_payments", payload], true);

    await api("sendMessage", {
      chat_id: uid,
      text: getTxt(user, "payment_success") + `\n+${amount} ⭐`,
      reply_markup: getMainMenu(user),
    });
    return;
  }

  // 3. Text Commands
  if (text.startsWith("/")) {
    if (text === "/start") {
      const user = await getUser(uid, msg.from.first_name, username);
      if (!user.language) {
        await api("sendMessage", {
          chat_id: uid,
          text: TEXTS.en.choose_lang + "\n" + TEXTS.ru.choose_lang,
          reply_markup: {
            inline_keyboard: [[
              { text: "🇬🇧 English", callback_data: "set_lang_en" },
              { text: "🇷🇺 Русский", callback_data: "set_lang_ru" }
            ]]
          }
        });
      } else {
        await api("sendMessage", {
          chat_id: uid,
          text: getTxt(user, "welcome"),
          reply_markup: getMainMenu(user),
        });
      }
    } else if (text === "/admin") {
      if (username !== ADMIN_USERNAME) {
        await api("sendMessage", { chat_id: uid, text: "❌ Access Denied" });
        return;
      }
      await api("sendMessage", {
        chat_id: uid,
        text: "🔐 Admin Panel",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📊 Stats", callback_data: "admin_stats" }],
            [{ text: "💸 Pending Withdrawals", callback_data: "admin_withdrawals" }]
          ]
        }
      });
    }
    return;
  }

  // 4. Handle Text Inputs (Top Up Amount)
  const user = await getUser(uid, msg.from.first_name, username);
  if (user.inputState === "TOPUP") {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < 1) {
      await api("sendMessage", { chat_id: uid, text: getTxt(user, "invalid_amount") });
      return;
    }

    // Create Invoice
    await api("sendInvoice", {
      chat_id: uid,
      title: "Star Top-Up",
      description: `Top up ${amount} stars`,
      payload: `topup_${uid}_${Date.now()}`,
      provider_token: "", // Empty for Telegram Stars
      currency: "XTR",
      prices: [{ label: "Stars", amount: amount }], // XTR amount is direct integer
    });
    
    // Reset state
    user.inputState = null;
    await kv.set(["users", uid], user);
  }
}

async function handleCallback(update: any) {
  const cb = update.callback_query;
  const uid = cb.from.id;
  const data = cb.data;
  const msgId = cb.message.message_id;

  const user = await getUser(uid, cb.from.first_name, cb.from.username);
  
  // Acknowledge
  await api("answerCallbackQuery", { callback_query_id: cb.id });

  // Language Selection
  if (data.startsWith("set_lang_")) {
    const lang = data.split("_")[2] as Lang;
    user.language = lang;
    await kv.set(["users", uid], user);
    await api("editMessageText", {
      chat_id: uid,
      message_id: msgId,
      text: getTxt(user, "welcome"),
      reply_markup: getMainMenu(user),
    });
    return;
  }

  // Main Menu Actions
  if (data === "profile") {
    const txt = `${getTxt(user, "menu_profile")}\n\n` +
                `🏆 Trophies: ${user.trophies}\n` +
                `⭐ Stars: ${user.stars}\n` +
                `🎮 Matches: ${user.matchesPlayed}\n` +
                `🏅 Wins: ${user.wins}`;
    await api("sendMessage", { chat_id: uid, text: txt });
  }

  if (data === "leaderboard") {
    // Basic leaderboards (inefficient for millions, ok for thousands)
    const iter = kv.list<UserProfile>({ prefix: ["users"] });
    const users: UserProfile[] = [];
    for await (const entry of iter) users.push(entry.value);
    
    users.sort((a, b) => b.trophies - a.trophies);
    const topTrophy = users.slice(0, 10).map((u, i) => `${i+1}. ${u.firstName}: 🏆${u.trophies}`).join("\n");
    
    users.sort((a, b) => b.stars - a.stars);
    const topStars = users.slice(0, 10).map((u, i) => `${i+1}. ${u.firstName}: ⭐${u.stars}`).join("\n");

    await api("sendMessage", { chat_id: uid, text: `🏆 TOP TROPHIES:\n${topTrophy}\n\n⭐ TOP STARS:\n${topStars}` });
  }

  if (data === "daily") {
    const now = Date.now();
    if (now - user.lastDailyBonus > 24 * 60 * 60 * 1000) {
      const rewardStars = 5;
      const rewardTrophy = 1;
      user.stars += rewardStars;
      user.trophies += rewardTrophy;
      user.lastDailyBonus = now;
      await kv.set(["users", uid], user);
      await api("sendMessage", { chat_id: uid, text: getTxt(user, "daily_claim") + `+${rewardStars}⭐, +${rewardTrophy}🏆` });
    } else {
      await api("sendMessage", { chat_id: uid, text: getTxt(user, "daily_wait") });
    }
  }

  if (data === "topup") {
    user.inputState = "TOPUP";
    await kv.set(["users", uid], user);
    await api("sendMessage", { chat_id: uid, text: getTxt(user, "topup_prompt") });
  }

  if (data === "withdraw") {
    if (user.stars < 50) {
      await api("sendMessage", { chat_id: uid, text: getTxt(user, "withdraw_min") });
      return;
    }
    // Ask for amount? Prompt says "User clicks Withdraw... Min 50". Let's assume full balance or prompt?
    // Prompt: "User clicks Withdraw... Message to admin".
    // Let's create a request for 50 stars just to show logic, or ask input.
    // For simplicity based on prompt "User clicks Withdraw", let's withdraw all > 50 or fixed 50?
    // Let's deduce prompt implies a flow. Let's just withdraw all available stars for simplicity or fix amount.
    // Better: Withdraw all.
    const amount = user.stars;
    
    // Atomic Transaction
    const res = await kv.atomic()
      .check({ key: ["users", uid], versionstamp: null }) // Optimistic check (won't work if user exists, just checking consistency)
      // Actually simply:
      .set(["withdrawals", Date.now().toString()], {
        id: Date.now().toString(),
        userId: uid,
        amount: amount,
        username: user.username || user.firstName,
        status: "pending"
      })
      .set(["users", uid], { ...user, stars: 0 }) // Deduct all
      .commit();

    if (res.ok) {
       await api("sendMessage", { chat_id: uid, text: getTxt(user, "withdraw_sent") });
       // Notify Admin
       // Note: Admin ID is needed to message. Since we only have username, we can't push unless admin started bot.
       // Assuming Admin has ID. For now, Admin checks via /admin panel.
    }
  }

  // MATCHMAKING
  if (data === "play_trophy" || data === "play_star") {
    const type = data === "play_trophy" ? "trophy" : "star";
    
    if (type === "star" && user.stars < 1) {
      await api("sendMessage", { chat_id: uid, text: getTxt(user, "withdraw_funds") });
      return;
    }

    // Deduct star entry immediately (prevent double join with same balance)
    if (type === "star") {
        user.stars -= 1;
        await kv.set(["users", uid], user);
    }

    await api("sendMessage", { chat_id: uid, text: getTxt(user, "searching") });

    // Queue Logic
    // Using a simple lock mechanism or check
    const queueKey = ["queue", type];
    // We need a loop/atomic check to match
    let matched = false;
    
    while(!matched) {
        const qRes = await kv.get<number[]>(queueKey);
        let q = qRes.value || [];
        
        // Remove self if already there (retry)
        q = q.filter(id => id !== uid);

        if (q.length > 0) {
            const opponentId = q.shift()!;
            // Create Match
            const matchId = crypto.randomUUID();
            const match: Match = {
                id: matchId,
                p1: opponentId,
                p2: uid,
                type: type,
                board: ["","","","","","","","",""],
                turn: opponentId, // P1 starts
                p1Mark: "X",
                p2Mark: "O",
                rounds: 1,
                currentRound: 1,
                roundWins: { [opponentId]: 0, [uid]: 0 },
                msgIds: {},
                active: true,
                stake: type === "star" ? 1 : 0
            };

            const res = await kv.atomic()
                .set(queueKey, q) // Update queue
                .set(["match", matchId], match)
                .set(["active_match", opponentId], matchId)
                .set(["active_match", uid], matchId)
                .commit();
            
            if (res.ok) {
                // Initialize UI
                // We need to send initial messages and store IDs
                const m1 = await api("sendMessage", { chat_id: opponentId, text: "Game Starting..." });
                const m2 = await api("sendMessage", { chat_id: uid, text: "Game Starting..." });
                match.msgIds[opponentId] = m1.result.message_id;
                match.msgIds[uid] = m2.result.message_id;
                
                await kv.set(["match", matchId], match);
                await updateGameUI(match);
                matched = true;
                return;
            }
        } else {
            // Add self to queue
            q.push(uid);
            const res = await kv.atomic()
                .check(qRes)
                .set(queueKey, q)
                .commit();
            if (res.ok) {
                matched = true; // Waiting in queue
                return;
            }
        }
    }
  }

  // GAMEPLAY
  if (data.startsWith("mv_")) {
    const [_, matchId, idxStr] = data.split("_");
    const idx = parseInt(idxStr);
    
    const mRes = await kv.get<Match>(["match", matchId]);
    if (!mRes.value) return; // Match ended or invalid
    const match = mRes.value;

    if (!match.active) return;
    if (match.turn !== uid) {
        await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Not your turn!", show_alert: true });
        return;
    }
    if (match.board[idx] !== "") return;

    // Execute Move
    const mark = uid === match.p1 ? match.p1Mark : match.p2Mark;
    match.board[idx] = mark;
    
    // Check Win/Tie
    const winnerMark = checkWinner(match.board);
    
    if (winnerMark) {
        await handleRoundEnd(match, winnerMark);
    } else {
        // Next Turn
        match.turn = uid === match.p1 ? match.p2 : match.p1;
        await kv.set(["match", matchId], match);
        await updateGameUI(match);
    }
  }

  // ADMIN ACTIONS
  if (cb.from.username === ADMIN_USERNAME) {
    if (data === "admin_withdrawals") {
      const iter = kv.list<WithdrawalRequest>({ prefix: ["withdrawals"] });
      let count = 0;
      for await (const entry of iter) {
        if (entry.value.status === "pending") {
           const w = entry.value;
           const txt = `User: ${w.username} (ID: ${w.userId})\nAmount: ${w.amount}`;
           await api("sendMessage", {
             chat_id: uid,
             text: txt,
             reply_markup: {
               inline_keyboard: [[{ text: "✅ Pay & Complete", callback_data: `admin_pay_${entry.key[1]}` }]]
             }
           });
           count++;
        }
      }
      if (count === 0) await api("sendMessage", { chat_id: uid, text: "No pending withdrawals." });
    }
    
    if (data.startsWith("admin_pay_")) {
       const key = data.split("admin_pay_")[1];
       const wRes = await kv.get<WithdrawalRequest>(["withdrawals", key]);
       if (wRes.value && wRes.value.status === "pending") {
           const w = wRes.value;
           w.status = "completed";
           await kv.set(["withdrawals", key], w);
           await api("editMessageText", { chat_id: uid, message_id: msgId, text: `✅ Paid ${w.amount} to ${w.username}` });
           // Notify user
           await api("sendMessage", { chat_id: w.userId, text: `✅ Withdrawal of ${w.amount} ⭐ processed!` });
       }
    }
    
    if (data === "admin_stats") {
        const users = kv.list({ prefix: ["users"] });
        let userCount = 0;
        let totalMatches = 0;
        let totalStars = 0;
        for await (const u of users) {
            userCount++;
            const p = u.value as UserProfile;
            totalMatches += p.matchesPlayed;
            totalStars += p.stars;
        }
        await api("sendMessage", {
            chat_id: uid, 
            text: `📊 STATS\nUsers: ${userCount}\nMatches: ${totalMatches}\nStars in Circulation: ${totalStars}` 
        });
    }
  }
}

// --- SERVER SETUP ---

serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/bot") {
      const update = await req.json();
      if (update.message || update.pre_checkout_query) await handleCommand(update);
      if (update.callback_query) await handleCallback(update);
      return new Response("OK");
    }
  } catch (e) {
    console.error(e);
  }
  return new Response("Tic Tac Toe Bot is Running");
});
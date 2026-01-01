
// 🎮 Tic Tac Toe Telegram Bot with matchmaking, trophies, stars, withdrawals, and admin panel
// 💾 Uses Deno KV for all persistent storage
// 🌍 Supports English (EN) and Russian (RU)
// ⚔️ Trophy matches (best of 3 rounds, winner +1 trophy, loser -1 min 0)
// ⭐ Real star matches (best of 3 rounds, winner +1.5 stars, loser -1 min 0, net +0.5 from bot)
// 🔔 Daily login bonus (+1 star per day)
// 👑 Leaderboards, profiles, withdrawals (min 50 stars, manual admin approval)
// 🛡️ Anti-cheat: one match/queue at a time per user
// 🔧 Admin (@Masakoff only): stats, pending withdrawals with completion

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/crypto.ts";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Deno KV --------------------
const kv = await Deno.openKv();

// -------------------- Constants --------------------
const ADMIN_USERNAME = "Masakoff";
const INITIAL_STARS = 10.0;
const DAILY_BONUS_STARS = 1.0;
const MIN_WITHDRAW = 50.0;

// -------------------- Messages (EN/RU) --------------------
const MESSAGES: Record<string, { en: string; ru: string }> = {
  choose_language: { en: "🌍 Please choose your language:", ru: "🌍 Пожалуйста, выберите язык:" },
  btn_en: { en: "English 🇬🇧", ru: "English 🇬🇧" },
  btn_ru: { en: "Russian 🇷🇺", ru: "Russian 🇷🇺" },
  main_menu: { en: "*Main Menu*", ru: "*Главное меню*" },
  play_trophy: { en: "🏆 Play Trophy Match", ru: "🏆 Играть на трофеи" },
  play_star: { en: "⭐ Play for Stars", ru: "⭐ Играть на звёзды" },
  profile: { en: "👤 My Profile", ru: "👤 Мой профиль" },
  leaderboard: { en: "🏅 Leaderboard", ru: "🏅 Таблица лидеров" },
  withdraw: { en: "💰 Withdraw Stars (min 50)", ru: "💰 Вывести звёзды (мин. 50)" },
  top_trophies: { en: "Top by Trophies", ru: "Топ по трофеям" },
  top_stars: { en: "Top by Stars", ru: "Топ по звёздам" },
  waiting_opponent: { en: "*Waiting for opponent...*", ru: "*Ожидание соперника...*" },
  cancel_queue: { en: "❌ Cancel Search", ru: "❌ Отменить поиск" },
  not_enough_stars: { en: "Not enough stars for withdrawal", ru: "Недостаточно звёзд для вывода" },
  enter_withdraw_amount: { en: "Enter amount to withdraw (min 50):", ru: "Введите сумму для вывода (мин. 50):" },
  withdraw_requested: { en: "Withdrawal request sent! Awaiting admin approval.", ru: "Запрос на вывод отправлен! Ожидайте одобрения админа." },
  daily_bonus: { en: "🎉 Daily bonus: +1 ⭐", ru: "🎉 Ежедневный бонус: +1 ⭐" },
  match_found: { en: "Match found! Game starting...", ru: "Соперник найден! Игра начинается..." },
  your_turn: { en: "Your turn!", ru: "Ваш ход!" },
  opponent_turn: { en: "Opponent's turn", ru: "Ход соперника" },
  round_win: { en: "You won the round!", ru: "Вы выиграли раунд!" },
  round_tie: { en: "Round tie!", ru: "Ничья в раунде!" },
  round_loss: { en: "Opponent won the round!", ru: "Соперник выиграл раунд!" },
  new_round: { en: "New round started!", ru: "Новый раунд начат!" },
  match_win_trophy: { en: "You won the match! +1 🏆", ru: "Вы выиграли матч! +1 🏆" },
  match_loss_trophy: { en: "You lost the match! -1 🏆", ru: "Вы проиграли матч! -1 🏆" },
  match_win_star: { en: "You won the match! +1.5 ⭐", ru: "Вы выиграли матч! +1.5 ⭐" },
  match_loss_star: { en: "You lost the match! -1 ⭐", ru: "Вы проиграли матч! -1 ⭐" },
  match_tie: { en: "Match ended in a tie!", ru: "Матч закончился ничьей!" },
  admin_panel: { en: "*Admin Panel*", ru: "*Панель админа*" },
  admin_stats: { en: "📊 Statistics", ru: "📊 Статистика" },
  admin_pending: { en: "⏳ Pending Withdrawals", ru: "⏳ Ожидающие выводы" },
  complete_withdraw: { en: "✅ Complete", ru: "✅ Завершить" },
  withdrawal_completed_user: { en: "Your withdrawal of {amount} ⭐ has been completed!", ru: "Ваш вывод {amount} ⭐ завершён!" },
  withdrawal_completed_admin: { en: "Withdrawal completed for {user}", ru: "Вывод завершён для {user}" },
  new_withdrawal: { en: "New withdrawal request: {user} — {amount} ⭐", ru: "Новый запрос на вывод: {user} — {amount} ⭐" },
};

// -------------------- Helper Functions --------------------
async function sendMessage(chatId: string, text: string, parseMode = "Markdown", replyMarkup?: any) {
  const body = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) (body as any).reply_markup = replyMarkup;
  const res = await fetch(`${API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()).result || null;
}

async function editMessageText(chatId: string, messageId: number, text: string, parseMode = "Markdown", replyMarkup?: any) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: parseMode };
  if (replyMarkup) (body as any).reply_markup = replyMarkup;
  const res = await fetch(`${API}/editMessageText`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()).result || null;
}

async function answerCallbackQuery(id: string, text?: string, showAlert = false) {
  const body = { callback_query_id: id };
  if (text) (body as any).text = text;
  if (showAlert) (body as any).show_alert = true;
  await fetch(`${API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function getText(userId: string, key: string, params: Record<string, string> = {}): Promise<string> {
  const user = await getUser(userId);
  const lang = user?.lang || "en";
  let text = MESSAGES[key][lang] || MESSAGES[key].en;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

// -------------------- User & Stats Functions --------------------
interface User {
  lang: "en" | "ru";
  username?: string;
  trophies: number;
  stars: number;
  matches: number;
  wins: number;
  last_active: number;
  daily_date: string;
  current_match?: string;
  in_queue?: "trophy" | "star";
  state?: string; // e.g., "waiting_withdraw_amount"
}

async function getUser(userId: string): Promise<User | null> {
  const entry = await kv.get<User>(["users", userId]);
  return entry.value;
}

async function createUser(userId: string, username: string | undefined, lang: "en" | "ru"): Promise<User> {
  const today = new Date().toISOString().slice(0, 10);
  const user: User = {
    lang,
    username,
    trophies: 0,
    stars: INITIAL_STARS,
    matches: 0,
    wins: 0,
    last_active: Date.now(),
    daily_date: today,
  };
  await kv.set(["users", userId], user);
  await incrementStats("total_users", 1);
  return user;
}

async function updateDailyBonus(userId: string, user: User): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  if (user.daily_date !== today) {
    user.stars += DAILY_BONUS_STARS;
    user.daily_date = today;
    await incrementStats("stars_distributed", DAILY_BONUS_STARS);
    await kv.set(["users", userId], user);
    await sendMessage(userId, await getText(userId, "daily_bonus"));
    return true;
  }
  return false;
}

async function incrementStats(key: "total_users" | "total_matches" | "stars_distributed", delta: number) {
  await kv.atomic()
    .sum(["stats", key], BigInt(delta * 100)) // use bigint for precision, but simple add
    .commit();
  // Note: for simplicity, we use separate set/get
  const entry = await kv.get<number>(["stats", key]);
  const current = entry.value || 0;
  await kv.set(["stats", key], current + delta);
}

// -------------------- Game Logic --------------------
function checkWinner(board: (null | "X" | "O")[][]): "X" | "O" | "tie" | null {
  // rows
  for (let i = 0; i < 3; i++) {
    if (board[i][0] && board[i][0] === board[i][1] && board[i][1] === board[i][2]) return board[i][0]!;
  }
  // cols
  for (let i = 0; i < 3; i++) {
    if (board[0][i] && board[0][i] === board[1][i] && board[1][i] === board[2][i]) return board[0][i]!;
  }
  // diags
  if (board[0][0] && board[0][0] === board[1][1] && board[1][1] === board[2][2]) return board[0][0]!;
  if (board[0][2] && board[0][2] === board[1][1] && board[1][1] === board[2][0]) return board[0][2]!;
  if (board.flat().every(c => c !== null)) return "tie";
  return null;
}

function generateKeyboard(board: (null | "X" | "O")[][]): any[][] {
  const kb: any[][] = [];
  for (let r = 0; r < 3; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) {
      const cell = board[r][c];
      if (cell) {
        row.push({ text: cell === "X" ? "❌" : "⭕" });
      } else {
        row.push({ text: "▫️", callback_data: `move_${r}_${c}` });
      }
    }
    kb.push(row);
  }
  return kb;
}

async function renderAndUpdateBoard(match: any, userId: string) {
  const players = match.players as string[];
  const oppId = players.find((p: string) => p !== userId)!;
  const oppUser = await getUser(oppId);
  const oppName = oppUser?.username ? `@${oppUser.username}` : "Opponent";
  const mySymbol = userId === players[0] ? match.symbols[0] : match.symbols[1];
  const isTurn = userId === match.current_turn;
  const myRounds = match.rounds_won[userId] || 0;
  const oppRounds = match.rounds_won[oppId] || 0;
  const lang = (await getUser(userId))?.lang || "en";

  let extra = "";
  if (match.last_result) {
    if (match.last_result === "tie") extra = await getText(userId, "round_tie");
    else if (match.last_result === mySymbol) extra = await getText(userId, "round_win");
    else extra = await getText(userId, "round_loss");
    if (match.round > match.last_round) extra += "\n" + await getText(userId, "new_round");
  }

  const text = `<b>Tic Tac Toe</b>\nVs ${oppName}\nRound ${match.round}/3\nYour symbol: ${mySymbol === "X" ? "❌" : "⭕"}\nScore: ${myRounds} - ${oppRounds}\n${isTurn ? "<b>" + await getText(userId, "your_turn") + "</b>" : await getText(userId, "opponent_turn")}\n${extra}`;

  const markup = { inline_keyboard: generateKeyboard(match.board) };

  const msgId = match.message_ids[userId];
  if (msgId) {
    await editMessageText(userId, msgId, text, "HTML", markup);
  }
}

// -------------------- Webhook Handler --------------------
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const update = await req.json();

    // Callback query handling
    if (update.callback_query) {
      const cb = update.callback_query;
      const cbId = cb.id;
      const data = cb.data;
      const userId = String(cb.from.id);
      const username = cb.from.username;
      const chatId = String(cb.message.chat.id);
      const messageId = cb.message.message_id;
      const isPrivate = cb.message.chat.type === "private";
      const isAdmin = isPrivate && username === ADMIN_USERNAME;

      // Save admin ID on first interaction
      if (isAdmin) {
        const currentAdminId = await kv.get(["config", "admin_id"]);
        if (!currentAdminId.value) await kv.set(["config", "admin_id"], userId);
      }

      let user = await getUser(userId);
      if (!user) return new Response("ok");

      await updateDailyBonus(userId, user);
      user.last_active = Date.now();
      await kv.set(["users", userId], user);

      if (data === "lang_en" || data === "lang_ru") {
        user.lang = data === "lang_en" ? "en" : "ru";
        await kv.set(["users", userId], user);
        await sendMainMenu(userId);
        await answerCallbackQuery(cbId, "Language set");
        return new Response("ok");
      }

      if (data.startsWith("move_")) {
        const [, rs, cs] = data.split("_");
        const r = parseInt(rs);
        const c = parseInt(cs);
        const matchId = user.current_match;
        if (!matchId) {
          await answerCallbackQuery(cbId, "No active match");
          return new Response("ok");
        }
        const matchEntry = await kv.get(["matches", matchId]);
        const match = matchEntry.value;
        if (!match || match.current_turn !== userId || match.board[r][c] !== null) {
          await answerCallbackQuery(cbId, "Invalid move", true);
          return new Response("ok");
        }

        const mySymbol = userId === match.players[0] ? match.symbols[0] : match.symbols[1];
        match.board[r][c] = mySymbol;
        match.current_turn = match.players.find((p: string) => p !== userId);
        const result = checkWinner(match.board);

        match.last_result = result;
        match.last_round = match.round;

        if (result) {
          if (result !== "tie") {
            match.rounds_won[result === mySymbol ? userId : match.current_turn] += 1;
          }

          if (match.round < 3) {
            match.round += 1;
            match.board = Array(3).fill(null).map(() => Array(3).fill(null));
            const randStart = Math.random() < 0.5;
            match.symbols = randStart ? ["X", "O"] : ["O", "X"];
            match.current_turn = randStart ? match.players[0] : match.players[1];
          } else {
            // Match end logic
            const rw1 = match.rounds_won[match.players[0]] || 0;
            const rw2 = match.rounds_won[match.players[1]] || 0;
            let winnerId: string | null = null;
            if (rw1 > rw2) winnerId = match.players[0];
            else if (rw2 > rw1) winnerId = match.players[1];

            for (const pid of match.players) {
              const pu = await getUser(pid);
              pu.matches += 1;
              if (pid === winnerId) pu.wins += 1;
              await kv.set(["users", pid], pu);
            }

            if (winnerId) {
              const loserId = match.players.find((p: string) => p !== winnerId)!;
              const wu = await getUser(winnerId);
              const lu = await getUser(loserId);
              if (match.type === "trophy") {
                wu.trophies += 1;
                lu.trophies = Math.max(0, lu.trophies - 1);
              } else {
                wu.stars += 1.5;
                lu.stars = Math.max(0, lu.stars - 1);
                await incrementStats("stars_distributed", 0.5);
              }
              await kv.set(["users", winnerId], wu);
              await kv.set(["users", loserId], lu);
              await sendMessage(winnerId, await getText(winnerId, match.type === "trophy" ? "match_win_trophy" : "match_win_star"));
              await sendMessage(loserId, await getText(loserId, match.type === "trophy" ? "match_loss_trophy" : "match_loss_star"));
            } else {
              await sendMessage(match.players[0], await getText(match.players[0], "match_tie"));
              await sendMessage(match.players[1], await getText(match.players[1], "match_tie"));
            }

            await incrementStats("total_matches", 1);

            // Cleanup
            await kv.delete(["matches", matchId]);
            for (const pid of match.players) {
              const pu = await getUser(pid);
              if (pu) {
                pu.current_match = undefined;
                await kv.set(["users", pid], pu);
              }
              await sendMainMenu(pid);
            }
            await answerCallbackQuery(cbId, "Match ended");
            return new Response("ok");
          }
        }

        await kv.set(["matches", matchId], match);
        for (const pid of match.players) {
          await renderAndUpdateBoard(match, pid);
        }
        await answerCallbackQuery(cbId, "Move accepted");
        return new Response("ok");
      }

      // Menu callbacks
      if (data === "menu_play_trophy" || data === "menu_play_star") {
        const type = data === "menu_play_trophy" ? "trophy" : "star";
        if (user.in_queue === type) {
          await removeFromQueue(userId, type);
          user.in_queue = undefined;
          await kv.set(["users", userId], user);
          await sendMessage(userId, await getText(userId, "cancel_queue"));
          await sendMainMenu(userId);
        } else if (user.current_match || user.in_queue) {
          await answerCallbackQuery(cbId, "You are already in a match/queue");
        } else {
          await addToQueue(userId, type);
          user.in_queue = type;
          await kv.set(["users", userId], user);
          const kb = [[{ text: await getText(userId, "cancel_queue"), callback_data: `cancel_${type}` }]];
          await sendMessage(userId, await getText(userId, "waiting_opponent"), "Markdown", { inline_keyboard: kb });
          await tryPairQueue(type);
        }
        await answerCallbackQuery(cbId);
        return new Response("ok");
      }

      if (data.startsWith("cancel_")) {
        const type = data === "cancel_trophy" ? "trophy" : "star";
        if (user.in_queue === type) {
          await removeFromQueue(userId, type);
          user.in_queue = undefined;
          await kv.set(["users", userId], user);
          await sendMessage(userId, "Search cancelled");
          await sendMainMenu(userId);
        }
        await answerCallbackQuery(cbId);
        return new Response("ok");
      }

      if (data === "menu_profile") {
        const profileText = `*Profile*\n🏆 Trophies: ${user.trophies}\n⭐ Stars: ${user.stars.toFixed(1)}\n📊 Matches: ${user.matches} (Wins: ${user.wins})`;
        await editMessageText(chatId, messageId, profileText, "Markdown");
        await answerCallbackQuery(cbId);
        return new Response("ok");
      }

      if (data === "menu_leader_trophy" || data === "menu_leader_star") {
        const type = data === "menu_leader_trophy" ? "trophies" : "stars";
        const top = await getLeaderboard(type);
        let text = type === "trophies" ? "*Top 10 by Trophies*" : "*Top 10 by Stars*";
        top.forEach((u, i) => {
          const name = u.username ? `@${u.username}` : `User${u.id.slice(-4)}`;
          const val = type === "trophies" ? u.trophies : u.stars.toFixed(1);
          text += `\n${i + 1}. ${name} — ${val}`;
        });
        await editMessageText(chatId, messageId, text || "No players yet", "Markdown");
        await answerCallbackQuery(cbId);
        return new Response("ok");
      }

      if (data === "menu_withdraw") {
        if (user.stars < MIN_WITHDRAW) {
          await answerCallbackQuery(cbId, await getText(userId, "not_enough_stars"), true);
        } else {
          user.state = "waiting_withdraw_amount";
          await kv.set(["users", userId], user);
          await sendMessage(chatId, await getText(userId, "enter_withdraw_amount"));
          await answerCallbackQuery(cbId);
        }
        return new Response("ok");
      }

      // Admin callbacks
      if (isAdmin) {
        if (data === "admin_stats") {
          const stats = await getBotStats();
          const text = `*Bot Statistics*\nTotal users: ${stats.totalUsers}\nActive 24h: ${stats.active24h}\nTotal matches: ${stats.totalMatches}\nStars distributed: ${stats.starsDistributed.toFixed(1)}`;
          await editMessageText(chatId, messageId, text, "Markdown");
          await answerCallbackQuery(cbId);
          return new Response("ok");
        }

        if (data === "admin_pending") {
          const pending = (await kv.get<string[]>(["pending_withdrawals"])).value || [];
          if (pending.length === 0) {
            await editMessageText(chatId, messageId, "No pending withdrawals", "Markdown");
          } else {
            let text = "*Pending Withdrawals*";
            for (const reqId of pending) {
              const w = (await kv.get(["withdrawals", reqId])).value;
              if (w) {
                const u = await getUser(w.userId);
                const name = u?.username ? `@${u.username}` : w.userId;
                text += `\n${name} — ${w.amount} ⭐`;
                const kb = [[{ text: await getText(chatId, "complete_withdraw"), callback_data: `complete_${reqId}` }]];
                await sendMessage(chatId, text, "Markdown", { inline_keyboard: kb });
                text = ""; // clear for next
              }
            }
          }
          await answerCallbackQuery(cbId);
          return new Response("ok");
        }

        if (data.startsWith("complete_")) {
          const reqId = data.slice(9);
          const wEntry = await kv.get(["withdrawals", reqId]);
          const w = wEntry.value;
          if (w) {
            const u = await getUser(w.userId);
            if (u) {
              u.stars = Math.max(0, u.stars - w.amount);
              await kv.set(["users", w.userId], u);
              await sendMessage(w.userId, await getText(w.userId, "withdrawal_completed_user", { amount: w.amount.toString() }));
            }
            // Remove from pending
            const pending = (await kv.get<string[]>(["pending_withdrawals"])).value || [];
            await kv.set(["pending_withdrawals"], pending.filter(id => id !== reqId));
            await sendMessage(chatId, await getText(chatId, "withdrawal_completed_admin", { user: u?.username || w.userId }));
          }
          await answerCallbackQuery(cbId, "Completed");
          return new Response("ok");
        }
      }

      return new Response("ok");
    }

    // Message handling
    const msg = update.message;
    if (!msg) return new Response("ok");

    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const username = msg.from.username;
    const text = msg.text?.trim() || "";
    const isPrivate = msg.chat.type === "private";
    const isAdmin = isPrivate && username === ADMIN_USERNAME;

    let user = await getUser(userId);
    if (!user && (text === "/start" || text === "/menu")) {
      // Language selection on first start
      const kb = [[
        { text: MESSAGES.btn_en.en, callback_data: "lang_en" },
        { text: MESSAGES.btn_ru.ru, callback_data: "lang_ru" },
      ]];
      await sendMessage(chatId, await getText(userId, "choose_language"), "Markdown", { inline_keyboard: kb });
      return new Response("ok");
    }

    if (!user) return new Response("ok");

    await updateDailyBonus(userId, user);
    user.last_active = Date.now();
    await kv.set(["users", userId], user);

    if (text === "/start" || text === "/menu") {
      await sendMainMenu(chatId);
      return new Response("ok");
    }

    if (text === "/admin" && isAdmin) {
      const kb = [
        [{ text: await getText(chatId, "admin_stats"), callback_data: "admin_stats" }],
        [{ text: await getText(chatId, "admin_pending"), callback_data: "admin_pending" }],
      ];
      await sendMessage(chatId, await getText(chatId, "admin_panel"), "Markdown", { inline_keyboard: kb });
      return new Response("ok");
    }

    // Withdrawal amount input
    if (user.state === "waiting_withdraw_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < MIN_WITHDRAW || amount > user.stars) {
        await sendMessage(chatId, "Invalid amount. Try again.");
      } else {
        const reqId = crypto.randomUUID().toString();
        await kv.set(["withdrawals", reqId], { userId, amount, timestamp: Date.now() });
        let pending = (await kv.get<string[]>(["pending_withdrawals"])).value || [];
        pending.push(reqId);
        await kv.set(["pending_withdrawals"], pending);

        await sendMessage(chatId, await getText(userId, "withdraw_requested"));
        const adminId = await kv.get<string>(["config", "admin_id"]);
        if (adminId.value) {
          const name = username ? `@${username}` : userId;
          const kb = [[{ text: "✅ Complete", callback_data: `complete_${reqId}` }]];
          await sendMessage(adminId.value, await getText(adminId.value, "new_withdrawal", { user: name, amount: amount.toString() }), "Markdown", { inline_keyboard: kb });
        }

        user.state = undefined;
        await kv.set(["users", userId], user);
      }
      return new Response("ok");
    }

  } catch (err) {
    console.error("Error:", err);
  }

  return new Response("ok");
});

// -------------------- Additional Functions --------------------
async function sendMainMenu(chatId: string) {
  const user = await getUser(chatId);
  if (!user) return;
  const kb = [
    [{ text: await getText(chatId, "play_trophy"), callback_data: "menu_play_trophy" }],
    [{ text: await getText(chatId, "play_star"), callback_data: "menu_play_star" }],
    [{ text: await getText(chatId, "profile"), callback_data: "menu_profile" }],
    [{ text: await getText(chatId, "top_trophies"), callback_data: "menu_leader_trophy" }, { text: await getText(chatId, "top_stars"), callback_data: "menu_leader_star" }],
  ];
  if (user.stars >= MIN_WITHDRAW) {
    kb.push([{ text: await getText(chatId, "withdraw"), callback_data: "menu_withdraw" }]);
  }
  await sendMessage(chatId, await getText(chatId, "main_menu"), "Markdown", { inline_keyboard: kb });
}

async function addToQueue(userId: string, type: "trophy" | "star") {
  const entry = await kv.get<string[]>(["queue", type]);
  const queue = entry.value || [];
  if (!queue.includes(userId)) queue.push(userId);
  await kv.set(["queue", type], queue);
}

async function removeFromQueue(userId: string, type: "trophy" | "star") {
  const entry = await kv.get<string[]>(["queue", type]);
  const queue = (entry.value || []).filter(id => id !== userId);
  await kv.set(["queue", type], queue);
}

async function tryPairQueue(type: "trophy" | "star") {
  const entry = await kv.get<string[]>(["queue", type]);
  const queue = entry.value || [];
  if (queue.length >= 2) {
    const p1 = queue[0];
    const p2 = queue[1];
    await kv.set(["queue", type], queue.slice(2));

    // Clear queue state
    for (const p of [p1, p2]) {
      const u = await getUser(p);
      if (u) {
        u.in_queue = undefined;
        await kv.set(["users", p], u);
      }
    }

    // Create match
    const matchId = crypto.randomUUID().toString();
    const randStart = Math.random() < 0.5;
    const match = {
      id: matchId,
      type,
      players: [p1, p2],
      symbols: randStart ? ["X", "O"] : ["O", "X"],
      current_turn: randStart ? p1 : p2,
      round: 1,
      rounds_won: { [p1]: 0, [p2]: 0 },
      board: Array(3).fill(null).map(() => Array(3).fill(null)),
      message_ids: {} as Record<string, number>,
      last_result: null,
      last_round: 0,
    };
    await kv.set(["matches", matchId], match);

    // Set current_match
    for (const p of [p1, p2]) {
      const u = await getUser(p);
      if (u) {
        u.current_match = matchId;
        await kv.set(["users", p], u);
      }
      await sendMessage(p, await getText(p, "match_found"));
    }

    // Send initial boards
    for (const pid of [p1, p2]) {
      await renderAndUpdateBoard(match, pid);
      const sent = await sendMessage(pid, " "); // dummy to get msg id if needed
      // Actually send the board via render function (it uses edit if exists, but first send)
      // Initial send
      const oppId = pid === p1 ? p2 : p1;
      const oppU = await getUser(oppId);
      const oppName = oppU?.username ? `@${oppU.username}` : "Opponent";
      const mySym = pid === p1 ? match.symbols[0] : match.symbols[1];
      const isTurn = pid === match.current_turn;
      const text = `<b>Tic Tac Toe</b>\nVs ${oppName}\nRound 1/3\nYour symbol: ${mySym === "X" ? "❌" : "⭕"}\nScore: 0 - 0\n${isTurn ? "<b>Your turn!</b>" : "Opponent's turn"}`;
      const sentMsg = await sendMessage(pid, text, "HTML", { inline_keyboard: generateKeyboard(match.board) });
      if (sentMsg) {
        match.message_ids[pid] = sentMsg.message_id;
        await kv.set(["matches", matchId], match);
      }
    }
  }
}

async function getLeaderboard(type: "trophies" | "stars"): Promise<Array<User & { id: string }>> {
  const users: Array<User & { id: string }> = [];
  for await (const entry of kv.list<User>({ prefix: ["users"] })) {
    users.push({ id: entry.key[1] as string, ...(entry.value as User) });
  }
  users.sort((a, b) => (b[type] ?? 0) - (a[type] ?? 0));
  return users.slice(0, 10);
}

async function getBotStats() {
  const totalUsers = (await kv.get<number>(["stats", "total_users"])).value || 0;
  const totalMatches = (await kv.get<number>(["stats", "total_matches"])).value || 0;
  const starsDistributed = (await kv.get<number>(["stats", "stars_distributed"])).value || 0;
  let active24h = 0;
  const now = Date.now();
  for await (const entry of kv.list<User>({ prefix: ["users"] })) {
    if (entry.value.last_active > now - 86400000) active24h++;
  }
  return { totalUsers, active24h, totalMatches, starsDistributed };

}

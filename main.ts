// main.ts
// Telegram Tic-Tac-Toe Bot (Deno)
// Features: Language selection (EN/RU), trophy matches (/battle), real star matches (/realbattle),
// profiles with stats (Deno KV), leaderboard with pagination (trophies and stars), admin (/addtouser, /stats, /userprofile),
// Withdrawal functionality (/withdraw) with admin approval via inline button,
// Daily login bonus (+1 star if last login >24h),
// Match = best of 3 rounds,
// All messages support EN/RU based on user choice
//
// Notes: Requires BOT_TOKEN env var and Deno KV. Deploy as webhook at SECRET_PATH.
// Removed: Subscription check, referrals, bosses, promocodes, globalmessage, deleteuser, createboss, createpromocode
// Currency: stars (replaced TMT)
// Withdrawal: min 50 stars, pending in KV, admin approves via button, deduct on approve
// Daily bonus: +1 star on init if lastLogin < now-24h
// Leaderboards: separate for trophies and stars
// Admin stats: total users, active last 24h, total matches, total stars distributed (sum in profiles)
// Anti-cheat: check if in battle or queue
// Notifications: messages on start/end
// Edge cases: invalid moves, ties, insufficient balance, etc.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");
const API = `https://api.telegram.org/bot${TOKEN}`;
const SECRET_PATH = Deno.env.get("SECRET_PATH"); // make sure webhook path matches
const BOT_USERNAME = "HappDecryptionBot"; // Adjust to your bot's username

// Deno KV
const kv = await Deno.openKv();

const ADMIN_USERNAME = "Masakoff"; // without @

// runtime storages
let queue: string[] = []; // for trophy matches
let starQueue: string[] = []; // for real star matches
const battles: Record<string, any> = {};
const searchTimeouts: Record<string, number> = {};

// State helpers using KV
async function getWithdrawalState(userId: string): Promise<{ amount: number; step: "amount" } | null> {
  const res = await kv.get<{ amount: number; step: "amount" }>(["states", "withdrawal", userId]);
  return res.value;
}

async function setWithdrawalState(userId: string, state: { amount: number; step: "amount" } | null) {
  if (state) {
    await kv.set(["states", "withdrawal", userId], state);
  } else {
    await kv.delete(["states", "withdrawal", userId]);
  }
}

// -------------------- Telegram helpers --------------------
async function sendMessage(chatId: string | number, text: string, options: any = {}): Promise<number | null> {
  try {
    const body: any = { chat_id: chatId, text, ...options };
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error("sendMessage error", e);
    return null;
  }
}

async function editMessageText(chatId: string | number, messageId: number, text: string, options: any = {}) {
  try {
    const body = { chat_id: chatId, message_id: messageId, text, ...options };
    await fetch(`${API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("editMessageText failed", e?.message ?? e);
  }
}

async function answerCallbackQuery(id: string, text = "", showAlert = false) {
  try {
    await fetch(`${API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text, show_alert: showAlert }),
    });
  } catch (e) {
    console.warn("answerCallbackQuery failed", e?.message ?? e);
  }
}

// -------------------- Language helpers --------------------
type Lang = 'en' | 'ru';

const texts: Record<Lang, Record<string, string>> = {
  en: {
    chooseLang: "Choose language:",
    welcome: "Welcome to Tic-Tac-Toe Bot!",
    help: "Play Tic-Tac-Toe, earn trophies and stars.\n\nCommands:\n/battle - Trophy match\n/realbattle - Star match (stake 1 star)\n/profile - Your profile\n/leaderboard_trophies - Top by trophies\n/leaderboard_stars - Top by stars\n/withdraw - Withdraw stars (min 50)\n/admin - Admin panel (if admin)",
    searching: "Searching for opponent...",
    searchTimeout: "Search timed out. No opponent found.",
    alreadyInQueue: "You are already in queue.",
    alreadyInGame: "You are already in a game.",
    insufficientStars: "Insufficient stars. Need at least 1 star for real match.",
    battleStartTrophy: "Trophy Match\nYou are {mark}. Best of 3 rounds vs ID:{opponent}",
    battleStartStar: "Star Match\nYou are {mark}. Best of 3 rounds vs ID:{opponent}\nStakes: Both stake 1 star. Winner gets 1.5 stars.",
    roundStart: "Round {round}/{rounds}\nScore: {score1} - {score2}\nTurn: {turn}",
    yourTurn: "Your turn",
    opponentTurn: "Opponent's turn",
    roundWin: "You won the round!",
    roundLoss: "You lost the round",
    roundDraw: "Round draw!",
    matchWin: "You won the match!\n+1 trophy",
    matchLoss: "You lost the match.\n-1 trophy",
    matchDraw: "Match draw!",
    starWin: "+0.5 stars (total 1.5)",
    starLoss: "-1 star",
    starRefund: "Draw: 1 star refunded.",
    surrender: "You surrendered.",
    opponentSurrender: "Opponent surrendered. You win!",
    timeoutTurn: "Timed out. You lose the turn.",
    timeoutGame: "Game timed out due to inactivity.",
    invalidMove: "Invalid move.",
    cellOccupied: "Cell occupied.",
    profile: "Profile: {name}\nID: {id}\nTrophies: {trophies}\nStars: {stars}\nGames: {games}\nWins: {wins}\nLosses: {losses}\nDraws: {draws}\nWin Rate: {winrate}%",
    leaderboard: "Leaderboard - Page {page}\n",
    noPlayers: "No players yet!",
    noMorePages: "No more pages!",
    withdrawAmount: "Enter amount to withdraw (min 50):",
    invalidAmount: "Invalid amount.",
    insufficientBalance: "Insufficient balance.",
    withdrawRequest: "Withdrawal request sent to admin.",
    withdrawPending: "Withdrawal {amount} stars from ID:{userId}",
    withdrawComplete: "Withdrawal completed!",
    withdrawNotify: "Your withdrawal of {amount} stars has been completed.",
    adminNoAccess: "No access.",
    adminStats: "Stats\nUsers: {users}\nActive 24h: {active}\nTotal Matches: {matches}\nTotal Stars: {stars}",
    dailyBonus: "Daily login bonus: +1 star!",
    // Add more as needed
  },
  ru: {
    chooseLang: "Выберите язык:",
    welcome: "Добро пожаловать в бота Крестики-Нолики!",
    help: "Играйте в крестики-нолики, зарабатывайте трофеи и звезды.\n\nКоманды:\n/battle - Матч за трофеи\n/realbattle - Матч за звезды (ставка 1 звезда)\n/profile - Ваш профиль\n/leaderboard_trophies - Топ по трофеям\n/leaderboard_stars - Топ по звездам\n/withdraw - Вывод звезд (мин 50)\n/admin - Панель админа (если админ)",
    searching: "Поиск противника...",
    searchTimeout: "Поиск завершился. Противник не найден.",
    alreadyInQueue: "Вы уже в очереди.",
    alreadyInGame: "Вы уже в игре.",
    insufficientStars: "Недостаточно звезд. Нужно минимум 1 звезда для реального матча.",
    battleStartTrophy: "Матч за трофеи\nВы {mark}. Лучший из 3 раундов vs ID:{opponent}",
    battleStartStar: "Матч за звезды\nВы {mark}. Лучший из 3 раундов vs ID:{opponent}\nСтавки: Оба ставят 1 звезду. Победитель получает 1.5 звезды.",
    roundStart: "Раунд {round}/{rounds}\nСчет: {score1} - {score2}\nХод: {turn}",
    yourTurn: "Ваш ход",
    opponentTurn: "Ход противника",
    roundWin: "Вы выиграли раунд!",
    roundLoss: "Вы проиграли раунд",
    roundDraw: "Ничья в раунде!",
    matchWin: "Вы выиграли матч!\n+1 трофей",
    matchLoss: "Вы проиграли матч.\n-1 трофей",
    matchDraw: "Ничья в матче!",
    starWin: "+0.5 звезды (всего 1.5)",
    starLoss: "-1 звезда",
    starRefund: "Ничья: 1 звезда возвращена.",
    surrender: "Вы сдались.",
    opponentSurrender: "Противник сдался. Вы выиграли!",
    timeoutTurn: "Время вышло. Вы проиграли ход.",
    timeoutGame: "Игра завершена из-за неактивности.",
    invalidMove: "Неверный ход.",
    cellOccupied: "Клетка занята.",
    profile: "Профиль: {name}\nID: {id}\nТрофеи: {trophies}\nЗвезды: {stars}\nИгры: {games}\nПобеды: {wins}\nПоражения: {losses}\nНичьи: {draws}\nПроцент побед: {winrate}%",
    leaderboard: "Лидерборд - Страница {page}\n",
    noPlayers: "Игроков пока нет!",
    noMorePages: "Больше страниц нет!",
    withdrawAmount: "Введите сумму для вывода (мин 50):",
    invalidAmount: "Неверная сумма.",
    insufficientBalance: "Недостаточно баланса.",
    withdrawRequest: "Запрос на вывод отправлен админу.",
    withdrawPending: "Запрос на вывод {amount} звезд от ID:{userId}",
    withdrawComplete: "Вывод завершен!",
    withdrawNotify: "Ваш вывод {amount} звезд завершен.",
    adminNoAccess: "Нет доступа.",
    adminStats: "Статистика\nПользователи: {users}\nАктивные 24ч: {active}\nВсего матчей: {matches}\nВсего звезд: {stars}",
    dailyBonus: "Ежедневный бонус за вход: +1 звезда!",
    // Add more as needed
  }
};

async function getText(userId: string, key: string, params: Record<string, any> = {}): Promise<string> {
  const profile = await getProfile(userId);
  const lang = (profile?.lang as Lang) || 'en';
  let msg = texts[lang][key] || key;
  for (const [k, v] of Object.entries(params)) {
    msg = msg.replace(new RegExp(`{${k}}`, 'g'), v);
  }
  return msg;
}

// -------------------- Profile helpers --------------------
type Profile = {
  id: string;
  username?: string;
  displayName: string;
  lang?: Lang;
  trophies: number;
  stars: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastActive: number;
  lastLogin: number;
};

function getDisplayName(p: Profile) {
  if (p.username) return `@${p.username}`;
  return p.displayName && p.displayName !== "" ? p.displayName : `ID:${p.id}`;
}

async function initProfile(userId: string, username?: string, displayName?: string): Promise<{ profile: Profile; isNew: boolean }> {
  const key = ["profiles", userId];
  const res = await kv.get(key);
  const now = Date.now();
  if (!res.value) {
    const profile: Profile = {
      id: userId,
      username,
      displayName: displayName || `ID:${userId}`,
      trophies: 0,
      stars: 0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      lastActive: now,
      lastLogin: now,
    };
    await kv.set(key, profile);
    return { profile, isNew: true };
  } else {
    const existing = res.value as Profile;
    let changed = false;
    if (username && username !== existing.username) {
      existing.username = username;
      changed = true;
    }
    if (displayName && displayName !== existing.displayName) {
      existing.displayName = displayName;
      changed = true;
    }
    existing.lastActive = now;

    // Daily bonus
    if (!existing.lastLogin || now - existing.lastLogin > 24 * 60 * 60 * 1000) {
      existing.stars += 1;
      existing.lastLogin = now;
      changed = true;
      await sendMessage(userId, await getText(userId, 'dailyBonus'));
    }

    if (changed) await kv.set(key, existing);
    return { profile: existing, isNew: false };
  }
}

async function getProfile(userId: string): Promise<Profile | null> {
  const res = await kv.get(["profiles", userId]);
  return (res.value as Profile) ?? null;
}

async function updateProfile(userId: string, delta: Partial<Profile>) {
  const existing = (await getProfile(userId)) || (await initProfile(userId)).profile;
  const newProfile: Profile = {
    ...existing,
    username: delta.username ?? existing.username,
    displayName: delta.displayName ?? existing.displayName,
    lang: delta.lang ?? existing.lang,
    trophies: Math.max(0, (existing.trophies || 0) + (delta.trophies ?? 0)),
    stars: Math.max(0, (existing.stars || 0) + (delta.stars ?? 0)),
    gamesPlayed: (existing.gamesPlayed || 0) + (delta.gamesPlayed ?? 0),
    wins: (existing.wins || 0) + (delta.wins ?? 0),
    losses: (existing.losses || 0) + (delta.losses ?? 0),
    draws: (existing.draws || 0) + (delta.draws ?? 0),
    lastActive: Date.now(),
    lastLogin: delta.lastLogin ?? existing.lastLogin,
    id: existing.id,
  };
  await kv.set(["profiles", userId], newProfile);
  return newProfile;
}

async function sendProfile(chatId: string) {
  const p = (await getProfile(chatId))!;
  const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
  const msg = await getText(chatId, 'profile', {
    name: getDisplayName(p),
    id: p.id,
    trophies: p.trophies,
    stars: p.stars,
    games: p.gamesPlayed,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    winrate: winRate,
  });
  await sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

async function sendUserProfile(adminChatId: string, userId: string) {
  const p = await getProfile(userId);
  if (!p) {
    await sendMessage(adminChatId, await getText(adminChatId, 'invalidAmount')); // Reuse as "User not found"
    return;
  }
  const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
  const msg = await getText(adminChatId, 'profile', {
    name: getDisplayName(p),
    id: p.id,
    trophies: p.trophies,
    stars: p.stars,
    games: p.gamesPlayed,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    winrate: winRate,
  });
  await sendMessage(adminChatId, msg, { parse_mode: "Markdown" });
}

// -------------------- Leaderboard helpers --------------------
async function getLeaderboard(type: 'trophies' | 'stars', top = 10, offset = 0): Promise<{top: Profile[], total: number}> {
  const players: Profile[] = [];
  try {
    for await (const entry of kv.list({ prefix: ["profiles"] })) {
      if (!entry.value) continue;
      players.push(entry.value as Profile);
    }
  } catch (e) {
    console.error("getLeaderboard kv.list error", e);
  }
  players.sort((a, b) => {
    const valA = type === 'trophies' ? a.trophies : a.stars;
    const valB = type === 'trophies' ? b.trophies : b.stars;
    if (valB !== valA) return valB - valA;
    return b.wins - a.wins;
  });
  return {top: players.slice(offset, offset + top), total: players.length};
}

async function sendLeaderboard(chatId: string, type: 'trophies' | 'stars', page = 0) {
  const perPage = 10;
  const offset = page * perPage;
  const {top: topPlayers, total} = await getLeaderboard(type, perPage, offset);

  if (topPlayers.length === 0) {
    const msg = page === 0 ? await getText(chatId, 'noPlayers') : await getText(chatId, 'noMorePages');
    await sendMessage(chatId, msg);
    return;
  }

  let msg = await getText(chatId, 'leaderboard', {page: page + 1});
  topPlayers.forEach((p, i) => {
    const rankNum = offset + i + 1;
    const name = getDisplayName(p);
    const val = type === 'trophies' ? p.trophies : p.stars;
    const winRate = p.gamesPlayed ? ((p.wins / p.gamesPlayed) * 100).toFixed(1) : "0";
    msg += `*${rankNum}.* [${name}](tg://user?id=${p.id}) — ${val} | ${winRate}%\n`;
  });

  const keyboard: any = { inline_keyboard: [] };
  const row: any[] = [];
  if (page > 0) row.push({ text: "⬅️", callback_data: `leaderboard_${type}:${page - 1}` });
  if (offset + topPlayers.length < total) row.push({ text: "➡️", callback_data: `leaderboard_${type}:${page + 1}` });
  if (row.length) keyboard.inline_keyboard.push(row);

  await sendMessage(chatId, msg, { reply_markup: keyboard, parse_mode: "Markdown" });
}

// -------------------- Game logic --------------------
function createEmptyBoard(): string[] {
  return Array(9).fill("");
}

function boardToText(board: string[]) {
  const map: any = { "": "▫️", X: "❌", O: "⭕" };
  let text = "\n";
  for (let i = 0; i < 9; i += 3) {
    text += `${map[board[i]]}${map[board[i + 1]]}${map[board[i + 2]]}\n`;
  }
  return text;
}

function checkWin(board: string[]) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every((c) => c !== "")) return { winner: "draw" };
  return null;
}

function makeInlineKeyboard(board: string[], disabled = false) {
  const keyboard: any[] = [];
  for (let r = 0; r < 3; r++) {
    const row: any[] = [];
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const cell = board[i];
      let text = cell === "X" ? "❌" : cell === "O" ? "⭕" : `${i + 1}`;
      const callback_data = disabled ? "noop" : `move:${i}`;
      row.push({ text, callback_data });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: "🏳️", callback_data: "surrender" }]);
  return { inline_keyboard: keyboard };
}

// -------------------- Battle control --------------------
async function startBattle(p1: string, p2: string, isStarBattle: boolean = false, rounds: number = 3) {
  if (searchTimeouts[p1]) {
    clearTimeout(searchTimeouts[p1]);
    delete searchTimeouts[p1];
  }
  if (searchTimeouts[p2]) {
    clearTimeout(searchTimeouts[p2]);
    delete searchTimeouts[p2];
  }

  const battle = {
    players: [p1, p2],
    board: createEmptyBoard(),
    turn: p1,
    marks: { [p1]: "X", [p2]: "O" },
    messageIds: {} as Record<string, number>,
    idleTimerId: undefined as number | undefined,
    moveTimerId: undefined as number | undefined,
    round: 1,
    roundWins: { [p1]: 0, [p2]: 0 },
    isStarBattle: isStarBattle,
    rounds,
  };
  battles[p1] = battle;
  battles[p2] = battle;

  await initProfile(p1);
  await initProfile(p2);

  const battleTypeKey = isStarBattle ? 'battleStartStar' : 'battleStartTrophy';
  await sendMessage(p1, await getText(p1, battleTypeKey, {mark: 'X', opponent: p2}));
  await sendMessage(p2, await getText(p2, battleTypeKey, {mark: 'O', opponent: p1}));
  await sendRoundStart(battle);
}

function headerForPlayer(battle: any, player: string) {
  const opponent = battle.players.find((p: string) => p !== player)!;
  const yourMark = battle.marks[player];
  const opponentMark = battle.marks[opponent];
  const battleTypeText = battle.isStarBattle ? "⭐ Star Match" : "🏆 Trophy Match"; // TODO: translate
  return `${battleTypeText} — You (${yourMark}) vs ID:${opponent} (${opponentMark})`;
}

async function sendRoundStart(battle: any) {
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const yourTurn = battle.turn === player;
    const turnText = yourTurn ? await getText(player, 'yourTurn') : await getText(player, 'opponentTurn');
    const text =
      `${header}\n\n` +
      await getText(player, 'roundStart', {round: battle.round, rounds: battle.rounds, score1: battle.roundWins[battle.players[0]], score2: battle.roundWins[battle.players[1]]}) + '\n' +
      `${turnText}\n` +
      boardToText(battle.board);
    const msgId = await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board), parse_mode: "Markdown" });
    if (msgId) battle.messageIds[player] = msgId;
  }

  if (battle.idleTimerId) {
    clearTimeout(battle.idleTimerId);
  }
  battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 3 * 60 * 1000);

  if (battle.moveTimerId) {
    clearTimeout(battle.moveTimerId);
  }
  battle.moveTimerId = setTimeout(() => endTurnIdle(battle), 30 * 1000);
}

async function endTurnIdle(battle: any) {
  const loser = battle.turn;
  const winner = battle.players.find((p: string) => p !== loser)!;

  await sendMessage(loser, await getText(loser, 'timeoutTurn'));
  await sendMessage(winner, await getText(winner, 'timeoutTurn')); // Opponent timed out

  if (battle.idleTimerId) {
    clearTimeout(battle.idleTimerId);
    delete battle.idleTimerId;
  }
  if (battle.moveTimerId) {
    clearTimeout(battle.moveTimerId);
    delete battle.moveTimerId;
  }

  await finishMatch(battle, { winner: winner, loser: loser });
}

async function endBattleIdle(battle: any) {
  const [p1, p2] = battle.players;
  await sendMessage(p1, await getText(p1, 'timeoutGame'));
  await sendMessage(p2, await getText(p2, 'timeoutGame'));

  if (battle.isStarBattle) {
    await updateProfile(p1, { stars: 1 });
    await updateProfile(p2, { stars: 1 });
    await sendMessage(p1, await getText(p1, 'starRefund'));
    await sendMessage(p2, await getText(p2, 'starRefund'));
  }

  delete battles[p1];
  delete battles[p2];
}

async function finishMatch(battle: any, result: { winner?: string; loser?: string; draw?: boolean }) {
  // Increment total matches in KV
  const totalMatchesKey = ["stats", "totalMatches"];
  const totalRes = await kv.get<number>(totalMatchesKey);
  await kv.set(totalMatchesKey, (totalRes.value || 0) + 1);

  if (battle.idleTimerId) {
    clearTimeout(battle.idleTimerId);
    delete battle.idleTimerId;
  }
  if (battle.moveTimerId) {
    clearTimeout(battle.moveTimerId);
    delete battle.moveTimerId;
  }
  const [p1, p2] = battle.players;

  for (const player of battle.players) {
    const msgId = battle.messageIds[player];
    const header = headerForPlayer(battle, player);
    let text: string;
    if (result.draw) {
      text = `${header}\n\n` + await getText(player, 'matchDraw') + `\n${boardToText(battle.board)}`;
    } else if (result.winner === player) {
      text = `${header}\n\n` + await getText(player, 'matchWin') + `\n${boardToText(battle.board)}`;
    } else {
      text = `${header}\n\n` + await getText(player, 'matchLoss') + `\n${boardToText(battle.board)}`;
    }
    if (msgId) {
      await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board, true), parse_mode: "Markdown" });
    } else {
      await sendMessage(player, text, { parse_mode: "Markdown" });
    }
  }

  if (result.draw) {
    await updateProfile(p1, { gamesPlayed: 1, draws: 1 });
    await updateProfile(p2, { gamesPlayed: 1, draws: 1 });
    await sendMessage(p1, await getText(p1, 'matchDraw'));
    await sendMessage(p2, await getText(p2, 'matchDraw'));

    if (battle.isStarBattle) {
      await updateProfile(p1, { stars: 1 });
      await updateProfile(p2, { stars: 1 });
      await sendMessage(p1, await getText(p1, 'starRefund'));
      await sendMessage(p2, await getText(p2, 'starRefund'));
    }
  } else if (result.winner) {
    const winner = result.winner!;
    const loser = result.loser!;
    await initProfile(winner);
    await initProfile(loser);

    await updateProfile(winner, { gamesPlayed: 1, wins: 1, trophies: 1 });
    await updateProfile(loser, { gamesPlayed: 1, losses: 1, trophies: -1 });
    await sendMessage(winner, await getText(winner, 'matchWin'));
    await sendMessage(loser, await getText(loser, 'matchLoss'));

    if (battle.isStarBattle) {
      await updateProfile(winner, { stars: 1.5 });
      await sendMessage(winner, await getText(winner, 'starWin'));
      await sendMessage(loser, await getText(loser, 'starLoss'));
    }
  }

  delete battles[p1];
  delete battles[p2];
}

// -------------------- Callback handler --------------------
async function handleCallback(cb: any) {
  const fromId = String(cb.from.id);
  const data = cb.data ?? null;
  const callbackId = cb.id;
  const username = cb.from.username;
  const displayName = cb.from.first_name || cb.from.username || fromId;

  if (!data) {
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("lang:")) {
    const lang = data.split(":")[1] as Lang;
    await updateProfile(fromId, { lang });
    await sendMessage(fromId, await getText(fromId, 'welcome'));
    await showHelpAndMenu(fromId);
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("menu:")) {
    const cmd = data.split(":")[1];
    await handleCommand(fromId, username, displayName, `/${cmd}`, false);
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("leaderboard_trophies:")) {
    const page = parseInt(data.split(":")[2]) || 0;
    await sendLeaderboard(fromId, 'trophies', page);
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("leaderboard_stars:")) {
    const page = parseInt(data.split(":")[2]) || 0;
    await sendLeaderboard(fromId, 'stars', page);
    await answerCallbackQuery(callbackId);
    return;
  }

  if (data.startsWith("complete_withdraw:")) {
    const withdrawId = data.split(":")[1];
    const adminProfile = await getProfileByUsername(ADMIN_USERNAME);
    if (fromId !== adminProfile?.id) {
      await answerCallbackQuery(callbackId, await getText(fromId, 'adminNoAccess'), true);
      return;
    }
    const withdrawRes = await kv.get<{userId: string, amount: number}>(["withdrawals", withdrawId]);
    if (!withdrawRes.value) {
      await answerCallbackQuery(callbackId, "Request not found.", true);
      return;
    }
    const {userId, amount} = withdrawRes.value;
    const profile = await getProfile(userId);
    if (!profile || profile.stars < amount) {
      await answerCallbackQuery(callbackId, "User has insufficient balance.", true);
      return;
    }
    await updateProfile(userId, {stars: -amount});
    await sendMessage(userId, await getText(userId, 'withdrawNotify', {amount}));
    await kv.delete(["withdrawals", withdrawId]);
    await answerCallbackQuery(callbackId, await getText(fromId, 'withdrawComplete'));
    return;
  }

  if (data === "noop") {
    await answerCallbackQuery(callbackId);
    return;
  }

  const battle = battles[fromId];
  if (!battle) {
    await answerCallbackQuery(callbackId);
    return;
  }

  // Reset timers
  if (battle.idleTimerId) {
    clearTimeout(battle.idleTimerId);
    battle.idleTimerId = setTimeout(() => endBattleIdle(battle), 3 * 60 * 1000);
  }

  if (battle.moveTimerId) {
    clearTimeout(battle.moveTimerId);
    battle.moveTimerId = setTimeout(() => endTurnIdle(battle), 30 * 1000);
  }

  if (data === "surrender") {
    const opponent = battle.players.find((p: string) => p !== fromId)!;
    await sendMessage(fromId, await getText(fromId, 'surrender'));
    await sendMessage(opponent, await getText(opponent, 'opponentSurrender'));
    await finishMatch(battle, { winner: opponent, loser: fromId });
    await answerCallbackQuery(callbackId, await getText(fromId, 'surrender'));
    return;
  }

  if (!data.startsWith("move:")) {
    await answerCallbackQuery(callbackId);
    return;
  }

  const idx = parseInt(data.split(":")[1]);
  if (isNaN(idx) || idx < 0 || idx > 8) {
    await answerCallbackQuery(callbackId, await getText(fromId, 'invalidMove'), true);
    return;
  }
  if (battle.turn !== fromId) {
    await answerCallbackQuery(callbackId, await getText(fromId, 'opponentTurn'), true);
    return;
  }
  if (battle.board[idx] !== "") {
    await answerCallbackQuery(callbackId, await getText(fromId, 'cellOccupied'), true);
    return;
  }

  const mark = battle.marks[fromId];
  battle.board[idx] = mark;

  const winResult = checkWin(battle.board);
  let roundWinner: string | undefined;
  if (winResult) {
    const { winner, line } = winResult as any;
    if (winner !== "draw") {
      roundWinner = battle.players.find((p: string) => battle.marks[p] === winner)!;
      battle.roundWins[roundWinner] += 1;
    }

    let boardText = boardToText(battle.board);
    if (line) {
      boardText += `\n🎉 Line: ${line.map((i: number) => i + 1).join("-")}`;
    } else if (winner === "draw") {
      boardText += `\n🤝 Draw!`;
    }

    for (const player of battle.players) {
      const msgId = battle.messageIds[player];
      const header = headerForPlayer(battle, player);
      let text = `${header}\n\nRound ${battle.round} Result!\n`;
      if (winner === "draw") text += await getText(player, 'roundDraw') + '\n';
      else text += `${roundWinner === player ? await getText(player, 'roundWin') : await getText(player, 'roundLoss')}\n`;
      text += `Score: ${battle.roundWins[battle.players[0]]} - ${battle.roundWins[battle.players[1]]}\n${boardText}`;
      if (msgId) await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board, true), parse_mode: "Markdown" });
      else await sendMessage(player, text, { parse_mode: "Markdown" });
    }

    // Check if match over
    const neededWins = Math.ceil(battle.rounds / 2);
    if (battle.roundWins[battle.players[0]] >= neededWins || battle.roundWins[battle.players[1]] >= neededWins || battle.round === battle.rounds) {
      if (battle.roundWins[battle.players[0]] > battle.roundWins[battle.players[1]]) {
        await finishMatch(battle, { winner: battle.players[0], loser: battle.players[1] });
      } else if (battle.roundWins[battle.players[1]] > battle.roundWins[battle.players[0]]) {
        await finishMatch(battle, { winner: battle.players[1], loser: battle.players[0] });
      } else {
        await finishMatch(battle, { draw: true });
      }
      await answerCallbackQuery(callbackId);
      return;
    }

    // Next round
    battle.round++;
    battle.board = createEmptyBoard();
    battle.turn = battle.players[(battle.round - 1) % 2];

    if (battle.moveTimerId) clearTimeout(battle.moveTimerId);
    battle.moveTimerId = setTimeout(() => endTurnIdle(battle), 30 * 1000);

    await sendRoundStart(battle);
    await answerCallbackQuery(callbackId);
    return;
  }

  // Continue
  battle.turn = battle.players.find((p: string) => p !== fromId)!;
  for (const player of battle.players) {
    const header = headerForPlayer(battle, player);
    const yourTurn = battle.turn === player;
    const turnText = yourTurn ? await getText(player, 'yourTurn') : await getText(player, 'opponentTurn');
    const text =
      `${header}\n\n` +
      `Round: ${battle.round}/${battle.rounds}\n` +
      `Score: ${battle.roundWins[battle.players[0]]} - ${battle.roundWins[battle.players[1]]}\n` +
      `${turnText}\n` +
      boardToText(battle.board);
    const msgId = battle.messageIds[player];
    if (msgId) await editMessageText(player, msgId, text, { reply_markup: makeInlineKeyboard(battle.board), parse_mode: "Markdown" });
    else await sendMessage(player, text, { reply_markup: makeInlineKeyboard(battle.board), parse_mode: "Markdown" });
  }
  await answerCallbackQuery(callbackId);
}

// -------------------- Show help and menu --------------------
async function showHelpAndMenu(fromId: string) {
  const helpText = await getText(fromId, 'help');
  const mainMenu = {
    inline_keyboard: [
      [{ text: "🏆 Trophy Battle", callback_data: "menu:battle" }, { text: "⭐ Star Battle", callback_data: "menu:realbattle" }],
      [{ text: "📊 Profile", callback_data: "menu:profile" }, { text: "🏅 Trophies Leaderboard", callback_data: "menu:leaderboard_trophies" }],
      [{ text: "⭐ Stars Leaderboard", callback_data: "menu:leaderboard_stars" }, { text: "💸 Withdraw", callback_data: "menu:withdraw" }],
    ]
  };
  await sendMessage(fromId, helpText, { parse_mode: "Markdown", reply_markup: mainMenu });
}

// -------------------- Withdrawal functionality --------------------
async function handleWithdrawal(fromId: string, text: string) {
  const state = await getWithdrawalState(fromId);
  if (state) {
    if (state.step === "amount") {
      const amount = parseFloat(text);

      if (isNaN(amount) || amount < 50) {
        await sendMessage(fromId, await getText(fromId, 'invalidAmount'));
        return;
      }

      const profile = await getProfile(fromId);
      if (!profile || profile.stars < amount) {
        await sendMessage(fromId, await getText(fromId, 'insufficientBalance'));
        await setWithdrawalState(fromId, null);
        return;
      }

      // Create pending without deduct
      const withdrawId = crypto.randomUUID();
      await kv.set(["withdrawals", withdrawId], {userId: fromId, amount});

      await sendMessage(fromId, await getText(fromId, 'withdrawRequest'));

      const adminProfile = await getProfileByUsername(ADMIN_USERNAME);
      const adminId = adminProfile?.id;
      if (adminId) {
        const adminMsg = await getText(adminId, 'withdrawPending', {amount, userId: fromId});
        await sendMessage(adminId, adminMsg, {
          reply_markup: { inline_keyboard: [[{ text: "Complete", callback_data: `complete_withdraw:${withdrawId}` }]] }
        });
      }

      await setWithdrawalState(fromId, null);
      return;
    }
  } else {
    await sendMessage(fromId, await getText(fromId, 'withdrawAmount'));
    await setWithdrawalState(fromId, { amount: 0, step: "amount" });
    return;
  }
}

async function getProfileByUsername(username: string): Promise<Profile | null> {
  try {
    for await (const entry of kv.list({ prefix: ["profiles"] })) {
      const profile = entry.value as Profile;
      if (!profile) continue;
      if (profile.username === username) return profile;
    }
  } catch (e) {
    console.error("getProfileByUsername error", e);
  }
  return null;
}

// -------------------- Stats for admin --------------------
async function sendStats(chatId: string) {
  let userCount = 0;
  let activeCount = 0;
  let totalMatches = (await kv.get<number>(["stats", "totalMatches"]))?.value || 0;
  let totalStars = 0;
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;

  for await (const entry of kv.list({ prefix: ["profiles"] })) {
    if (!entry.value) continue;
    const p = entry.value as Profile;
    userCount++;
    totalStars += p.stars || 0;
    if (p.lastActive > last24h) activeCount++;
  }

  const msg = await getText(chatId, 'adminStats', {
    users: userCount,
    active: activeCount,
    matches: totalMatches,
    stars: totalStars,
  });
  await sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

// -------------------- Commands --------------------
async function handleCommand(fromId: string, username: string | undefined, displayName: string, text: string, isNew: boolean) {
  const { profile } = await initProfile(fromId, username, displayName);
  if (!profile.lang) {
    await sendMessage(fromId, await getText(fromId, 'chooseLang'), {
      reply_markup: { inline_keyboard: [[{ text: "EN", callback_data: "lang:en" }, { text: "RU", callback_data: "lang:ru" }]] }
    });
    return;
  }

  // Close active states
  if (await getWithdrawalState(fromId)) {
    await setWithdrawalState(fromId, null);
  }

  if (text.startsWith("/battle")) {
    if (queue.includes(fromId) || starQueue.includes(fromId)) {
      await sendMessage(fromId, await getText(fromId, 'alreadyInQueue'));
      return;
    }
    if (battles[fromId]) {
      await sendMessage(fromId, await getText(fromId, 'alreadyInGame'));
      return;
    }
    queue.push(fromId);
    await sendMessage(fromId, await getText(fromId, 'searching'));

    searchTimeouts[fromId] = setTimeout(async () => {
      const index = queue.indexOf(fromId);
      if (index !== -1) {
        queue.splice(index, 1);
        delete searchTimeouts[fromId];
        await sendMessage(fromId, await getText(fromId, 'searchTimeout'));
      }
    }, 30_000) as unknown as number;

    if (queue.length >= 2) {
      const [p1, p2] = queue.splice(0, 2);
      await startBattle(p1, p2);
    }
    return;
  }

  if (text.startsWith("/realbattle")) {
    const profile = await getProfile(fromId);
    if (!profile || profile.stars < 1) {
      await sendMessage(fromId, await getText(fromId, 'insufficientStars'));
      return;
    }

    if (queue.includes(fromId) || starQueue.includes(fromId)) {
      await sendMessage(fromId, await getText(fromId, 'alreadyInQueue'));
      return;
    }
    if (battles[fromId]) {
      await sendMessage(fromId, await getText(fromId, 'alreadyInGame'));
      return;
    }

    await updateProfile(fromId, { stars: -1 });
    starQueue.push(fromId);
    await sendMessage(fromId, await getText(fromId, 'searching'));

    searchTimeouts[fromId] = setTimeout(async () => {
      const index = starQueue.indexOf(fromId);
      if (index !== -1) {
        starQueue.splice(index, 1);
        await updateProfile(fromId, { stars: 1 });
        await sendMessage(fromId, await getText(fromId, 'searchTimeout'));
        delete searchTimeouts[fromId];
      }
    }, 30_000) as unknown as number;

    if (starQueue.length >= 2) {
      const [p1, p2] = starQueue.splice(0, 2);
      await startBattle(p1, p2, true);
    }
    return;
  }

  if (text.startsWith("/profile")) {
    await sendProfile(fromId);
    return;
  }

  if (text.startsWith("/userprofile")) {
    if (username !== ADMIN_USERNAME) {
      await sendMessage(fromId, await getText(fromId, 'adminNoAccess'));
      return;
    }
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) {
      await sendMessage(fromId, "/userprofile <userId>");
      return;
    }
    const [, userId] = parts;
    await sendUserProfile(fromId, userId);
    return;
  }

  if (text.startsWith("/leaderboard_trophies")) {
    await sendLeaderboard(fromId, 'trophies', 0);
    return;
  }

  if (text.startsWith("/leaderboard_stars")) {
    await sendLeaderboard(fromId, 'stars', 0);
    return;
  }

  if (text.startsWith("/addtouser")) {
    if (username !== ADMIN_USERNAME) {
      await sendMessage(fromId, await getText(fromId, 'adminNoAccess'));
      return;
    }
    const parts = text.trim().split(/\s+/);
    if (parts.length < 4) {
      await sendMessage(fromId, "/addtouser stars|trophies <userId> <amount>");
      return;
    }
    const [, type, userId, amountStr] = parts;
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) {
      await sendMessage(fromId, "Invalid amount.");
      return;
    }
    if (type === "stars") {
      await updateProfile(userId, { stars: amount });
      await sendMessage(fromId, `${amount} stars added to ID:${userId}`);
    } else if (type === "trophies") {
      await updateProfile(userId, { trophies: amount });
      await sendMessage(fromId, `${amount} trophies added to ID:${userId}`);
    } else {
      await sendMessage(fromId, "Invalid type: stars or trophies.");
    }
    return;
  }

  if (text.startsWith("/withdraw")) {
    const profile = await getProfile(fromId);
    if (!profile || profile.stars < 50) {
      await sendMessage(fromId, await getText(fromId, 'insufficientBalance'));
      return;
    }
    await handleWithdrawal(fromId, "");
    return;
  }

  if (text.startsWith("/stats")) {
    if (username !== ADMIN_USERNAME) {
      await sendMessage(fromId, await getText(fromId, 'adminNoAccess'));
      return;
    }
    await sendStats(fromId);
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await showHelpAndMenu(fromId);
    return;
  }

  await sendMessage(fromId, "Unknown command. /help");
}

// -------------------- Server / Webhook --------------------
serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (url.pathname !== SECRET_PATH) return new Response("Not found", { status: 404 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const update = await req.json();

    // handle normal messages
    if (update.message) {
      const msg = update.message;
      if (msg.chat.type !== "private") return new Response("OK");
      const from = msg.from;
      const text = (msg.text || "").trim();
      const fromId = String(from.id);
      const username = from.username;
      const displayName = from.first_name || from.username || fromId;

      if (text.startsWith("/")) {
        await handleCommand(fromId, username, displayName, text, false);
      } else if (await getWithdrawalState(fromId)) {
        await handleWithdrawal(fromId, text);
      } else {
        await sendMessage(fromId, "Unknown command. /help");
      }
    }
    // handle callback queries
    else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    return new Response("OK");
  } catch (e) {
    console.error("server error", e);
    return new Response("Error", { status: 500 });
  }
});
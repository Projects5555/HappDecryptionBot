import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/* =========================================================
   CONFIGURATION
========================================================= */
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN env var is required");

const API = `https://api.telegram.org/bot${TOKEN}`;
const ADMIN_USERNAME = "Masakoff";

/* =========================================================
   KV DATABASE
========================================================= */
const kv = await Deno.openKv();

/* =========================================================
   TYPES
========================================================= */
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
  wins: Record<number, number>;
  msgIds: Record<number, number>;
  active: boolean;
}

interface Withdrawal {
  id: string;
  userId: number;
  amount: number;
  completed: boolean;
}

/* =========================================================
   LOCALIZATION
========================================================= */
const T = {
  chooseLang: {
    en: "Choose your language",
    ru: "Выберите язык",
  },
  yourTurn: {
    en: "Your turn",
    ru: "Ваш ход",
  },
  wait: {
    en: "Waiting for opponent…",
    ru: "Ожидание соперника…",
  },
  accessDenied: {
    en: "Access denied",
    ru: "Доступ запрещён",
  },
};

/* =========================================================
   TELEGRAM HELPERS
========================================================= */
async function tg(method: string, body: any) {
  await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* =========================================================
   USER HELPERS
========================================================= */
async function getUser(id: number, from: any): Promise<UserProfile> {
  const res = await kv.get<UserProfile>(["user", id]);
  if (res.value) return res.value;

  const user: UserProfile = {
    id,
    username: from.username,
    firstName: from.first_name,
    language: null,
    trophies: 0,
    stars: 0,
    matchesPlayed: 0,
    wins: 0,
    lastDailyBonus: 0,
    lastActive: Date.now(),
  };
  await kv.set(["user", id], user);
  return user;
}

/* =========================================================
   LANGUAGE SELECTION
========================================================= */
async function askLanguage(chatId: number) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: "Choose your language",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🇬🇧 English", callback_data: "lang_en" }],
        [{ text: "🇷🇺 Русский", callback_data: "lang_ru" }],
      ],
    },
  });
}

/* =========================================================
   MATCHMAKING QUEUES
========================================================= */
async function enqueue(userId: number, type: "trophy" | "star") {
  const key = ["queue", type];
  const q = (await kv.get<number[]>(key)).value ?? [];

  if (q.includes(userId)) return;
  q.push(userId);
  await kv.set(key, q);

  if (q.length >= 2) {
    const p1 = q.shift()!;
    const p2 = q.shift()!;
    await kv.set(key, q);
    await startMatch(p1, p2, type);
  }
}

/* =========================================================
   MATCH CREATION
========================================================= */
async function startMatch(p1: number, p2: number, type: "trophy" | "star") {
  if (p1 === p2) return;

  const id = crypto.randomUUID();
  const match: Match = {
    id,
    p1,
    p2,
    type,
    board: Array(9).fill(""),
    turn: p1,
    p1Mark: "X",
    p2Mark: "O",
    rounds: 1,
    wins: { [p1]: 0, [p2]: 0 },
    msgIds: {},
    active: true,
  };

  await kv.set(["match", id], match);
  await sendBoard(match);
}

/* =========================================================
   BOARD RENDER
========================================================= */
function boardKeyboard(match: Match) {
  const btn = (i: number) => ({
    text: match.board[i] || " ",
    callback_data: `mv_${match.id}_${i}`,
  });

  return {
    inline_keyboard: [
      [btn(0), btn(1), btn(2)],
      [btn(3), btn(4), btn(5)],
      [btn(6), btn(7), btn(8)],
    ],
  };
}

async function sendBoard(match: Match) {
  for (const uid of [match.p1, match.p2]) {
    const msg = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: uid,
        text: `Round ${match.rounds}\n${match.turn === uid ? "Your turn" : "Opponent's turn"}`,
        reply_markup: boardKeyboard(match),
      }),
    }).then(r => r.json());

    match.msgIds[uid] = msg.result.message_id;
  }
  await kv.set(["match", match.id], match);
}

/* =========================================================
   MOVE HANDLING
========================================================= */
function checkWin(b: string[]) {
  const w = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];
  return w.some(([a,b1,c]) => b[a] && b[a] === b[b1] && b[a] === b[c]);
}

/* =========================================================
   WITHDRAWALS
========================================================= */
async function requestWithdraw(user: UserProfile) {
  if (user.stars < 50) return;

  const existing = await kv.get(["withdraw_pending", user.id]);
  if (existing.value) return;

  const w: Withdrawal = {
    id: crypto.randomUUID(),
    userId: user.id,
    amount: user.stars,
    completed: false,
  };

  await kv.set(["withdraw", w.id], w);
  await kv.set(["withdraw_pending", user.id], true);

  await tg("sendMessage", {
    chat_id: `@${ADMIN_USERNAME}`,
    text: `Withdraw request\nUser: ${user.id}\nAmount: ${w.amount}`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Complete", callback_data: `wd_${w.id}` }],
      ],
    },
  });
}

/* =========================================================
   TELEGRAM STARS TOP-UP
========================================================= */
async function createInvoice(chatId: number, userId: number, amount: number) {
  const payload = `topup_${userId}_${crypto.randomUUID()}`;

  await kv.set(["invoice", payload], { userId, amount });

  await tg("sendInvoice", {
    chat_id: chatId,
    title: "Star Top-Up",
    description: `Top up ${amount} stars`,
    payload,
    provider_token: "", // Telegram Stars → empty
    currency: "XTR",
    prices: [{ label: "Stars", amount }],
  });
}

/* =========================================================
   WEBHOOK
========================================================= */
serve(async (req) => {
  const update = await req.json();

  /* ---------- CALLBACK QUERIES ---------- */
  if (update.callback_query) {
    const cq = update.callback_query;
    const user = await getUser(cq.from.id, cq.from);

    // Language select
    if (cq.data.startsWith("lang_")) {
      user.language = cq.data.endsWith("en") ? "en" : "ru";
      await kv.set(["user", user.id], user);
      await tg("sendMessage", {
        chat_id: user.id,
        text: "Language saved ✅",
      });
    }
  }

  /* ---------- MESSAGES ---------- */
  if (update.message) {
    const m = update.message;
    const user = await getUser(m.from.id, m.from);

    // /start
    if (m.text === "/start") {
      if (!user.language) await askLanguage(user.id);
    }

    // /profile
    if (m.text === "/profile") {
      await tg("sendMessage", {
        chat_id: user.id,
        text:
`🏆 Trophies: ${user.trophies}
⭐ Stars: ${user.stars}
🎮 Matches: ${user.matchesPlayed}
🏅 Wins: ${user.wins}`,
      });
    }

    // Top up stars
    if (m.text === "⭐ Top Up Stars") {
      await tg("sendMessage", {
        chat_id: user.id,
        text: "Enter number of stars (minimum 1 ⭐)",
      });
    }

    // Numeric top-up
    if (/^\d+$/.test(m.text || "")) {
      const amount = Number(m.text);
      if (amount >= 1) {
        await createInvoice(user.id, user.id, amount);
      }
    }

    // Successful payment
    if (m.successful_payment) {
      const payload = m.successful_payment.invoice_payload;
      const inv = await kv.get<any>(["invoice", payload]);
      if (!inv.value) return new Response("OK");

      const u = await getUser(inv.value.userId, m.from);
      u.stars += inv.value.amount;
      await kv.set(["user", u.id], u);
      await kv.delete(["invoice", payload]);

      await tg("sendMessage", {
        chat_id: u.id,
        text: `✅ Payment successful!\n⭐ ${inv.value.amount} stars added`,
      });
    }
  }

  return new Response("OK");
});

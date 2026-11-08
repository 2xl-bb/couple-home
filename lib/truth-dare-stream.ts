import { publicGame, type GameRow } from './truth-dare-games';
import type { context } from './home-server';

type Database = Awaited<ReturnType<typeof context>>['db'];
type Listener = {
  userId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  snapshot: string | null;
  closed: boolean;
  hadError: boolean;
};
type StreamState = {
  db: Database;
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  polling: boolean;
  rerun: boolean;
  failed: boolean;
};

const states = new WeakMap<Database, StreamState>();
const encoder = new TextEncoder();
const event = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

function stateFor(db: Database) {
  let state = states.get(db);
  if (!state) {
    state = { db, listeners: new Set(), timer: null, polling: false, rerun: false, failed: false };
    states.set(db, state);
  }
  return state;
}

function send(state: StreamState, listener: Listener, chunk: Uint8Array) {
  if (listener.closed) return;
  try { listener.controller.enqueue(chunk); }
  catch { unsubscribe(state, listener); }
}

async function poll(state: StreamState) {
  if (state.polling) {
    state.rerun = true;
    return;
  }
  state.polling = true;
  try {
    do {
      state.rerun = false;
      const listeners = [...state.listeners].filter(listener => !listener.closed);
      if (!listeners.length) return;
      const users = [...new Set(listeners.map(listener => listener.userId))];
      const placeholders = users.map(() => '?').join(',');
      const result = await state.db.prepare(`SELECT id,creator_id,partner_id,p1_roll,p2_roll,status,loser_id,choice_type,question_text,answer_text,chat_messages,created_at
        FROM truth_dare_games
        WHERE creator_id IN (${placeholders}) OR partner_id IN (${placeholders})
        ORDER BY CASE WHEN status <> 'finished' THEN 0 ELSE 1 END, created_at DESC, id DESC`)
        .bind(...users, ...users).all<GameRow>();
      const games = new Map<string, GameRow>();
      for (const game of result.results) {
        if (!games.has(game.creator_id)) games.set(game.creator_id, game);
        if (!games.has(game.partner_id)) games.set(game.partner_id, game);
      }

      state.failed = false;
      for (const listener of listeners) {
        const game = games.get(listener.userId) || null;
        const snapshot = JSON.stringify({ game: publicGame(game, listener.userId) });
        if (listener.snapshot !== snapshot || listener.hadError) {
          listener.snapshot = snapshot;
          listener.hadError = false;
          send(state, listener, event(JSON.parse(snapshot)));
        }
      }
    } while (state.rerun);
  } catch (error) {
    if (!state.failed) console.error('真心话大冒险 SSE 同步失败：', error instanceof Error ? error.message : error);
    state.failed = true;
    for (const listener of state.listeners) {
      if (!listener.closed && !listener.hadError) {
        listener.hadError = true;
        send(state, listener, encoder.encode('event: sync-error\ndata: {"error":"实时同步暂不可用"}\n\n'));
      }
    }
  } finally {
    state.polling = false;
    if (state.rerun && state.listeners.size) void poll(state);
  }
}

function unsubscribe(state: StreamState, listener: Listener) {
  if (listener.closed) return;
  listener.closed = true;
  state.listeners.delete(listener);
  if (!state.listeners.size && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

export function truthDareEventStream(db: Database, userId: string) {
  const state = stateFor(db);
  let listener: Listener | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      listener = { userId, controller, snapshot: null, closed: false, hadError: false };
      state.listeners.add(listener);
      if (!state.timer) state.timer = setInterval(() => void poll(state), 1000);
      heartbeat = setInterval(() => send(state, listener!, encoder.encode(': ping\n\n')), 15000);
      void poll(state);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (listener) unsubscribe(state, listener);
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export function notifyTruthDareChanged(db: Database) {
  const state = states.get(db);
  if (state?.listeners.size) void poll(state);
}

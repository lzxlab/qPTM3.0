import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { cfg } from "../config.js";
function utcNow() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
let db = null;
export function initConversationsDb() {
    mkdirSync(cfg.conversationsDataDir, { recursive: true });
    const path = `${cfg.conversationsDataDir}/agent.db`;
    db = new DatabaseSync(path);
    db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT 'New conversation',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id ASC);
    CREATE INDEX IF NOT EXISTS idx_conv_device_updated ON conversations(device_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS conversation_state (
      conversation_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
function getDb() {
    if (!db)
        initConversationsDb();
    return db;
}
export function createConversation(deviceId, title = "New conversation") {
    const id = crypto.randomUUID();
    const now = utcNow();
    const t = (title || "New conversation").trim().slice(0, 80) || "New conversation";
    getDb()
        .prepare("INSERT INTO conversations (id, device_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, deviceId, t, now, now);
    return { id, title: t, created_at: now, updated_at: now };
}
export function listConversations(deviceId, limit = 50) {
    return getDb()
        .prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE device_id = ? ORDER BY updated_at DESC LIMIT ?")
        .all(deviceId, limit);
}
export function belongsToDevice(conversationId, deviceId) {
    const row = getDb()
        .prepare("SELECT 1 AS ok FROM conversations WHERE id = ? AND device_id = ?")
        .get(conversationId, deviceId);
    return Boolean(row?.ok);
}
export function getConversation(conversationId, deviceId) {
    const conv = getDb()
        .prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND device_id = ?")
        .get(conversationId, deviceId);
    if (!conv)
        return null;
    const messages = getDb()
        .prepare("SELECT id, role, content, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC")
        .all(conversationId);
    return {
        ...conv,
        messages: messages.map((m) => ({
            ...m,
            meta: m.meta ? JSON.parse(String(m.meta)) : null,
        })),
    };
}
export function deleteConversation(conversationId, deviceId) {
    const res = getDb()
        .prepare("DELETE FROM conversations WHERE id = ? AND device_id = ?")
        .run(conversationId, deviceId);
    if (Number(res.changes) > 0) {
        getDb().prepare("DELETE FROM conversation_state WHERE conversation_id = ?").run(conversationId);
        return true;
    }
    return false;
}
export function saveConversationState(conversationId, state) {
    if (!conversationId)
        return;
    getDb()
        .prepare("INSERT INTO conversation_state (conversation_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at")
        .run(conversationId, JSON.stringify(state), utcNow());
}
export function loadConversationState(conversationId) {
    if (!conversationId)
        return null;
    const row = getDb()
        .prepare("SELECT state_json FROM conversation_state WHERE conversation_id = ?")
        .get(conversationId);
    if (!row?.state_json)
        return null;
    try {
        return JSON.parse(row.state_json);
    }
    catch {
        return null;
    }
}
export function clearConversationState(conversationId) {
    if (!conversationId)
        return;
    getDb().prepare("DELETE FROM conversation_state WHERE conversation_id = ?").run(conversationId);
}
export function addMessage(conversationId, role, content, meta) {
    const now = utcNow();
    getDb()
        .prepare("INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(conversationId, role, content, meta ? JSON.stringify(meta) : null, now);
    getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
}
export function updateTitle(conversationId, title) {
    getDb()
        .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
        .run(title.slice(0, 80), utcNow(), conversationId);
}
export function titleFromMessage(msg) {
    const t = (msg || "").replace(/\s+/g, " ").trim();
    return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New conversation";
}

// ═══════════════════════════════════════════════════════════════
//  lib/store.js — Shared in-memory store (module singleton)
//  Persists across requests within the same warm Vercel instance
//  For production reliability → upgrade to Vercel KV (free)
// ═══════════════════════════════════════════════════════════════

export const histories  = new Map(); // userId → [{role, content}]
export const users      = new Map(); // userId → { firstName, chatId, msgCount }
export const processing = new Set(); // userId → currently being processed

/** Register or update a user */
export function registerUser(userId, firstName, chatId) {
  const existing = users.get(userId) || { firstName, chatId, msgCount: 0 };
  users.set(userId, { ...existing, firstName, chatId });
}

/** Increment message count and return new count */
export function incrementMsgCount(userId) {
  const u = users.get(userId);
  if (!u) return 0;
  u.msgCount = (u.msgCount || 0) + 1;
  users.set(userId, u);
  return u.msgCount;
}

/** Get all registered users as array */
export function getAllUsers() {
  return [...users.values()];
}

/** History helpers */
export function getHist(uid) {
  if (!histories.has(uid)) histories.set(uid, []);
  return histories.get(uid);
}
export function addMsg(uid, role, content) {
  const h = getHist(uid);
  h.push({ role, content });
  if (h.length > 30) h.splice(0, h.length - 30);
}
export function clearHist(uid) { histories.set(uid, []); }

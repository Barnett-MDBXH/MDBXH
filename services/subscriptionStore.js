// services/subscriptionStore.js
const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(process.cwd(), "storage", "subscriptions.json");

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return { users: {} };
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    return { users: {} };
  }
}

function writeStore(store) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {}
}

function ensureUser(store, discordUserId) {
  if (!store.users) store.users = {};
  if (!store.users[discordUserId]) {
    store.users[discordUserId] = { val: [], lol: [] };
  }
  if (!Array.isArray(store.users[discordUserId].val)) store.users[discordUserId].val = [];
  if (!Array.isArray(store.users[discordUserId].lol)) store.users[discordUserId].lol = [];
  return store.users[discordUserId];
}

module.exports = { readStore, writeStore, ensureUser };

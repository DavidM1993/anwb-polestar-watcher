#!/usr/bin/env node
/**
 * Print your Telegram chat ID.
 * 1. Create a bot with @BotFather and copy the token
 * 2. Send /start to your bot
 * 3. TELEGRAM_BOT_TOKEN=... npm run telegram:chatid
 */
import { getUpdates } from "../src/telegram.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN first.");
  console.error("  PowerShell:  $env:TELEGRAM_BOT_TOKEN='123:abc'");
  console.error("  bash:        export TELEGRAM_BOT_TOKEN=123:abc");
  process.exit(1);
}

const data = await getUpdates(token);
const updates = data.result || [];
if (updates.length === 0) {
  console.log(
    "No messages yet. Open Telegram, find your bot, send /start, then re-run this."
  );
  process.exit(0);
}

const chats = new Map();
for (const u of updates) {
  const chat = u.message?.chat || u.edited_message?.chat || u.my_chat_member?.chat;
  if (!chat) continue;
  const label = [chat.first_name, chat.last_name, chat.username && `@${chat.username}`]
    .filter(Boolean)
    .join(" ");
  chats.set(String(chat.id), label || chat.type);
}

console.log("Chat IDs found:");
for (const [id, label] of chats) {
  console.log(`  ${id}  (${label})`);
}
console.log("\nAdd TELEGRAM_CHAT_ID as a GitHub Actions secret with one of these IDs.");

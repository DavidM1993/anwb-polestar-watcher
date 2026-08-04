#!/usr/bin/env node
/**
 * Send a one-off test Telegram message.
 * TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm run telegram:test
 */
import { sendMessage } from "../src/telegram.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
  console.error("Need TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.");
  process.exit(1);
}

await sendMessage({
  token,
  chatId,
  text: "✅ ANWB Polestar Watcher — Telegram test OK.",
  disablePreview: true,
});
console.log("Sent.");

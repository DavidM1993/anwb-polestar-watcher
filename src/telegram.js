/**
 * Minimal Telegram Bot API helpers.
 */

/**
 * @param {string} token
 * @param {string} method
 * @param {Record<string, unknown>} payload
 */
async function telegramCall(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(
      `Telegram ${method} failed: ${res.status} ${JSON.stringify(data)}`
    );
  }
  return data;
}

/**
 * @param {{ token: string, chatId: string, text: string, disablePreview?: boolean }} opts
 */
export async function sendMessage({
  token,
  chatId,
  text,
  disablePreview = false,
}) {
  return telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: disablePreview,
  });
}

/**
 * @param {{ token: string, chatId: string, photo: string, caption?: string }} opts
 */
export async function sendPhoto({ token, chatId, photo, caption }) {
  return telegramCall(token, "sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: "HTML",
  });
}

/**
 * @param {string} token
 */
export async function getUpdates(token) {
  return telegramCall(token, "getUpdates", { limit: 20 });
}

/**
 * Escape text for Telegram HTML parse mode.
 * @param {string} s
 */
export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

# ANWB Polestar Watcher

Watches [ANWB Private Lease occasions](https://www.anwb.nl/auto/private-lease/anwb-private-lease/aanbod?aanbod[0]=occasion) and sends you a **Telegram** push the moment a **Polestar** appears.

Runs on **GitHub Actions** on a schedule — your PC can stay off. Cost: €0.

## How it works

1. Every 20 minutes (UTC) a workflow wakes up.
2. `scripts/should-run.js` checks **Europe/Amsterdam** time:
   - **08:00–18:00**: run if 20 or 40 minutes (randomized) have passed since the last check
   - **Otherwise**: run if 3 hours have passed
3. It POSTs to ANWB’s public search API (`/privatelease/v1/car-search-api/query/leasecars`) — no browser needed.
4. New Polestar listings are pushed to Telegram (once each; if one disappears and comes back you get notified again).
5. After 3 consecutive scrape failures you get a “watcher is broken” alert.

## One-time setup (~5 minutes)

### 1. Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, follow the prompts, copy the **token**
3. Open a chat with your new bot and send `/start`

### 2. Clone and get your chat ID

```powershell
cd ~/Projects/anwb-polestar-watcher
$env:TELEGRAM_BOT_TOKEN = "PASTE_TOKEN_HERE"
node scripts/telegram-chatid.js
```

(You can also copy [`.env.example`](.env.example) to `.env` and fill it in — do not commit `.env`.)

Copy the numeric chat ID it prints.

Optional local smoke tests:

```powershell
$env:TELEGRAM_CHAT_ID = "YOUR_CHAT_ID"
npm run telegram:test
node src/scrape.js
```

### 3. Create a public GitHub repo and push

Public repos get unlimited Actions minutes (recommended).

1. Create an empty **public** repo on github.com (e.g. `anwb-polestar-watcher`), without a README
2. Push this project:

```powershell
cd ~/Projects/anwb-polestar-watcher
git remote add origin https://github.com/YOUR_USER/anwb-polestar-watcher.git
git branch -M main
git push -u origin main
```

### 4. Add secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Value |
|------|--------|
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_CHAT_ID` | Your numeric chat ID |

### 5. Run once by hand

**Actions** → **Check ANWB for Polestar** → **Run workflow** (leave “test” checked).

You should get a Telegram test message and a “check OK” summary (0 Polestars is fine).

Scheduled runs start automatically after that.

## Change the brand later

Set `BRAND_FILTER` in [`.github/workflows/check.yml`](.github/workflows/check.yml) (default `polestar`). Matching is case-insensitive substring on the manufacturer name.

## Local development

```powershell
node src/scrape.js          # print current occasion listings
node scripts/should-run.js  # print whether a check would run now
```

API discovery (needs Playwright once):

```powershell
npm install
npx playwright install chromium
npm run discover
```

## Files

| Path | Role |
|------|------|
| `src/scrape.js` | ANWB API client |
| `src/main.js` | Diff + Telegram + failure tracking |
| `src/telegram.js` | Bot API helpers |
| `src/state.js` | `state/seen.json` read/write |
| `scripts/should-run.js` | Amsterdam time gate |
| `.github/workflows/check.yml` | Cron + manual trigger |

## Notes

- GitHub scheduled workflows can run a few minutes late; occasionally a tick is dropped. At a 20–40 minute cadence that is usually fine.
- GitHub disables schedules after 60 days of repo inactivity; this workflow commits `state/seen.json` after each check so that does not happen.
- Personal use only; be polite to ANWB’s API (this schedule is ~1 request every 20–40 minutes).

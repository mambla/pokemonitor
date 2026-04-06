# PokeMonitor

Chrome extension that monitors Facebook groups for new posts and sends AI-powered alerts via browser notifications and Telegram.

Built for Pokemon card trading groups but works with any Facebook group.

## How it works

1. You add Facebook group URLs in the dashboard
2. The extension opens and manages those tabs in a Chrome tab group
3. A content script parses new posts from the DOM (author, text, images, timestamps)
4. Claude AI (Sonnet 4.6) analyzes post images and text to extract structured info
5. You get a browser notification and a Telegram message with card details, prices, and images

No backend server needed -- everything runs in the browser.

## Install

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `extension/` folder
5. The dashboard opens automatically

## Setup

In the dashboard sidebar, configure:

- **Groups** -- paste Facebook group URLs to monitor
- **Claude API Key** -- get one from [console.anthropic.com](https://console.anthropic.com)
- **AI Prompt** -- customize what the AI extracts (defaults to Pokemon card analysis)
- **Telegram** -- bot token (from [@BotFather](https://t.me/BotFather)) and chat ID

All fields are optional. Without an API key you still get browser notifications with the raw post info.

## Features

- Parses posts from live Facebook group DOM without making extra HTTP requests
- Manages its own browser tabs in a collapsed Chrome tab group
- Auto-refreshes tabs every 2 min (day) or 30 min (1-8 AM local time)
- Sends up to 10 images per post to Telegram as file uploads (no Facebook URLs leaked)
- Claude vision analyzes card images for names, sets, conditions, grading, prices
- Deduplicates posts across tab reloads and extension restarts
- Extracts approximate post timestamps from Facebook's relative time labels
- Night mode toggle for manual control of refresh frequency
- Test buttons for both Telegram and AI prompt

## Project structure

```
extension/
  manifest.json       Manifest V3 config
  background.js       Service worker: tab management, AI, Telegram, notifications
  content.js          Injected into Facebook group tabs, scans for posts
  parser.js           DOM parsing logic (shared with test harness)
  dashboard.html/js/css   Full-page dashboard UI
  icons/              Extension icons
test/
  test-parser.js      Offline parser tests against saved Facebook HTML
```

## Parser testing

Save a Facebook group page's HTML with `copy(document.documentElement.outerHTML)` in DevTools, place it as `facebook.html` in the repo root, then:

```bash
cd test
npm install
cd ..
node test/test-parser.js
```

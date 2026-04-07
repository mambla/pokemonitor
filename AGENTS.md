# PokeMonitor

Chrome extension (Manifest V3) that monitors Facebook groups for new posts and sends AI-analyzed alerts via browser notifications and Telegram. No backend -- everything runs in the browser.

## Architecture

Three-layer pipeline, all client-side inside the extension:

1. **Content script** (`content.js` + `parser.js`) -- injected into Facebook group tabs. `MutationObserver` + 30s interval scan detect new posts. `parser.js` extracts structured data from the DOM (author, text, images, timestamps, post links).
2. **Background service worker** (`background.js`) -- receives posts from content scripts, deduplicates, stores, sends browser notifications, calls Claude API for vision analysis, sends Telegram alerts with uploaded images.
3. **Dashboard** (`dashboard.html/js/css`) -- full-page settings and monitoring UI opened via the extension icon.

## Key files

| File | Role |
|---|---|
| `extension/manifest.json` | Manifest V3 config, permissions, content script injection rules |
| `extension/parser.js` | DOM parser -- the only file that touches Facebook's HTML structure. Shared between content script and Node.js test harness via UMD export. |
| `extension/content.js` | Content script IIFE -- scans, deduplicates locally, sends `NEW_POSTS` messages to background |
| `extension/background.js` | Service worker -- tab group management, post storage, Claude API calls, Telegram sending, alarm-based tab refresh |
| `extension/dashboard.js` | Dashboard UI logic -- group management, settings, post log rendering |
| `test/test-parser.js` | Offline parser tests using JSDOM against `facebook.html` |

## Critical conventions

### Parser isolation

All Facebook DOM parsing lives in `parser.js`. When Facebook changes their DOM, only this file should need updating. It uses structural selectors (`div[role="article"][aria-posinset]`, `[data-ad-rendering-role="profile_name"]`, `a[href]` matching `/groups/.../posts/...`) rather than obfuscated class names.

### No extra HTTP requests to Facebook

The extension only reads the DOM of tabs the user already has open (or that the extension opened). It never hits Facebook APIs or scrapes URLs. This is intentional -- it makes the extension indistinguishable from ad blockers or accessibility tools.

### Image handling

Images are fetched as blobs and uploaded to Telegram as file attachments. Facebook CDN URLs (`scontent`) are never forwarded to external services. Claude receives images as base64 (max 4 per post). Telegram receives up to 10 as uploaded photos.

### Tab management

The extension manages its own Chrome tab group (collapsed, red, named "PokeMonitor"). Tabs auto-reopen if closed. On extension suspend, all managed tabs are cleaned up. On startup, they're reopened. Each monitored group gets one tab set to `?sorting_setting=CHRONOLOGICAL`.

### Refresh schedule

Tabs reload on alarms: ~2 min during the day, ~30 min at night (1-8 AM local time), with random jitter. Night mode can be forced via the dashboard toggle.

### Message protocol

Content script and background communicate via `chrome.runtime.sendMessage`. Message types: `NEW_POSTS`, `ADD_GROUP`, `REMOVE_GROUP`, `CLEAR_POSTS`, `SET_NIGHT_MODE`, `SET_API_KEY`, `SET_PROMPT`, `SET_TELEGRAM`, `TEST_PROMPT`, `TEST_TELEGRAM`, `GET_STATE`, `GET_TAB_INFO`.

### Storage schema (`chrome.storage.local`)

| Key | Type | Purpose |
|---|---|---|
| `monitoredGroups` | `Array<{groupId, url, name, addedAt}>` | Groups being watched |
| `managedTabs` | `Object<groupId, tabId>` | Map of group to Chrome tab |
| `seenPostIds` | `string[]` | Deduplication set |
| `parsedPosts` | `Array` (max 500) | Post summaries for dashboard log |
| `fullPosts` | `Object<postId, Post>` (max 50) | Full post data for AI re-analysis |
| `recentAlerts` | `Array` (max 50) | Alert log entries |
| `nightMode` | `'auto' \| 'force_night' \| 'force_day'` | Refresh schedule override |
| `apiKey` | `string` | Claude API key |
| `aiPrompt` | `string` | Custom system prompt for Claude |
| `telegramBotToken` | `string` | Telegram bot token |
| `telegramChatId` | `string` | Telegram chat ID |
| `tabGroupId` | `number \| null` | Chrome tab group ID |

## Testing

```bash
cd test && npm install && cd .. && node test/test-parser.js
```

Requires `facebook.html` in the repo root (saved via `copy(document.documentElement.outerHTML)` from a Facebook group page in DevTools). The test validates post extraction count, field presence, and timestamp parsing against known post IDs.

## AI integration

Claude Sonnet 4.6 via the Anthropic REST API with `anthropic-dangerous-direct-browser-access` header (required for browser-based calls). The default prompt targets Pokemon card listings but is fully customizable from the dashboard. Expects JSON output matching a specific schema (cards, listing_type, price, summary).

## Gotchas

- `parser.js` uses UMD pattern: exports to `module.exports` in Node, `window.PokeParser` in browser. Both `content.js` and `test-parser.js` depend on this.
- Facebook's React fiber is walked to extract precise timestamps (`creation_time` from `__reactFiber$` properties). This is fragile and may break on React upgrades.
- The service worker can be suspended by Chrome at any time. State must always be read from `chrome.storage.local`, never held in module-level variables (except `shuttingDown` flag which is intentionally ephemeral).
- Telegram caption limit is 1024 chars; message limit is 4096. Both are truncated with `...`.
- The `seenPostIds` array grows unbounded across sessions. Consider periodic pruning if monitoring long-term.

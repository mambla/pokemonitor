(async function () {
  'use strict';

  const state = await send('GET_STATE');

  const {
    monitoredGroups = [],
    parsedPosts = [],
    nightMode = 'auto',
    apiKey = '',
    telegramBotToken = '',
    telegramChatId = '',
  } = state;

  // --- Header ---

  const nightToggle = document.getElementById('nightModeToggle');
  nightToggle.checked = nightMode === 'force_night';
  nightToggle.addEventListener('change', () => {
    send('SET_NIGHT_MODE', { nightMode: nightToggle.checked ? 'force_night' : 'auto' });
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    send('CLEAR_POSTS');
    document.getElementById('postLog').innerHTML = '';
    document.getElementById('latestPosts').innerHTML = '';
    document.getElementById('noPostsMsg').hidden = false;
    document.getElementById('postCount').textContent = '';
  });

  // --- Claude API key ---

  const apiKeyInput = document.getElementById('apiKeyInput');
  const keyStatus = document.getElementById('keyStatus');
  if (apiKey) {
    apiKeyInput.value = apiKey;
    keyStatus.textContent = 'Saved -- AI vision analysis active';
  }

  document.getElementById('saveKeyBtn').addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    send('SET_API_KEY', { apiKey: key });
    keyStatus.textContent = key ? 'Saved' : 'Cleared';
  });

  // --- AI Prompt ---

  const DEFAULT_PROMPT = `You are a Pokemon trading card expert. Analyze Facebook group posts selling or trading Pokemon cards.

Given the post text and images, extract structured information about the cards.

Respond with valid JSON only, no markdown fences. Use this schema:
{
  "cards": [{"name": "card name", "set": "set name if identifiable", "condition": "NM/LP/MP/HP/Unknown", "graded": false, "grade": null, "grading_company": null}],
  "listing_type": "sale | trade | auction | buying | unknown",
  "lot_or_single": "lot | single | multiple_singles",
  "price": "price as stated, or null",
  "currency": "currency code or null",
  "summary": "One-line English summary of the listing"
}

Rules:
- If cards are graded (PSA, CGC, BGS), set graded=true with grade and grading_company
- If you can read card names from images, include them even if not in the text
- Post text may be in Hebrew -- translate relevant info
- If you can't identify specific cards, describe what you see (e.g. "lot of ~20 mixed cards")
- Price may be in ILS (₪/שקל) or USD ($)
- "lot" means multiple cards sold together; "multiple_singles" means individually priced`;

  const promptInput = document.getElementById('promptInput');
  const promptStatus = document.getElementById('promptStatus');
  const { aiPrompt = '' } = state;
  promptInput.value = aiPrompt || DEFAULT_PROMPT;

  document.getElementById('savePromptBtn').addEventListener('click', () => {
    const prompt = promptInput.value.trim();
    send('SET_PROMPT', { prompt });
    promptStatus.textContent = 'Saved';
  });

  const promptResult = document.getElementById('promptResult');
  document.getElementById('testPromptBtn').addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      promptStatus.textContent = 'Write a prompt first';
      return;
    }

    const currentPosts = (await send('GET_STATE')).parsedPosts || [];
    if (currentPosts.length === 0) {
      promptStatus.textContent = 'No posts to test with -- add a group first';
      return;
    }

    promptStatus.textContent = 'Analyzing most recent post...';
    promptResult.hidden = true;

    const result = await send('TEST_PROMPT', { prompt, postId: currentPosts[0].postId });

    if (result?.error) {
      promptStatus.textContent = `Failed: ${result.error}`;
      return;
    }

    promptStatus.textContent = result?.telegramSent ? 'Done -- sent to Telegram' : 'Done';
    promptResult.textContent = JSON.stringify(result?.analysis, null, 2);
    promptResult.hidden = false;
  });

  // --- Telegram ---

  const tgBotToken = document.getElementById('tgBotToken');
  const tgChatId = document.getElementById('tgChatId');
  const tgStatus = document.getElementById('tgStatus');

  if (telegramBotToken) tgBotToken.value = telegramBotToken;
  if (telegramChatId) tgChatId.value = telegramChatId;
  if (telegramBotToken && telegramChatId) tgStatus.textContent = 'Saved -- Telegram alerts active';

  document.getElementById('saveTgBtn').addEventListener('click', () => {
    const botToken = tgBotToken.value.trim();
    const chatId = tgChatId.value.trim();
    send('SET_TELEGRAM', { botToken, chatId });
    tgStatus.textContent = (botToken && chatId) ? 'Saved' : 'Cleared';
  });

  document.getElementById('testTgBtn').addEventListener('click', async () => {
    const botToken = tgBotToken.value.trim();
    const chatId = tgChatId.value.trim();
    if (!botToken || !chatId) {
      tgStatus.textContent = 'Fill in bot token and chat ID first';
      return;
    }
    tgStatus.textContent = 'Sending test...';
    const result = await send('TEST_TELEGRAM', { botToken, chatId });
    tgStatus.textContent = result?.ok ? 'Test message sent!' : `Failed: ${result?.error || 'unknown error'}`;
  });

  // --- Sidebar: groups ---

  renderGroups(monitoredGroups);

  document.getElementById('addGroupBtn').addEventListener('click', addGroup);
  document.getElementById('groupUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addGroup();
  });

  async function addGroup() {
    const input = document.getElementById('groupUrlInput');
    const url = input.value.trim();
    if (!url) return;

    const result = await send('ADD_GROUP', { url });
    if (result.error) {
      alert(result.error);
      return;
    }
    input.value = '';
    const { monitoredGroups: updated } = await send('GET_STATE');
    renderGroups(updated);
  }

  function renderGroups(groups) {
    const container = document.getElementById('groupsList');
    const noGroups = document.getElementById('noGroups');
    container.innerHTML = '';

    if (groups.length === 0) {
      noGroups.hidden = false;
      return;
    }

    noGroups.hidden = true;
    for (const g of groups) {
      const el = document.createElement('div');
      el.className = 'group-item';
      el.innerHTML = `
        <span class="group-dot"></span>
        <div class="group-info">
          <div class="group-name">${esc(g.name || 'Loading...')}</div>
          <div class="group-id">${g.groupId}</div>
        </div>
        <button class="btn btn-danger remove-btn" data-gid="${g.groupId}">&times;</button>
      `;
      container.appendChild(el);
    }

    container.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await send('REMOVE_GROUP', { groupId: btn.dataset.gid });
        const { monitoredGroups: updated } = await send('GET_STATE');
        renderGroups(updated);
      });
    });
  }

  // --- Latest per group ---

  renderLatest(parsedPosts, monitoredGroups);

  function renderLatest(posts, groups) {
    const container = document.getElementById('latestPosts');
    container.innerHTML = '';

    const latestByGroup = new Map();
    for (const post of posts) {
      const gid = post.groupId;
      if (gid && !latestByGroup.has(gid)) {
        latestByGroup.set(gid, post);
      }
    }

    if (latestByGroup.size === 0) return;

    for (const [, post] of latestByGroup) {
      const textPreview = (post.text || '(no text)').substring(0, 120);
      const el = document.createElement('a');
      el.className = 'latest-card';
      el.href = post.postLink;
      el.target = '_blank';
      el.innerHTML = `
        <div class="card-group">${esc(post.groupName || post.groupId)}</div>
        <div class="card-author">${esc(post.author || '?')}</div>
        <div class="card-text">${esc(textPreview)}</div>
        <div class="card-meta">
          <span>${post.imageCount} images</span>
          <span>${timeAgo(post.estimatedTime || post.parsedAt)}</span>
          <span>${post.timeSource === 'react' ? 'exact time' : 'approx time'}</span>
        </div>
      `;
      container.appendChild(el);
    }
  }

  // --- Post log ---

  renderLog(parsedPosts);

  function renderLog(posts) {
    const container = document.getElementById('postLog');
    const noMsg = document.getElementById('noPostsMsg');
    const countEl = document.getElementById('postCount');
    container.innerHTML = '';

    if (posts.length === 0) {
      noMsg.hidden = false;
      return;
    }

    noMsg.hidden = true;
    countEl.textContent = `(${posts.length})`;

    for (const post of posts) {
      const textPreview = (post.text || '(no text)').substring(0, 100);
      const groupUrl = `https://www.facebook.com/groups/${post.groupId}/?sorting_setting=CHRONOLOGICAL`;
      const el = document.createElement('div');
      el.className = 'log-row';
      el.innerHTML = `
        <a class="log-group" href="${esc(groupUrl)}" target="_blank">${esc(post.groupName || post.groupId || '')}</a>
        <a class="log-post-link" href="${esc(post.postLink)}" target="_blank">
          <span class="log-time">${timeAgo(post.estimatedTime || post.parsedAt)}</span>
          <span class="log-author">${esc(post.author || '?')}</span>
          <span class="log-text">${esc(textPreview)}</span>
          <span class="log-imgs">${post.imageCount} img</span>
        </a>
      `;
      container.appendChild(el);
    }
  }

  // --- Auto-refresh ---

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.parsedPosts) {
      const posts = changes.parsedPosts.newValue || [];
      renderLog(posts);
      send('GET_STATE').then(s => renderLatest(posts, s.monitoredGroups || []));
    }
    if (changes.monitoredGroups) {
      renderGroups(changes.monitoredGroups.newValue || []);
    }
  });

  // --- Helpers ---

  function send(type, extra) {
    return chrome.runtime.sendMessage({ type, ...extra });
  }

  function esc(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function timeAgo(ts) {
    if (!ts) return '?';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    return `${Math.floor(hr / 24)}d`;
  }
})();

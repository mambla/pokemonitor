const MAX_PARSED_POSTS = 500;
const MAX_RECENT_ALERTS = 50;
const TAB_GROUP_NAME = 'PokeMonitor';

// --- Initialization ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['monitoredGroups'], (result) => {
    if (!result.monitoredGroups) {
      chrome.storage.local.set({
        monitoredGroups: [],
        managedTabs: {},
        seenPostIds: [],
        sentPostIds: [],
        parsedPosts: [],
        recentAlerts: [],
        nightMode: 'auto',
        tabGroupId: null,
      });
    }
  });
  openAllMonitoredTabs();
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

// --- Icon click opens dashboard ---

chrome.action.onClicked.addListener(async () => {
  const dashUrl = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({ url: dashUrl });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: dashUrl });
  }
});

// --- Message handling ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NEW_POSTS') {
    handleNewPosts(msg.posts, sender.tab);
  }
  if (msg.type === 'ADD_GROUP') {
    addGroup(msg.url).then(sendResponse);
    return true;
  }
  if (msg.type === 'REMOVE_GROUP') {
    removeGroup(msg.groupId).then(sendResponse);
    return true;
  }
  if (msg.type === 'CLEAR_POSTS') {
    chrome.storage.local.set({ parsedPosts: [], seenPostIds: [], sentPostIds: [], recentAlerts: [] });
  }
  if (msg.type === 'SET_NIGHT_MODE') {
    chrome.storage.local.set({ nightMode: msg.nightMode });
  }
  if (msg.type === 'SET_API_KEY') {
    chrome.storage.local.set({ apiKey: msg.apiKey || '' });
  }
  if (msg.type === 'SET_PROMPT') {
    chrome.storage.local.set({ aiPrompt: msg.prompt || '' });
  }
  if (msg.type === 'SET_TELEGRAM') {
    chrome.storage.local.set({
      telegramBotToken: msg.botToken || '',
      telegramChatId: msg.chatId || '',
    });
  }
  if (msg.type === 'TEST_PROMPT') {
    testPrompt(msg.prompt, msg.postId).then(sendResponse);
    return true;
  }
  if (msg.type === 'TEST_TELEGRAM') {
    testTelegram(msg.botToken, msg.chatId).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_STATE') {
    getFullState().then(sendResponse);
    return true;
  }
});

// --- Tab group management ---

async function getOrCreateTabGroup() {
  const { tabGroupId } = await chrome.storage.local.get('tabGroupId');

  if (tabGroupId) {
    try {
      const group = await chrome.tabGroups.get(tabGroupId);
      if (group) return tabGroupId;
    } catch {}
  }

  const newTab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const newGroupId = await chrome.tabs.group({ tabIds: [newTab.id] });
  await chrome.tabGroups.update(newGroupId, {
    title: TAB_GROUP_NAME,
    color: 'red',
    collapsed: true,
  });
  await chrome.tabs.remove(newTab.id);
  await chrome.storage.local.set({ tabGroupId: newGroupId });
  return newGroupId;
}

async function openManagedTab(groupId, url) {
  const { managedTabs = {} } = await chrome.storage.local.get('managedTabs');

  if (managedTabs[groupId]) {
    try {
      const existing = await chrome.tabs.get(managedTabs[groupId]);
      if (existing) return existing.id;
    } catch {}
  }

  const tabGroupId = await getOrCreateTabGroup();
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    await chrome.tabs.group({ tabIds: [tab.id], groupId: tabGroupId });
  } catch {
    const newGroupId = await getOrCreateTabGroup();
    try {
      await chrome.tabs.group({ tabIds: [tab.id], groupId: newGroupId });
    } catch {}
  }

  managedTabs[groupId] = tab.id;
  await chrome.storage.local.set({ managedTabs });
  return tab.id;
}

async function closeManagedTab(groupId) {
  const { managedTabs = {} } = await chrome.storage.local.get('managedTabs');
  const tabId = managedTabs[groupId];
  if (tabId) {
    try { await chrome.tabs.remove(tabId); } catch {}
    delete managedTabs[groupId];
    await chrome.storage.local.set({ managedTabs });
  }
}

let shuttingDown = false;

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (shuttingDown) return;

  const { managedTabs = {}, monitoredGroups = [] } = await chrome.storage.local.get(['managedTabs', 'monitoredGroups']);
  const entry = Object.entries(managedTabs).find(([, tid]) => tid === tabId);
  if (!entry) return;

  const [groupId] = entry;
  delete managedTabs[groupId];
  await chrome.storage.local.set({ managedTabs });

  const group = monitoredGroups.find(g => g.groupId === groupId);
  if (group) {
    setTimeout(() => reopenTab(groupId, group.url), 3000);
  }
});

async function reopenTab(groupId, url) {
  if (shuttingDown) return;
  const { monitoredGroups = [] } = await chrome.storage.local.get('monitoredGroups');
  if (!monitoredGroups.find(g => g.groupId === groupId)) return;
  await openManagedTab(groupId, url);
}

async function closeAllManagedTabs() {
  shuttingDown = true;
  const { managedTabs = {} } = await chrome.storage.local.get('managedTabs');
  for (const tabId of Object.values(managedTabs)) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
  await chrome.storage.local.set({ managedTabs: {}, tabGroupId: null });
}

chrome.runtime.onSuspend.addListener(() => {
  closeAllManagedTabs();
});

chrome.runtime.onStartup.addListener(() => {
  openAllMonitoredTabs();
});

async function openAllMonitoredTabs() {
  const { managedTabs = {} } = await chrome.storage.local.get('managedTabs');
  for (const tabId of Object.values(managedTabs)) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
  await chrome.storage.local.set({ managedTabs: {}, tabGroupId: null });
  shuttingDown = false;
  const { monitoredGroups = [] } = await chrome.storage.local.get('monitoredGroups');
  for (const g of monitoredGroups) {
    await openManagedTab(g.groupId, g.url);
  }
  scheduleAllRefreshes();
}

// --- Group management ---

function cleanGroupName(name) {
  return (name || '').replace(/\s*\|\s*Facebook\s*$/, '').replace(/\(\d+\)\s*/g, '').trim();
}

function parseGroupUrl(url) {
  const match = url.match(/facebook\.com\/groups\/([^/?]+)/);
  if (!match) return null;
  const slug = match[1];
  return { groupId: slug, url: `https://www.facebook.com/groups/${slug}/?sorting_setting=CHRONOLOGICAL` };
}

async function addGroup(url) {
  const parsed = parseGroupUrl(url);
  if (!parsed) return { error: 'Invalid Facebook group URL' };

  const { monitoredGroups = [] } = await chrome.storage.local.get('monitoredGroups');
  if (monitoredGroups.find(g => g.groupId === parsed.groupId)) {
    return { error: 'Group already monitored' };
  }

  const group = {
    groupId: parsed.groupId,
    url: parsed.url,
    name: null,
    addedAt: Date.now(),
  };

  monitoredGroups.push(group);
  await chrome.storage.local.set({ monitoredGroups });

  const tabId = await openManagedTab(parsed.groupId, parsed.url);

  setTimeout(async () => {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'GET_TAB_INFO' });
      if (resp && resp.groupName) {
        group.name = cleanGroupName(resp.groupName);
        await chrome.storage.local.set({ monitoredGroups });
      }
    } catch {}
  }, 5000);

  scheduleRefresh(parsed.groupId);
  return { ok: true, group };
}

async function removeGroup(groupId) {
  const { monitoredGroups = [] } = await chrome.storage.local.get('monitoredGroups');
  const filtered = monitoredGroups.filter(g => g.groupId !== groupId);
  await chrome.storage.local.set({ monitoredGroups: filtered });
  await closeManagedTab(groupId);
  cancelRefresh(groupId);
  return { ok: true };
}

// --- Post handling ---

async function handleNewPosts(posts, tab) {
  const { seenPostIds = [], sentPostIds = [], monitoredGroups = [] } =
    await chrome.storage.local.get(['seenPostIds', 'sentPostIds', 'monitoredGroups']);
  const monitoredIds = new Set(monitoredGroups.map(g => g.groupId));
  const seenSet = new Set(seenPostIds);
  const sentSet = new Set(sentPostIds);

  const relevant = posts.filter(p => monitoredIds.has(p.groupId));
  if (relevant.length === 0) return;

  const truly_new = relevant.filter(p => !seenSet.has(p.postId));
  const unsent = relevant.filter(p => !sentSet.has(p.postId));

  if (truly_new.length === 0 && unsent.length === 0) return;

  for (const p of relevant) seenSet.add(p.postId);
  await chrome.storage.local.set({ seenPostIds: [...seenSet] });

  if (truly_new.length > 0) {
    await storeParsedPosts(truly_new);
    await storeFullPosts(truly_new);

    const grpPost = truly_new.find(p => p.groupName && p.groupId);
    if (grpPost) {
      const { monitoredGroups: groups = [] } = await chrome.storage.local.get('monitoredGroups');
      const grp = groups.find(g => g.groupId === grpPost.groupId);
      if (grp && !grp.name) {
        grp.name = cleanGroupName(grpPost.groupName);
        await chrome.storage.local.set({ monitoredGroups: groups });
      }
    }

    for (const post of truly_new) {
      notifyNewPost(post);
    }
  }

  if (unsent.length > 0) {
    unsent.sort((a, b) => (a.estimatedTime || 0) - (b.estimatedTime || 0));

    const { apiKey, telegramBotToken, telegramChatId } =
      await chrome.storage.local.get(['apiKey', 'telegramBotToken', 'telegramChatId']);

    for (const post of unsent) {
      let analysis = null;
      if (apiKey) {
        analysis = await analyzeClientSide(post, apiKey);
      }
      if (telegramBotToken && telegramChatId) {
        const ok = await sendTelegram(post, analysis, telegramBotToken, telegramChatId);
        if (ok) {
          sentSet.add(post.postId);
          await chrome.storage.local.set({ sentPostIds: [...sentSet] });
        }
      } else {
        sentSet.add(post.postId);
        await chrome.storage.local.set({ sentPostIds: [...sentSet] });
      }
    }
  }
}

async function storeParsedPosts(posts) {
  const { parsedPosts = [] } = await chrome.storage.local.get('parsedPosts');
  const existingIds = new Set(parsedPosts.map(p => p.postId));

  for (const post of posts) {
    if (existingIds.has(post.postId)) continue;
    existingIds.add(post.postId);

    parsedPosts.push({
      postId: post.postId,
      groupId: post.groupId,
      author: post.author,
      text: post.text,
      imageCount: (post.images || []).length,
      descriptionCount: (post.imageDescriptions || []).length,
      postLink: post.postLink,
      groupName: post.groupName,
      timeLabel: post.timeLabel,
      estimatedTime: post.estimatedTime,
      timeSource: post.timeSource,
      parsedAt: Date.now(),
    });
  }

  parsedPosts.sort((a, b) => (b.estimatedTime || b.parsedAt) - (a.estimatedTime || a.parsedAt));

  if (parsedPosts.length > MAX_PARSED_POSTS) {
    parsedPosts.length = MAX_PARSED_POSTS;
  }
  await chrome.storage.local.set({ parsedPosts });
}

async function storeFullPosts(posts) {
  const { fullPosts = {} } = await chrome.storage.local.get('fullPosts');
  for (const post of posts) {
    fullPosts[post.postId] = post;
  }
  const keys = Object.keys(fullPosts);
  if (keys.length > 50) {
    for (const k of keys.slice(0, keys.length - 50)) {
      delete fullPosts[k];
    }
  }
  await chrome.storage.local.set({ fullPosts });
}

async function logAlert(post, status, detail) {
  const { recentAlerts = [] } = await chrome.storage.local.get('recentAlerts');
  recentAlerts.unshift({
    postId: post.postId,
    author: post.author,
    groupName: post.groupName,
    status,
    detail,
    timestamp: Date.now(),
  });
  if (recentAlerts.length > MAX_RECENT_ALERTS) {
    recentAlerts.length = MAX_RECENT_ALERTS;
  }
  await chrome.storage.local.set({ recentAlerts });
}

// --- Notifications ---

function notifyNewPost(post) {
  const title = `${post.groupName || 'New Post'}`;
  const text = post.author
    ? `${post.author}: ${(post.text || '(images)').substring(0, 80)}`
    : (post.text || '(new post)').substring(0, 100);

  chrome.notifications.create(`post:${post.postId}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: text,
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener(async (notifId) => {
  const prefix = notifId.split(':')[0];
  const postId = notifId.slice(prefix.length + 1);
  if (postId) {
    const { parsedPosts = [] } = await chrome.storage.local.get('parsedPosts');
    const post = parsedPosts.find(p => p.postId === postId);
    if (post?.postLink) {
      chrome.tabs.create({ url: post.postLink });
    }
  }
  chrome.notifications.clear(notifId);
});

// --- JSON extraction ---

function extractJson(raw) {
  raw = raw.trim();
  if (raw.startsWith('```')) {
    raw = raw.split('\n').slice(1).join('\n');
    if (raw.endsWith('```')) raw = raw.slice(0, -3);
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    raw = raw.substring(start, end + 1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { summary: raw };
  }
}

// --- Client-side AI analysis (Claude) ---

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

const MAX_IMAGES = 4;

async function fetchImageAsBase64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const mediaType = blob.type || 'image/jpeg';
    return { base64: btoa(binary), mediaType };
  } catch {
    return null;
  }
}

async function buildImageContent(imageUrls) {
  const results = [];
  for (const url of imageUrls.slice(0, MAX_IMAGES)) {
    const img = await fetchImageAsBase64(url);
    if (img) {
      results.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      });
    }
  }
  return results;
}

async function analyzeClientSide(post, apiKey) {
  const { aiPrompt } = await chrome.storage.local.get('aiPrompt');
  const systemPrompt = aiPrompt || DEFAULT_PROMPT;

  const userText = [
    `Post from: ${post.author || 'Unknown'}`,
    `Group: ${post.groupName || 'Unknown'}`,
    `Post text:\n${post.text || '(no text)'}`,
    `Image descriptions: ${(post.imageDescriptions || []).join('; ') || '(none)'}`,
    `\nAnalyze this post.`,
  ].join('\n');

  const imageContent = await buildImageContent(post.images || []);
  const content = [{ type: 'text', text: userText }, ...imageContent];

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Claude API returned ${resp.status}: ${errText}`);
      return null;
    }

    const data = await resp.json();
    const raw = (data.content?.[0]?.text || '').trim();
    if (!raw) return null;

    const analysis = extractJson(raw);

    const summary = analysis.summary || 'Analyzed';
    notifyAiResult(post, analysis);
    await logAlert(post, 'ai', summary);
    return analysis;
  } catch (err) {
    console.error(`Claude analysis failed for ${post.postId}:`, err.message);
    return null;
  }
}

function notifyAiResult(post, analysis) {
  const cards = (analysis.items || analysis.cards || []).map(c => c.name).filter(Boolean).join(', ');
  const price = analysis.price ? ` - ${analysis.price} ${analysis.currency || ''}`.trim() : '';
  const summary = analysis.summary || '';
  const title = `${post.groupName || 'Analysis'}`;
  const message = cards
    ? `${cards}${price}\n${summary}`
    : summary || `${post.author}: new listing`;

  chrome.notifications.create(`ai:${post.postId}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: message.substring(0, 200),
    priority: 2,
  });
}

// --- Client-side Telegram ---

async function sendTelegram(post, analysis, token, chatId) {
  const base = `https://api.telegram.org/bot${token}`;
  const caption = formatTelegramCaption(post, analysis);
  const imageUrls = (post.images || []).slice(0, 10);

  const blobs = [];
  for (const url of imageUrls) {
    try {
      const resp = await fetch(url);
      if (resp.ok) blobs.push(await resp.blob());
    } catch {}
  }

  let ok = false;
  if (blobs.length > 1) {
    ok = await telegramSendMediaGroup(base, chatId, blobs, caption);
  } else if (blobs.length === 1) {
    ok = await telegramSendPhoto(base, chatId, blobs[0], caption);
  }
  if (!ok) {
    ok = await telegramSendMessage(base, chatId, caption);
  }

  await logAlert(post, ok ? 'telegram' : 'tg_error', ok ? 'Sent' : 'Failed');
  return ok;
}

function formatTelegramCaption(post, analysis) {
  const group = post.groupName || 'Unknown Group';
  const author = post.author || 'Unknown';
  const link = post.postLink || '';

  const postText = post.text || '';
  const absTime = post.estimatedTime
    ? new Date(post.estimatedTime).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
    : '';
  const relTime = post.timeLabel || '';
  const timeStr = relTime && absTime ? `${relTime} (${absTime})` : relTime || absTime;
  const lines = [`📢 NEW POST — ${group}`];
  if (timeStr) lines.push(`🕐 ${timeStr}`);
  lines.push(`👤 ${author}`);

  if (analysis) {
    lines.push('—'.repeat(20));
    const items = (analysis.items || analysis.cards || []).slice(0, 8).map(c => {
      const parts = [c.name || 'Unknown'];
      if (c.set) parts.push(`(${c.set})`);
      if (c.details) parts.push(`[${c.details}]`);
      else if (c.graded) parts.push(`[${c.grading_company || '?'} ${c.grade || '?'}]`);
      else if (c.condition && c.condition !== 'Unknown') parts.push(`[${c.condition}]`);
      return parts.join(' ');
    });
    if (items.length > 0) lines.push('🃏 ' + items.join(', '));
    if (analysis.price) {
      lines.push(`💰 ${analysis.price} ${analysis.currency || ''}`.trim());
    }
    if (analysis.listing_type && analysis.listing_type !== 'unknown') {
      lines.push(`📋 ${analysis.listing_type}`);
    }
    if (analysis.summary) lines.push(`\n${analysis.summary}`);
  }

  if (postText) {
    lines.push('—'.repeat(20));
    lines.push(postText);
  }

  if (link) lines.push(`\n🔗 ${link}`);

  return lines.join('\n');
}

async function telegramSendPhoto(base, chatId, photoBlob, caption) {
  if (caption.length > 1024) caption = caption.substring(0, 1021) + '...';

  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('photo', photoBlob, 'photo.jpg');

    const resp = await fetch(`${base}/sendPhoto`, { method: 'POST', body: form });
    if (resp.ok) return true;
    console.error(`Telegram sendPhoto failed: ${resp.status}`);
    return false;
  } catch (err) {
    console.error('Telegram sendPhoto error:', err.message);
    return false;
  }
}

async function telegramSendMediaGroup(base, chatId, photoBlobs, caption) {
  if (caption.length > 1024) caption = caption.substring(0, 1021) + '...';

  try {
    const form = new FormData();
    form.append('chat_id', chatId);

    const media = photoBlobs.map((_, i) => ({
      type: 'photo',
      media: `attach://photo${i}`,
      ...(i === 0 ? { caption } : {}),
    }));
    form.append('media', JSON.stringify(media));

    for (let i = 0; i < photoBlobs.length; i++) {
      form.append(`photo${i}`, photoBlobs[i], `photo${i}.jpg`);
    }

    const resp = await fetch(`${base}/sendMediaGroup`, { method: 'POST', body: form });
    if (resp.ok) return true;
    console.error(`Telegram sendMediaGroup failed: ${resp.status}`);
    return false;
  } catch (err) {
    console.error('Telegram sendMediaGroup error:', err.message);
    return false;
  }
}

async function testPrompt(prompt, postId) {
  const { apiKey, telegramBotToken, telegramChatId, fullPosts = {} } =
    await chrome.storage.local.get(['apiKey', 'telegramBotToken', 'telegramChatId', 'fullPosts']);

  if (!apiKey) return { error: 'No Claude API key configured' };

  let post = fullPosts[postId];
  if (!post) {
    const { parsedPosts = [] } = await chrome.storage.local.get('parsedPosts');
    const trimmed = parsedPosts.find(p => p.postId === postId);
    if (!trimmed) return { error: 'Post not found' };
    post = { ...trimmed, images: [], imageDescriptions: [] };
  }

  const userText = [
    `Post from: ${post.author || 'Unknown'}`,
    `Group: ${post.groupName || 'Unknown'}`,
    `Post text:\n${post.text || '(no text)'}`,
    `Image descriptions: ${(post.imageDescriptions || []).join('; ') || '(none)'}`,
    `\nAnalyze this post.`,
  ].join('\n');

  const imageContent = await buildImageContent(post.images || []);
  const content = [{ type: 'text', text: userText }, ...imageContent];

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: prompt,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { error: `Claude ${resp.status}: ${errText.substring(0, 200)}` };
    }

    const data = await resp.json();
    const raw = (data.content?.[0]?.text || '').trim();
    if (!raw) return { error: 'Empty response from Claude' };

    const analysis = extractJson(raw);

    let telegramSent = false;
    if (telegramBotToken && telegramChatId) {
      await sendTelegram(post, analysis, telegramBotToken, telegramChatId);
      telegramSent = true;
    }

    return { analysis, telegramSent };
  } catch (err) {
    return { error: err.message };
  }
}

async function testTelegram(botToken, chatId) {
  const base = `https://api.telegram.org/bot${botToken}`;
  try {
    const resp = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ PokeMonitor test -- Telegram is working!',
      }),
    });
    if (resp.ok) return { ok: true };
    const err = await resp.json().catch(() => ({}));
    return { ok: false, error: err.description || `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function telegramSendMessage(base, chatId, text) {
  if (text.length > 4096) text = text.substring(0, 4093) + '...';

  try {
    const resp = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (resp.ok) return true;
    console.error(`Telegram sendMessage failed: ${resp.status}`);
    return false;
  } catch (err) {
    console.error('Telegram sendMessage error:', err.message);
    return false;
  }
}

// --- State query ---

async function getFullState() {
  const data = await chrome.storage.local.get([
    'monitoredGroups', 'parsedPosts', 'recentAlerts',
    'nightMode', 'apiKey', 'aiPrompt',
    'telegramBotToken', 'telegramChatId', 'managedTabs',
  ]);
  return data;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('refresh:')) {
    const groupId = alarm.name.slice('refresh:'.length);
    refreshOneTab(groupId);
  }
});

const REFRESH_NORMAL_MIN = 2;
const REFRESH_NORMAL_JITTER_MIN = 0.5;
const REFRESH_NIGHT_MIN = 30;
const REFRESH_NIGHT_JITTER_MIN = 5;
const NIGHT_START_HOUR = 1;
const NIGHT_END_HOUR = 8;

function isNightLocally() {
  const hour = new Date().getHours();
  return hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR;
}

async function getRefreshDelayMin() {
  const { nightMode = 'auto' } = await chrome.storage.local.get('nightMode');

  let useNight;
  if (nightMode === 'force_night') {
    useNight = true;
  } else if (nightMode === 'force_day') {
    useNight = false;
  } else {
    useNight = isNightLocally();
  }

  const base = useNight ? REFRESH_NIGHT_MIN : REFRESH_NORMAL_MIN;
  const jitter = useNight ? REFRESH_NIGHT_JITTER_MIN : REFRESH_NORMAL_JITTER_MIN;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0.5, base + offset);
}

async function scheduleRefresh(groupId) {
  const delay = await getRefreshDelayMin();
  chrome.alarms.create(`refresh:${groupId}`, { delayInMinutes: delay });
}

function cancelRefresh(groupId) {
  chrome.alarms.clear(`refresh:${groupId}`);
}

async function refreshOneTab(groupId) {
  const { managedTabs = {} } = await chrome.storage.local.get('managedTabs');
  const tabId = managedTabs[groupId];
  if (tabId) {
    try {
      await chrome.tabs.reload(tabId);
    } catch {
      // tab gone, will be reopened by onRemoved handler
    }
  }
  scheduleRefresh(groupId);
}

async function scheduleAllRefreshes() {
  const { monitoredGroups = [] } = await chrome.storage.local.get('monitoredGroups');
  for (const g of monitoredGroups) {
    scheduleRefresh(g.groupId);
  }
}

scheduleAllRefreshes();

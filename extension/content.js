(function () {
  'use strict';

  const SCAN_INTERVAL_MS = 30_000;
  const DEBOUNCE_MS = 2_000;

  const seenIds = new Set();
  let debounceTimer = null;
  let intervalId = null;

  function getGroupName() {
    const title = document.title || '';
    return title.replace(/\s*\|\s*Facebook\s*$/, '').replace(/\(\d+\)\s*/g, '').trim();
  }

  function getGroupId() {
    const match = location.pathname.match(/\/groups\/([^/]+)/);
    return match ? match[1] : null;
  }

  function scan() {
    const posts = PokeParser.extractPosts(document);
    const newPosts = [];

    for (const post of posts) {
      if (seenIds.has(post.postId)) continue;
      seenIds.add(post.postId);
      post.groupName = getGroupName();
      newPosts.push(post);
    }

    if (newPosts.length > 0) {
      chrome.runtime.sendMessage({
        type: 'NEW_POSTS',
        posts: newPosts,
      });
    }
  }

  function debouncedScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, DEBOUNCE_MS);
  }

  function nudgeScroll() {
    const distance = 400 + Math.random() * 400;
    window.scrollBy({ top: distance, behavior: 'smooth' });
  }

  const observer = new MutationObserver(debouncedScan);
  observer.observe(document.body, { childList: true, subtree: true });
  intervalId = setInterval(scan, SCAN_INTERVAL_MS);

  scan();
  setTimeout(nudgeScroll, 2000 + Math.random() * 3000);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_TAB_INFO') {
      sendResponse({
        groupId: getGroupId(),
        groupName: getGroupName(),
        seenCount: seenIds.size,
      });
    }
  });
})();

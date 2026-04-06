(function (exports) {
  'use strict';

  const POST_LINK_RE = /\/groups\/([^/]+)\/posts\/(\d+)/;

  function extractPosts(root) {
    const articles = root.querySelectorAll('div[role="article"][aria-posinset]');
    const posts = [];

    for (const article of articles) {
      if (isComment(article)) continue;

      const post = extractPost(article);
      if (post) posts.push(post);
    }

    return posts;
  }

  function isComment(article) {
    const label = article.getAttribute('aria-label') || '';
    return label.startsWith('Comment');
  }

  function extractPost(article) {
    const linkInfo = extractLinkInfo(article);
    if (!linkInfo) return null;

    const timeInfo = extractTimestamp(article, linkInfo.postId);

    return {
      postId: linkInfo.postId,
      groupId: linkInfo.groupId,
      postLink: `https://www.facebook.com/groups/${linkInfo.groupId}/posts/${linkInfo.postId}/`,
      author: extractAuthor(article),
      text: extractText(article),
      images: extractImages(article),
      imageDescriptions: extractImageDescriptions(article),
      timeLabel: timeInfo.label,
      estimatedTime: timeInfo.estimatedMs,
      timeSource: timeInfo.source,
    };
  }

  function extractLinkInfo(article) {
    const anchors = article.querySelectorAll('a[href]');
    for (const a of anchors) {
      const match = a.getAttribute('href').match(POST_LINK_RE);
      if (match) {
        return { groupId: match[1], postId: match[2] };
      }
    }
    return null;
  }

  function extractAuthor(article) {
    const profileName = article.querySelector('[data-ad-rendering-role="profile_name"]');
    if (!profileName) return '';

    const bold = profileName.querySelector('b');
    if (bold) return deepestText(bold).trim();

    const span = profileName.querySelector('span');
    if (span) return deepestText(span).trim();

    return profileName.textContent.trim();
  }

  function extractText(article) {
    const lines = [];

    const messageContainer = article.querySelector('[data-ad-preview="message"]');
    const searchRoot = messageContainer || article;

    const divs = searchRoot.querySelectorAll('div[dir="auto"]');
    for (const div of divs) {
      const text = div.textContent.trim();
      if (text && text !== 'See more' && text !== 'עוד...') {
        lines.push(text);
      }
    }

    return lines.join('\n');
  }

  function extractImages(article) {
    const imgs = article.querySelectorAll('img[src*="scontent"]');
    const seen = new Set();
    const urls = [];

    for (const img of imgs) {
      const src = img.getAttribute('src');
      if (!src) continue;
      const stem = src.split('?')[0];
      if (seen.has(stem)) continue;
      seen.add(stem);
      urls.push(src);
    }

    return urls;
  }

  function extractImageDescriptions(article) {
    const descriptions = [];
    const elements = article.querySelectorAll('[aria-label]');

    for (const el of elements) {
      const label = el.getAttribute('aria-label') || '';
      if (label.startsWith('May be')) {
        descriptions.push(label);
      }
    }

    return descriptions;
  }

  function extractTimestamp(article, postId) {
    const postLinkPattern = new RegExp(`/posts/${postId}`);
    const anchors = article.querySelectorAll('a[aria-label][href]');

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (!postLinkPattern.test(href)) continue;

      const label = a.getAttribute('aria-label') || '';
      const absoluteMs = readReactTimestamp(a);

      if (absoluteMs) {
        return { label, estimatedMs: absoluteMs, source: 'react' };
      }
      if (label) {
        return { label, estimatedMs: relativeToMs(label), source: 'relative' };
      }
    }

    return { label: null, estimatedMs: null, source: null };
  }

  function readReactTimestamp(el) {
    // Facebook stores timestamps in React fiber/props on DOM elements.
    // The property key includes a random hash, e.g. __reactProps$abc123.
    // Walk up from the timestamp anchor to find a creation_time or timestamp.
    const fiberKey = findReactKey(el, '__reactFiber$');
    if (!fiberKey) return null;

    let fiber = el[fiberKey];
    for (let i = 0; i < 15 && fiber; i++) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props) {
        const ts = digForTimestamp(props, 3);
        if (ts) return ts;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function findReactKey(el, prefix) {
    for (const key of Object.keys(el)) {
      if (key.startsWith(prefix)) return key;
    }
    return null;
  }

  function digForTimestamp(obj, maxDepth) {
    if (maxDepth <= 0 || !obj || typeof obj !== 'object') return null;

    for (const key of ['creation_time', 'publish_time', 'created_time', 'timestamp']) {
      const val = obj[key];
      if (typeof val === 'number' && val > 1e9 && val < 2e10) {
        return val * 1000;
      }
    }

    for (const key of Object.keys(obj)) {
      if (key.startsWith('__') || key === 'children') continue;
      const result = digForTimestamp(obj[key], maxDepth - 1);
      if (result) return result;
    }
    return null;
  }

  const RELATIVE_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

  function relativeToMs(label) {
    const now = Date.now();

    if (label === 'Just now' || label === 'עכשיו') return now;

    const match = label.match(/^(\d+)\s*([smhdw])/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const ms = RELATIVE_UNITS[unit];
      if (ms) return now - value * ms;
    }

    if (/yesterday/i.test(label) || /אתמול/.test(label)) {
      return now - 86400000;
    }

    return null;
  }

  function deepestText(el) {
    const spans = el.querySelectorAll('span');
    if (spans.length === 0) return el.textContent || '';

    let deepest = el;
    let maxDepth = 0;

    for (const span of spans) {
      let depth = 0;
      let node = span;
      while (node !== el && node.parentElement) {
        depth++;
        node = node.parentElement;
      }
      if (depth >= maxDepth && span.textContent.trim()) {
        maxDepth = depth;
        deepest = span;
      }
    }

    return deepest.textContent || '';
  }

  exports.extractPosts = extractPosts;
  exports.extractPost = extractPost;

})(typeof module !== 'undefined' ? module.exports : (window.PokeParser = {}));

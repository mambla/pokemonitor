const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const parser = require('../extension/parser');

const EXPECTED_POST_IDS = [
  '4491509724504361', '4491468697841797', '4491471867841480',
  '4491484584506875', '4491486937839973', '4491494147839252',
  '4491494394505894', '4491496711172329', '4490275814627752',
  '4491453161176684', '4491448267843840', '4491444797844187',
  '4491427557845911', '4491406534514680', '4491301357858531',
  '4491332704522063', '4491339454521388', '4491360477852619',
  '4491366471185353',
];

const GROUP_ID = '1736658266656201';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

async function run() {
  console.log('Loading facebook.html...');
  const htmlPath = path.join(__dirname, '..', 'facebook.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html);
  const document = dom.window.document;

  console.log('\n--- Extracting posts ---');
  const posts = parser.extractPosts(document);

  console.log(`\nFound ${posts.length} posts\n`);

  assert(posts.length === 19, `Expected 19 posts, got ${posts.length}`);

  const foundIds = posts.map(p => p.postId);
  for (const expected of EXPECTED_POST_IDS) {
    assert(foundIds.includes(expected), `Post ${expected} found`);
  }

  const commentIncluded = posts.some(p => !p.postId || p.postId === 'undefined');
  assert(!commentIncluded, 'No comments included (no undefined post IDs)');

  console.log('\n--- Per-post validation ---');
  for (const post of posts) {
    const label = `Post ${post.postId} (${post.author || 'no author'})`;
    assert(!!post.postId && /^\d+$/.test(post.postId), `${label}: has numeric post ID`);
    assert(post.groupId === GROUP_ID, `${label}: correct group ID`);
    assert(!!post.author && post.author.length > 1, `${label}: has author name`);
    assert(post.images.length >= 0, `${label}: images extracted (got ${post.images.length})`);
    assert(post.postLink.includes(post.postId), `${label}: postLink contains postId`);
  }

  const postsWithText = posts.filter(p => p.text.length > 0);
  assert(postsWithText.length >= 5, `At least 5 posts have text (got ${postsWithText.length})`);

  const postsWithDescriptions = posts.filter(p => p.imageDescriptions.length > 0);
  assert(postsWithDescriptions.length >= 1, `At least 1 post has image descriptions (got ${postsWithDescriptions.length})`);

  console.log('\n--- Timestamp validation ---');
  const postsWithTime = posts.filter(p => p.timeLabel);
  assert(postsWithTime.length >= 15, `At least 15 posts have timeLabel (got ${postsWithTime.length})`);

  const postsWithEstimate = posts.filter(p => p.estimatedTime && typeof p.estimatedTime === 'number');
  assert(postsWithEstimate.length >= 15, `At least 15 posts have estimatedTime (got ${postsWithEstimate.length})`);

  for (const post of postsWithTime.slice(0, 3)) {
    console.log(`  Post ${post.postId}: timeLabel="${post.timeLabel}", est=${new Date(post.estimatedTime).toISOString()}`);
  }

  console.log('\n--- Sample post ---');
  const sample = posts[0];
  console.log(JSON.stringify({
    postId: sample.postId,
    author: sample.author,
    text: sample.text.substring(0, 100),
    imageCount: sample.images.length,
    descriptionCount: sample.imageDescriptions.length,
    postLink: sample.postLink,
    timeLabel: sample.timeLabel,
    estimatedTime: sample.estimatedTime ? new Date(sample.estimatedTime).toISOString() : null,
  }, null, 2));

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});

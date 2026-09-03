#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { createHash, createCipheriv, randomBytes } from 'crypto';

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'ClubMediterranee';
const REPO  = 'knowledge-base';
if (!TOKEN) { console.error('GH_TOKEN not set'); process.exit(1); }
const PASSWORD = process.env.DASHBOARD_PASSWORD;

/* ── Catalog ── */
const CATALOG = [
  { letter:'A', docs:[
    { id:'prd00', hint:['prd00'] },
    { id:'prd05', hint:['prd05','childcare'] },
    { id:'prd06', hint:['prd06','activit'] },
    { id:'prd04', hint:['prd04','transport'] },
    { id:'prd07', hint:['prd07','food'] },
    { id:'prd03', hint:['accommodation'] },
    { id:'prd19', hint:['prd19','booking-confirmation'] },
    { id:'prd24', hint:['prd24','more-room'] },
    { id:'prd23', hint:['prd23','ski'] },
    { id:'prd25', hint:['cruise','prd13'] },
  ]},
  { letter:'B', docs:[
    { id:'prd09', hint:['criteria','prd03-criteria'] },
    { id:'prd01', hint:['prd01','ticket-price'] },
    { id:'prd13', hint:['prd13-pricing','discount','privilege'] },
    { id:'prd14', hint:['prd14-rates','rates'] },
    { id:'prd12', hint:['prd12','share','booking-confirmation'] },
    { id:'prd10', hint:['prd10','save-criteria'] },
    { id:'prd02', hint:['prd02','basket'] },
  ]},
  { letter:'C', docs:[
    { id:'prd08', hint:['prd08','guest'] },
    { id:'prd15', hint:['prd15','insurance'] },
    { id:'prd16', hint:['donation','prd09-donation'] },
    { id:'prd20', hint:['prd20','sign-in'] },
    { id:'prd18', hint:['prd18','payment'] },
    { id:'prd17', hint:['prd17','hold'] },
    { id:'prd26', hint:['great-member','prd14'] },
    { id:'prd11', hint:['prd11','save-proposal'] },
    { id:'prd22', hint:['prd22','banner','toaster'] },
    { id:'prd21', hint:['prd21','reassurance'] },
  ]},
];

const LOGIN_MAP = {
  'loquic': 'cl', 'loursce': 'cel', 'celine-sorya': 'cn', 'liliyoru': 'og',
};

/* ── GitHub helpers ── */
async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.json();
}

// Decode base64 blob content (GitHub adds line breaks every 60 chars)
function decodeBlob(b64) {
  return Buffer.from(b64.replace(/\n/g, ''), 'base64').toString('utf8');
}

async function fetchBlobContent(sha) {
  const blob = await gh(`/git/blobs/${sha}`);
  return decodeBlob(blob.content).slice(0, 800);
}

async function fetchContentAtRef(filePath, ref) {
  const encoded = filePath.split('/').map(s => encodeURIComponent(s)).join('/');
  const file = await gh(`/contents/${encoded}?ref=${ref}`);
  if (!file.content) return null;
  return decodeBlob(file.content).slice(0, 800);
}

/* ── Doc status helpers ── */
const SKIP_FILE = (name) =>
  name.endsWith('index.md') || name.endsWith('canonical-memory.md');

function parseDocStatus(content) {
  // Extract frontmatter block between first pair of ---
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const src = fmMatch ? fmMatch[1] : content.slice(0, 500);
  const m = src.match(/^status:\s*(\S+)/m);
  if (!m) return null;
  const v = m[1].toLowerCase().replace(/['"]/g, '');
  if (v === 'in-progress' || v === 'in_progress' || v === 'progress') return 'in-progress';
  if (v === 'accepted' || v === 'done' || v === 'approved') return 'accepted';
  if (v === 'review' || v === 'reviewed') return 'review';
  if (v === 'draft') return 'draft';
  return null;
}

const DS_ORDER = [null, 'draft', 'in-progress', 'review', 'accepted'];
function minDocStatus(arr) {
  const valid = arr.filter(s => s != null);
  if (!valid.length) return null;
  return valid.reduce((a, b) =>
    DS_ORDER.indexOf(a) <= DS_ORDER.indexOf(b) ? a : b
  );
}

/* ── PR / repo helpers ── */
function pathMatch(filePath, doc, isSpecs) {
  const hints = doc.hint || [doc.id];
  const typeMatch = isSpecs ? filePath.includes('/specs/') : filePath.includes('/prd/');
  return typeMatch && hints.some(h => filePath.includes(h));
}
function daysSince(iso) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
function prStatus(pr, reviews) {
  if (!pr) return null;
  if (pr.state === 'closed') return pr.merged_at ? 'merged' : null;
  const formal = {};
  for (const rv of reviews) if (rv.state !== 'COMMENTED') formal[rv.user.login] = rv.state;
  if (Object.values(formal).includes('CHANGES_REQUESTED')) return 'review';
  const author = pr.user?.login?.toLowerCase() ?? '__unknown__';
  const external = reviews.some(rv => rv.user.login.toLowerCase() !== author);
  if (external || pr.requested_reviewers?.length) return 'review';
  return 'sub';
}
function findReviewers(pr, reviewMap) {
  if (!pr || pr.state === 'closed') return [];
  const author = pr.user?.login?.toLowerCase() ?? '__unknown__';
  const revs = reviewMap[pr.number] || [];
  const seen = new Set(), result = [];
  [...(pr.requested_reviewers || []).map(u => u.login), ...revs.map(r => r.user.login)]
    .filter(l => l.toLowerCase() !== author)
    .forEach(l => {
      const k = LOGIN_MAP[l.toLowerCase()];
      if (k && !seen.has(k)) { seen.add(k); result.push(k); }
    });
  return result;
}

/* ── Encryption ── */
function encryptJSON(plaintext, password) {
  const key = createHash('sha256').update(password, 'utf8').digest(); // 32-byte key
  const iv  = randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return JSON.stringify({
    enc: enc.toString('base64'),
    iv:  iv.toString('base64'),
    tag: tag.toString('base64'),
  });
}

/* ── Main ── */
console.log('Fetching PRs and repo tree…');
const [open, closed, tree] = await Promise.all([
  gh('/pulls?state=open&per_page=100'),
  gh('/pulls?state=closed&per_page=100&sort=updated&direction=desc'),
  gh('/git/trees/HEAD?recursive=1').catch(() => ({ tree: [] })),
]);
const allPRs = [...open, ...closed];
const treeBlobs = (tree.tree || []).filter(f => f.type === 'blob' && f.path.endsWith('.md'));
const mainPaths = treeBlobs.map(f => f.path.toLowerCase());

console.log(`${open.length} open PRs, ${closed.length} closed, ${treeBlobs.length} .md files on main`);

// Fetch PR files + reviews
const details = [];
for (let i = 0; i < allPRs.length; i += 8) {
  const batch = allPRs.slice(i, i + 8);
  const res = await Promise.all(batch.map(pr => Promise.all([
    gh(`/pulls/${pr.number}/files`).catch(() => []),
    pr.state === 'open' ? gh(`/pulls/${pr.number}/reviews`).catch(() => []) : Promise.resolve([]),
  ]).then(([files, reviews]) => ({ pr, files, reviews }))));
  details.push(...res);
  process.stdout.write(`  PR details ${Math.min(i + 8, allPRs.length)}/${allPRs.length}\r`);
}
console.log('\nFetching doc statuses from file content…');

const reviewMap = Object.fromEntries(details.map(d => [d.pr.number, d.reviews]));

// Fetch doc status: from main tree if available, else from PR head
async function getDocStatus(doc, isSpecs) {
  // Files on main matching this doc/type (excluding skip files)
  const mainFiles = treeBlobs.filter(f =>
    pathMatch(f.path.toLowerCase(), doc, isSpecs) &&
    !SKIP_FILE(f.path.toLowerCase())
  );

  if (mainFiles.length > 0) {
    const targets = isSpecs ? mainFiles.slice(0, 8) : [mainFiles[0]];
    const statuses = await Promise.all(targets.map(async f => {
      try { return parseDocStatus(await fetchBlobContent(f.sha)); } catch { return null; }
    }));
    return isSpecs ? minDocStatus(statuses) : (statuses[0] ?? null);
  }

  // Not on main → try open PR head commit
  const prEntry = details.find(({ files, pr }) =>
    pr.state === 'open' &&
    files.some(f =>
      pathMatch(f.filename.toLowerCase(), doc, isSpecs) &&
      !SKIP_FILE(f.filename.toLowerCase())
    )
  );
  if (!prEntry) return null;

  const prFiles = prEntry.files.filter(f =>
    pathMatch(f.filename.toLowerCase(), doc, isSpecs) &&
    !SKIP_FILE(f.filename.toLowerCase())
  );
  const targets = isSpecs ? prFiles.slice(0, 8) : [prFiles[0]];
  const ref = prEntry.pr.head.sha;
  const statuses = await Promise.all(targets.map(async f => {
    try { return parseDocStatus(await fetchContentAtRef(f.filename, ref)); } catch { return null; }
  }));
  return isSpecs ? minDocStatus(statuses) : (statuses[0] ?? null);
}

const map = {};
let docCount = 0;
// Pre-compute all doc statuses in parallel
const _allPairs = CATALOG.flatMap(s => s.docs.flatMap(d => [{doc:d,isSpecs:false},{doc:d,isSpecs:true}]));
const _statuses = await Promise.all(_allPairs.map(({doc,isSpecs}) => getDocStatus(doc, isSpecs).catch(() => null)));
const docStatusMap = Object.fromEntries(_allPairs.map(({doc,isSpecs},i) => [`${doc.id}:${isSpecs}`, _statuses[i]]));

for (const sec of CATALOG) {
  for (const doc of sec.docs) {
    map[doc.id] = {};
    for (const isSpecs of [false, true]) {
      const side = isSpecs ? 'specs' : 'prd';
      const matching = details.filter(({ files }) =>
        files.some(f => pathMatch(f.filename.toLowerCase(), doc, isSpecs) && !SKIP_FILE(f.filename.toLowerCase()))
      );
      const openOnes = matching.filter(d => d.pr.state === 'open');
      const closedMerged = matching.filter(d => d.pr.state === 'closed' && d.pr.merged_at);
      const onMain = mainPaths.some(p => pathMatch(p, doc, isSpecs) && !SKIP_FILE(p));

      const docStatus = docStatusMap[`${doc.id}:${isSpecs}`] ?? null;
      docCount++;
      process.stdout.write(`  doc status ${docCount}/54\r`);

      if (openOnes.length === 0) {
        const base = onMain || closedMerged.length ? 'merged' : 'none';
        map[doc.id][side] = { base, authorKey: null, reviewerKeys: [], prNumber: null, prCount: 0, isStale: false, docStatus };
        continue;
      }

      const sorted = openOnes.sort((a, b) => new Date(b.pr.updated_at) - new Date(a.pr.updated_at));
      const main = sorted[0];
      const reviews = reviewMap[main.pr.number] || [];
      const stale = daysSince(main.pr.updated_at) > 7;
      const authorKey = LOGIN_MAP[main.pr.user?.login?.toLowerCase()] || null;
      const reviewerKeys = findReviewers(main.pr, reviewMap);
      const base = prStatus(main.pr, reviews) || 'sub';
      map[doc.id][side] = { base, authorKey, reviewerKeys, prNumber: main.pr.number, prCount: openOnes.length, isStale: stale, docStatus };
    }
  }
}

console.log('\nWriting data.json…');
const output   = { updatedAt: new Date().toISOString(), map };
const plaintext = JSON.stringify(output, null, 2);

if (PASSWORD) {
  writeFileSync('data.json', encryptJSON(plaintext, PASSWORD));
  console.log('data.json written (AES-256-GCM encrypted) ✓');
} else {
  writeFileSync('data.json', plaintext);
  console.warn('⚠ data.json written unencrypted — set DASHBOARD_PASSWORD secret to enable encryption');
}

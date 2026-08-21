#!/usr/bin/env node
// Runs in GitHub Actions — fetches PR data from ClubMediterranee/knowledge-base
// and writes data.json consumed by the dashboard HTML (no auth needed client-side).

import { writeFileSync } from 'fs';

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'ClubMediterranee';
const REPO  = 'knowledge-base';

if (!TOKEN) { console.error('GH_TOKEN not set'); process.exit(1); }

/* ── Same catalog as index.html ── */
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

/* ── GitHub login → PO key ── */
const LOGIN_MAP = {
  'loquic':       'cl',
  'loursce':      'cel',
  'celine-sorya': 'cn',
  'liliyoru':     'og',
};

/* ── Helpers ── */
async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

function pathMatch(filePath, doc, isSpecs) {
  const hints = doc.hint || [doc.id];
  const typeMatch = isSpecs ? filePath.includes('/specs/') : filePath.includes('/prd/');
  return typeMatch && hints.some(h => filePath.includes(h));
}

function daysSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

function prStatus(pr, reviews) {
  if (!pr) return null;
  if (pr.state === 'closed') return pr.merged_at ? 'merged' : null;
  const formal = {};
  for (const rv of reviews) if (rv.state !== 'COMMENTED') formal[rv.user.login] = rv.state;
  const vals = Object.values(formal);
  if (vals.includes('CHANGES_REQUESTED')) return 'review';
  const author = pr.user?.login?.toLowerCase();
  const external = reviews.some(rv => rv.user.login.toLowerCase() !== author);
  if (external || pr.requested_reviewers?.length) return 'review';
  return 'sub';
}

function findReviewer(pr, reviewMap) {
  if (!pr || pr.state === 'closed') return null;
  const author = pr.user?.login?.toLowerCase();
  const revs = reviewMap[pr.number] || [];
  const cands = [
    ...(pr.requested_reviewers || []).map(u => u.login),
    ...revs.map(r => r.user.login),
  ].filter(l => l.toLowerCase() !== author);
  for (const l of cands) {
    const k = LOGIN_MAP[l.toLowerCase()];
    if (k) return k;
  }
  return null;
}

/* ── Main ── */
console.log('Fetching PRs and repo tree…');

const [open, closed, tree] = await Promise.all([
  gh('/pulls?state=open&per_page=100'),
  gh('/pulls?state=closed&per_page=100&sort=updated&direction=desc'),
  gh('/git/trees/HEAD?recursive=1').catch(() => ({ tree: [] })),
]);

const allPRs = [...open, ...closed];
const mainPaths = (tree.tree || []).map(f => f.path.toLowerCase());

console.log(`Found ${open.length} open PRs, ${closed.length} closed PRs, ${mainPaths.length} files on main`);

// Fetch files + reviews in batches of 8
const details = [];
for (let i = 0; i < allPRs.length; i += 8) {
  const batch = allPRs.slice(i, i + 8);
  const results = await Promise.all(batch.map(pr =>
    Promise.all([
      gh(`/pulls/${pr.number}/files`).catch(() => []),
      pr.state === 'open'
        ? gh(`/pulls/${pr.number}/reviews`).catch(() => [])
        : Promise.resolve([]),
    ]).then(([files, reviews]) => ({ pr, files, reviews }))
  ));
  details.push(...results);
  process.stdout.write(`  Fetched PR details ${Math.min(i + 8, allPRs.length)}/${allPRs.length}\r`);
}
console.log('\nBuilding status map…');

const reviewMap = Object.fromEntries(details.map(d => [d.pr.number, d.reviews]));
const map = {};

for (const sec of CATALOG) {
  for (const doc of sec.docs) {
    map[doc.id] = {};
    for (const isSpecs of [false, true]) {
      const side = isSpecs ? 'specs' : 'prd';
      const matching = details.filter(({ files }) =>
        files.some(f => pathMatch(f.filename.toLowerCase(), doc, isSpecs))
      );
      const openOnes = matching.filter(d => d.pr.state === 'open');
      const onMain = mainPaths.some(p => pathMatch(p, doc, isSpecs));

      if (openOnes.length === 0) {
        map[doc.id][side] = { base: onMain ? 'merged' : 'none', authorKey: null, reviewerKey: null, prNumber: null, prCount: 0, isStale: false };
        continue;
      }

      const sorted = openOnes.sort((a, b) => new Date(b.pr.updated_at) - new Date(a.pr.updated_at));
      const main = sorted[0];
      const reviews = reviewMap[main.pr.number] || [];
      const stale = daysSince(main.pr.updated_at) > 7;
      const authorKey = LOGIN_MAP[main.pr.user?.login?.toLowerCase()] || null;
      const reviewerKey = findReviewer(main.pr, reviewMap);
      const base = prStatus(main.pr, reviews) || 'sub';

      map[doc.id][side] = { base, authorKey, reviewerKey, prNumber: main.pr.number, prCount: openOnes.length, isStale: stale };
    }
  }
}

const output = { updatedAt: new Date().toISOString(), map };
writeFileSync('data.json', JSON.stringify(output, null, 2));
console.log('data.json written ✓');

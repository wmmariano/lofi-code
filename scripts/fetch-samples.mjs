#!/usr/bin/env node
/*
 * fetch-samples.mjs — downloads the CC0 audio that turns lofi-code's pure
 * synthesis into sampled instruments (a Rhodes for the chords, a boom-bap
 * kick and snare). Pure Node, zero dependencies (global fetch, Node >=18).
 *
 * Source: freesound.org, License "Creative Commons 0" ONLY. The script asks
 * the freesound search API for the most-downloaded CC0 sounds matching each
 * role's tag/query (downloads = a decent quality/reliability proxy), filters
 * the noise client-side (tag search is polluted: "kick" returns door kicks,
 * "snare" returns drum rolls), then downloads the high-quality OGG preview.
 *
 * Auth: freesound needs a token. Set FREESOUND_API_KEY (get one at
 * https://freesound.org/apiv2/apply/). Without it, the script prints how to
 * get a key and exits 0 — the app still runs, falling back to synthesis.
 *
 * Reproducibility: once you find a sound you like, pin its numeric id in the
 * role's `id` field below and the search is skipped. Re-running is idempotent:
 * files already present with a matching size are kept.
 *
 * Everything downloaded is logged to renderer/samples/CREDITS.md with author,
 * freesound URL and license.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = resolve(__dirname, '..', 'renderer', 'samples');
const API = 'https://freesound.org/apiv2';

// --- what we want -----------------------------------------------------------
//
// Each role maps to one output file. `dest` is relative to renderer/samples.
// For the Rhodes, `dest` encodes the pitch the sample is treated as (see
// audio.js): the filename note becomes the Sampler's root, so a single sample
// is repitched across the whole chord range. Drop in more notes by hand
// (renderer/samples/rhodes/E2.ogg, G3.ogg, …) for a truer multisample — the
// Sampler reads however many it finds.
//
// `query` is free text; `tag` and the CC0 license are applied as filters;
// `maxDur` drops anything longer (drum one-shots are short). Set `id` to pin.
const ROLES = [
  {
    name: 'Rhodes / electric-piano note (chords)',
    dest: 'rhodes/C3.ogg',
    id: null,
    query: 'rhodes electric piano note',
    tag: 'electric',
    minDur: 0.8, maxDur: 8,
  },
  {
    name: 'Boom-bap kick (one-shot)',
    dest: 'drums/kick.ogg',
    id: null,
    query: 'kick drum acoustic',
    tag: 'kick',
    minDur: 0.05, maxDur: 1.5,
  },
  {
    name: 'Boom-bap snare (one-shot)',
    dest: 'drums/snare.ogg',
    id: null,
    query: 'snare drum',
    tag: 'snare',
    minDur: 0.05, maxDur: 1.5,
  },
];

const TOKEN = process.env.FREESOUND_API_KEY;

function die(msg) { console.error(msg); process.exitCode = 1; }

async function api(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('token', TOKEN);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`freesound ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

// Pick the most-downloaded CC0 sound for a role, skipping anything outside the
// duration window (kills the door-kicks and drum-rolls the tag search drags in).
async function chooseSound(role) {
  if (role.id) {
    const s = await api(`/sounds/${role.id}/`, {
      fields: 'id,name,username,license,duration,previews',
    });
    return s;
  }
  const data = await api('/search/text/', {
    query: role.query,
    filter: `license:"Creative Commons 0" tag:${role.tag}`,
    sort: 'downloads_desc',
    fields: 'id,name,username,license,duration,previews',
    page_size: '30',
  });
  const ok = (data.results || []).find(
    (s) => s.duration >= role.minDur && s.duration <= role.maxDur && s.previews
  );
  if (!ok) throw new Error(`no CC0 match within ${role.minDur}-${role.maxDur}s for "${role.query}" (tag:${role.tag})`);
  return ok;
}

async function download(url, dest) {
  const res = await fetch(`${url}?token=${TOKEN}`);
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return createHash('sha256').update(buf).digest('hex');
}

async function main() {
  if (!TOKEN) {
    console.log([
      'lofi-code: FREESOUND_API_KEY not set — skipping sample download.',
      '',
      '  The app works without samples (it falls back to synthesis).',
      '  To get the sampled Rhodes + boom-bap drums:',
      '    1. Grab a free API key: https://freesound.org/apiv2/apply/',
      '    2. FREESOUND_API_KEY=xxxxx pnpm fetch-samples',
      '',
    ].join('\n'));
    return; // exit 0: not an error, just opted out
  }

  await mkdir(SAMPLES_DIR, { recursive: true });
  const credits = [];

  for (const role of ROLES) {
    const dest = join(SAMPLES_DIR, role.dest);
    // path-traversal guard: dest must stay inside SAMPLES_DIR
    if (!resolve(dest).startsWith(SAMPLES_DIR + '/')) {
      die(`refusing to write outside samples dir: ${role.dest}`);
      continue;
    }
    if (existsSync(dest) && (await stat(dest)).size > 0) {
      console.log(`✓ ${role.dest} (already present, skipped)`);
      continue;
    }
    try {
      const s = await chooseSound(role);
      const previewUrl = s.previews['preview-hq-ogg'] || s.previews['preview-lq-ogg'];
      if (!previewUrl) throw new Error(`no OGG preview for sound ${s.id}`);
      const sha = await download(previewUrl, dest);
      const page = `https://freesound.org/s/${s.id}/`;
      console.log(`✓ ${role.dest} ← "${s.name}" by ${s.username} (${page})`);
      credits.push(
        `- **${role.dest}** — [${s.name}](${page}) by ${s.username}. ` +
        `License: CC0 1.0. sha256: \`${sha}\``
      );
    } catch (err) {
      die(`✗ ${role.dest}: ${err.message}`);
    }
  }

  if (credits.length) {
    const md = [
      '# Sample credits',
      '',
      'All audio below is licensed **CC0 1.0 (public domain)** and was sourced',
      'from [freesound.org](https://freesound.org) by `scripts/fetch-samples.mjs`.',
      '',
      ...credits,
      '',
    ].join('\n');
    await writeFile(join(SAMPLES_DIR, 'CREDITS.md'), md);
    console.log('\nWrote renderer/samples/CREDITS.md');
  }

  if (process.exitCode) {
    console.error('\nSome samples failed — the app will fall back to synthesis for those.');
  } else {
    console.log('\nSamples ready. Restart the app to hear them.');
  }
}

main().catch((err) => die(`fetch-samples failed: ${err.stack || err}`));

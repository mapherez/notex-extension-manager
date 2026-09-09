#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(await readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const version = String(config.version).replace(/^v/, '');
const repository = required('GITHUB_REPOSITORY');
const tag = process.env.RELEASE_TAG?.trim() || `v${version}`;
const bundle = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
const signatures = await findFiles(bundle, (file) => file.endsWith('.sig'));
const candidates = [];

for (const signature of signatures) {
  const artifact = signature.slice(0, -4);
  if (!(await exists(artifact))) continue;
  const normalized = artifact.replaceAll('\\', '/').toLowerCase();
  const score = normalized.endsWith('.exe.zip') ? 100
    : normalized.endsWith('.msi.zip') ? 95
      : normalized.endsWith('.exe') ? 90
        : normalized.endsWith('.msi') ? 85
          : 0;
  if (score) candidates.push({ artifact, signature, score });
}

candidates.sort((left, right) => right.score - left.score || left.artifact.localeCompare(right.artifact));
const selected = candidates[0];
if (!selected) throw new Error(`No signed Windows updater artifact was found below ${bundle}.`);

const assetName = path.basename(selected.artifact);
const latest = {
  version,
  notes: process.env.TAURI_RELEASE_NOTES ?? '',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: (await readFile(selected.signature, 'utf8')).trim(),
      url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`,
    },
  },
};

const output = path.join(bundle, 'latest.json');
await writeFile(output, `${JSON.stringify(latest, null, 2)}\n`, 'utf8');
console.log(`Created ${output} for ${tag} using ${assetName}.`);

async function findFiles(directory, predicate) {
  const result = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && predicate(target)) result.push(target);
    }
  }
  await walk(directory);
  return result;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

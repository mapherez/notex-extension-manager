#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const appName = 'NoX Extension Manager';
const cargoPackageName = 'nox-extension-manager';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  packageJson: path.join(rootDir, 'package.json'),
  packageLock: path.join(rootDir, 'package-lock.json'),
  cargoToml: path.join(rootDir, 'src-tauri', 'Cargo.toml'),
  cargoLock: path.join(rootDir, 'src-tauri', 'Cargo.lock'),
  tauriConfig: path.join(rootDir, 'src-tauri', 'tauri.conf.json'),
};

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const checkOnly = args[0] === '--check';
if ((checkOnly && args.length !== 1) || (!checkOnly && (args.length > 1 || args[0]?.startsWith('-')))) {
  fail(checkOnly ? 'The --check option does not accept a version.' : 'Expected a single version argument.');
}

const originals = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, filePath]) => [key, await readFile(filePath, 'utf8')]),
  ),
);

const packageJson = parseJson(originals.packageJson, files.packageJson);
const packageLock = parseJson(originals.packageLock, files.packageLock);
const tauriConfig = parseJson(originals.tauriConfig, files.tauriConfig);

const versionSources = [
  ['package.json', packageJson.version],
  ['package-lock.json', packageLock.version],
  ['package-lock.json root package', packageLock.packages?.['']?.version],
  ['src-tauri/Cargo.toml', readPackageVersion(originals.cargoToml)],
  ['src-tauri/Cargo.lock', readCargoLockVersion(originals.cargoLock)],
  ['src-tauri/tauri.conf.json', tauriConfig.version],
];

for (const [label, version] of versionSources) {
  assertStringVersion(version, label);
}

if (checkOnly) {
  checkVersions(versionSources);
  process.exit(0);
}

const currentVersion = packageJson.version;
let requestedVersion = args[0];

if (!requestedVersion) {
  if (!process.stdin.isTTY) {
    fail('No version provided. Run interactively or pass it after --.');
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    requestedVersion = await prompt.question(
      `Current ${appName} version: ${currentVersion}\nNew version: `,
    );
  } finally {
    prompt.close();
  }
}

const nextVersion = normalizeVersion(requestedVersion);
if (!isSemver(nextVersion)) {
  fail(`Invalid semantic version: ${requestedVersion}`);
}

if (versionSources.every(([, version]) => normalizeVersion(version) === nextVersion)) {
  console.log(`${appName} is already at version ${nextVersion}.`);
  process.exit(0);
}

packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[''].version = nextVersion;

const updated = {
  packageJson: formatJson(packageJson, originals.packageJson),
  packageLock: formatJson(packageLock, originals.packageLock),
  cargoToml: replacePackageVersion(originals.cargoToml, nextVersion),
  cargoLock: replaceCargoLockVersion(originals.cargoLock, nextVersion),
  tauriConfig: replaceJsonVersion(
    originals.tauriConfig,
    'src-tauri/tauri.conf.json',
    nextVersion,
  ),
};

const written = [];
try {
  for (const key of Object.keys(files)) {
    written.push(key);
    await writeFile(files[key], updated[key], 'utf8');
  }
} catch (error) {
  await Promise.allSettled(written.map((key) => writeFile(files[key], originals[key], 'utf8')));
  throw error;
}

console.log(`Updated ${appName} from ${currentVersion} to ${nextVersion}:`);
for (const filePath of Object.values(files)) {
  console.log(`- ${path.relative(rootDir, filePath)}`);
}

function checkVersions(sources) {
  const expectedVersion = normalizeVersion(sources[0][1]);
  const mismatches = sources.filter(([, version]) => normalizeVersion(version) !== expectedVersion);

  if (mismatches.length === 0) {
    console.log(`${appName} version is consistent: ${expectedVersion}.`);
    return;
  }

  console.error(`${appName} version mismatch:`);
  for (const [label, version] of sources) {
    console.error(`- ${label}: ${version}`);
  }
  process.exit(1);
}

function replaceJsonVersion(contents, label, version) {
  const pattern = /"version"(\s*):(\s*)"[^"]+"/g;
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`Expected exactly one version in ${label}.`);
  }

  return contents.replace(pattern, `"version"$1:$2"${version}"`);
}

function replacePackageVersion(contents, version) {
  readPackageVersion(contents);

  const sectionName = '[package]';
  const sectionStart = contents.indexOf(sectionName);
  const nextSection = contents.indexOf('\n[', sectionStart + sectionName.length);
  const sectionEnd = nextSection === -1 ? contents.length : nextSection;
  const section = contents.slice(sectionStart, sectionEnd);
  const updatedSection = section.replace(
    /^version[ \t]*=[ \t]*"[^"]+"[ \t]*(\r?)$/m,
    `version = "${version}"$1`,
  );
  return contents.slice(0, sectionStart) + updatedSection + contents.slice(sectionEnd);
}

function readPackageVersion(contents) {
  const sectionName = '[package]';
  const label = 'src-tauri/Cargo.toml';
  const sectionStart = contents.indexOf(sectionName);
  if (sectionStart === -1) {
    fail(`Could not find ${sectionName} in ${label}.`);
  }

  const nextSection = contents.indexOf('\n[', sectionStart + sectionName.length);
  const sectionEnd = nextSection === -1 ? contents.length : nextSection;
  const section = contents.slice(sectionStart, sectionEnd);
  const matches = [...section.matchAll(/^version[ \t]*=[ \t]*"([^"]+)"[ \t]*(\r?)$/gm)];

  if (matches.length !== 1) {
    fail(`Expected exactly one package version in ${label}.`);
  }

  return matches[0][1];
}

function replaceCargoLockVersion(contents, version) {
  readCargoLockVersion(contents);

  const blocks = contents.split(/(?=^\[\[package\]\][ \t]*\r?$)/m);
  const matchingIndexes = blocks
    .map((block, index) =>
      new RegExp(`^name[ \\t]*=[ \\t]*"${cargoPackageName}"[ \\t]*\\r?$`, 'm').test(block)
        ? index
        : -1,
    )
    .filter((index) => index !== -1);

  if (matchingIndexes.length !== 1) {
    fail(`Expected exactly one ${cargoPackageName} package in src-tauri/Cargo.lock.`);
  }

  const index = matchingIndexes[0];
  const matches = [...blocks[index].matchAll(/^version[ \t]*=[ \t]*"[^"]+"[ \t]*(\r?)$/gm)];
  if (matches.length !== 1) {
    fail(`Expected exactly one ${cargoPackageName} version in src-tauri/Cargo.lock.`);
  }

  blocks[index] = blocks[index].replace(
    /^version[ \t]*=[ \t]*"[^"]+"[ \t]*(\r?)$/m,
    `version = "${version}"$1`,
  );
  return blocks.join('');
}

function readCargoLockVersion(contents) {
  const blocks = contents.split(/(?=^\[\[package\]\][ \t]*\r?$)/m);
  const packagePattern = new RegExp(
    `^name[ \\t]*=[ \\t]*"${cargoPackageName}"[ \\t]*\\r?$`,
    'm',
  );
  const matchingBlocks = blocks.filter((block) => packagePattern.test(block));

  if (matchingBlocks.length !== 1) {
    fail(`Expected exactly one ${cargoPackageName} package in src-tauri/Cargo.lock.`);
  }

  const matches = [
    ...matchingBlocks[0].matchAll(/^version[ \t]*=[ \t]*"([^"]+)"[ \t]*(\r?)$/gm),
  ];
  if (matches.length !== 1) {
    fail(`Expected exactly one ${cargoPackageName} version in src-tauri/Cargo.lock.`);
  }

  return matches[0][1];
}

function parseJson(contents, filePath) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    fail(`Could not parse ${path.relative(rootDir, filePath)}: ${error.message}`);
  }
}

function formatJson(value, original) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  return `${JSON.stringify(value, null, 2).replaceAll('\n', newline)}${newline}`;
}

function assertStringVersion(value, label) {
  if (typeof value !== 'string' || !isSemver(normalizeVersion(value))) {
    fail(`Invalid or missing version in ${label}.`);
  }
}

function normalizeVersion(value) {
  return String(value ?? '').trim().replace(/^v/i, '');
}

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}

function printHelp() {
  console.log(`
Usage:
  npm run version:set
  npm run version:set -- <version>
  npm run version:check

Updates or verifies the ${appName} application version in package.json,
package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, and
src-tauri/tauri.conf.json.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

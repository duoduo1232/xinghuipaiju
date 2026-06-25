import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const baselinePath = path.join(root, 'scripts', 'encoding-baseline.json');

// Common characters that appear when UTF-8 Chinese text has been decoded as GBK/CP936.
// Keep this file ASCII-only so the checker cannot corrupt itself.
const suspiciousChars = [
  0x9359, 0x941c, 0x7eee, 0x59f9, 0x9286, 0x9291, 0x4f99, 0x922e,
  0x94bc, 0x698d, 0x7470, 0x89d9, 0x9396, 0x934f, 0x61dc, 0x20ac,
  0x923e, 0x923c, 0x69bb, 0x93c6, 0x938a, 0x95c3, 0x5bee,
  0x6d93, 0x8364, 0x666b, 0x95c8, 0x704f, 0x9358, 0x93c8, 0x9417,
];
const suspiciousPattern = new RegExp(
  `[${suspiciousChars.map((code) => `\\u${code.toString(16).padStart(4, '0')}`).join('')}]`,
  'gu',
);

// Structural signals of mojibake that are independent of any character list:
// - U+E000..U+F8FF Private Use Area: produced when UTF-8 bytes are decoded as GBK and
//   land on user-defined codepoints. Real source files never legitimately contain PUA.
// - U+FFFD replacement char: irreversible decode loss.
// - U+0250..U+036F (IPA / spacing modifiers / combining diacritics) and U+0400..U+04FF
//   (Cyrillic): a single UTF-8 Chinese byte decoded as GBK can surface as one of these.
//   A Chinese-only project never legitimately contains them, so zero false positives.
// These have effectively zero false positives, so they are NOT subject to the baseline.
const structuralPattern = /[\u{0250}-\u{036F}\u{0400}-\u{04FF}\u{E000}-\u{F8FF}\uFFFD]/gu;

async function listFiles(dir) {
  if (!existsSync(path.join(root, dir))) return [];
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      result.push(...await listFiles(relative));
    } else if (/\.(js|jsx|mjs|ts|tsx|css|html|json|md|ps1)$/i.test(entry.name)) {
      result.push(relative);
    }
  }
  return result;
}

const files = [
  'index.html',
  'package.json',
  'vite.config.js',
  'capacitor.config.ts',
  'README.md',
  ...await listFiles('src'),
  ...await listFiles('scripts'),
].filter((file) => !file.endsWith('encoding-baseline.json') && !file.endsWith('check-encoding.mjs'));

async function readTextFile(file) {
  const bytes = await readFile(path.join(root, file));
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { hasBom, text: bytes.toString('utf8') };
}

function countSuspicious(text) {
  return [...text.matchAll(suspiciousPattern)].length;
}

function countStructural(text) {
  return [...text.matchAll(structuralPattern)].length;
}

const baseline = existsSync(baselinePath)
  ? JSON.parse(await readFile(baselinePath, 'utf8'))
  : {};
const updateBaseline = process.argv.includes('--update-baseline');
const nextBaseline = {};
const errors = [];

for (const file of files) {
  const { hasBom, text } = await readTextFile(file);
  const suspicious = countSuspicious(text);
  const structural = countStructural(text);
  if (hasBom) errors.push(`${file}: has UTF-8 BOM, save as UTF-8 without BOM`);
  // Structural mojibake (PUA / U+FFFD) is always an error and never baselined:
  // legitimate source never contains these, so there are no false positives to grandfather.
  if (structural > 0) {
    errors.push(`${file}: ${structural} structural mojibake char(s) (Private Use Area / U+FFFD) - file was saved with the wrong encoding`);
  }
  if (updateBaseline) {
    if (suspicious > 0) nextBaseline[file] = suspicious;
  } else {
    const allowed = baseline[file] ?? 0;
    if (suspicious > allowed) {
      errors.push(`${file}: suspicious mojibake count ${suspicious}, baseline ${allowed}`);
    }
  }
}

if (updateBaseline) {
  await writeFile(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`, 'utf8');
  console.log(`Encoding baseline updated: ${Object.keys(nextBaseline).length} files`);
  process.exit(0);
}

if (errors.length > 0) {
  console.error('Encoding check failed:');
  for (const error of errors) console.error(`- ${error}`);
  console.error('Use UTF-8 without BOM. If you intentionally cleaned old mojibake, run: npm run check:encoding:update');
  process.exit(1);
}

console.log('Encoding check passed.');

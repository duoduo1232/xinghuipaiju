import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const output = resolve(process.argv[3] ?? 'ui-check.png');
const width = Number(process.argv[4]) || 1920;
const height = Number(process.argv[5]) || 1080;

const candidates = [
  'C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const browser = candidates.find((path) => existsSync(path));

if (!browser) {
  console.error('No Chromium/Edge/Chrome executable found.');
  process.exit(1);
}

const result = spawnSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--window-size=${width},${height}`,
  `--screenshot=${output}`,
  url,
], { stdio: 'inherit' });

process.exit(result.status ?? 0);

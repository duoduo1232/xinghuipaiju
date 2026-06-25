import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronLeft, ChevronRight, Cog, Coins, Download, Eye, Info, Play, RefreshCw, RotateCcw, Shield, Swords, X, Zap } from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import packageInfo from '../package.json';
import cardFrameUrl from '../1.png';
import cardBackUrl from './assets/card-back.png';
import skillIconUrl from './assets/skill-icon.png';
import spiritIconUrl from './assets/spirit-icon.png';
import { APP_CONFIG } from './appConfig.js';
import { CARD_ART_FILENAMES } from './cardArtMap.js';
import { STARTING_DECK } from './cardData.js';
import './styles.css';

const CARD_TYPES = {
  character: '角色',
  equipment: '装备',
  scene: '场景',
  skill: '技能',
  hidden: '暗置',
  food: '食物',
};

const CARD_ART_MODULES = import.meta.glob('./assets/generated/*.png', {
  eager: true,
  import: 'default',
});

const CARD_ART_URLS = Object.fromEntries(
  Object.entries(CARD_ART_MODULES).map(([path, url]) => [path.split('/').pop(), url])
);

const PLAYER_BASE_HP = 100;
const PLAYER_BASE_SPIRIT = 100;
const STARTING_HAND_SIZE = 3;
const HAND_LIMIT = 5;
const TURN_DRAW_COUNT = 2;
const MAX_SKILL = 5;
const INITIAL_POLLUTION_LIMIT = 100;
const MIN_POLLUTION_LIMIT = 20;
const MAX_STAT_LOSS = 20;
const MIN_MAX_HP = 20;
const MIN_MAX_SPIRIT = 20;
const SELF_DESTRUCT_BURSTS = 3;
const AI_PASS_SCORE_FLOOR = -80;
const APP_VERSION = packageInfo.version ?? '0.0.0';
const DEFAULT_UPDATE_REPO = APP_CONFIG.updateRepo;
const DEFAULT_UPDATE_PROXY = APP_CONFIG.updateProxy;
const DEFAULT_LEADERBOARD_URL = APP_CONFIG.leaderboardUrl;
const DEFAULT_RELAY_URL = APP_CONFIG.defaultRelayUrl ?? 'ws://duoduo1215.xyz:18781';
const NativeUpdater = registerPlugin('NativeUpdater');

// 更新加速节点预设（下拉直选，最后一项为自定义入口）
const PROXY_PRESETS = [
  { value: '', label: '直连（不加速）' },
  { value: 'https://ghproxy.cxkpro.top', label: 'cxk 镜像（ghproxy.cxkpro.top）' },
  { value: 'https://gh-proxy.com', label: 'gh-proxy.com' },
  { value: 'https://gitproxy.mrhjx.cn', label: 'mrhjx 镜像（gitproxy.mrhjx.cn）' },
  { value: 'https://ghproxy.imciel.com', label: 'imciel 镜像（ghproxy.imciel.com）' },
  { value: 'https://gh.idayer.com', label: 'idayer 镜像（gh.idayer.com）' },
  { value: 'https://github.ednovas.xyz', label: 'ednovas 镜像（github.ednovas.xyz）' },
];

function getCardArtUrl(card) {
  if (card.artDataUrl) return card.artDataUrl;
  const filename = CARD_ART_FILENAMES[card.id];
  return filename ? CARD_ART_URLS[`${filename}.png`] ?? null : null;
}

function CardArt({ card, className = 'frame-art' }) {
  const url = getCardArtUrl(card);
  return (
    <span className={className}>
      {url ? <img src={url} alt="" /> : card.art}
    </span>
  );
}

function normalizeDeveloperCards(cards = []) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card, index) => {
    let skill = {};
    if (card.code?.trim()) {
      try {
        skill = JSON.parse(card.code);
      } catch {
        skill = { text: card.code };
      }
    }
    const type = skill.type ?? card.type ?? 'skill';
    const cost = Number.isFinite(Number(skill.cost ?? card.cost)) ? Number(skill.cost ?? card.cost) : 0;
    const valueText = skill.valueText ?? card.valueText ?? '+0';
    return {
      ...skill,
      id: card.id ?? `custom-${index}`,
      name: card.name?.trim() || `Custom ${index + 1}`,
      type,
      cost,
      valueText,
      effect: skill.effect ?? card.effect ?? 'customNote',
      text: skill.text ?? card.text ?? card.code ?? 'Custom card.',
      art: skill.art ?? card.artName ?? card.name?.slice(0, 1) ?? '?',
      artDataUrl: card.artDataUrl ?? skill.artDataUrl ?? null,
      createdAt: card.createdAt,
      customCode: card.code ?? '',
    };
  });
}

function availableDeckCards(customCards = []) {
  return [...STARTING_DECK, ...normalizeDeveloperCards(customCards)];
}

function makeDeck(owner, customCards = []) {
  return availableDeckCards(customCards).map((card) => {
    return {
      ...card,
      pollutionDelta: parsePollutionDelta(card.valueText),
      instanceId: `${owner}-${card.id}-${Math.random().toString(16).slice(2)}`,
      currentHp: card.hp,
    };
  });
}

function parsePollutionDelta(valueText) {
  if (!valueText) return 0;
  const parsed = Number(valueText);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCharacterLike(card) {
  return card.type === 'character'
    || card.subType === 'character'
    || card.subType === '角色';
}

function isHiddenLike(card) {
  return card.type === 'hidden' || card.tags?.includes('暗置');
}

function boardZoneOf(card) {
  if (isCharacterLike(card)) return 'characters';
  if (card.type === 'equipment' || card.subType === 'equipment' || card.subType === '装备') return 'equipment';
  if (card.type === 'scene' || card.subType === 'scene' || card.subType === '场景') return 'scenes';
  return null;
}

function boardZoneLimit(zone) {
  if (zone === 'characters') return 3;
  if (zone === 'equipment') return 2;
  if (zone === 'scenes') return 3;
  return Infinity;
}

function visibleAndHiddenZoneCount(player, zone) {
  return (player[zone]?.length ?? 0) + player.hidden.filter((card) => boardZoneOf(card) === zone).length;
}

function makeCharacterState(card) {
  const hp = card.hp;
  const spirit = card.noSpirit ? null : (card.spirit ?? hp ?? null);
  return {
    ...card,
    currentHp: hp,
    maxSpirit: spirit,
    spirit,
    shield: card.shield ?? 0,
  };
}

function shuffle(cards) {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function createPlayer(id, label) {
  return {
    id,
    label,
    maxHp: PLAYER_BASE_HP,
    hp: PLAYER_BASE_HP,
    skill: 3,
    maxSpirit: PLAYER_BASE_SPIRIT,
    spirit: PLAYER_BASE_SPIRIT,
    pollution: 0,
    maxPollution: INITIAL_POLLUTION_LIMIT,
    pollutionBursts: 0,
    deck: [],
    hand: [],
    characters: [],
    equipment: [],
    scenes: [],
    hidden: [],
    discard: [],
    damageReducedThisRound: false,
    boostedThisRound: false,
    freeSkillUsed: false,
    freeCardUsed: false,
  };
}

function addSkill(player, amount) {
  player.skill = Math.min(MAX_SKILL, Math.max(0, (player.skill ?? 0) + amount));
}

const DEFAULT_PLAYER_NAME = '玩家';
const PLAYER_NAME_KEY = 'pixel-card-player-name';
const PLAYER_STATS_KEY = 'pixel-card-player-stats';
const PLAYER_SETTINGS_KEY = 'pixel-card-settings';
const STORAGE_KEYS = [PLAYER_NAME_KEY, PLAYER_STATS_KEY, PLAYER_SETTINGS_KEY];

// 源无关存储层：以同步内存缓存为真相源，底层用 Capacitor Preferences 持久化
// （原生 SharedPreferences，不受 web origin 影响——androidScheme 改了也不丢）。
// 启动时 initStorage() 把 Preferences 读进缓存，并从 localStorage 迁移历史数据。
// 同步接口 storageGet/storageSet 保持与旧 localStorage 用法一致，调用点无需改成异步。
const storageCache = new Map();

function storageGet(key) {
  if (storageCache.has(key)) return storageCache.get(key);
  // 缓存未命中（如 initStorage 尚未完成）时回退读 localStorage，保证首屏不空白
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    storageCache.set(key, v);
    return v;
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  storageCache.set(key, value);
  // 同步落 localStorage（即时、网页版兜底），异步落 Preferences（原生持久化）
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch { /* ignore quota / unavailable */ }
  try {
    Preferences.set({ key, value }).catch(() => {});
  } catch { /* plugin unavailable on web is fine */ }
}

async function initStorage() {
  for (const key of STORAGE_KEYS) {
    let value = null;
    try {
      const res = await Preferences.get({ key });
      value = res?.value ?? null;
    } catch { /* web/无插件时忽略 */ }
    // Preferences 没有 → 从当前源的 localStorage 迁移（首次升级到本版时）
    if (value == null && typeof window !== 'undefined') {
      try {
        const legacy = window.localStorage.getItem(key);
        if (legacy != null) {
          value = legacy;
          try { await Preferences.set({ key, value }); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
    storageCache.set(key, value);
  }
}


const DEFAULT_SETTINGS = {
  musicEnabled: false,
  musicUrl: '',
  uiScale: 100,
  fontScale: 100,
  handCardScale: 112,
  handGap: 10,
  handTextScale: 100,
  boardCardScale: 110,
  startScale: 100,
  gameOffsetX: 0,
  gameOffsetY: 0,
  updateRepo: DEFAULT_UPDATE_REPO,
  updateProxy: DEFAULT_UPDATE_PROXY,
  developerCards: [],
};

const CUSTOM_CARD_TEMPLATES = [
  {
    label: '治疗本体',
    type: 'skill',
    code: '{"effect":"healSelf","value":15,"cost":1,"valueText":"+0","text":"我方本体+15血。"}',
  },
  {
    label: '抽牌',
    type: 'skill',
    code: '{"effect":"drawCards","value":2,"cost":0,"valueText":"+10","text":"抽2张牌。"}',
  },
  {
    label: '攻击技能',
    type: 'skill',
    code: '{"effect":"damageEnemy","value":10,"cost":1,"valueText":"+10","text":"对方本体-10血。"}',
  },
  {
    label: '角色',
    type: 'character',
    code: '{"hp":10,"spirit":10,"atk":0,"actionCount":1,"actionDamage":5,"actionShield":1,"cost":2,"valueText":"+0","text":"可行动1次。A：5点物伤；B：自身+1护盾。"}',
  },
  {
    label: '场景',
    type: 'scene',
    code: '{"effect":"banquet","cost":0,"valueText":"+0","text":"回合末触发：我方全体角色+1血，本体+4血。"}',
  },
  {
    label: '暗置角色',
    type: 'hidden',
    code: '{"subType":"character","hp":10,"spirit":10,"actionCount":1,"actionDamage":5,"cost":1,"valueText":"+10","text":"暗置角色。可行动1次，造成5点物伤。"}',
  },
];

const CUSTOM_CARD_SKILL_FIELDS = [
  '基础：代码必须是一段 JSON，例如 {"effect":"healSelf","value":15,"cost":1,"valueText":"+0","text":"我方本体+15血。"}',
  'type：character / equipment / scene / skill / hidden / food。不写时使用表单里选的类型。',
  'cost：消耗技能点，数字；技能点上限是 5。',
  'valueText：污染变化，例如 "+10" 或 "-5"。',
  'effect：推荐使用已有规则效果，乱写新名字只会当说明牌，不会自动产生新规则。',
  '常用 effect：healSelf 治疗本体，drawCards 抽牌，damageEnemy 伤害敌方本体，reduceSelfPollution 降低自身污染，restoreSpirit 恢复精神力。',
  '目标类 effect：killTarget 40点物伤，shieldCard 选择己方角色+1护盾，removeEnemyHidden 移除暗置，destroyEnemyScene 摧毁场景。',
  '特殊 effect：teleport 传送，wordlessBook 无字天书，feedingContract 投喂契约，rewindClock 回溯之钟，selfDestruct 自毁装置。',
  '角色字段：hp 血量，spirit 精神力，atk 展示攻击，noSpirit true 表示没有精神力。',
  '行动字段：actionCount 行动次数，actionDamage 物伤，actionShield 自身护盾，actionSkillCost 行动消耗技能点。',
  '暗置：type 为 hidden，subType 为 character / equipment / scene / skill，会占对应槽位。',
  '标记：gear true 或 tags 包含 "齿轮" 会被传送等齿轮相关效果识别。',
  'text：卡牌说明文字，会显示在卡牌和详情页。',
];

const CUSTOM_CARD_CODE_EXAMPLES = [
  {
    title: '治疗本体',
    code: '{"effect":"healSelf","value":15,"cost":1,"valueText":"+0","text":"我方本体+15血。"}',
  },
  {
    title: '目标护盾',
    code: '{"effect":"shieldCard","cost":1,"valueText":"+0","text":"选择一个己方角色，+1护盾。"}',
  },
  {
    title: '暗置角色',
    code: '{"type":"hidden","subType":"character","hp":10,"spirit":10,"actionCount":1,"actionDamage":5,"cost":1,"valueText":"+10","text":"暗置角色。可行动1次，造成5点物伤。"}',
  },
];
function getStoredStats() {
  if (typeof window === 'undefined') return { wins: 0, losses: 0 };
  try {
    const parsed = JSON.parse(storageGet(PLAYER_STATS_KEY) || '{}');
    return {
      wins: Number.isFinite(parsed.wins) ? parsed.wins : 0,
      losses: Number.isFinite(parsed.losses) ? parsed.losses : 0,
    };
  } catch {
    return { wins: 0, losses: 0 };
  }
}

function saveStats(stats) {
  storageSet(PLAYER_STATS_KEY, JSON.stringify(stats));
}

async function fetchLeaderboard(signal) {
  if (!DEFAULT_LEADERBOARD_URL) return [];
  const response = await fetch(DEFAULT_LEADERBOARD_URL, { signal });
  if (!response.ok) throw new Error(`排行榜读取失败：${response.status}`);
  const data = await response.json();
  return Array.isArray(data.players) ? data.players : [];
}

async function submitLeaderboardResult({ name, result, mode }) {
  if (!DEFAULT_LEADERBOARD_URL || !name || !result) return;
  await fetch(DEFAULT_LEADERBOARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, result, mode }),
  });
}

function getStoredSettings() {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(storageGet(PLAYER_SETTINGS_KEY) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      uiScale: Math.min(300, Math.max(1, Number(parsed.uiScale) || DEFAULT_SETTINGS.uiScale)),
      fontScale: Math.min(200, Math.max(50, Number(parsed.fontScale) || DEFAULT_SETTINGS.fontScale)),
      handCardScale: Math.min(250, Math.max(70, Number(parsed.handCardScale) || DEFAULT_SETTINGS.handCardScale)),
      handGap: Math.min(80, Math.max(-40, Number(parsed.handGap) || DEFAULT_SETTINGS.handGap)),
      handTextScale: Math.min(200, Math.max(50, Number(parsed.handTextScale) || DEFAULT_SETTINGS.handTextScale)),
      boardCardScale: Math.min(180, Math.max(70, Number(parsed.boardCardScale) || DEFAULT_SETTINGS.boardCardScale)),
      startScale: Math.min(160, Math.max(60, Number(parsed.startScale) || DEFAULT_SETTINGS.startScale)),
      gameOffsetX: Math.min(300, Math.max(-300, Number(parsed.gameOffsetX) || DEFAULT_SETTINGS.gameOffsetX)),
      gameOffsetY: Math.min(300, Math.max(-300, Number(parsed.gameOffsetY) || DEFAULT_SETTINGS.gameOffsetY)),
      updateRepo: typeof parsed.updateRepo === 'string' ? parsed.updateRepo.trim() : DEFAULT_SETTINGS.updateRepo,
      updateProxy: typeof parsed.updateProxy === 'string' ? normalizeUpdateProxy(parsed.updateProxy) : DEFAULT_SETTINGS.updateProxy,
      developerCards: Array.isArray(parsed.developerCards) ? parsed.developerCards : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  storageSet(PLAYER_SETTINGS_KEY, JSON.stringify(settings));
}

function normalizeVersion(version = '') {
  return String(version).trim().replace(/^v/i, '');
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = normalizeVersion(right).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeGitHubRepo(repo = '') {
  return String(repo)
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/releases.*$/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function normalizeUpdateProxy(proxy = '') {
  const trimmed = String(proxy).trim().replace(/\/+$/g, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeLanUrl(input = '') {
  const trimmed = String(input).trim();
  if (!trimmed) {
    throw new Error('请填写联机服务器地址，例如 ws://duoduo1215.xyz:18781。');
  }

  let candidate = trimmed;
  const hasProtocol = /^(?:https?|wss?):\/\//i.test(candidate);
  const securePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const explicitPlainWs = /^ws:\/\//i.test(candidate) || /^http:\/\//i.test(candidate);
  if (securePage && explicitPlainWs) {
    throw new Error('HTTPS 页面不能连接 ws://。请使用 wss://，或在 APK/HTTP 页面里连接 ws://。');
  }
  if (/^https?:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  } else if (!/^wss?:\/\//i.test(candidate)) {
    candidate = `${securePage ? 'wss' : 'ws'}://${candidate}`;
  }

  const url = new URL(candidate);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') url.protocol = 'ws:';
  if (!hasProtocol && !url.port) {
    url.port = '18781';
  }
  return url;
}

function roomApiUrlFromWs(input = '') {
  const wsUrl = normalizeLanUrl(input);
  wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
  wsUrl.pathname = '/rooms';
  wsUrl.search = '';
  return wsUrl.toString();
}

function makeRoomId(name = '') {
  const prefix = String(name || 'room').trim().replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 8) || 'room';
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
}

function proxyGitHubDownloadUrl(url, proxy = DEFAULT_UPDATE_PROXY) {
  const normalizedProxy = normalizeUpdateProxy(proxy);
  if (!url || !normalizedProxy) return url;
  if (!/^https?:\/\/(?:github\.com|raw\.githubusercontent\.com|objects\.githubusercontent\.com)\//i.test(url)) {
    return url;
  }
  if (url.startsWith(`${normalizedProxy}/`)) return url;
  return `${normalizedProxy}/${url}`;
}

async function checkGitHubUpdate(repo, signal) {
  const normalizedRepo = normalizeGitHubRepo(repo);
  if (!/^[\w.-]+\/[\w.-]+$/.test(normalizedRepo)) {
    throw new Error('请先填写 GitHub 仓库，例如 username/pixel-card-duel。');
  }
  const response = await fetch(`https://api.github.com/repos/${normalizedRepo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });
  if (response.status === 404) {
    throw new Error('没有找到 Release，请先在 GitHub 发布一个版本。');
  }
  if (!response.ok) {
    throw new Error(`检查失败：GitHub 返回 ${response.status}`);
  }
  const release = await response.json();
  const apkAsset = release.assets?.find((asset) => /\.apk$/i.test(asset.name));
  return {
    repo: normalizedRepo,
    version: normalizeVersion(release.tag_name || release.name || ''),
    tag: release.tag_name,
    name: release.name || release.tag_name,
    url: apkAsset?.browser_download_url || release.html_url,
    apkName: apkAsset?.name ?? '',
    hasUpdate: compareVersions(release.tag_name || release.name || '', APP_VERSION) > 0,
  };
}

function getStoredPlayerName() {
  if (typeof window === 'undefined') return DEFAULT_PLAYER_NAME;
  return storageGet(PLAYER_NAME_KEY)?.trim() || DEFAULT_PLAYER_NAME;
}

function getAutoStartMode() {
  if (typeof window === 'undefined') return null;
  const mode = new URLSearchParams(window.location.search).get('autostart');
  return ['pve', 'pvp', 'p2p', 'lan', 'relay', 'ffa4', 'team4'].includes(mode) ? mode : null;
}

function looksLikeAudioUrl(value) {
  return /\.(mp3|ogg|wav|m4a|aac|flac)(\?|#|$)/i.test(value);
}

async function resolveMusicSource(input, signal) {
  const source = input?.trim();
  if (!source) return '';
  if (looksLikeAudioUrl(source) || source.startsWith('data:audio/')) return source;
  const response = await fetch(source, { signal });
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    return data.url ?? data.musicUrl ?? data.audio ?? data.src ?? data.data?.url ?? '';
  }
  const text = (await response.text()).trim();
  if (text.startsWith('{')) {
    const data = JSON.parse(text);
    return data.url ?? data.musicUrl ?? data.audio ?? data.src ?? data.data?.url ?? '';
  }
  return text;
}

function getSeatLabels(mode = 'pve', localName = DEFAULT_PLAYER_NAME, localSeat = 'p1') {
  const name = localName?.trim() || DEFAULT_PLAYER_NAME;
  if (mode === 'pve') return { p1: name, p2: 'Bot' };
  if (mode === 'p2p' || mode === 'lan' || mode === 'relay') {
    return {
      p1: localSeat === 'p1' ? name : DEFAULT_PLAYER_NAME,
      p2: localSeat === 'p2' ? name : DEFAULT_PLAYER_NAME,
    };
  }
  if (mode === 'ffa4' || mode === 'team4') {
    return {
      p1: name,
      p2: 'Bot',
      p3: mode === 'team4' ? 'AI 队友' : 'Bot',
      p4: 'Bot',
    };
  }
  return { p1: name, p2: '对手' };
}

function setupGame({ mode = 'pve', localName = DEFAULT_PLAYER_NAME, localSeat = 'p1', customCards = [] } = {}) {
  const baseTurnOrder = mode === 'ffa4' || mode === 'team4' ? ['p1', 'p2', 'p3', 'p4'] : ['p1', 'p2'];
  const first = baseTurnOrder[Math.floor(Math.random() * baseTurnOrder.length)];
  const startIndex = baseTurnOrder.indexOf(first);
  const turnOrder = [...baseTurnOrder.slice(startIndex), ...baseTurnOrder.slice(0, startIndex)];
  const labels = getSeatLabels(mode, localName, localSeat);
  const deck = shuffle(makeDeck('shared', customCards));
  const players = Object.fromEntries(baseTurnOrder.map((playerId) => [playerId, createPlayer(playerId, labels[playerId] ?? DEFAULT_PLAYER_NAME)]));
  const dealOrder = turnOrder;
  for (let index = 0; index < STARTING_HAND_SIZE; index += 1) {
    dealOrder.forEach((playerId) => {
      if (deck.length > 0) players[playerId].hand.push(deck.shift());
    });
  }
  return {
    matchId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    players,
    deck,
    turnOrder,
    mode,
    first,
    turn: 1,
    phase: `${first}:play`,
    log: [`双方获得3点初始技能点。`, `抛硬币决定：${labels[first]}成为先手。`],
    inspected: null,
    actionState: null,
    revealedHidden: null,
  };
}

function opponentOf(playerId) {
  return playerId === 'p1' ? 'p2' : 'p1';
}

function isFourPlayerMode(mode) {
  return mode === 'ffa4' || mode === 'team4';
}

function isRelayNetworkMode(mode) {
  return mode === 'p2p' || mode === 'lan' || mode === 'relay';
}

function getTurnOrder(game) {
  return game.turnOrder?.length ? game.turnOrder : ['p1', 'p2'];
}

function getTeamId(playerId) {
  if (playerId === 'p1' || playerId === 'p3') return 'a';
  if (playerId === 'p2' || playerId === 'p4') return 'b';
  return null;
}

function getEnemyIds(game, playerId) {
  const ids = getTurnOrder(game).filter((id) => id !== playerId);
  if (!isFourPlayerMode(game.mode)) return [opponentOf(playerId)];
  if (game.mode === 'team4') {
    const team = getTeamId(playerId);
    return ids.filter((id) => getTeamId(id) !== team);
  }
  return ids;
}

function getPrimaryEnemyId(game, playerId) {
  const enemyIds = getEnemyIds(game, playerId);
  if (enemyIds.length === 0) return opponentOf(playerId);
  const order = getTurnOrder(game);
  const start = order.indexOf(playerId);
  if (start >= 0) {
    for (let offset = 1; offset <= order.length; offset += 1) {
      const candidate = order[(start + offset) % order.length];
      if (enemyIds.includes(candidate)) return candidate;
    }
  }
  return enemyIds[0];
}

function modeLabel(mode) {
  if (mode === 'pve') return '人机对战';
  if (mode === 'p2p') return 'P2P 联机';
  if (mode === 'lan') return '局域网联机';
  if (mode === 'relay') return '服务器联机';
  if (mode === 'ffa4') return '4人自由战';
  if (mode === 'team4') return '4人组队战';
  return '双人对战';
}

function isAiControlledSeat(mode, playerId, localSeat = 'p1') {
  if (mode === 'pve') return playerId === 'p2';
  if (mode === 'ffa4' || mode === 'team4') return playerId !== localSeat;
  return false;
}

function getWinner(game, localSeat = 'p1') {
  const aliveIds = getTurnOrder(game).filter((id) => (game.players[id]?.hp ?? 0) > 0);
  if (aliveIds.length === 0) return null;
  if (!isFourPlayerMode(game.mode)) {
    const defeated = getTurnOrder(game).find((id) => (game.players[id]?.hp ?? 0) <= 0);
    return defeated ? game.players[opponentOf(defeated)] : null;
  }
  if (game.mode === 'team4') {
    const aliveTeams = new Set(aliveIds.map(getTeamId));
    if (aliveTeams.size === 1) {
      const winnerId = aliveIds.includes(localSeat) ? localSeat : aliveIds[0];
      return game.players[winnerId];
    }
    return null;
  }
  return aliveIds.length === 1 ? game.players[aliveIds[0]] : null;
}

function isNetChannelOpen(channel) {
  return channel?.readyState === 'open' || channel?.readyState === WebSocket.OPEN;
}

function advanceActionCursor(game, note) {
  if (!game.actionState) return game;
  const actionState = {
    ...game.actionState,
    cursor: game.actionState.cursor + 1,
  };
  if (!note) return { ...game, actionState };
  return { ...game, actionState, log: [note, ...game.log] };
}

function visibleLogLine(line, game, viewerId) {
  let text = String(line ?? '');
  Object.values(game.players).forEach((player) => {
    if (player.id === viewerId) return;
    player.hidden.forEach((card) => {
      if (!card?.name) return;
      text = text.split(`《${card.name}》`).join('《暗置牌》');
      text = text.split(card.name).join('暗置牌');
    });
  });
  return text;
}
function getCannotPlayReason(game, playerId, card) {
  const player = game.players[playerId];
  if (!player) return '找不到当前玩家。';
  if (!card) return '没有选中卡牌。';
  if (player.cannotPlayThisRound) return '本回合被效果限制，不能出牌。';
  const freeByRefrigeration = card.type === 'skill' && hasEquipment(player, 'scene_refrigeration') && !player.freeSkillUsed;
  const freeByConsole = hasEquipment(player, 'scene_control_console') && !player.freeCardUsed;
  const freePlay = freeByConsole || freeByRefrigeration;

  if (!freePlay && player.skill < card.cost) return `技能点不足：需要 ${card.cost}，当前 ${player.skill}。`;
  const playedHidden = isHiddenLike(card) || card.id === 'char_protector';
  const zone = boardZoneOf(card);
  if (playedHidden && player.hidden.length >= 2) return '暗置栏已满，最多 2 张。';
  if (zone && visibleAndHiddenZoneCount(player, zone) >= boardZoneLimit(zone)) {
    const names = { characters: '角色', equipment: '装备', scenes: '场景' };
    return `${names[zone] ?? '场上'}栏已满，最多 ${boardZoneLimit(zone)} 张。`;
  }
  if (card.effect === 'selfDestruct' && totalPollutionBursts(game.players) < SELF_DESTRUCT_BURSTS) {
    return `污染爆发次数不足：需要 ${SELF_DESTRUCT_BURSTS} 次。`;
  }
  if (card.effect === 'feedingContract') {
    const hasTarget = allBoardCharacters(player).some((character) => !isGearCard(character));
    if (!hasTarget) return '没有可献祭的非齿轮角色。';
  }
  return '';
}
function canPlayCard(game, playerId, card) {
  return !getCannotPlayReason(game, playerId, card);
}

function scoreAiCard(game, playerId, card) {
  const player = game.players[playerId];
  const enemy = game.players[opponentOf(playerId)];
  let score = 0;

  if (card.effect === 'killTarget') {
    score += 100;
    if (enemy.characters.length === 0) score += 30;
    if (enemy.hp <= 12) score += 20;
  }
  if (card.effect === 'selfDestruct' && totalPollutionBursts(game.players) >= SELF_DESTRUCT_BURSTS) score += 95;
  if (card.effect === 'motherLove' && enemy.hand.length <= 3) score += 85;
  if (card.effect === 'healSelf' && player.hp <= Math.max(20, (player.maxHp ?? PLAYER_BASE_HP) * 0.45)) score += 70;
  if (card.effect === 'restoreSpirit' && (player.spirit ?? player.maxSpirit ?? PLAYER_BASE_SPIRIT) <= 45) score += 70;
  if (card.effect === 'trueBodyStrike') score += enemy.hp <= 40 || (enemy.spirit ?? 100) <= 40 ? 110 : 72;
  if (card.effect === 'abyssGaze') score += 72;
  if (card.effect === 'destroyEnemyScene' || card.effect === 'memorySceneRemove') score += enemy.scenes.length > 0 ? 70 : 12;
  if (card.effect === 'removeEnemyHidden') score += enemy.hidden.length > 0 ? 68 : 8;
  if (card.effect === 'feedingContract') score += player.hp <= 55 ? 68 : 30;
  if (card.effect === 'rewindClock') score += player.hp <= 45 ? 80 : 36;
  if (card.effect === 'wordlessBook') {
    if (player.pollution >= 60) score += 78;
    else if (player.hp <= 45 || (player.spirit ?? 0) <= 45) score += 72;
    else score += 30;
  }
  if (card.effect === 'drawCards' && player.hand.length <= 3) score += 65;
  if (card.effect === 'reduceSelfPollution' && player.pollution >= 40) score += 68;
  if (card.effect === 'inspectHidden' && enemy.hidden.length > 0) score += 58;
  if (card.effect === 'inspectAllHidden' && enemy.hidden.length > 0) score += 52;
  if (card.effect === 'ziyou' || card.effect === 'damageEnemy') score += 60;
  if (card.effect === 'teleport') score += 45;
  if (card.type === 'character') score += 55;
  if (card.type === 'equipment') score += 42;
  if (card.type === 'scene') score += 42;
  if (card.type === 'hidden') score += 38;
  if (card.type === 'food') score += 50;
  if (card.effect === 'gainSkill') score += player.skill <= 2 ? 56 : 28;
  if (card.id === 'skill_big_chief') score += 50;
  if (card.id === 'skill_memory_inspect') score += enemy.hidden.length > 0 ? 58 : 10;
  if (card.id === 'skill_metal_cabinet' || card.id === 'skill_ancestral_blessing') score += 44;
  const pollutionDelta = effectivePollutionDelta(player, card);
  if (pollutionDelta > 0) {
    const afterPollution = player.pollution + pollutionDelta;
    if (afterPollution >= (player.maxPollution ?? INITIAL_POLLUTION_LIMIT)) score -= 70;
    else if (afterPollution >= 80) score -= 28;
  }
  return score + (card.valueText ? Number.parseInt(String(card.valueText).replace(/[^0-9-]/g, ''), 10) || 0 : 0);
}

function evaluateCharacterForAi(card) {
  const hp = card.currentHp ?? card.hp ?? 0;
  const spirit = card.noSpirit ? 0 : (card.spirit ?? card.maxSpirit ?? card.hp ?? 0);
  const attack = Math.max(card.actionDamage ?? 0, card.actionBodyDamage ?? 0, card.actionCharacterDamage ?? 0, card.atk ?? 0);
  const shield = card.shield ?? 0;
  const actionValue = (card.actionCount ?? 1) * (
    attack * 5
    + (card.actionSpiritDamage ?? 0) * 4.5
    + (card.actionPolluteEnemy ?? 0) * 1.4
    + (card.actionShield ?? 0) * 7
  );
  return hp * 2.3
    + spirit * 0.7
    + actionValue
    + shield * 7
    + (card.taunt ? 14 : 0)
    + (card.untargetableByAttack ? 18 : 0)
    + (card.immuneCharacterDamage ? 16 : 0)
    + (card.noSpirit ? 8 : 0);
}

function aiCharacterThreat(card) {
  const hp = card.currentHp ?? card.hp ?? 0;
  const spirit = card.noSpirit ? 0 : (card.spirit ?? card.maxSpirit ?? card.hp ?? 0);
  const attack = Math.max(card.actionDamage ?? 0, card.actionBodyDamage ?? 0, card.actionCharacterDamage ?? 0, card.atk ?? 0);
  return attack * 8
    + (card.actionCount ?? 1) * 8
    + (card.actionSpiritDamage ?? 0) * 6
    + (card.actionPolluteEnemy ?? 0) * 2
    + hp * 1.2
    + spirit * 0.5
    + (card.taunt ? 28 : 0)
    + (card.untargetableByAttack ? 24 : 0)
    + (card.immuneCharacterDamage ? 18 : 0)
    + (card.id === 'char_monster' ? 24 : 0)
    + (card.id === 'char_it' ? 36 : 0);
}

function totalHealthForFx(player) {
  return player.hp + allBoardCharacters(player).reduce((sum, card) => sum + Math.max(0, card.currentHp ?? card.hp ?? 0), 0);
}

function selectableCardsForEffect(game, playerId, card) {
  const player = game.players[playerId];
  const enemy = game.players[getPrimaryEnemyId(game, playerId)];
  if (card.effect === 'removeEnemyHidden') return enemy.hidden;
  if (card.effect === 'destroyEnemyScene') return enemy.scenes ?? [];
  if (card.effect === 'memorySceneRemove') {
    return [
      ...(enemy.scenes ?? []),
      ...enemy.hidden.filter((item) => boardZoneOf(item) === 'scenes'),
    ];
  }
  if (card.effect === 'feedingContract') {
    return allBoardCharacters(player).filter((item) => !isGearCard(item));
  }
  if (card.effect === 'shieldCard') {
    return allBoardCharacters(player);
  }
  if (card.effect === 'itEnter') return enemy.characters;
  if (card.effect === 'orcaEnter') return enemy.characters;
  return [];
}

function evaluateAiState(game, playerId) {
  const player = game.players[playerId];
  const enemy = game.players[getPrimaryEnemyId(game, playerId)];
  if (!player || !enemy) return -999999;
  if (enemy.hp <= 0) return 999999;
  if (player.hp <= 0) return -999999;

  const playerBoard = player.characters.reduce((sum, card) => sum + evaluateCharacterForAi(card), 0)
    + player.hidden.reduce((sum, card) => sum + (boardZoneOf(card) === 'characters' ? evaluateCharacterForAi(card) * 0.9 : 8), 0)
    + player.equipment.length * 16
    + player.scenes.length * 16;
  const enemyBoard = enemy.characters.reduce((sum, card) => sum + evaluateCharacterForAi(card), 0)
    + enemy.hidden.length * 7
    + enemy.equipment.length * 14
    + enemy.scenes.length * 14;

  let score = 0;
  const playerHpRatio = player.hp / Math.max(1, player.maxHp ?? PLAYER_BASE_HP);
  const enemyHpRatio = enemy.hp / Math.max(1, enemy.maxHp ?? PLAYER_BASE_HP);
  const playerSpiritRatio = (player.spirit ?? 0) / Math.max(1, player.maxSpirit ?? PLAYER_BASE_SPIRIT);
  const enemySpiritRatio = (enemy.spirit ?? 0) / Math.max(1, enemy.maxSpirit ?? PLAYER_BASE_SPIRIT);

  score += (player.hp - enemy.hp) * 9.5;
  score += ((player.spirit ?? 0) - (enemy.spirit ?? 0)) * 5.5;
  score += ((player.maxHp ?? PLAYER_BASE_HP) - (enemy.maxHp ?? PLAYER_BASE_HP)) * 4.2;
  score += ((player.maxSpirit ?? PLAYER_BASE_SPIRIT) - (enemy.maxSpirit ?? PLAYER_BASE_SPIRIT)) * 3.6;
  score += playerBoard - enemyBoard;
  score += player.skill * 6 - enemy.skill * 2.4;
  score += player.hand.length * 4.2 - enemy.hand.length * 3;
  score += enemy.pollution * 0.9 - player.pollution * 1.5;
  score += (enemy.pollutionBursts ?? 0) * 42 - (player.pollutionBursts ?? 0) * 58;
  if (player.hp <= 15) score -= 95;
  if (playerHpRatio <= 0.25) score -= 90;
  if ((player.spirit ?? 0) <= 0) score -= 160;
  if (playerSpiritRatio <= 0.25) score -= 60;
  if ((enemy.spirit ?? 0) <= 0) score += 130;
  if (enemySpiritRatio <= 0.25) score += 55;
  if (player.pollution >= (player.maxPollution ?? INITIAL_POLLUTION_LIMIT) - 20) score -= 85;
  if (enemy.hp <= 40) score += (40 - enemy.hp) * 6;
  if (enemyHpRatio <= 0.35) score += 85;
  if (enemy.pollution >= (enemy.maxPollution ?? INITIAL_POLLUTION_LIMIT) - 20) score += 48;
  if (player.cannotPlayThisRound) score -= 12;
  if (player.physicalImmuneThisRound) score += 18;
  if (player.pollutionImmuneThisRound) score += 12;
  return score;
}

function getKillTargets(game, playerId) {
  return getEnemyIds(game, playerId).flatMap((enemyId) => {
    const enemy = game.players[enemyId];
    return [
      { type: 'body', enemyId },
      ...enemy.characters.map((card) => ({ type: 'character', enemyId, instanceId: card.instanceId })),
    ];
  });
}

function getAiCardPlan(game, playerId, card) {
  const before = evaluateAiState(game, playerId);
  const contextBonus = scoreAiCard(game, playerId, card) * 0.08;

  if (card.effect === 'killTarget') {
    return getKillTargets(game, playerId)
      .map((target) => {
        const nextGame = playTargetedKill(game, playerId, card, target);
        return {
          card,
          target,
          game: nextGame,
          score: evaluateAiState(nextGame, playerId) - before + contextBonus,
        };
      })
      .sort((a, b) => b.score - a.score)[0] ?? null;
  }

  const nextGame = playCard(game, playerId, card);
  if (nextGame === game) return null;
  let bonus = contextBonus;
  if (card.effect === 'healSelf' && game.players[playerId].hp >= (game.players[playerId].maxHp ?? PLAYER_BASE_HP)) bonus -= 30;
  if (card.effect === 'selfDestruct' && totalPollutionBursts(game.players) < SELF_DESTRUCT_BURSTS) bonus -= 85;
  if (card.effect === 'motherLove' && getEnemyIds(game, playerId).every((enemyId) => game.players[enemyId].hand.length > 3)) bonus -= 45;
  if (card.effect === 'inspectHidden' && getEnemyIds(game, playerId).every((enemyId) => game.players[enemyId].hidden.length === 0)) bonus -= 30;
  if (card.effect === 'inspectAllHidden' && getEnemyIds(game, playerId).every((enemyId) => game.players[enemyId].hidden.length === 0)) bonus -= 25;
  if (card.id === 'skill_ancestral_blessing' && game.players[playerId].pollution < 45) bonus -= 20;

  return {
    card,
    game: nextGame,
    score: evaluateAiState(nextGame, playerId) - before + bonus,
  };
}

function selectedEffectPlans(game, playerId, card, before, contextBonus) {
  const targets = selectableCardsForEffect(game, playerId, card);
  if (targets.length === 0) return [];
  return targets
    .map((selection) => {
      const nextGame = playSelectedEffectCard(game, playerId, card, selection);
      if (nextGame === game) return null;
      const targetBonus = selection ? aiCharacterThreat(selection) * 0.05 : 0;
      return {
        card,
        selection,
        game: nextGame,
        score: evaluateAiState(nextGame, playerId) - before + contextBonus + targetBonus,
      };
    })
    .filter(Boolean);
}

function selectedEnterPlans(game, playerId, card, before, contextBonus) {
  const targets = selectableCardsForEffect(game, playerId, card);
  if (targets.length === 0) return [];
  return targets
    .map((selection) => {
      const nextGame = playSelectedEnterCard(game, playerId, card, selection);
      if (nextGame === game) return null;
      const targetBonus = selection?.instanceId === '__played_self' ? 6 : aiCharacterThreat(selection) * 0.08;
      return {
        card,
        selection,
        game: nextGame,
        score: evaluateAiState(nextGame, playerId) - before + contextBonus + targetBonus,
      };
    })
    .filter(Boolean);
}

function getAiCardPlans(game, playerId, card) {
  const before = evaluateAiState(game, playerId);
  const contextBonus = scoreAiCard(game, playerId, card) * 0.08;

  if (card.effect === 'killTarget') {
    return getKillTargets(game, playerId)
      .map((target) => {
        const nextGame = playTargetedKill(game, playerId, card, target);
        const enemy = game.players[target.enemyId ?? getPrimaryEnemyId(game, playerId)];
        const targetCard = target.type === 'character'
          ? enemy.characters.find((item) => item.instanceId === target.instanceId)
          : null;
        const highestEnemyThreat = enemy.characters.reduce((best, item) => Math.max(best, aiCharacterThreat(item)), 0);
        const targetBonus = target.type === 'body'
          ? (enemy.hp <= 40 ? 1400 : (enemy.hp <= 55 ? 420 : 90 - highestEnemyThreat * 0.25))
          : aiCharacterThreat(targetCard) * 1.55 - (enemy.hp <= 55 ? 160 : 0);
        return {
          card,
          target,
          game: nextGame,
          score: evaluateAiState(nextGame, playerId) - before + contextBonus + targetBonus,
        };
      });
  }

  if (['removeEnemyHidden', 'destroyEnemyScene', 'memorySceneRemove', 'feedingContract', 'shieldCard'].includes(card.effect)) {
    const plans = selectedEffectPlans(game, playerId, card, before, contextBonus);
    if (plans.length > 0) return plans;
  }

  if (['itEnter', 'orcaEnter'].includes(card.effect)) {
    const plans = selectedEnterPlans(game, playerId, card, before, contextBonus);
    if (plans.length > 0) return plans;
  }

  const plan = getAiCardPlan(game, playerId, card);
  return plan ? [plan] : [];
}

function getAiCandidatePlans(game, playerId, limit = 8) {
  const player = game.players[playerId];
  return player.hand
    .filter((card) => canPlayCard(game, playerId, card))
    .flatMap((card) => getAiCardPlans(game, playerId, card))
    .filter((plan) => plan && plan.game !== game)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function evaluateAiSequence(game, playerId, depth) {
  if (depth <= 0) return evaluateAiState(game, playerId);
  const plans = getAiCandidatePlans(game, playerId, 6);
  if (plans.length === 0) return evaluateAiState(game, playerId);
  const passScore = evaluateAiState(game, playerId);
  return plans.reduce((best, plan) => {
    const futureScore = evaluateAiSequence(plan.game, playerId, depth - 1);
    return Math.max(best, futureScore + plan.score * 0.08);
  }, passScore);
}

function getAiBestPlan(game, playerId) {
  const before = evaluateAiState(game, playerId);
  const plans = getAiCandidatePlans(game, playerId, 10)
    .map((plan) => ({
      ...plan,
      score: plan.score + (evaluateAiSequence(plan.game, playerId, 2) - before) * 0.35,
    }))
    .sort((a, b) => b.score - a.score);
  return plans[0] ?? null;
}

function chooseKillTarget(game, playerId) {
  const killCard = game.players[playerId].hand.find((card) => card.effect === 'killTarget');
  if (killCard) {
    const plan = getAiCardPlans(game, playerId, killCard).sort((a, b) => b.score - a.score)[0];
    if (plan?.target) return plan.target;
  }
  return { type: 'body' };
}

function chooseActionTarget(game, playerId, actor) {
  const player = game.players[playerId];
  const enemy = game.players[getPrimaryEnemyId(game, playerId)];
  const canPay = !actor.actionSkillCost || player.skill >= actor.actionSkillCost;

  if (!canPay) {
    if (actor.actionShield) return { type: 'shieldSelf' };
    if (actor.actionSelfPolluteForSkill && player.pollution <= 65) return { type: 'selfPolluteSkill' };
    if (actor.actionPolluteEnemy) return { type: 'polluteEnemy' };
    return null;
  }

  if (actor.actionSelfPolluteForSkill && player.skill <= 2 && player.pollution <= 65) {
    return { type: 'selfPolluteSkill' };
  }

  const candidates = [];
  const hasPhysicalAttack = (actor.actionDamage ?? actor.actionBodyDamage ?? actor.actionCharacterDamage ?? actor.atk ?? 0) > 0;
  if (hasPhysicalAttack) candidates.push({ type: 'body' });
  enemy.characters
    .filter((card) => hasPhysicalAttack && !card.untargetableByAttack)
    .forEach((card) => candidates.push({ type: 'character', instanceId: card.instanceId }));
  if (actor.actionSpiritDamage) {
    candidates.push({ type: 'spiritEnemy' });
    enemy.characters
      .filter((card) => card.spirit != null && !card.noSpirit)
      .forEach((card) => candidates.push({ type: 'characterSpirit', instanceId: card.instanceId }));
  }
  if (actor.actionPolluteEnemy && enemy.hp > 0) candidates.push({ type: 'polluteEnemy' });
  if (actor.actionShield) candidates.push({ type: 'shieldSelf' });

  const before = evaluateAiState(game, playerId);
  const best = candidates
    .map((target) => {
      const nextGame = resolveCharacterAction(game, playerId, actor.instanceId, target);
      if (nextGame === game) return null;
      return {
        target,
        score: evaluateAiState(nextGame, playerId) - before,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0];

  if (best && best.score > -45) return best.target;
  return null;
}

function chooseAiCard(game, playerId) {
  const plan = getAiBestPlan(game, playerId);
  if (!plan || plan.score <= AI_PASS_SCORE_FLOOR) return null;
  return plan.card;
}

function playAiCard(game, playerId) {
  const plan = getAiBestPlan(game, playerId);
  if (!plan || plan.score <= AI_PASS_SCORE_FLOOR) return { game, played: false };
  return { game: plan.game, played: true, card: plan.card };
}

function chooseAiCycleCard(game, playerId) {
  const player = game.players[playerId];
  if (player.skill < 1 || player.hand.length === 0) return null;
  return player.hand
    .map((card) => {
      const plan = canPlayCard(game, playerId, card)
        ? getAiCardPlans(game, playerId, card).sort((a, b) => b.score - a.score)[0]
        : null;
      const deadWeightPenalty = card.cost > player.skill ? -25 - card.cost * 2 : 0;
      const dangerPenalty = (card.pollutionDelta ?? 0) >= 30 && player.pollution >= 55 ? -40 : 0;
      const keepComboBonus = ['killTarget', 'trueBodyStrike', 'healSelf', 'restoreSpirit', 'reduceSelfPollution'].includes(card.effect) ? 35 : 0;
      const boardCardBonus = ['character', 'scene', 'equipment', 'hidden'].includes(card.type) ? 18 : 0;
      return { card, score: (plan?.score ?? deadWeightPenalty + dangerPenalty) + keepComboBonus + boardCardBonus };
    })
    .sort((a, b) => a.score - b.score)[0]?.card ?? null;
}

function runAiTurn(game, playerId) {
  let state = game;
  let cycledThisPhase = false;
  for (let guard = 0; guard < 30; guard += 1) {
    const [currentPlayerId, step] = state.phase.split(':');
    if (currentPlayerId !== playerId) break;
    if (step === 'play') {
      const result = playAiCard(state, playerId);
      if (result.played) {
        state = result.game;
        continue;
      }
      if (!cycledThisPhase) {
        const cycleCard = chooseAiCycleCard(state, playerId);
        if (cycleCard) {
          state = discardThenDrawOne(state, playerId, cycleCard.instanceId);
          cycledThisPhase = true;
          continue;
        }
      }
      state = nextPhase(state);
      continue;
    }
    if (step === 'action') {
      const actor = getActionActorCard(state);
      if (!actor) {
        state = nextPhase(state);
        continue;
      }
      const target = chooseActionTarget(state, playerId, actor);
      if (!target) {
        state = advanceActionCursor(state, `${state.players[playerId].label}跳过了《${actor.name}》的行动。`);
        continue;
      }
      const nextState = resolveCharacterAction(state, playerId, actor.instanceId, target);
      if (nextState === state) {
        state = advanceActionCursor(state, `${state.players[playerId].label}无法完成《${actor.name}》的行动。`);
        continue;
      }
      state = nextState;
      continue;
    }
    break;
  }
  return state;
}

function runAiStep(game, playerId, { allowCycle = true } = {}) {
  const [currentPlayerId, step] = game.phase.split(':');
  if (currentPlayerId !== playerId) return { game, playedCard: null, advanced: false, cycled: false };

  if (step === 'play') {
    const result = playAiCard(game, playerId);
    if (result.played) return { game: result.game, playedCard: result.card, advanced: false, cycled: false };
    if (allowCycle) {
      const cycleCard = chooseAiCycleCard(game, playerId);
      if (cycleCard) {
        return {
          game: discardThenDrawOne(game, playerId, cycleCard.instanceId),
          playedCard: null,
          advanced: false,
          cycled: true,
        };
      }
    }
    return { game: nextPhase(game), playedCard: null, advanced: true, cycled: false };
  }

  if (step === 'action') {
    const actor = getActionActorCard(game);
    if (!actor) return { game: nextPhase(game), playedCard: null, advanced: true, cycled: false };
    const target = chooseActionTarget(game, playerId, actor);
    if (!target) {
      return {
        game: advanceActionCursor(game, `${game.players[playerId].label}跳过了《${actor.name}》的行动。`),
        playedCard: null,
        advanced: false,
        cycled: false,
      };
    }
    const nextState = resolveCharacterAction(game, playerId, actor.instanceId, target);
    if (nextState === game) {
      return {
        game: advanceActionCursor(game, `${game.players[playerId].label}无法完成《${actor.name}》的行动。`),
        playedCard: null,
        advanced: false,
        cycled: false,
      };
    }
    return { game: nextState, playedCard: null, advanced: false, cycled: false };
  }

  return { game, playedCard: null, advanced: false, cycled: false };
}

function phaseLabel(game) {
  const [playerId, step] = game.phase.split(':');
  const name = game.players[playerId].label;
  const stepName = {
    play: '出牌',
    action: '角色行动',
  }[step];
  return `${name} · ${stepName}`;
}

function nextPhase(game) {
  const turnOrder = getTurnOrder(game);
  const order = isFourPlayerMode(game.mode)
    ? turnOrder.flatMap((playerId) => [`${playerId}:play`, `${playerId}:action`])
    : [
        `${game.first}:play`,
        `${opponentOf(game.first)}:play`,
        `${opponentOf(game.first)}:action`,
        `${game.first}:action`,
      ];
  const index = order.indexOf(game.phase);
  const phaseEndPlayers = structuredClone(game.players);
  const phaseEndLogs = runSmallPhaseEndHiddenTriggers(phaseEndPlayers);
  if (index < order.length - 1) {
    const nextPhaseName = order[index + 1];
    const nextPlayerId = nextPhaseName.split(':')[0];
    const rewindLogs = [];
    if (nextPhaseName === `${nextPlayerId}:play` && (phaseEndPlayers[nextPlayerId].rewindUntilTurn ?? Infinity) <= game.turn) {
      restoreRewindSnapshot(phaseEndPlayers[nextPlayerId], rewindLogs);
    }
    const actionState = nextPhaseName.endsWith(':action')
      ? { playerId: nextPlayerId, queue: buildActionQueue(phaseEndPlayers[nextPlayerId]), cursor: 0 }
      : null;
    return {
      ...game,
      players: phaseEndPlayers,
      phase: nextPhaseName,
      inspected: null,
      actionState,
      log: [...phaseEndLogs, ...rewindLogs, ...game.log],
    };
  }

  const players = phaseEndPlayers;
  const spiritLogs = [];
  const rewindLogs = [];
  Object.values(players).forEach((player) => {
    if ((player.rewindUntilTurn ?? Infinity) <= game.turn + 1) restoreRewindSnapshot(player, rewindLogs);
  });
  const roundEndLogs = runRoundEndEffects(players, game.turn);
  Object.values(players).forEach((player) => {
    addSkill(player, 3);
    const woodTreeSkill = allBoardCharacters(player).filter((card) => card.id === 'hidden_wood_tree').length;
    if (woodTreeSkill > 0) addSkill(player, woodTreeSkill);
    if (hasEquipment(player, 'scene_great_invasion')) player.hp = clampHp(player.hp - 1);
    if (player.hidden.some((card) => card.id === 'hidden_purifier') && player.pollution >= 40) applyPollutionChange(player, -5);
    player.freeSkillUsed = false;
    player.freeCardUsed = false;
    player.damageReducedThisRound = false;
    player.boostedThisRound = false;
    player.pollutionImmuneThisRound = false;
    player.cannotPlayThisRound = false;
    player.physicalImmuneThisRound = false;
    spiritLogs.push(...applyEndTurnSpiritFatigue(player));
  });
  const carriageLogs = applyAbandonedCarriage(players, game.turn + 1);
  const darknessLogs = applyDarknessStartTurn(players);
  const roundStartLogs = runRoundStartEffects(players);
  const deck = game.deck ? [...game.deck] : null;
  const refillLogs = drawRoundCards(players, deck);
  return {
    ...game,
    players,
    ...(deck ? { deck } : {}),
    turn: game.turn + 1,
    phase: isFourPlayerMode(game.mode) ? `${turnOrder[0]}:play` : `${game.first}:play`,
    first: isFourPlayerMode(game.mode) ? turnOrder[0] : game.first,
    inspected: null,
    actionState: null,
    log: [
      ...phaseEndLogs,
      ...rewindLogs,
      ...roundEndLogs,
      ...carriageLogs,
      ...darknessLogs,
      ...roundStartLogs,
      ...spiritLogs,
      ...refillLogs,
      `第${game.turn}回合结束，双方手牌调整到5张。`,
      `第${game.turn + 1}回合开始，双方获得3点技能点。`,
      ...game.log,
    ],
  };
}

function recycleSharedDeck(sharedDeck, players) {
  if (!sharedDeck || sharedDeck.length > 0) return 0;
  const recycled = [];
  Object.values(players).forEach((player) => {
    recycled.push(...player.discard);
    player.discard = [];
  });
  sharedDeck.push(...shuffle(recycled));
  return recycled.length;
}

function drawFromSharedDeck(player, count, sharedDeck, players) {
  let drawn = 0;
  const drawLimit = Math.max(0, Math.min(count, HAND_LIMIT - player.hand.length));
  recycleSharedDeck(sharedDeck, players);
  const availableThisDraw = sharedDeck.length;
  while (drawn < drawLimit) {
    if (drawn >= availableThisDraw || sharedDeck.length === 0) break;
    player.hand.push(sharedDeck.shift());
    drawn += 1;
  }
  return drawn;
}

function drawRoundCards(players, sharedDeck = null) {
  const logs = [];
  Object.values(players).forEach((player) => {
    if (sharedDeck) {
      const drawLimit = Math.max(0, Math.min(TURN_DRAW_COUNT, HAND_LIMIT - player.hand.length));
      const recycled = sharedDeck.length === 0 ? recycleSharedDeck(sharedDeck, players) : 0;
      const drawn = drawFromSharedDeck(player, TURN_DRAW_COUNT, sharedDeck, players);
      if (recycled > 0) logs.push(`公共牌库摸空，将${recycled}张弃牌洗回牌库。`);
      if (drawn > 0) logs.push(`${player.label}补摸${drawn}张牌。`);
      if (drawLimit === 0) logs.push(`${player.label}手牌已满，不能继续摸牌。`);
      if (drawn === 0 && drawLimit > 0) logs.push(`${player.label}没有摸到牌。`);
      return;
    }
    let drawn = 0;
    let recycled = 0;
    const drawLimit = Math.max(0, Math.min(TURN_DRAW_COUNT, HAND_LIMIT - player.hand.length));
    if (player.deck.length === 0 && player.discard.length > 0) {
      player.deck = shuffle(player.discard);
      recycled = player.deck.length;
      player.discard = [];
    }
    const availableThisDraw = player.deck.length;
    while (drawn < drawLimit) {
      if (drawn >= availableThisDraw || player.deck.length === 0) break;
      player.hand.push(player.deck.shift());
      drawn += 1;
    }
    if (recycled > 0) logs.push(`${player.label}牌库摸空，将${recycled}张弃牌洗回牌库。`);
    if (drawn > 0) logs.push(`${player.label}补摸${drawn}张牌。`);
    if (drawLimit === 0) logs.push(`${player.label}手牌已满，不能继续摸牌。`);
    if (drawn === 0 && drawLimit > 0) logs.push(`${player.label}没有摸到牌。`);
  });
  return logs;
}

function enforceHandLimit(player) {
  const discarded = [];
  while (player.hand.length > HAND_LIMIT) {
    discarded.push(player.hand.shift());
  }
  player.discard.push(...discarded);
  return discarded;
}

function drawCards(player, count, sharedDeck = null, players = null) {
  if (sharedDeck) return drawFromSharedDeck(player, count, sharedDeck, players);
  let drawn = 0;
  const drawLimit = Math.max(0, Math.min(count, HAND_LIMIT - player.hand.length));
  if (player.deck.length === 0 && player.discard.length > 0) {
    player.deck = shuffle(player.discard);
    player.discard = [];
  }
  const availableThisDraw = player.deck.length;
  while (drawn < drawLimit) {
    if (drawn >= availableThisDraw || player.deck.length === 0) break;
    player.hand.push(player.deck.shift());
    drawn += 1;
  }
  return drawn;
}

function healPlayer(player, amount) {
  player.hp = Math.min(player.maxHp ?? PLAYER_BASE_HP, Math.max(0, player.hp + amount));
}

function reduceMaxHp(player, amount) {
  player.maxHp = Math.max(MIN_MAX_HP, (player.maxHp ?? PLAYER_BASE_HP) - amount);
  player.hp = Math.min(player.hp, player.maxHp);
}

function reduceMaxSpirit(player, amount) {
  player.maxSpirit = Math.max(MIN_MAX_SPIRIT, (player.maxSpirit ?? PLAYER_BASE_SPIRIT) - amount);
  player.spirit = Math.min(player.spirit ?? player.maxSpirit, player.maxSpirit);
}

function applySpiritChange(player, delta) {
  const logs = [];
  player.maxSpirit = player.maxSpirit ?? PLAYER_BASE_SPIRIT;
  player.spirit = (player.spirit ?? player.maxSpirit) + delta;
  if (player.spirit <= 0) {
    player.spirit = 0;
    logs.push(`${player.label}\u7cbe\u795e\u529b\u5f52\u96f6\uff0c\u5c06\u5728\u56de\u5408\u672b\u53d7\u5230\u67af\u7aed\u7ed3\u7b97\u3002`);
  } else {
    player.spirit = Math.min(player.spirit, player.maxSpirit);
  }
  return logs;
}

function applyPollutionChange(player, delta) {
  const logs = [];
  if (delta > 0) {
    const blessingIndex = player.hidden?.findIndex((card) => card.id === 'skill_ancestral_blessing') ?? -1;
    if (blessingIndex >= 0) {
      const [blessing] = player.hidden.splice(blessingIndex, 1);
      player.discard.push(blessing);
      player.pollutionImmuneThisRound = true;
      player.cannotPlayThisRound = true;
      logs.push(`${player.label}的《祖上的庇护》触发，本回合不受污染且不可出牌。`);
      return logs;
    }
  }
  if (delta > 0 && (player.pollutionImmuneThisRound || hasEquipment(player, 'scene_ancestral_hall'))) {
    logs.push(`${player.label}\u53d7\u5230\u5e87\u62a4\uff0c\u672c\u6b21\u6c61\u67d3\u65e0\u6548\u3002`);
    return logs;
  }
  player.pollution += delta;
  if (player.pollution < 0) player.pollution = 0;
  if (!player.maxPollution) player.maxPollution = INITIAL_POLLUTION_LIMIT;
  while (player.pollution >= player.maxPollution) {
    const burstLimit = player.maxPollution;
    player.pollution -= burstLimit;
    player.pollutionBursts += 1;
    reduceMaxHp(player, MAX_STAT_LOSS);
    reduceMaxSpirit(player, MAX_STAT_LOSS);
    logs.push(`${player.label}\u6c61\u67d3\u7206\u53d1\uff0c\u751f\u547d\u4e0a\u9650-${MAX_STAT_LOSS}\uff0c\u7cbe\u795e\u529b\u4e0a\u9650-${MAX_STAT_LOSS}\u3002`);
  }
  return logs;
}

function runRoundStartEffects(players) {
  const logs = [];
  Object.entries(players).forEach(([ownerId, owner]) => {
    const enemy = players[opponentOf(ownerId)];
    if (hasEquipment(owner, 'scene_signal_tower')) {
      Object.values(players).forEach((player) => {
        logs.push(...applyBodySpiritDamage(player, 2));
      });
      logs.push('信号塔触发，双方本体-2精神力。');
    }
    if (hasEquipment(owner, 'scene_vending_machine')) {
      logs.push(...applyPollutionChange(owner, 10));
      addSkill(owner, 1);
      logs.push(...applyPollutionChange(enemy, 15));
      addSkill(enemy, 1);
      logs.push(`${owner.label}的贩卖机触发：己方+10污染+1技能点，对方+15污染+1技能点。`);
    }
    if (hasEquipment(owner, 'scene_darkness')) {
      Object.values(players).forEach((player) => {
        logs.push(...applyBodySpiritDamage(player, 5));
        logs.push(...applyPollutionChange(player, 10));
      });
      enemy.hp = clampHp(enemy.hp - 5);
      logs.push(...applyPollutionChange(enemy, 5));
      logs.push(`${owner.label}的黑暗！触发：全员+5精神力+10污染，${enemy.label}额外-5血+5污染。`);
    }
  });
  return logs;
}

function runRoundEndEffects(players, currentTurn = null) {
  const logs = [];
  Object.values(players).forEach((player) => {
    if (hasEquipment(player, 'scene_banquet')) {
      allBoardCharacters(player).forEach((character) => changeCharacterHp(character, 1));
      healPlayer(player, 4);
      logs.push(`${player.label}的宴席触发：己方角色+1血，本体+4血。`);
    }

    const mountain = [...(player.scenes ?? []), ...player.hidden].find((card) => card.id === 'scene_mountain');
    const mountainAlreadyTriggered = currentTurn != null && mountain?.lastTriggeredTurn === currentTurn;
    if (mountain && !mountainAlreadyTriggered && (mountain.triggerCount ?? 0) < (mountain.maxTriggers ?? 3)) {
      allBoardCharacters(player).forEach((character) => {
        changeCharacterHp(character, 1);
        changeCharacterSpirit(character, 1);
      });
      healPlayer(player, 3);
      logs.push(...applyBodySpiritHeal(player, 3));
      logs.push(...applyPollutionChange(player, -4));
      mountain.triggerCount = (mountain.triggerCount ?? 0) + 1;
      if (currentTurn != null) mountain.lastTriggeredTurn = currentTurn;
      logs.push(`${player.label}的宀触发：己方角色+1血+1精神力，本体+3血+3精神力，污染-4。（${mountain.triggerCount}/${mountain.maxTriggers ?? 3}）`);
    }

    allBoardCharacters(player).forEach((character) => {
      if (character.selfHpLossPerTurn) {
        changeCharacterHp(character, -character.selfHpLossPerTurn);
        logs.push(`${player.label}的《${character.name}》回合末-${character.selfHpLossPerTurn}血。`);
      }
    });
  });
  Object.keys(players).forEach((playerId) => cleanupDefeatedCharacters(players, playerId, logs));
  applyRewindIfDefeated(players, logs);
  return logs;
}
function runSmallPhaseEndHiddenTriggers(players) {
  const logs = [];
  Object.entries(players).forEach(([ownerId, owner]) => {
    const enemy = players[opponentOf(ownerId)];
    [...owner.hidden].forEach((card) => {
      if (card.id === 'hidden_first_aid' && owner.hp < 20) {
        healPlayer(owner, 25);
        discardHiddenCard(owner, card);
        logs.push(`${owner.label}的暗置《${card.name}》触发，本体+25血，技能牌消耗。`);
      }
      if (card.id === 'hidden_purifier' && owner.pollution >= 40) {
        logs.push(...applyPollutionChange(owner, -5));
        logs.push(`${owner.label}的暗置《${card.name}》触发，污染-5。`);
      }
      if (card.id === 'hidden_fall' && ((enemy.pollutionBursts ?? 0) === 0 || (enemy.spirit ?? 0) <= 60)) {
        if (!owner.pendingFallChoice) {
          owner.pendingFallChoice = {
            cardInstanceId: card.instanceId,
            enemyId: opponentOf(ownerId),
          };
          logs.push(`${owner.label}的暗置《${card.name}》触发，请选择扣敌方血量或精神力。`);
        }
      }
      if (card.id === 'hidden_blood_test') {
        Object.values(players).forEach((player) => {
          allBoardCharacters(player).forEach((character) => applyCharacterSpiritDamage(character, 5));
        });
        logs.push(...applyBodySpiritDamage(enemy, 15));
        enemy.hp = clampHp(enemy.hp - 5 * (enemy.pollutionBursts ?? 0));
        if ((enemy.spirit ?? 0) < 40) logs.push(...applyBodySpiritDamage(enemy, 5));
        discardHiddenCard(owner, card);
        logs.push(`${owner.label}的暗置《${card.name}》触发并消失。`);
      }
    });
  });
  Object.keys(players).forEach((playerId) => cleanupDefeatedCharacters(players, playerId, logs));
  applyRewindIfDefeated(players, logs);
  return logs;
}

function applyEndTurnSpiritFatigue(player) {
  if ((player.spirit ?? PLAYER_BASE_SPIRIT) > 0) return [];
  player.hp = clampHp(player.hp - 30);
  return [
    `${player.label}精神力枯竭，回合末-30生命，+40污染。`,
    ...applyPollutionChange(player, 40),
  ];
}

function totalPollutionBursts(players) {
  return Object.values(players).reduce((sum, player) => sum + (player.pollutionBursts ?? 0), 0);
}

function hasEquipment(player, id) {
  return [
    ...player.equipment,
    ...(player.scenes ?? []),
    ...player.hidden,
  ].some((card) => card.id === id);
}

function isGearCard(card) {
  return Boolean(card.gear)
    || card.tags?.includes('齿轮')
    || [
      'skill_transfer',
      'skill_memory_inspect',
      'char_gun',
      'char_protector',
      'hidden_abandoned_carriage',
      'scene_control_console',
      'hidden_purifier',
      'scene_vending_machine',
      'hidden_travelers_blood',
    ].includes(card.id);
}

function boardCards(player) {
  return [
    ...player.characters,
    ...player.equipment,
    ...(player.scenes ?? []),
    ...player.hidden,
  ];
}

function allBoardCharacters(player) {
  return [
    ...player.characters,
    ...player.hidden.filter((card) => boardZoneOf(card) === 'characters'),
  ];
}

function hasCharacterAction(card) {
  return Boolean(
    card.actionDamage
    || card.actionBodyDamage
    || card.actionCharacterDamage
    || card.actionShield
    || card.actionPolluteEnemy
    || card.actionSelfPolluteForSkill
    || card.actionSpiritDamage
    || card.actionEffect
  );
}

function hasFriendlyMtf(player) {
  return allBoardCharacters(player).some((card) => card.id === 'char_mtf_agent');
}

function effectivePollutionDelta(player, card) {
  const delta = card.pollutionDelta ?? 0;
  if (delta <= 0) return delta;
  const reduction = hasFriendlyMtf(player) ? 5 : 0;
  return Math.max(0, delta - reduction);
}

function changeCharacterHp(character, amount) {
  if (character.currentHp == null) return;
  const maxHp = character.hp ?? character.currentHp;
  character.currentHp = Math.max(0, Math.min(maxHp, character.currentHp + amount));
}

function changeCharacterSpirit(character, amount) {
  if (character.spirit == null || character.noSpirit) return;
  if (amount > 0 && character.noSpiritGain) return;
  const maxSpirit = character.maxSpirit ?? character.spirit;
  character.spirit = Math.max(0, Math.min(maxSpirit, character.spirit + amount));
}

function applyBodySpiritDamage(player, amount) {
  const logs = applySpiritChange(player, -amount);
  return logs;
}

function applyBodySpiritHeal(player, amount) {
  return applySpiritChange(player, amount);
}

function chooseWordlessBookOption(player) {
  if (player.pollution >= 60) return 'resetPollution';
  if (player.hp <= Math.max(35, (player.maxHp ?? PLAYER_BASE_HP) * 0.45)) return 'heal';
  if ((player.spirit ?? 0) <= Math.max(35, (player.maxSpirit ?? PLAYER_BASE_SPIRIT) * 0.45)) return 'spirit';
  return 'resetPollution';
}

function applyWordlessBookEffect(player, option, logs = []) {
  reduceMaxHp(player, 5);
  if (option === 'resetPollution') {
    player.pollution = 0;
    logs.push(`${player.label}选择《无字天书》：污染重置到0，生命上限-5。`);
    return logs;
  }
  if (option === 'heal') {
    healPlayer(player, 50);
    logs.push(`${player.label}选择《无字天书》：本体+50血，生命上限-5。`);
    return logs;
  }
  logs.push(...applyBodySpiritHeal(player, 40));
    logs.push(`${player.label}选择《无字天书》：本体+40精神力，生命上限-5。`);
  return logs;
}

function applyCharacterSpiritDamage(character, amount) {
  changeCharacterSpirit(character, -amount);
}

function discardHiddenCard(player, card) {
  const index = player.hidden.findIndex((item) => item.instanceId === card.instanceId);
  if (index < 0) return false;
  const [removed] = player.hidden.splice(index, 1);
  player.discard.push(removed);
  return true;
}

function removeFirstScene(player, includeHidden = false) {
  if (player.scenes.length > 0) {
    const [removed] = player.scenes.splice(0, 1);
    player.discard.push(removed);
    return removed;
  }
  if (includeHidden) {
    const index = player.hidden.findIndex((card) => boardZoneOf(card) === 'scenes');
    if (index >= 0) {
      const [removed] = player.hidden.splice(index, 1);
      player.discard.push(removed);
      return removed;
    }
  }
  return null;
}

function restoreRewindSnapshot(player, logs = []) {
  if (!player.rewindSnapshot) return false;
  const snapshot = structuredClone(player.rewindSnapshot);
  Object.assign(player, snapshot);
  delete player.rewindSnapshot;
  delete player.rewindUntilTurn;
    logs.push(`${player.label}的回朔之钟触发，恢复到记录时的数据。`);
  return true;
}

function applyRewindIfDefeated(players, logs = []) {
  Object.values(players).forEach((player) => {
    if (player.hp <= 0 && player.rewindSnapshot) restoreRewindSnapshot(player, logs);
  });
}

function triggerMetalCabinetIfAttack(defender, card, logs = []) {
  const attackEffects = new Set(['killTarget', 'damageEnemy', 'trueBodyStrike', 'abyssGaze', 'ziyou', 'motherLove', 'teleport', 'selfDestruct']);
  if (!attackEffects.has(card.effect)) return false;
  const index = defender.hidden.findIndex((hidden) => hidden.id === 'skill_metal_cabinet');
  if (index < 0) return false;
  const [metalCabinet] = defender.hidden.splice(index, 1);
  defender.discard.push(metalCabinet);
  defender.physicalImmuneThisRound = true;
    logs.push(`${defender.label}的《金属柜》触发，本回合不受物伤。`);
  return true;
}

function bodyPhysicalReduction(player) {
  let reduction = 0;
  if (hasEquipment(player, 'equip_blast_shield')) reduction = Math.max(reduction, 0.5);
  if (player.characters.some((card) => card.id === 'char_police')) reduction = Math.max(reduction, 0.1);
  return reduction;
}

function characterPhysicalReduction(owner, character) {
  let reduction = character.selfPhysicalReduction ?? 0;
  if (hasEquipment(owner, 'equip_blast_shield')) reduction = Math.max(reduction, 0.2);
  return reduction;
}

function applyBodyDamage(player, amount, type = 'physical') {
  if (type === 'physical' && player.physicalImmuneThisRound) return 0;
  let damage = amount;
  if (type === 'physical' || type === 'characterPhysical') damage = Math.round(damage * (1 - bodyPhysicalReduction(player)));
  if (hasFriendlyMtf(player) && type !== 'true') damage = Math.max(0, damage - 1);
  player.hp = clampHp(player.hp - damage);
  return damage;
}

function applyCharacterDamage(players, ownerId, character, amount, type = 'physical') {
  const owner = players[ownerId];
  if ((type === 'physical' || type === 'characterPhysical') && owner.physicalImmuneThisRound) {
    return { damage: 0, shieldNote: '金属柜生效，本次物伤无效。' };
  }
  if (type === 'characterPhysical' && character.immuneCharacterDamage) {
    return { damage: 0, shieldNote: '该角色免疫角色造成的伤害。' };
  }
  let damage = amount;
  if (type === 'physical' || type === 'characterPhysical') damage = Math.round(damage * (1 - characterPhysicalReduction(owner, character)));
  if (hasFriendlyMtf(owner) && type !== 'true') damage = Math.max(0, damage - 1);
  let shieldNote = '';
  if (type !== 'true' && (character.shield ?? 0) > 0 && owner.pollution < 60) {
    character.shield -= 1;
    damage = Math.max(0, damage - 5);
    shieldNote = '护盾生效，伤害-5。';
  } else if (type !== 'true' && (character.shield ?? 0) > 0 && owner.pollution >= 60) {
    shieldNote = '污染过高，护盾无效。';
  }
  if (character.currentHp != null) character.currentHp = clampHp(character.currentHp - damage);
  return { damage, shieldNote };
}

function cleanupDefeatedCharacters(players, ownerId, logs = []) {
  const owner = players[ownerId];
  const enemy = players[opponentOf(ownerId)];
  let mindTransferConsumed = false;
  const transferredCharacters = [];
  const isAliveCharacter = (character) => (
    (character.currentHp == null || character.currentHp > 0)
    && (character.spirit == null || character.spirit > 0)
  );
  const triggerMindTransfer = () => {
    if (mindTransferConsumed) return false;
    const mindTransferIndex = owner.hidden.findIndex((card) => card.id === 'hidden_mind_transfer');
    if (mindTransferIndex < 0) return false;
    const livingCharacterCount = owner.characters.filter(isAliveCharacter).length
      + owner.hidden.filter((card) => boardZoneOf(card) === 'characters' && isAliveCharacter(card)).length
      + transferredCharacters.length;
    if (livingCharacterCount >= 3) return false;
    const target = enemy.characters.shift();
    if (!target) return false;
    const [mindTransfer] = owner.hidden.splice(mindTransferIndex, 1);
    owner.discard.push(mindTransfer);
    mindTransferConsumed = true;
    transferredCharacters.push({ ...target, currentHp: target.currentHp ?? target.hp ?? 10 });
    logs.push(`《意识转移》触发，${owner.label}夺舍了${enemy.label}的《${target.name}》。`);
    return true;
  };
  const triggerTravelersBlood = () => {
    const index = owner.hidden.findIndex((card) => card.id === 'hidden_travelers_blood');
    if (index < 0) return false;
    const [blood] = owner.hidden.splice(index, 1);
    owner.discard.push(blood);
    Object.values(players).forEach((player) => {
      player.hp = clampHp(player.hp - 5);
      applyBodySpiritDamage(player, 5);
      allBoardCharacters(player).forEach((character) => {
        changeCharacterHp(character, -5);
        applyCharacterSpiritDamage(character, 5);
      });
    });
    logs.push(`${owner.label}的《旅人的鲜血》触发，全员-5血-5精神力。`);
    return true;
  };
  owner.characters = owner.characters.filter((character) => {
    if ((character.currentHp == null || character.currentHp > 0) && (character.spirit == null || character.spirit > 0)) return true;
    owner.discard.push(character);
    triggerTravelersBlood();
    triggerMindTransfer();
    if (hasEquipment(owner, 'scene_corpse_land')) {
      healPlayer(owner, 5);
      logs.push(`${owner.label}的《食尸地》触发，本体+5血。`);
    }
    logs.push(`${owner.label}的《${character.name}》死亡。`);
    return false;
  });

  owner.hidden = owner.hidden.filter((card) => {
    if (mindTransferConsumed && card.id === 'hidden_mind_transfer') return false;
    if (boardZoneOf(card) !== 'characters' || ((card.currentHp == null || card.currentHp > 0) && (card.spirit == null || card.spirit > 0))) return true;
    if (card.id === 'hidden_wood_tree') {
      enemy.characters.push(makeCharacterState({ ...card, type: 'character', subType: undefined }));
      logs.push(`《木树》死亡，变为${enemy.label}的角色。`);
    } else {
      owner.discard.push(card);
      logs.push(`${owner.label}的暗置角色《${card.name}》死亡。`);
    }
    triggerTravelersBlood();
    triggerMindTransfer();
    if (hasEquipment(owner, 'scene_corpse_land')) {
      healPlayer(owner, 5);
      logs.push(`${owner.label}的《食尸地》触发，本体+5血。`);
    }
    return false;
  });
  owner.characters.push(...transferredCharacters);
}

function applyDarknessStartTurn(players) {
  const logs = [];
  Object.values(players).forEach((owner) => {
    const darknessCount = owner.characters.filter((card) => card.id === 'char_darkness').length;
    if (darknessCount === 0) return;
    Object.values(players).forEach((player) => {
      logs.push(...applyPollutionChange(player, 10 * darknessCount));
    });
    const enemy = players[opponentOf(owner.id)];
    enemy.hp = clampHp(enemy.hp - 5 * darknessCount);
    logs.push(...applyPollutionChange(enemy, 5 * darknessCount));
    logs.push(`《黑暗！》触发：全员污染上升，敌方本体受损。`);
  });
  return logs;
}

function applyAbandonedCarriage(players, currentTurn) {
  const logs = [];
  Object.values(players).forEach((owner) => {
    const enemy = players[opponentOf(owner.id)];
    owner.hidden.forEach((card) => {
      if (card.id !== 'hidden_abandoned_carriage') return;
      if (card.playedTurn == null || currentTurn - card.playedTurn < 2 || card.triggered) return;
      card.triggered = true;
      enemy.hp = clampHp(enemy.hp - 35);
      Object.values(players).forEach((player) => {
        player.characters.forEach((character) => {
          if (character.currentHp != null) character.currentHp = clampHp(character.currentHp - 4);
        });
        player.hidden.forEach((hidden) => {
          if (boardZoneOf(hidden) === 'characters' && hidden.currentHp != null) hidden.currentHp = clampHp(hidden.currentHp - 4);
        });
      });
      logs.push(`《抛弃丰厢》触发：敌方本体-35，所有生物-4。`);
    });
  });
  Object.values(players).forEach((player) => cleanupDefeatedCharacters(players, player.id, logs));
  return logs;
}

function buildActionQueue(player) {
  return [
    ...player.characters,
    ...player.hidden.filter((card) => boardZoneOf(card) === 'characters'),
  ].filter(hasCharacterAction)
    .flatMap((card) => Array.from({ length: card.actionCount ?? 1 }, () => card.instanceId));
}

function discardThenDrawOne(game, playerId, discardedCardId) {
  const players = structuredClone(game.players);
  const deck = game.deck ? [...game.deck] : null;
  const player = players[playerId];
  const cardIndex = player.hand.findIndex((card) => card.instanceId === discardedCardId);
  if (cardIndex < 0) return game;
  if (player.skill < 1) return { ...game, log: ['技能点不足，无法进行换牌。', ...game.log] };

  player.skill -= 1;
  const [removed] = player.hand.splice(cardIndex, 1);
  player.discard.push(removed);

  drawCards(player, 1, deck, players);

  return {
    ...game,
    players,
    ...(deck ? { deck } : {}),
    log: [`${player.label}花费1点技能点弃置《${removed.name}》，并摸1张牌。`, ...game.log],
  };
}

function getActionActorCard(game) {
  if (!game.actionState) return null;
  const { playerId, queue, cursor } = game.actionState;
  const actorId = queue[cursor];
  if (!actorId) return null;
  const player = game.players[playerId];
  return [
    ...player.characters,
    ...player.hidden.filter((card) => boardZoneOf(card) === 'characters'),
  ].find((card) => card.instanceId === actorId) ?? null;
}

function resolveCharacterAction(game, playerId, actorId, target) {
  const players = structuredClone(game.players);
  const player = players[playerId];
  const enemyId = target.enemyId ?? getPrimaryEnemyId(game, playerId);
  const enemy = players[enemyId];
  const actor = [
    ...player.characters,
    ...player.hidden.filter((card) => boardZoneOf(card) === 'characters'),
  ].find((card) => card.instanceId === actorId);

  if (!actor) return game;

  const nextGame = { ...game, players };
  let message = `${player.label}的《${actor.name}》行动。`;

  if (target.type === 'shieldSelf') {
    actor.shield = (actor.shield ?? 0) + (actor.actionShield ?? 1);
    const actionState = game.actionState ? { ...game.actionState, cursor: game.actionState.cursor + 1 } : null;
    return { ...nextGame, actionState, log: [`${player.label}的《${actor.name}》获得${actor.actionShield ?? 1}点护盾。`, ...game.log] };
  }

  if (target.type === 'polluteEnemy') {
    const pollutionLogs = applyPollutionChange(enemy, actor.actionPolluteEnemy ?? 0);
    const actionState = game.actionState ? { ...game.actionState, cursor: game.actionState.cursor + 1 } : null;
    return { ...nextGame, actionState, log: [...pollutionLogs, `${player.label}的《${actor.name}》使${enemy.label}+${actor.actionPolluteEnemy ?? 0}污染。`, ...game.log] };
  }

  if (target.type === 'selfPolluteSkill') {
    const pollutionLogs = applyPollutionChange(player, actor.actionSelfPolluteForSkill ?? 20);
    addSkill(player, 1);
    const actionState = game.actionState ? { ...game.actionState, cursor: game.actionState.cursor + 1 } : null;
    return { ...nextGame, actionState, log: [...pollutionLogs, `${player.label}的《${actor.name}》使自身+${actor.actionSelfPolluteForSkill ?? 20}污染，并获得1点技能点。`, ...game.log] };
  }

  if (target.type === 'spiritEnemy') {
    const spiritLogs = applyBodySpiritDamage(enemy, actor.actionSpiritDamage ?? 0);
    const actionState = game.actionState ? { ...game.actionState, cursor: game.actionState.cursor + 1 } : null;
    return { ...nextGame, actionState, log: [...spiritLogs, `${player.label}的《${actor.name}》使${enemy.label}-${actor.actionSpiritDamage ?? 0}精神力。`, ...game.log] };
  }

  if (target.type === 'characterSpirit') {
    const targetCard = enemy.characters.find((card) => card.instanceId === target.instanceId);
    if (!targetCard) return { ...game, log: ['目标已不存在。', ...game.log] };
    applyCharacterSpiritDamage(targetCard, actor.actionSpiritDamage ?? 0);
    const defeatLogs = [];
    cleanupDefeatedCharacters(players, enemyId, defeatLogs);
    const actionState = game.actionState ? { ...game.actionState, cursor: game.actionState.cursor + 1 } : null;
    return { ...nextGame, actionState, log: [`${player.label}的《${actor.name}》使${enemy.label}的《${targetCard.name}》-${actor.actionSpiritDamage ?? 0}精神力。`, ...defeatLogs, ...game.log] };
  }

  if (actor.actionSkillCost && player.skill < actor.actionSkillCost) return { ...game, log: [`技能点不足，无法发动《${actor.name}》的行动技能。`, ...game.log] };
  if (actor.actionSkillCost) player.skill -= actor.actionSkillCost;
  if (actor.actionSelfSpiritCost) changeCharacterSpirit(actor, -actor.actionSelfSpiritCost);

  if (actor.actionEffect === 'itAction') {
    const targetCard = enemy.characters[0];
    const logs = [];
    if (targetCard) {
      targetCard.currentHp = 0;
      logs.push(`${player.label}的《${actor.name}》使${enemy.label}的《${targetCard.name}》死亡。`);
      cleanupDefeatedCharacters(players, enemyId, logs);
    } else {
      reduceMaxHp(enemy, 10);
      logs.push(...applyPollutionChange(enemy, 20));
      logs.push(`${player.label}的《${actor.name}》未找到敌方角色，${enemy.label}-10生命上限并+20污染。`);
    }
    cleanupDefeatedCharacters(players, playerId, logs);
    const actionState = game.actionState ? { ...game.actionState, cursor: game.actionState.cursor + 1 } : null;
    return { ...nextGame, actionState, log: [...logs, ...game.log] };
  }

  const damageBonus = actor.damageBonusVsCharacters ?? 0;
  const invasionBonus = hasEquipment(player, 'scene_great_invasion') ? 1 : 0;
  const bodyDamage = (actor.actionBodyDamage ?? actor.actionDamage ?? actor.atk ?? 0) + invasionBonus;
  const characterDamageBase = (actor.actionCharacterDamage ?? actor.actionDamage ?? actor.atk ?? 0) + invasionBonus;
  const damageToCharacter = Math.max(0, Math.round(characterDamageBase * (1 + damageBonus)));

  if (target.type === 'body') {
    if (bodyDamage > 0) {
      const dealt = applyBodyDamage(enemy, bodyDamage, 'characterPhysical');
      message = `${player.label}的《${actor.name}》对${enemy.label}本体造成${dealt}点物伤。`;
    } else {
      message = `${player.label}的《${actor.name}》没有造成伤害。`;
    }
  } else {
    const targetCard = enemy.characters.find((card) => card.instanceId === target.instanceId);
    if (!targetCard) return { ...game, log: ['目标已不存在。', ...game.log] };
    if (targetCard.untargetableByAttack) return { ...game, log: [`《${targetCard.name}》无法被普通攻击命中。`, ...game.log] };
    const { damage: dealt, shieldNote } = applyCharacterDamage(players, enemyId, targetCard, damageToCharacter, 'characterPhysical');
    const defeatLogs = [];
    message = `${player.label}的《${actor.name}》对${enemy.label}的《${targetCard.name}》造成${dealt}点物伤。`;
    if (shieldNote) message += shieldNote;
    cleanupDefeatedCharacters(players, enemyId, defeatLogs);
    if (defeatLogs.length > 0) message += ` ${defeatLogs.join(' ')}`;
  }

  const actionState = game.actionState ? { ...game.actionState, cursor: game.actionState.cursor + 1 } : null;
  return { ...nextGame, actionState, log: [message, ...game.log] };
}
function applyDamage(players, targetId, amount, sourceId) {
  const target = players[targetId];
  const source = players[sourceId];
  let damage = amount;
  const armor = target.equipment.some((card) => card.id === 'e01');
  const hiddenShield = target.hidden.some((card) => card.hiddenKind === 'shield');
  if (!target.damageReducedThisRound && (armor || hiddenShield)) {
    damage = Math.max(0, damage - 1);
    target.damageReducedThisRound = true;
  }
  target.hp = Math.max(0, target.hp - damage);
  return `${source.label}对${target.label}造成${damage}点伤害。`;
}

function clampHp(value) {
  return Math.max(0, value);
}

function discardGearMarkedCards(player) {
  const zones = ['hand', 'characters', 'equipment', 'scenes', 'hidden'];
  const removed = [];
  zones.forEach((zone) => {
    const kept = [];
    player[zone].forEach((card) => {
      if (isGearCard(card)) {
        removed.push(card);
      } else {
        kept.push(card);
      }
    });
    player[zone] = kept;
  });
  player.discard.push(...removed);
  return removed.length;
}

function discardOneFromHand(player) {
  if (player.hand.length === 0) return null;
  const [removed] = player.hand.splice(0, 1);
  player.discard.push(removed);
  return removed;
}

function playWordlessBookCard(game, playerId, card, option) {
  const players = structuredClone(game.players);
  const player = players[playerId];
  const enemy = players[opponentOf(playerId)];
  const handIndex = player.hand.findIndex((item) => item.instanceId === card.instanceId);
  if (handIndex < 0) return game;

  const freeByRefrigeration = card.type === 'skill' && hasEquipment(player, 'scene_refrigeration') && !player.freeSkillUsed;
  const freeByConsole = hasEquipment(player, 'scene_control_console') && !player.freeCardUsed;
  const freePlay = freeByConsole || freeByRefrigeration;
  if (!freePlay && player.skill < card.cost) return { ...game, log: [`技能点不足，无法使用《${card.name}》。`, ...game.log] };
  if (!canPlayCard(game, playerId, card)) return game;

  const [used] = player.hand.splice(handIndex, 1);
  if (freePlay) {
    if (freeByConsole) player.freeCardUsed = true;
    else player.freeSkillUsed = true;
  } else {
    player.skill -= used.cost;
  }

  const logs = applyPollutionChange(player, effectivePollutionDelta(player, used));
  triggerMetalCabinetIfAttack(enemy, used, logs);
  applyWordlessBookEffect(player, option, logs);

  player.discard.push(used);
  applyRewindIfDefeated(players, logs);
  return {
    ...game,
    players,
    log: [...logs, `${player.label}使用《${used.name}》。`, ...game.log],
  };
}

function payAndRemoveHandCard(game, players, playerId, card) {
  const player = players[playerId];
  const enemy = players[opponentOf(playerId)];
  const handIndex = player.hand.findIndex((item) => item.instanceId === card.instanceId);
  if (handIndex < 0) return null;

  const freeByRefrigeration = card.type === 'skill' && hasEquipment(player, 'scene_refrigeration') && !player.freeSkillUsed;
  const freeByConsole = hasEquipment(player, 'scene_control_console') && !player.freeCardUsed;
  const freePlay = freeByConsole || freeByRefrigeration;
  if (!freePlay && player.skill < card.cost) return null;
  if (!canPlayCard(game, playerId, card)) return null;

  const [used] = player.hand.splice(handIndex, 1);
  if (freePlay) {
    if (freeByConsole) player.freeCardUsed = true;
    else player.freeSkillUsed = true;
  } else {
    player.skill -= used.cost;
  }
  const logs = applyPollutionChange(player, effectivePollutionDelta(player, used));
  triggerMetalCabinetIfAttack(enemy, used, logs);
  return { player, enemy, used, logs };
}

function removeFromListByInstance(list, instanceId) {
  const index = list.findIndex((item) => item.instanceId === instanceId);
  if (index < 0) return null;
  const [removed] = list.splice(index, 1);
  return removed;
}

function playSelectedEffectCard(game, playerId, card, selection) {
  const paid = payAndRemoveHandCard(game, structuredClone(game.players), playerId, card);
  if (!paid) return game;
  const { player, enemy, used, logs } = paid;
  const players = structuredClone(game.players);
  players[playerId] = player;
  players[opponentOf(playerId)] = enemy;
  let message = `${player.label}使用《${used.name}》。`;

  if (used.effect === 'removeEnemyHidden') {
    const removed = removeFromListByInstance(enemy.hidden, selection.instanceId);
    if (removed) enemy.discard.push(removed);
    message = removed ? `${player.label}使用《${used.name}》，移除了${enemy.label}的暗置牌。` : `${player.label}使用《${used.name}》，但目标暗置已不存在。`;
  }

  if (used.effect === 'destroyEnemyScene') {
    const removed = removeFromListByInstance(enemy.scenes, selection.instanceId);
    if (removed) enemy.discard.push(removed);
    message = removed ? `${player.label}使用《${used.name}》，摧毁了${enemy.label}的场景《${removed.name}》。` : `${player.label}使用《${used.name}》，但目标场景已不存在。`;
  }

  if (used.effect === 'memorySceneRemove') {
    const removed = removeFromListByInstance(enemy.scenes, selection.instanceId) || removeFromListByInstance(enemy.hidden, selection.instanceId);
    if (removed) enemy.discard.push(removed);
    logs.push(...applyBodySpiritDamage(enemy, 10));
    logs.push(...applyPollutionChange(enemy, 10));
    message = removed ? `${player.label}使用《${used.name}》，移除了${enemy.label}的《${removed.name}》。` : `${player.label}使用《${used.name}》，目标已不存在。`;
  }

  if (used.effect === 'feedingContract') {
    const removed = removeFromListByInstance(player.characters, selection.instanceId) || removeFromListByInstance(player.hidden, selection.instanceId);
    if (removed && !isGearCard(removed)) {
      player.discard.push(removed);
      healPlayer(player, 20);
      logs.push(...applyBodySpiritHeal(player, 8));
      addSkill(player, 1);
      message = `${player.label}使用《${used.name}》，移除己方《${removed.name}》，本体+20血+8精神力+1技能点。`;
    } else {
      message = `${player.label}使用《${used.name}》，但目标不能被投喂。`;
    }
  }

  if (used.effect === 'shieldCard') {
    const target = allBoardCharacters(player).find((item) => item.instanceId === selection.instanceId);
    if (target) {
      target.shield = (target.shield ?? 0) + 1;
      message = `${player.label}使用《${used.name}》，给《${target.name}》增加1点护盾。`;
    } else {
      message = `${player.label}使用《${used.name}》，但目标角色已不存在。`;
    }
  }

  player.discard.push(used);
  applyRewindIfDefeated(players, logs);
  return { ...game, players, log: [...logs, message, ...game.log] };
}

function playSelectedEnterCard(game, playerId, card, selection) {
  const players = structuredClone(game.players);
  const player = players[playerId];
  const enemyId = selection.enemyId ?? getPrimaryEnemyId(game, playerId);
  const enemy = players[enemyId];
  const handIndex = player.hand.findIndex((item) => item.instanceId === card.instanceId);
  if (handIndex < 0 || !enemy) return game;

  const freeByRefrigeration = card.type === 'skill' && hasEquipment(player, 'scene_refrigeration') && !player.freeSkillUsed;
  const freeByConsole = hasEquipment(player, 'scene_control_console') && !player.freeCardUsed;
  const freePlay = freeByConsole || freeByRefrigeration;
  if (!freePlay && player.skill < card.cost) return { ...game, log: [`技能点不足，无法使用《${card.name}》。`, ...game.log] };
  if (!canPlayCard(game, playerId, card)) return game;

  const [used] = player.hand.splice(handIndex, 1);
  if (freePlay) {
    if (freeByConsole) player.freeCardUsed = true;
    else player.freeSkillUsed = true;
  } else {
    player.skill -= used.cost;
  }

  const logs = applyPollutionChange(player, effectivePollutionDelta(player, used));
  triggerMetalCabinetIfAttack(enemy, used, logs);
  let message = `${player.label}使用《${used.name}》。`;

  if (used.type === 'character') {
    const played = makeCharacterState(used);
    player.characters.push(played);
  } else if (used.type === 'equipment') {
    player.equipment.push(used);
  } else if (used.type === 'scene') {
    player.scenes.push(used);
  }

  if (isHiddenLike(used)) {
    const hiddenCard = boardZoneOf(used) === 'characters'
      ? makeCharacterState(used)
      : { ...used, currentHp: used.hp, shield: used.shield ?? 0 };
    player.hidden.push({ ...hiddenCard, playedTurn: game.turn });
  }

  if (used.effect === 'itEnter') {
    const target = enemy.characters.find((item) => item.instanceId === selection.instanceId);
    if (target) {
      target.currentHp = 0;
      cleanupDefeatedCharacters(players, enemyId, logs);
      message = `${player.label}使用《${used.name}》，使${enemy.label}的《${target.name}》死亡。`;
    } else {
      message = `${player.label}使用《${used.name}》，但目标已不存在。`;
    }
  }

  if (used.effect === 'orcaEnter') {
    const target = enemy.characters.find((item) => item.instanceId === selection.instanceId);
    if (target) {
      target.shield = 0;
      message = `${player.label}使用《${used.name}》，使${enemy.label}的《${target.name}》护盾消失。`;
    } else {
      message = `${player.label}使用《${used.name}》，但目标已不存在。`;
    }
  }

  if (!['character', 'equipment', 'scene'].includes(used.type) && !isHiddenLike(used)) player.discard.push(used);
  applyRewindIfDefeated(players, logs);
  return { ...game, players, log: [...logs, message, ...game.log] };
}

function resolveFallChoice(game, ownerId, option) {
  const players = structuredClone(game.players);
  const owner = players[ownerId];
  const choice = owner?.pendingFallChoice;
  if (!owner || !choice) return game;
  const enemyId = choice.enemyId ?? getPrimaryEnemyId(game, ownerId);
  const enemy = players[enemyId];
  if (!enemy) return game;

  const logs = [];
  const card = owner.hidden.find((item) => item.instanceId === choice.cardInstanceId);
  if (option === 'spirit25') {
    logs.push(...applyBodySpiritDamage(enemy, 25));
    logs.push(`${owner.label}的暗置《${card?.name ?? '坠落'}》触发，${enemy.label}-25精神力。`);
  } else {
    const dealt = applyBodyDamage(enemy, 40, 'true');
    logs.push(`${owner.label}的暗置《${card?.name ?? '坠落'}》触发，${enemy.label}-${dealt}血。`);
  }
  if (card) discardHiddenCard(owner, card);
  delete owner.pendingFallChoice;
  applyRewindIfDefeated(players, logs);
  return { ...game, players, log: [...logs, ...game.log] };
}

function playCard(game, playerId, card) {
  const players = structuredClone(game.players);
  const deck = game.deck ? [...game.deck] : null;
  const player = players[playerId];
  const enemyId = opponentOf(playerId);
  const enemy = players[enemyId];
  const handIndex = player.hand.findIndex((item) => item.instanceId === card.instanceId);
  if (handIndex < 0) return game;
  const freeByRefrigeration = card.type === 'skill' && hasEquipment(player, 'scene_refrigeration') && !player.freeSkillUsed;
  const freeByConsole = hasEquipment(player, 'scene_control_console') && !player.freeCardUsed;
  const freePlay = freeByConsole || freeByRefrigeration;
  if (!freePlay && player.skill < card.cost) return { ...game, log: [`技能点不足，无法使用《${card.name}》。`, ...game.log] };

  if (!canPlayCard(game, playerId, card)) {
    return { ...game, log: [`当前不能使用《${card.name}》。`, ...game.log] };
  }

  const [used] = player.hand.splice(handIndex, 1);
  if (freePlay) {
    if (freeByConsole) player.freeCardUsed = true;
    else player.freeSkillUsed = true;
  } else {
    player.skill -= used.cost;
  }
  const pollutionLogs = applyPollutionChange(player, effectivePollutionDelta(player, used));
  let message = `${player.label}使用了《${used.name}》。`;
  triggerMetalCabinetIfAttack(enemy, used, pollutionLogs);

  if (used.type === 'character') {
    player.characters.push(makeCharacterState(used));
  }
  if (used.type === 'equipment') player.equipment.push(used);
  if (used.type === 'scene') player.scenes.push(used);
  const playedAsHidden = isHiddenLike(used);
  if (playedAsHidden) {
    const hiddenCard = boardZoneOf(used) === 'characters'
      ? makeCharacterState(used)
      : { ...used, currentHp: used.hp, shield: used.shield ?? 0 };
    player.hidden.push({ ...hiddenCard, playedTurn: game.turn });
    message = `${player.label}使用《${used.name}》。`;
  }
  if (used.effect === 'cleanedOne') {
    Object.values(players).forEach((item) => {
      allBoardCharacters(item).forEach((character) => {
        character.actionCount = 1;
        character.actionDamage = 5;
        character.actionSpiritDamage = 3;
        delete character.actionBodyDamage;
        delete character.actionCharacterDamage;
        delete character.actionPolluteEnemy;
        delete character.actionSkillCost;
        delete character.damageBonusVsCharacters;
        delete character.selfPhysicalReduction;
        delete character.bodyPhysicalReduction;
        delete character.immuneCharacterDamage;
      });
    });
    message = `${player.label}使用《${used.name}》。`;
  }
  if (used.effect === 'itEnter') {
    const target = enemy.characters[0];
    if (target) {
      target.currentHp = 0;
      cleanupDefeatedCharacters(players, enemyId, pollutionLogs);
      message = `${player.label}使用《${used.name}》，影响了《${target.name}》。`;
    } else {
      message = `${player.label}使用《${used.name}》。`;
    }
  }
  if (used.effect === 'orcaEnter') {
    const target = enemy.characters[0] ?? player.characters.find((character) => character.instanceId !== used.instanceId);
    if (target) {
      target.shield = 0;
      message = `${player.label}使用《${used.name}》，影响了《${target.name}》。`;
    }
  }
  if ((used.type === 'skill' || used.type === 'food') && !playedAsHidden) {
    if (used.effect === 'gainSkill') {
      addSkill(player, used.value);
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'healSelf') {
      healPlayer(player, used.value);
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'drawCards') {
      const drawn = drawCards(player, used.value, deck, players);
      message = `${player.label}使用《${used.name}》，抽${drawn}张牌。`;
    }
    if (used.effect === 'reduceSelfPollution') {
      pollutionLogs.push(...applyPollutionChange(player, -used.value));
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'ziyou') {
      enemy.hp = clampHp(enemy.hp - 10);
      pollutionLogs.push(...applyPollutionChange(enemy, 35));
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'motherLove') {
      if (enemy.hand.length <= 3) {
        enemy.hp = clampHp(enemy.hp - 10);
        pollutionLogs.push(...applyPollutionChange(enemy, 90));
        message = `${player.label}使用《${used.name}》。`;
      } else {
        message = `${player.label}使用《${used.name}》。`;
      }
    }
    if (used.effect === 'selfDestruct') {
      if (totalPollutionBursts(players) >= SELF_DESTRUCT_BURSTS) {
        enemy.hp = clampHp(enemy.hp - 15);
        pollutionLogs.push(...applyBodySpiritDamage(enemy, 5));
        enemy.characters.forEach((character) => {
          if (character.currentHp != null) character.currentHp = clampHp(character.currentHp - 15);
          applyCharacterSpiritDamage(character, 5);
        });
        enemy.hidden.forEach((character) => {
          if (boardZoneOf(character) === 'characters') {
            if (character.currentHp != null) character.currentHp = clampHp(character.currentHp - 15);
            applyCharacterSpiritDamage(character, 5);
          }
        });
        cleanupDefeatedCharacters(players, enemyId, pollutionLogs);
        message = `${player.label}使用《${used.name}》。`;
      } else {
        pollutionLogs.push(...applyPollutionChange(enemy, 50));
        message = `${player.label}使用《${used.name}》。`;
      }
    }
    if (used.effect === 'abyssGaze') {
      pollutionLogs.push(...applyBodySpiritDamage(enemy, 10));
      Object.values(players).forEach((item) => {
        allBoardCharacters(item).forEach((character) => applyCharacterSpiritDamage(character, 5));
      });
      pollutionLogs.push(...applyPollutionChange(enemy, 20));
      Object.keys(players).forEach((id) => cleanupDefeatedCharacters(players, id, pollutionLogs));
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'destroyEnemyScene') {
      const removed = removeFirstScene(enemy, false);
      message = removed
        ? `${player.label}使用《${used.name}》，摧毁${enemy.label}的《${removed.name}》。`
        : `${player.label}使用《${used.name}》，但${enemy.label}没有场景牌。`;
    }
    if (used.effect === 'memorySceneRemove') {
      const removed = removeFirstScene(enemy, true);
      pollutionLogs.push(...applyBodySpiritDamage(enemy, 10));
      pollutionLogs.push(...applyPollutionChange(enemy, 10));
      message = removed
        ? `${player.label}使用《${used.name}》，移除${enemy.label}的《${removed.name}》，并使其-10精神力+10污染。`
        : `${player.label}使用《${used.name}》，没有可移除场景，仍使${enemy.label}-10精神力+10污染。`;
    }
    if (used.effect === 'restoreSpirit') {
      pollutionLogs.push(...applyBodySpiritHeal(player, used.value ?? 20));
      message = `${player.label}使用《${used.name}》，恢复${used.value ?? 20}精神力。`;
    }
    if (used.effect === 'trueBodyStrike') {
      enemy.hp = clampHp(enemy.hp - 40);
      pollutionLogs.push(...applyBodySpiritDamage(enemy, 40));
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'removeEnemyHidden') {
      const removed = enemy.hidden.shift();
      if (removed) enemy.discard.push(removed);
      message = removed
        ? `${player.label}使用《${used.name}》，消除了${enemy.label}一张暗置牌。`
        : `${player.label}使用《${used.name}》，但${enemy.label}没有暗置牌。`;
    }
    if (used.effect === 'feedingContract') {
      const visibleIndex = player.characters.findIndex((character) => !isGearCard(character));
      let removed = null;
      if (visibleIndex >= 0) {
        [removed] = player.characters.splice(visibleIndex, 1);
      } else {
        const hiddenIndex = player.hidden.findIndex((character) => boardZoneOf(character) === 'characters' && !isGearCard(character));
        if (hiddenIndex >= 0) [removed] = player.hidden.splice(hiddenIndex, 1);
      }
      if (removed) {
        player.discard.push(removed);
        healPlayer(player, 20);
        pollutionLogs.push(...applyBodySpiritHeal(player, 8));
        addSkill(player, 1);
        message = `${player.label}使用《${used.name}》，移除己方《${removed.name}》，本体+20血+8精神力+1技能点。`;
      }
    }
    if (used.effect === 'rewindClock') {
      player.rewindSnapshot = structuredClone({
        maxHp: player.maxHp,
        hp: player.hp,
        skill: player.skill,
        maxSpirit: player.maxSpirit,
        spirit: player.spirit,
        pollution: player.pollution,
        maxPollution: player.maxPollution,
        pollutionBursts: player.pollutionBursts,
        deck: player.deck,
        hand: player.hand,
        characters: player.characters,
        equipment: player.equipment,
        scenes: player.scenes,
        hidden: player.hidden,
        discard: player.discard,
      });
      player.rewindUntilTurn = game.turn + 1;
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'wordlessBook') {
      const choiceLogs = [];
      applyWordlessBookEffect(player, chooseWordlessBookOption(player), choiceLogs);
      pollutionLogs.push(...choiceLogs);
      message = `${player.label}使用《${used.name}》。`;
    }
    if (used.effect === 'inspectAllHidden') {
      message = `${player.label}使用《${used.name}》。`;
      player.discard.push(used);
      return {
        ...game,
        players,
        inspected: { viewer: playerId, cards: enemy.hidden },
        log: [...pollutionLogs, message, ...game.log],
      };
    }
    if (used.effect === 'shieldCard') {
      const target = player.characters[0] ?? player.hidden.find((card) => boardZoneOf(card) === 'characters');
      if (target) {
        target.shield = (target.shield ?? 0) + 1;
        message = `${player.label}使用《${used.name}》，影响了《${target.name}》。`;
      } else {
        message = `${player.label}使用《${used.name}》。`;
      }
    }
    if (used.effect === 'damageEnemy') message = applyDamage(players, enemyId, used.value, playerId);
    if (used.effect === 'teleport') {
      const discardedByPlayer = discardGearMarkedCards(player);
      const discardedByEnemy = discardGearMarkedCards(enemy);
      const extraDiscarded = discardOneFromHand(enemy);
      const totalDiscardedCards = discardedByPlayer + discardedByEnemy + (extraDiscarded ? 1 : 0);
      const teleportHpLoss = 10 + totalDiscardedCards * 5;

      const extraLogs = [];
      extraLogs.push(...applyPollutionChange(player, 20));
      extraLogs.push(...applyPollutionChange(player, totalDiscardedCards * 10));
      extraLogs.push(...applyPollutionChange(enemy, 20));
      extraLogs.push(...applyPollutionChange(enemy, totalDiscardedCards * 10));
      enemy.hp = clampHp(enemy.hp - teleportHpLoss);
      extraLogs.push(`${enemy.label}因《传送》-${teleportHpLoss}血。`);

      message = `${player.label}使用《传送》，弃置己方${discardedByPlayer}张齿轮牌、敌方${discardedByEnemy}张齿轮牌，${extraDiscarded ? `${enemy.label}额外弃置《${extraDiscarded.name}》` : `${enemy.label}没有手牌可额外弃置`}。本次共弃置${totalDiscardedCards}张牌，双方+${20 + totalDiscardedCards * 10}污染，${enemy.label}-${teleportHpLoss}血。`;
      player.discard.push(used);
      return {
        ...game,
        players,
        log: [...(applyRewindIfDefeated(players, extraLogs), extraLogs), ...pollutionLogs, message, ...game.log],
      };
    }
    if (used.effect === 'inspectHidden') {
      const removed = enemy.hidden.length;
      enemy.discard.push(...enemy.hidden);
      enemy.hidden = [];
      message = `${player.label}使用《记忆检视》，查看并移除了${removed}张敌方暗置牌。`;
      player.discard.push(used);
      return {
        ...game,
        players,
        inspected: { viewer: playerId, cards: game.players[enemyId].hidden },
        log: [...pollutionLogs, message, ...game.log],
      };
    }
    player.discard.push(used);
  }

  applyRewindIfDefeated(players, pollutionLogs);
  return { ...game, players, ...(deck ? { deck } : {}), log: [...pollutionLogs, message, ...game.log] };
}

function playTargetedKill(game, playerId, card, target) {
  const players = structuredClone(game.players);
  const player = players[playerId];
  const enemyId = target.enemyId ?? getPrimaryEnemyId(game, playerId);
  const enemy = players[enemyId];
  const handIndex = player.hand.findIndex((item) => item.instanceId === card.instanceId);
  if (handIndex < 0) return game;
  if (player.skill < card.cost) return { ...game, log: [`技能点不足，无法使用《${card.name}》。`, ...game.log] };

  const [used] = player.hand.splice(handIndex, 1);
  player.skill -= used.cost;
  const pollutionLogs = applyPollutionChange(player, effectivePollutionDelta(player, used));
  player.discard.push(used);
  triggerMetalCabinetIfAttack(enemy, used, pollutionLogs);

  if (target.type === 'body') {
    const dealt = applyBodyDamage(enemy, 40, 'physical');
    applyRewindIfDefeated(players, pollutionLogs);
    return { ...game, players, log: [...pollutionLogs, `${player.label}使用《${used.name}》，对${enemy.label}本体造成${dealt}点物伤。`, ...game.log] };
  }

  const targetIndex = enemy.characters.findIndex((item) => item.instanceId === target.instanceId);
  if (targetIndex < 0) return { ...game, players, log: [...pollutionLogs, `${player.label}使用《${used.name}》，但目标已经不存在。`, ...game.log] };

  const targetCard = enemy.characters[targetIndex];
  const deathLogs = [];
  const { damage: dealt, shieldNote } = applyCharacterDamage(players, enemyId, targetCard, 40, 'physical');
  if (shieldNote) deathLogs.push(shieldNote);
  cleanupDefeatedCharacters(players, enemyId, deathLogs);
  applyRewindIfDefeated(players, deathLogs);
  return { ...game, players, log: [...pollutionLogs, `${player.label}使用《${used.name}》，对${enemy.label}的《${targetCard.name}》造成${dealt}点物伤。`, ...deathLogs, ...game.log] };
}
function performAction(game, playerId) {
  const players = structuredClone(game.players);
  const player = players[playerId];
  const enemyId = opponentOf(playerId);
  const activeCharacters = [
    ...player.characters,
    ...player.hidden.filter((card) => boardZoneOf(card) === 'characters'),
  ];
  if (activeCharacters.length === 0) {
    return { ...game, log: [`${player.label}没有角色可以行动。`, ...game.log] };
  }
  const logs = [];
  activeCharacters.forEach((character) => {
    let damage = character.atk;
    const hasBoost = player.hidden.some((card) => card.hiddenKind === 'attackBoost');
    if (hasBoost && !player.boostedThisRound) {
      damage += 1;
      player.boostedThisRound = true;
    }
    if (damage > 0) logs.push(applyDamage(players, enemyId, damage, playerId));
    if (boardZoneOf(character) === 'characters' && character.type === 'hidden') logs.push(`${player.label}的暗置角色行动。`);
  });
  return { ...game, players, log: [...logs.reverse(), ...game.log] };
}

function App() {
  const autoStartMode = getAutoStartMode();
  const [playerName, setPlayerName] = useState(getStoredPlayerName);
  const [stats, setStats] = useState(getStoredStats);
  const [settings, setSettings] = useState(getStoredSettings);
  const [game, setGame] = useState(() => {
    const storedSettings = getStoredSettings();
    return setupGame({ mode: autoStartMode ?? 'pve', localName: getStoredPlayerName(), customCards: storedSettings.developerCards });
  });
  const [screen, setScreen] = useState(() => autoStartMode ? 'game' : 'start');
  const [mode, setMode] = useState(autoStartMode ?? 'pve');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phaseBanner, setPhaseBanner] = useState(null);
  const [playFx, setPlayFx] = useState(null);
  const [damageBursts, setDamageBursts] = useState([]);
  const [coinReady, setCoinReady] = useState(false);
  const [coinIntro, setCoinIntro] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState('p1');
  const [selectedHandCardId, setSelectedHandCardId] = useState(null);
  const [detailCard, setDetailCard] = useState(null);
  const [detailPlayerId, setDetailPlayerId] = useState(null);
  const [targetRequest, setTargetRequest] = useState(null);
  const [cycleRequest, setCycleRequest] = useState(null);
  const [netPanelOpen, setNetPanelOpen] = useState(false);
  const [netStatus, setNetStatus] = useState('未连接');
  const [netRole, setNetRole] = useState(null);
  const [localSeat, setLocalSeat] = useState('p1');
  const [offerText, setOfferText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [signalInput, setSignalInput] = useState('');
  const [lanUrl, setLanUrl] = useState(DEFAULT_RELAY_URL);
  const [lanRoom, setLanRoom] = useState('room1');
  const [roomList, setRoomList] = useState([]);
  const [roomListState, setRoomListState] = useState({ status: 'idle', message: '' });
  const [netError, setNetError] = useState('');
  const [netReady, setNetReady] = useState({ local: false, remote: false });
  const [p2pStarted, setP2pStarted] = useState(false);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const suppressNetSyncRef = useRef(false);
  const seatNamesRef = useRef({});
  const recordedMatchRef = useRef(null);
  const healthFxRef = useRef(null);
  const aiCyclePhaseRef = useRef(null);
  const currentPlayer = game.phase.split(':')[0];
  const currentStep = game.phase.split(':')[1];

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!settings.musicEnabled || !settings.musicUrl) return undefined;
    const controller = new AbortController();
    const audio = new Audio();
    audio.loop = true;
    audio.volume = 0.45;
    resolveMusicSource(settings.musicUrl, controller.signal)
      .then((source) => {
        if (!source || controller.signal.aborted) return;
        audio.src = source;
        audio.play().catch(() => {});
      })
      .catch(() => {});
    return () => {
      controller.abort();
      audio.pause();
      audio.src = '';
    };
  }, [settings.musicEnabled, settings.musicUrl]);

  useEffect(() => {
    if (screen !== 'game' || mode !== 'relay' || !netPanelOpen) return;
    loadRooms();
  }, [screen, mode, netPanelOpen, lanUrl]);

  const victor = getWinner(game, localSeat);
  const pendingFallEntry = Object.entries(game.players).find(([, player]) => player.pendingFallChoice);
  const pendingFallOwnerId = pendingFallEntry?.[0] ?? null;
  const pendingFallOwner = pendingFallEntry?.[1] ?? null;

  const visiblePlayer = game.players[selectedPlayer];
  const enemy = game.players[getPrimaryEnemyId(game, selectedPlayer)];
  const isActivePerspective = selectedPlayer === currentPlayer;
  const isP2p = mode === 'p2p';
  const isNetwork = isRelayNetworkMode(mode);
  const isLocalTurn = !isNetwork || selectedPlayer === localSeat;
  const isAiTurn = isAiControlledSeat(mode, currentPlayer, localSeat) && !victor;
  const actionActor = getActionActorCard(game);

  const canNetPlay = !isNetwork || p2pStarted;
  const blocksForPendingChoice = Boolean(pendingFallOwnerId) && (!isNetwork || pendingFallOwnerId === localSeat);
  const canControlCurrentPhase = !victor
    && canNetPlay
    && !blocksForPendingChoice
    && !isAiTurn
    && (!isNetwork || currentPlayer === localSeat);
  const canUsePhaseButton = canControlCurrentPhase && isActivePerspective;
  const canPlay = currentStep === 'play' && isActivePerspective && isLocalTurn && canNetPlay && !isAiTurn && !blocksForPendingChoice;
  const canAction = currentStep === 'action' && isActivePerspective && isLocalTurn && canNetPlay && !isAiTurn && !blocksForPendingChoice;
  const canCycle = isActivePerspective && isLocalTurn && canNetPlay && !isAiTurn && !blocksForPendingChoice && visiblePlayer.skill >= 1 && visiblePlayer.hand.length > 0;

  const statusText = useMemo(() => {
    if (victor) return `${victor.label}获胜`;
    return phaseLabel(game);
  }, [game, victor]);

  function applyLocalPlayerName(nextName) {
    const cleaned = nextName.trim().slice(0, 10) || DEFAULT_PLAYER_NAME;
    setPlayerName(cleaned);
    storageSet(PLAYER_NAME_KEY, cleaned);
    setGame((current) => {
      const nextGame = structuredClone(current);
      const seat = isRelayNetworkMode(mode) ? localSeat : 'p1';
      nextGame.players[seat].label = cleaned;
      if (mode === 'pve') nextGame.players.p2.label = 'Bot';
      sendNetName(seat, cleaned);
      return nextGame;
    });
  }

  useEffect(() => {
    if (mode === 'pve' && selectedPlayer !== 'p1') setSelectedPlayer('p1');
    if (isRelayNetworkMode(mode) && selectedPlayer !== localSeat) setSelectedPlayer(localSeat);
  }, [mode, localSeat, selectedPlayer]);

  useEffect(() => {
    if (!isRelayNetworkMode(mode)) return;
    sendNetName(localSeat, playerName);
  }, [mode, localSeat, playerName]);

  useEffect(() => {
    if (!victor || recordedMatchRef.current === game.matchId) return;
    recordedMatchRef.current = game.matchId;
    const statSeat = isRelayNetworkMode(mode) ? localSeat : 'p1';
    setStats((current) => {
      const next = {
        wins: current.wins + (victor.id === statSeat ? 1 : 0),
        losses: current.losses + (victor.id === statSeat ? 0 : 1),
      };
      saveStats(next);
      return next;
    });
    submitLeaderboardResult({
      name: game.players[statSeat]?.label || playerName,
      result: victor.id === statSeat ? 'win' : 'loss',
      mode,
    }).catch(() => {});
  }, [victor, game.matchId, mode, localSeat, game.players, playerName]);

  useEffect(() => {
    if (screen !== 'game') {
      healthFxRef.current = null;
      return;
    }
    const current = Object.fromEntries(
      Object.entries(game.players).map(([id, player]) => [id, totalHealthForFx(player)])
    );
    const previous = healthFxRef.current;
    healthFxRef.current = current;
    if (!previous) return;
    const nextBursts = [];
    Object.entries(current).forEach(([id, value]) => {
      const diff = (previous[id] ?? value) - value;
      if (diff > 0) {
        nextBursts.push({
          id: `${id}-${game.turn}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          side: id === 'p1' ? 'right' : 'left',
          amount: diff,
        });
      }
    });
    if (nextBursts.length === 0) return;
    setDamageBursts((items) => [...items, ...nextBursts].slice(-6));
    const timer = window.setTimeout(() => {
      setDamageBursts((items) => items.filter((item) => !nextBursts.some((burst) => burst.id === item.id)));
    }, 950);
    return () => window.clearTimeout(timer);
  }, [screen, game.players, game.turn]);

  function resetGame(nextMode = mode) {
    setMode(nextMode);
    const nextSeat = isRelayNetworkMode(nextMode) ? localSeat : 'p1';
    recordedMatchRef.current = null;
    setGame(setupGame({ mode: nextMode, localName: playerName, localSeat: nextSeat, customCards: settings.developerCards }));
    setSelectedPlayer(nextSeat);
    setDetailCard(null);
    setDetailPlayerId(null);
    setTargetRequest(null);
    setCycleRequest(null);
    setCoinReady(false);
    setCoinIntro(false);
    setDrawerOpen(false);
    setPhaseBanner(null);
    setNetReady({ local: false, remote: false });
    setP2pStarted(false);
  }

  function runCoinIntro() {
  }

  function startGame(nextMode) {
    resetGame(nextMode);
    setScreen('game');
    setCoinIntro(true);
    window.setTimeout(() => {
      setCoinIntro(false);
      setPhaseBanner(phaseLabel(game));
    }, 1450);
    setPhaseBanner(modeLabel(nextMode));
    if (isRelayNetworkMode(nextMode)) {
      setNetPanelOpen(true);
      return;
    }
    runCoinIntro();
  }

  function backToStart() {
    setScreen('start');
    resetGame(mode);
  }

  function showPlayFx(card) {
    if (isHiddenLike(card) || card?.id === 'char_protector') return;
    setPlayFx({ card, id: `${card.instanceId}-${Date.now()}` });
    window.setTimeout(() => setPlayFx(null), 720);
  }

  function sendNetState(nextGame) {
    if (!isNetwork) return;
    const channel = channelRef.current;
    if (!isNetChannelOpen(channel)) return;
    channel.send(JSON.stringify({ type: 'state', game: nextGame }));
  }

  function sendNetName(seat = localSeat, name = playerName) {
    const clean = String(name).trim().slice(0, 10) || DEFAULT_PLAYER_NAME;
    seatNamesRef.current[seat] = clean;
    const channel = channelRef.current;
    if (!isNetChannelOpen(channel)) return;
    channel.send(JSON.stringify({ type: 'name', seat, name }));
  }

  function applyRemoteName(seat, name) {
    if (!seat || !name) return;
    const clean = String(name).trim().slice(0, 10) || DEFAULT_PLAYER_NAME;
    seatNamesRef.current[seat] = clean;
    setGame((current) => ({
      ...current,
      players: {
        ...current.players,
        [seat]: {
          ...current.players[seat],
          label: clean,
        },
      },
    }));
  }

  // 用已知的双方真名覆盖 game 里的 label，避免 state 同步把名字冲回默认"玩家"。
  function applyKnownNames(nextGame) {
    const names = seatNamesRef.current;
    if (!nextGame?.players || !Object.keys(names).length) return nextGame;
    const players = { ...nextGame.players };
    let changed = false;
    for (const seat of Object.keys(names)) {
      if (players[seat] && names[seat] && players[seat].label !== names[seat]) {
        players[seat] = { ...players[seat], label: names[seat] };
        changed = true;
      }
    }
    return changed ? { ...nextGame, players } : nextGame;
  }

  function updateGame(updater, { sync = true } = {}) {
    setGame((current) => {
      const nextGame = typeof updater === 'function' ? updater(current) : updater;
      if (sync && !suppressNetSyncRef.current) {
        sendNetState(nextGame);
      }
      return nextGame;
    });
  }

  useEffect(() => {
    if (mode !== 'pve' || pendingFallOwnerId !== 'p2' || victor) return;
    const timer = window.setTimeout(() => {
      updateGame((current) => {
        const owner = current.players.p2;
        const enemy = current.players[owner.pendingFallChoice?.enemyId ?? 'p1'];
        const option = enemy.hp <= 40 || (enemy.spirit ?? 0) <= 25 ? 'hp40' : 'spirit25';
        return resolveFallChoice(current, 'p2', option);
      }, { sync: false });
    }, 520);
    return () => window.clearTimeout(timer);
  }, [mode, pendingFallOwnerId, victor]);

  function closePeerConnection() {
    if (channelRef.current) {
      channelRef.current.onopen = null;
      channelRef.current.onmessage = null;
      channelRef.current.onclose = null;
      channelRef.current.close();
      channelRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.onicecandidate = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.ondatachannel = null;
      peerRef.current.close();
      peerRef.current = null;
    }
    setNetStatus('未连接');
    setNetRole(null);
    setNetError('');
    setNetReady({ local: false, remote: false });
    setP2pStarted(false);
  }

  async function loadRooms() {
    if (mode !== 'relay') return;
    setRoomListState({ status: 'loading', message: '正在刷新房间...' });
    try {
      const response = await fetch(roomApiUrlFromWs(lanUrl), { cache: 'no-store' });
      if (!response.ok) throw new Error(`房间列表读取失败：${response.status}`);
      const data = await response.json();
      setRoomList(Array.isArray(data.rooms) ? data.rooms : []);
      setRoomListState({ status: 'ready', message: '' });
    } catch (error) {
      setRoomListState({ status: 'error', message: error instanceof Error ? error.message : '房间列表读取失败。' });
    }
  }

  function connectLan(options = {}) {
    const roomName = options.room || lanRoom.trim() || 'room1';
    closePeerConnection();
    setNetError('');
    setNetReady({ local: false, remote: false });
    setP2pStarted(false);
    try {
      const url = normalizeLanUrl(lanUrl);
      url.searchParams.set('room', roomName);
      url.searchParams.set('name', playerName);
      if (options.host) url.searchParams.set('host', '1');
      setLanRoom(roomName);
      const socket = new WebSocket(url.toString());
      channelRef.current = socket;
      socket.onopen = () => {
        setNetStatus(mode === 'relay' ? '服务器已连接，等待对手...' : '局域网已连接');
        setNetRole(options.host ? 'host' : 'joiner');
        setNetReady((ready) => ({ ...ready, local: true }));
        socket.send(JSON.stringify({ type: 'name', seat: localSeat, name: playerName }));
      };
      socket.onclose = () => {
        setNetStatus(mode === 'relay' ? '服务器已断开' : '局域网已断开');
        if (mode === 'relay') loadRooms();
      };
      socket.onerror = () => setNetError('连接失败。HTTPS 页面必须使用 wss://；如果用域名，请确认 Nginx 已把 /ws 反代到 18781。');
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          if (message.type === 'error') {
            setNetError(message.message || '服务器返回错误。');
            return;
          }
          if (message.type === 'peer-left') {
            setNetStatus('对方已离开');
            setP2pStarted(false);
            if (mode === 'relay') loadRooms();
            return;
          }
          if (message.type === 'seat') {
            socket.localSeat = message.seat;
            setLocalSeat(message.seat);
            setSelectedPlayer(message.seat);
            seatNamesRef.current[message.seat] = String(playerName).trim().slice(0, 10) || DEFAULT_PLAYER_NAME;
            setGame(applyKnownNames(setupGame({ mode, localName: playerName, localSeat: message.seat })));
          }
          if (message.type === 'lan-ready') {
            setNetReady({ local: true, remote: true });
            setP2pStarted(true);
            setNetPanelOpen(false);
            if (socket.localSeat === 'p1') {
              setGame((current) => {
                socket.send(JSON.stringify({ type: 'state', game: current }));
                return current;
              });
            }
            runCoinIntro();
          }
          if (message.type === 'state' && message.game) {
            suppressNetSyncRef.current = true;
            setGame(applyKnownNames(message.game));
            window.setTimeout(() => {
              suppressNetSyncRef.current = false;
            }, 0);
          }
          if (message.type === 'name') {
            applyRemoteName(message.seat, message.name);
          }
        } catch (error) {
          setNetError('接收联机数据失败。');
        }
      };
    } catch (error) {
      setNetError(error instanceof Error ? error.message : '联机地址无法识别，例如 ws://duoduo1215.xyz:18781。');
    }
  }

  function createRelayRoom() {
    const room = makeRoomId(playerName);
    setLanRoom(room);
    connectLan({ room, host: true });
  }

  function joinRelayRoom(room) {
    if (!room) return;
    setLanRoom(room);
    connectLan({ room, host: false });
  }
  function attachChannel(channel) {
    channelRef.current = channel;
    channel.onopen = () => {
      setNetStatus('已连接');
      setNetError('');
      sendNetState(game);
      sendNetName(localSeat, playerName);
    };
    channel.onclose = () => setNetStatus('连接已断开');
    channel.onerror = () => setNetStatus('连接异常');
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'ping') {
          channel.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (message.type === 'error') {
          setNetError(message.message || '联机错误');
          return;
        }
        if (message.type === 'state' && message.game) {
          suppressNetSyncRef.current = true;
          setGame(message.game);
          window.setTimeout(() => {
            suppressNetSyncRef.current = false;
          }, 0);
        }
        if (message.type === 'ready') {
          setNetReady((ready) => ({ ...ready, remote: true }));
          applyRemoteName(message.seat, message.name);
        }
        if (message.type === 'name') {
          applyRemoteName(message.seat, message.name);
        }
      } catch (error) {
        setNetError('接收联机数据失败。');
      }
    };
  }

  async function createPeer(role) {
    closePeerConnection();
    setNetRole(role);
    setNetStatus(role === 'host' ? '创建中' : '等待输入房间');
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    peerRef.current = peer;
    peer.onconnectionstatechange = () => setNetStatus(peer.connectionState);
    if (role === 'host') {
      attachChannel(peer.createDataChannel('game'));
    } else {
      peer.ondatachannel = (event) => attachChannel(event.channel);
    }
    return peer;
  }

  async function waitForIceComplete(peer) {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      const handle = () => {
        if (peer.iceGatheringState === 'complete') {
          peer.removeEventListener('icegatheringstatechange', handle);
          resolve();
        }
      };
      peer.addEventListener('icegatheringstatechange', handle);
    });
  }

  async function createOffer() {
    setNetError('');
    setNetReady({ local: false, remote: false });
    setP2pStarted(false);
    setLocalSeat('p1');
    setSelectedPlayer('p1');
    const peer = await createPeer('host');
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceComplete(peer);
    const text = JSON.stringify(peer.localDescription);
    setOfferText(text);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  async function acceptOffer(input = signalInput) {
    setNetError('');
    setNetReady({ local: false, remote: false });
    setP2pStarted(false);
    try {
      const textInput = typeof input === 'string' ? input : signalInput;
      const offer = JSON.parse(textInput);
      const peer = await createPeer('guest');
      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceComplete(peer);
      const text = JSON.stringify(peer.localDescription);
      setAnswerText(text);
      navigator.clipboard?.writeText(text).catch(() => {});
      setLocalSeat('p2');
      setSelectedPlayer('p2');
      setGame((current) => ({
        ...current,
        players: {
          ...current.players,
          p2: { ...current.players.p2, label: playerName },
        },
      }));
      setNetStatus('等待对方接收');
    } catch (error) {
      setNetError('房间信息解析失败');
    }
  }

  async function acceptAnswer(input = signalInput) {
    setNetError('');
    try {
      const textInput = typeof input === 'string' ? input : signalInput;
      const answer = JSON.parse(textInput);
      const peer = peerRef.current;
      if (!peer) throw new Error('missing peer');
      await peer.setRemoteDescription(answer);
      setNetStatus('连接已完成');
    } catch (error) {
      setNetError('回答信息解析失败');
    }
  }

  async function applySignalInput() {
    setNetError('');
    try {
      const message = JSON.parse(signalInput);
      if (message.type === 'offer') {
        await acceptOffer(signalInput);
        return;
      }
      if (message.type === 'answer') {
        await acceptAnswer(signalInput);
        return;
      }
      setNetError('没有识别到 offer 或 answer。');
    } catch (error) {
      setNetError('联机码解析失败');
    }
  }

  function markLocalReady() {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== 'open') {
      setNetError('先连上对方，再点准备。');
      return;
    }
    setNetReady((ready) => ({ ...ready, local: true }));
    channel.send(JSON.stringify({ type: 'ready', seat: localSeat, name: playerName }));
    sendNetName(localSeat, playerName);
  }

  useEffect(() => {
    if (screen !== 'game' || !isRelayNetworkMode(mode) || p2pStarted) return;
    if (!netReady.local || !netReady.remote) return;
    setP2pStarted(true);
    setNetPanelOpen(false);
    runCoinIntro();
  }, [screen, mode, netReady.local, netReady.remote, p2pStarted]);

  useEffect(() => {
    if (victor) return;
    if (targetRequest || cycleRequest) return;
    if (!isAiTurn) return;
    const phaseKey = `${game.matchId}-${game.turn}-${game.phase}`;
    if (currentStep !== 'play') aiCyclePhaseRef.current = null;
    const timer = window.setTimeout(() => {
      if (currentStep === 'play') {
        const allowCycle = aiCyclePhaseRef.current !== phaseKey;
        const preview = playAiCard(game, currentPlayer);
        if (!preview.played) {
          updateGame((current) => {
            const stepResult = runAiStep(current, currentPlayer, { allowCycle });
            if (stepResult.cycled) aiCyclePhaseRef.current = phaseKey;
            return stepResult.game;
          }, { sync: false });
          return;
        }
        setPlayFx({ card: preview.card, id: `ai-${Date.now()}` });
        window.setTimeout(() => {
          updateGame((current) => runAiStep(current, currentPlayer, { allowCycle: false }).game, { sync: false });
          setPlayFx(null);
        }, 680);
        return;
      }
      updateGame((current) => runAiStep(current, currentPlayer, { allowCycle: false }).game, { sync: false });
    }, currentStep === 'play' ? 720 : 820);
    return () => window.clearTimeout(timer);
  }, [
    isAiTurn,
    victor,
    targetRequest,
    cycleRequest,
    game.phase,
    game.turn,
    game.matchId,
    game.actionState?.cursor,
    game.players[currentPlayer]?.hand.length,
    game.players[currentPlayer]?.skill,
    game.players[currentPlayer]?.pollution,
    game.log.length,
    currentStep,
    currentPlayer,
  ]);

  useEffect(() => {
    if (screen !== 'game') return;
    const text = victor ? `${victor.label} 获胜` : phaseLabel(game);
    setPhaseBanner(text);
    const timer = window.setTimeout(() => setPhaseBanner(null), 900);
    return () => window.clearTimeout(timer);
  }, [screen, game.phase, game.turn, victor]);

  useEffect(() => {
    if (!selectedHandCardId) return;
    const selectedCard = visiblePlayer.hand.find((card) => card.instanceId === selectedHandCardId);
    if (!selectedCard || !canPlay || victor || !canPlayCard(game, selectedPlayer, selectedCard)) {
      setSelectedHandCardId(null);
    }
  }, [selectedHandCardId, visiblePlayer.hand, canPlay, victor, game, selectedPlayer]);

  function advance() {
    if (!canUsePhaseButton) return;
    if (targetRequest) return;
    if (canAction && actionActor) {
      setTargetRequest({ type: 'action', actor: actionActor, playerId: selectedPlayer });
      return;
    }
    updateGame(nextPhase(game));
  }

  function skipCurrentAction() {
    if (!canAction) return;
    updateGame((current) => {
      const actor = getActionActorCard(current);
      if (!actor) return nextPhase(current);
      return advanceActionCursor(current, `${current.players[selectedPlayer].label}跳过了《${actor.name}》的行动。`);
    });
  }

  function handleHandCard(card) {
    const reason = victor
      ? '对局已经结束。'
      : !canPlay
        ? '现在不是你的出牌阶段。'
        : getCannotPlayReason(game, selectedPlayer, card);
    if (reason) {
      if (selectedHandCardId === card.instanceId) setSelectedHandCardId(null);
      updateGame((current) => ({
        ...current,
        log: [`不能使用《${card.name}》：${reason}`, ...current.log],
      }), { sync: false });
      return;
    }
    if (selectedHandCardId !== card.instanceId) {
      setSelectedHandCardId(card.instanceId);
      return;
    }
    setSelectedHandCardId(null);
    if (!canPlayCard(game, selectedPlayer, card)) {
      updateGame((current) => playCard(current, selectedPlayer, card));
      return;
    }
    if (card.effect === 'killTarget') {
      setTargetRequest({ type: 'kill', card, playerId: selectedPlayer });
      return;
    }
    if (card.effect === 'wordlessBook') {
      setTargetRequest({ type: 'wordlessBook', card, playerId: selectedPlayer });
      return;
    }
    if (['removeEnemyHidden', 'destroyEnemyScene', 'memorySceneRemove', 'feedingContract', 'shieldCard', 'itEnter', 'orcaEnter'].includes(card.effect)) {
      const choices = selectableCardsForEffect(game, selectedPlayer, card);
      if (choices.length > 0) {
        setTargetRequest({ type: 'selectCard', card, playerId: selectedPlayer, choices });
        return;
      }
    }
    showPlayFx(card);
    updateGame((current) => playCard(current, selectedPlayer, card));
  }

  function resolveTarget(target) {
    if (!targetRequest) return;
    if (targetRequest.type === 'kill') {
      showPlayFx(targetRequest.card);
      updateGame((current) => playTargetedKill(current, targetRequest.playerId, targetRequest.card, target));
    } else if (targetRequest.type === 'wordlessBook') {
      showPlayFx(targetRequest.card);
      updateGame((current) => playWordlessBookCard(current, targetRequest.playerId, targetRequest.card, target.option));
    } else if (targetRequest.type === 'selectCard') {
      showPlayFx(targetRequest.card);
      if (['itEnter', 'orcaEnter'].includes(targetRequest.card.effect)) {
        updateGame((current) => playSelectedEnterCard(current, targetRequest.playerId, targetRequest.card, target));
      } else {
        updateGame((current) => playSelectedEffectCard(current, targetRequest.playerId, targetRequest.card, target));
      }
    } else if (targetRequest.type === 'action') {
      updateGame((current) => resolveCharacterAction(current, targetRequest.playerId, targetRequest.actor.instanceId, target));
    }
    setTargetRequest(null);
  }

  function openCycle() {
    setCycleRequest({ playerId: selectedPlayer });
  }

  function resolveCycle(cardId) {
    if (!cycleRequest) return;
    updateGame((current) => discardThenDrawOne(current, cycleRequest.playerId, cardId));
    setCycleRequest(null);
  }

  function clearSelectedCardOnBlank(event) {
    if (!selectedHandCardId) return;
    const interactive = event.target.closest(
      'button, .hand-card-wrap, .detail-dialog, .target-dialog, .info-drawer, .victory-card, .start-settings-panel',
    );
    if (!interactive) setSelectedHandCardId(null);
  }

  const perspectiveIds = mode === 'pvp' ? ['p1', 'p2'] : [isRelayNetworkMode(mode) ? localSeat : 'p1'];
  const isFourPlayer = isFourPlayerMode(mode);

  if (screen === 'start') {
    return (
      <StartScreen
        playerName={playerName}
        stats={stats}
        settings={settings}
        onSettingsChange={setSettings}
        onNameChange={applyLocalPlayerName}
        onResetStats={() => {
          const nextStats = { wins: 0, losses: 0 };
          setStats(nextStats);
          saveStats(nextStats);
        }}
        onImportSave={(payload) => {
          // payload: { name, stats, settings } — 任意字段可缺省
          if (payload.name) applyLocalPlayerName(payload.name);
          if (payload.stats) {
            const nextStats = {
              wins: Number.isFinite(payload.stats.wins) ? payload.stats.wins : 0,
              losses: Number.isFinite(payload.stats.losses) ? payload.stats.losses : 0,
            };
            setStats(nextStats);
            saveStats(nextStats);
          }
          if (payload.settings && typeof payload.settings === 'object') {
            const merged = { ...DEFAULT_SETTINGS, ...payload.settings };
            setSettings(merged);
            saveSettings(merged);
          }
        }}
        onStart={startGame}
      />
    );
  }

  return (
    <main
      className="app-shell game-shell"
      style={{
        '--ui-scale': settings.uiScale / 100,
        '--font-scale': (settings.fontScale ?? 100) / 100,
        '--hand-card-scale': (settings.handCardScale ?? DEFAULT_SETTINGS.handCardScale) / 100,
        '--hand-gap': `${settings.handGap ?? DEFAULT_SETTINGS.handGap}px`,
        '--hand-text-scale': (settings.handTextScale ?? DEFAULT_SETTINGS.handTextScale) / 100,
        '--board-card-scale': (settings.boardCardScale ?? DEFAULT_SETTINGS.boardCardScale) / 100,
        '--app-window-offset-x': `${settings.gameOffsetX ?? 0}px`,
        '--app-window-offset-y': `${settings.gameOffsetY ?? 0}px`,
        fontSize: `${settings.fontScale ?? 100}%`,
      }}
    >
      <section className="game-table" onPointerDown={clearSelectedCardOnBlank}>
        <header className="table-topbar">
          <button
            className="top-tool-button"
            onClick={backToStart}
            aria-label="回到主界面"
          >
            <RotateCcw size={17} />
            <span>主界面</span>
          </button>
          <div>
            <p>第{game.turn}回合</p>
            <h1>{statusText}</h1>
          </div>
          <button className="top-tool-button" onClick={() => setCoinReady(true)} aria-label="抛硬币动画">
            <Coins size={17} />
            <span>硬币</span>
          </button>
        </header>

        {coinReady && (
          <div className="coin-overlay" onClick={() => setCoinReady(false)}>
            <div className="coin">
              <span>{game.first === 'p1' ? '一' : '二'}</span>
            </div>
            <p>{game.players[game.first].label}先手</p>
          </div>
        )}

        {coinIntro && <CoinIntro firstPlayer={game.players[game.first]} />}

        {phaseBanner && (
          <div className="phase-banner" aria-live="polite">
            <span>{phaseBanner}</span>
          </div>
        )}

        {victor && (
          <VictoryOverlay
            victor={victor}
            onRestart={() => resetGame(mode)}
            onHome={backToStart}
          />
        )}

        {playFx && <PlayCardBurst key={playFx.id} card={playFx.card} />}
        {damageBursts.map((burst) => (
          <DamageHeartBurst key={burst.id} burst={burst} />
        ))}

        {netPanelOpen && isRelayNetworkMode(mode) && (
          <P2PPanel
            mode={mode}
            status={netStatus}
            role={netRole}
            offerText={offerText}
            answerText={answerText}
            signalInput={signalInput}
            lanUrl={lanUrl}
            lanRoom={lanRoom}
            rooms={roomList}
            roomListState={roomListState}
            error={netError}
            ready={netReady}
            onClose={() => setNetPanelOpen(false)}
            onCreateOffer={createOffer}
            onAcceptOffer={acceptOffer}
            onAcceptAnswer={acceptAnswer}
            onApplySignalInput={applySignalInput}
            onConnectLan={connectLan}
            onCreateRelayRoom={createRelayRoom}
            onJoinRelayRoom={joinRelayRoom}
            onRefreshRooms={loadRooms}
            onLanUrlChange={setLanUrl}
            onLanRoomChange={setLanRoom}
            onReady={markLocalReady}
            onSignalInput={setSignalInput}
            onCopyOffer={() => navigator.clipboard.writeText(offerText)}
            onCopyAnswer={() => navigator.clipboard.writeText(answerText)}
            onDisconnect={closePeerConnection}
          />
        )}

        <section className="switcher" aria-label="玩家视角">
          <span className="mode-badge">
            {modeLabel(mode)}
          </span>
          {perspectiveIds.map((id) => (
            <button
              key={id}
              className={selectedPlayer === id ? 'active' : ''}
              onClick={() => setSelectedPlayer(id)}
            >
              {game.players[id].label}
            </button>
          ))}
        </section>

        {isFourPlayer ? (
          <section className="battlefield battlefield-four">
            <FourPlayerSeat
              className="seat-left"
              player={game.players.p2}
              selected={currentPlayer === 'p2'}
              perspective="enemy"
              inspected={game.inspected}
              onSelect={() => setDetailPlayerId('p2')}
              onInspect={setDetailCard}
            />
            <FourPlayerSeat
              className="seat-top"
              player={game.players.p3}
              selected={currentPlayer === 'p3'}
              perspective={mode === 'team4' ? 'ally' : 'enemy'}
              inspected={game.inspected}
              onSelect={() => setDetailPlayerId('p3')}
              onInspect={setDetailCard}
            />
            <FourPlayerSeat
              className="seat-right"
              player={game.players.p4}
              selected={currentPlayer === 'p4'}
              perspective="enemy"
              inspected={game.inspected}
              onSelect={() => setDetailPlayerId('p4')}
              onInspect={setDetailCard}
            />

            <section className="center-panel center-panel-four">
              <div className="phase-chip">
                <Zap size={15} />
                {phaseLabel(game)}
                {canAction && actionActor ? ` · ${actionActor.name}` : ''}
              </div>
              <button className="primary-action turn-action" onClick={advance} disabled={!canUsePhaseButton}>
                <Play size={17} />
                {isAiTurn ? 'AI行动中' : !isActivePerspective ? '切到当前玩家' : canAction ? (actionActor ? '选择目标' : '结束行动') : '进入下一阶段'}
              </button>
              {canAction && actionActor ? (
                <button className="mini-action turn-skip-action" onClick={skipCurrentAction} disabled={!canUsePhaseButton}>
                  <ChevronRight size={15} />
                  跳过行动
                </button>
              ) : null}
            </section>

            <FourPlayerSeat
              className="seat-self"
              player={game.players.p1}
              selected={currentPlayer === 'p1'}
              perspective="self"
              inspected={game.inspected}
              onSelect={() => setDetailPlayerId('p1')}
              onInspect={setDetailCard}
            />
          </section>
        ) : (
          <section className="battlefield">
            <PlayerArea
              player={enemy}
              perspective="enemy"
              inspected={game.inspected}
              onInspect={setDetailCard}
            />
            <section className="center-panel">
              <div className="phase-chip">
                <Zap size={15} />
                {phaseLabel(game)}
                {canAction && actionActor ? ` · ${actionActor.name}` : ''}
              </div>
              <button className="primary-action turn-action" onClick={advance} disabled={!canUsePhaseButton}>
                <Play size={17} />
                {isAiTurn ? 'AI行动中' : !isActivePerspective ? '切到当前玩家' : canAction ? (actionActor ? '选择目标' : '结束行动') : '进入下一阶段'}
              </button>
              {canAction && actionActor ? (
                <button className="mini-action turn-skip-action" onClick={skipCurrentAction} disabled={!canUsePhaseButton}>
                  <ChevronRight size={15} />
                  跳过行动
                </button>
              ) : null}
            </section>
            <PlayerArea
              player={visiblePlayer}
              perspective="self"
              inspected={game.inspected}
              onInspect={setDetailCard}
            />
          </section>
        )}

        <section className="hand-tray">
          <div className="hand-title">
            <span>手牌</span>
            <span>{visiblePlayer.hand.length} 张</span>
          </div>
          <div className="hand-actions">
            <button className="mini-action" onClick={openCycle} disabled={!canCycle}>
              <RotateCcw size={14} />
              1点换1张
            </button>
            <span>{visiblePlayer.skill} 点可用</span>
          </div>
          <div className="hand-scroll">
            {visiblePlayer.hand.map((card) => (
              <CardMini
                key={card.instanceId}
                card={card}
                selected={selectedHandCardId === card.instanceId}
                disabled={!canPlay || Boolean(victor) || !canPlayCard(game, selectedPlayer, card)}
                disabledReason={
                  victor
                    ? '对局已经结束。'
                    : !canPlay
                      ? '现在不是你的出牌阶段。'
                      : getCannotPlayReason(game, selectedPlayer, card)
                }
                onClick={() => handleHandCard(card)}
                onInspect={() => setDetailCard(card)}
              />
            ))}
          </div>
        </section>

        <aside className={`info-drawer ${drawerOpen ? 'open' : ''}`}>
          <button
            className="drawer-toggle"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label={drawerOpen ? '收起提示' : '打开提示'}
          >
            {drawerOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <div className="drawer-content">
            <header>
              <strong>对局提示</strong>
              <span>{modeLabel(mode)}</span>
            </header>
            <p className="drawer-status">{statusText}</p>
            <div className="drawer-log">
              {game.log.map((item, index) => (
                <p key={`${item}-${index}`}>{visibleLogLine(item, game, selectedPlayer)}</p>
              ))}
            </div>
          </div>
        </aside>

        {detailCard && (
          <CardDetail card={detailCard} onClose={() => setDetailCard(null)} />
        )}

        {detailPlayerId && game.players[detailPlayerId] && (
          <PlayerDetailOverlay
            player={game.players[detailPlayerId]}
            perspective={detailPlayerId === 'p1' ? 'self' : 'enemy'}
            inspected={game.inspected}
            onClose={() => setDetailPlayerId(null)}
            onInspect={setDetailCard}
          />
        )}

        {pendingFallOwnerId && pendingFallOwner && (!isNetwork || pendingFallOwnerId === localSeat) && !(mode === 'pve' && pendingFallOwnerId === 'p2') && (
          <FallChoicePicker
            owner={pendingFallOwner}
            enemy={game.players[pendingFallOwner.pendingFallChoice.enemyId]}
            onSelect={(option) => updateGame((current) => resolveFallChoice(current, pendingFallOwnerId, option))}
          />
        )}

        {targetRequest?.type === 'wordlessBook' && (
          <WordlessBookPicker
            card={targetRequest.card}
            onCancel={() => setTargetRequest(null)}
            onSelect={resolveTarget}
          />
        )}

        {targetRequest?.type === 'selectCard' && (
          <CardSelectPicker
            card={targetRequest.card}
            choices={targetRequest.choices}
            onCancel={() => setTargetRequest(null)}
            onSelect={resolveTarget}
          />
        )}

        {targetRequest && !['wordlessBook', 'selectCard'].includes(targetRequest.type) && (
          <TargetPicker
            card={targetRequest.card ?? targetRequest.actor}
            enemies={getEnemyIds(game, targetRequest.playerId).map((id) => game.players[id]).filter(Boolean)}
            actor={targetRequest.actor}
            onCancel={() => setTargetRequest(null)}
            onSelect={resolveTarget}
          />
        )}

        {cycleRequest && (
          <CyclePicker
            hand={visiblePlayer.hand}
            onCancel={() => setCycleRequest(null)}
            onSelect={resolveCycle}
          />
        )}
      </section>
    </main>
  );
}

function StartScreen({ playerName, stats, settings, onSettingsChange, onNameChange, onResetStats, onImportSave, onStart }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftName, setDraftName] = useState(playerName);
  const [draftSettings, setDraftSettings] = useState(settings);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [devCard, setDevCard] = useState({ name: '', type: 'skill', artName: '', artDataUrl: '', code: '' });
  const [updateState, setUpdateState] = useState({ status: 'idle', message: '', result: null });
  const [updateProgress, setUpdateProgress] = useState(0);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardState, setLeaderboardState] = useState({ status: 'idle', players: [], message: '' });
  const [saveCodeOpen, setSaveCodeOpen] = useState(false);
  const [saveCodeText, setSaveCodeText] = useState('');
  const [saveCodeMsg, setSaveCodeMsg] = useState('');

  useEffect(() => {
    setDraftName(playerName);
  }, [playerName]);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle = null;
    let active = true;
    NativeUpdater.addListener('downloadProgress', (event) => {
      if (!active) return;
      const percent = Number.isFinite(event?.percent) ? Math.max(0, Math.min(100, event.percent)) : null;
      if (percent != null) setUpdateProgress(percent);
    }).then((listener) => {
      handle = listener;
    });
    return () => {
      active = false;
      handle?.remove?.();
    };
  }, []);

  function saveName(event) {
    event.preventDefault();
    onNameChange(draftName);
    onSettingsChange({
      ...draftSettings,
      uiScale: Math.min(300, Math.max(1, Number(draftSettings.uiScale) || 100)),
      fontScale: Math.min(200, Math.max(50, Number(draftSettings.fontScale) || 100)),
      handCardScale: Math.min(250, Math.max(70, Number(draftSettings.handCardScale) || DEFAULT_SETTINGS.handCardScale)),
      handGap: Math.min(80, Math.max(-40, Number(draftSettings.handGap) || DEFAULT_SETTINGS.handGap)),
      handTextScale: Math.min(200, Math.max(50, Number(draftSettings.handTextScale) || DEFAULT_SETTINGS.handTextScale)),
      boardCardScale: Math.min(180, Math.max(70, Number(draftSettings.boardCardScale) || DEFAULT_SETTINGS.boardCardScale)),
      startScale: Math.min(160, Math.max(60, Number(draftSettings.startScale) || DEFAULT_SETTINGS.startScale)),
      gameOffsetX: Math.min(300, Math.max(-300, Number(draftSettings.gameOffsetX) || DEFAULT_SETTINGS.gameOffsetX)),
      gameOffsetY: Math.min(300, Math.max(-300, Number(draftSettings.gameOffsetY) || DEFAULT_SETTINGS.gameOffsetY)),
      updateRepo: normalizeGitHubRepo(draftSettings.updateRepo),
      updateProxy: normalizeUpdateProxy(draftSettings.updateProxy),
    });
    setSettingsOpen(false);
  }

  function handleExportSave() {
    // 把当前名字/胜负/设置打包成一段可复制的存档码（base64，兼容中文）
    const payload = {
      v: 1,
      name: draftName,
      stats,
      settings: draftSettings,
    };
    try {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      setSaveCodeText(code);
      setSaveCodeOpen(true);
      setSaveCodeMsg('已生成存档码，复制保存即可。');
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(
          () => setSaveCodeMsg('存档码已复制到剪贴板，请妥善保存。'),
          () => {},
        );
      }
    } catch {
      setSaveCodeMsg('生成存档码失败。');
      setSaveCodeOpen(true);
    }
  }

  function handleImportSave() {
    const raw = saveCodeText.trim();
    if (!raw) {
      setSaveCodeMsg('请先粘贴存档码。');
      return;
    }
    try {
      const json = decodeURIComponent(escape(atob(raw)));
      const payload = JSON.parse(json);
      onImportSave({
        name: typeof payload.name === 'string' ? payload.name : undefined,
        stats: payload.stats,
        settings: payload.settings,
      });
      setSaveCodeMsg('存档已导入。');
    } catch {
      setSaveCodeMsg('存档码无效，无法导入。');
    }
  }

  async function handleCheckUpdate() {
    const repo = normalizeGitHubRepo(draftSettings.updateRepo);
    setDraftSettings((current) => ({ ...current, updateRepo: repo }));
    setUpdateState({ status: 'checking', message: '正在检查 GitHub 最新版本...', result: null });
    const controller = new AbortController();
    try {
      const result = await checkGitHubUpdate(repo, controller.signal);
      setUpdateState({
        status: result.hasUpdate ? 'ready' : 'current',
        message: result.hasUpdate
          ? `发现新版本 ${result.tag || result.version}，当前 ${APP_VERSION}`
          : `已经是最新版本：${APP_VERSION}`,
        result,
      });
    } catch (error) {
      setUpdateState({
        status: 'error',
        message: error instanceof Error ? error.message : '检查更新失败。',
        result: null,
      });
    }
  }

  async function openUpdateDownload() {
    const url = proxyGitHubDownloadUrl(updateState.result?.url, draftSettings.updateProxy);
    if (!url) return;
    if (!Capacitor.isNativePlatform()) {
      window.open(url, '_blank', 'noopener,noreferrer') || window.location.assign(url);
      return;
    }

    setUpdateState((current) => ({
      ...current,
      status: 'downloading',
      message: '正在应用内下载 APK，下载完成后会打开安装界面。',
    }));
    setUpdateProgress(0);

    try {
      await NativeUpdater.downloadAndInstall({
        url,
        fileName: updateState.result?.apkName || `xinghui-${updateState.result?.tag || APP_VERSION}.apk`,
      });
      setUpdateProgress(100);
      setUpdateState((current) => ({
        ...current,
        status: 'installing',
        message: 'APK 已下载，正在打开系统安装界面。',
      }));
    } catch (error) {
      setUpdateState((current) => ({
        ...current,
        status: 'error',
        message: error instanceof Error ? error.message : '下载安装失败。',
      }));
      setUpdateProgress(0);
    }
  }

  function addDeveloperCard() {
    if (!devCard.name.trim()) return;
    setDraftSettings((current) => ({
      ...current,
      developerCards: [
        ...(current.developerCards ?? []),
        { ...devCard, id: `custom-${Date.now()}`, name: devCard.name.trim(), createdAt: new Date().toISOString() },
      ],
    }));
    setDevCard({ name: '', type: 'skill', artName: '', artDataUrl: '', code: '' });
  }

  function applyDeveloperTemplate(label) {
    const template = CUSTOM_CARD_TEMPLATES.find((item) => item.label === label);
    if (!template) return;
    setDevCard((current) => ({
      ...current,
      type: template.type,
      code: template.code,
    }));
  }

  function removeDeveloperCard(id) {
    setDraftSettings((current) => ({
      ...current,
      developerCards: (current.developerCards ?? []).filter((card) => card.id !== id),
    }));
  }

  async function loadLeaderboard() {
    setLeaderboardOpen(true);
    setLeaderboardState((current) => ({ ...current, status: 'loading', message: '正在读取排行榜...' }));
    const controller = new AbortController();
    try {
      const players = await fetchLeaderboard(controller.signal);
      setLeaderboardState({ status: 'ready', players, message: players.length ? '' : '排行榜暂时没有记录。' });
    } catch (error) {
      setLeaderboardState({
        status: 'error',
        players: [],
        message: error instanceof Error ? error.message : '排行榜读取失败。',
      });
    }
  }

  function readDeveloperArt(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDevCard((current) => ({
        ...current,
        artName: file.name,
        artDataUrl: typeof reader.result === 'string' ? reader.result : '',
      }));
    };
    reader.readAsDataURL(file);
  }

  return (
    <main
      className={`app-shell ${developerOpen ? 'developer-portrait' : ''}`}
      style={{
        '--ui-scale': (settings.uiScale ?? 100) / 100,
        '--font-scale': (settings.fontScale ?? 100) / 100,
        '--start-scale': (settings.startScale ?? DEFAULT_SETTINGS.startScale) / 100,
        '--app-window-offset-x': `${settings.gameOffsetX ?? 0}px`,
        '--app-window-offset-y': `${settings.gameOffsetY ?? 0}px`,
        fontSize: `${settings.fontScale ?? 100}%`,
      }}
    >
      <section className="start-screen">
        <button className="start-settings-button" onClick={() => setSettingsOpen((open) => !open)} aria-label="设置名字">
          <Cog size={18} />
          <span>{playerName}</span>
        </button>
        {settingsOpen && (
          <form className="start-settings-panel full-settings-panel" onSubmit={saveName}>
            <label className="settings-row">
              <span>音乐开关</span>
              <input
                type="checkbox"
                checked={Boolean(draftSettings.musicEnabled)}
                onChange={(event) => setDraftSettings((current) => ({ ...current, musicEnabled: event.target.checked }))}
              />
            </label>
            <label htmlFor="music-url">音乐 API / 音频 URL</label>
            <input
              id="music-url"
              value={draftSettings.musicUrl ?? ''}
              onChange={(event) => setDraftSettings((current) => ({ ...current, musicUrl: event.target.value }))}
              placeholder="https://example.com/music.mp3 或返回 {&quot;url&quot;:&quot;...&quot;} 的 API"
            />
            <label htmlFor="player-name">我的名字</label>
            <input
              id="player-name"
              value={draftName}
              maxLength={10}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="玩家"
            />
            <div>
              <button type="submit" className="primary-action">保存</button>
              <button type="button" className="mini-action" onClick={() => setSettingsOpen(false)}>取消</button>
            </div>
            <button type="button" className="mini-action" onClick={onResetStats}>重置胜负统计</button>
            <div className="save-code-actions">
              <button type="button" className="mini-action" onClick={handleExportSave}>导出存档</button>
              <button type="button" className="mini-action" onClick={() => { setSaveCodeOpen((open) => !open); setSaveCodeMsg(''); }}>
                {saveCodeOpen ? '收起存档码' : '导入存档'}
              </button>
            </div>
            {saveCodeOpen && (
              <div className="save-code-panel">
                <textarea
                  value={saveCodeText}
                  onChange={(event) => setSaveCodeText(event.target.value)}
                  placeholder="粘贴存档码后点“导入此存档”，或点“导出存档”生成当前存档码"
                  rows={3}
                />
                <div className="save-code-buttons">
                  <button type="button" className="primary-action" onClick={handleImportSave}>导入此存档</button>
                </div>
                {saveCodeMsg ? <p className="save-code-msg">{saveCodeMsg}</p> : null}
              </div>
            )}
            <label htmlFor="ui-scale">界面大小 1-300%</label>
            <input
              id="ui-scale"
              type="number"
              min="1"
              max="300"
              value={draftSettings.uiScale ?? 100}
              onChange={(event) => setDraftSettings((current) => ({ ...current, uiScale: event.target.value }))}
            />
            <label htmlFor="font-scale">字体大小 50-200%</label>
            <input
              id="font-scale"
              type="number"
              min="50"
              max="200"
              value={draftSettings.fontScale ?? 100}
              onChange={(event) => setDraftSettings((current) => ({ ...current, fontScale: event.target.value }))}
            />
            <label htmlFor="update-repo">GitHub 更新仓库</label>
            <input
              id="update-repo"
              value={draftSettings.updateRepo ?? ''}
              onChange={(event) => setDraftSettings((current) => ({ ...current, updateRepo: event.target.value }))}
              placeholder="用户名/仓库名"
            />
            <label htmlFor="update-proxy">更新加速节点</label>
            <select
              id="update-proxy"
              className="settings-select"
              value={
                PROXY_PRESETS.some((p) => p.value === (draftSettings.updateProxy ?? DEFAULT_UPDATE_PROXY))
                  ? (draftSettings.updateProxy ?? DEFAULT_UPDATE_PROXY)
                  : '__custom__'
              }
              onChange={(event) => {
                const v = event.target.value;
                if (v === '__custom__') {
                  setDraftSettings((current) => ({ ...current, updateProxy: current.updateProxy || '' }));
                } else {
                  setDraftSettings((current) => ({ ...current, updateProxy: v }));
                }
              }}
            >
              {PROXY_PRESETS.map((preset) => (
                <option key={preset.value || 'direct'} value={preset.value}>{preset.label}</option>
              ))}
              <option value="__custom__">自定义…</option>
            </select>
            {!PROXY_PRESETS.some((p) => p.value === (draftSettings.updateProxy ?? DEFAULT_UPDATE_PROXY)) && (
              <input
                id="update-proxy-custom"
                value={draftSettings.updateProxy ?? ''}
                onChange={(event) => setDraftSettings((current) => ({ ...current, updateProxy: event.target.value }))}
                placeholder="输入自定义加速地址，留空则直连"
              />
            )}
            <section className={`update-panel ${updateState.status}`}>
              <div className="update-version-row">
                <span>当前版本</span>
                <strong>v{APP_VERSION}</strong>
              </div>
              <div className="update-actions">
                <button type="button" className="mini-action" onClick={handleCheckUpdate} disabled={updateState.status === 'checking'}>
                  <RefreshCw size={14} />
                  {updateState.status === 'checking' ? '检查中' : '检查更新'}
                </button>
                {updateState.result?.url && ['ready', 'installing'].includes(updateState.status) ? (
                  <button
                    type="button"
                    className="primary-action"
                    onClick={openUpdateDownload}
                    disabled={updateState.status === 'installing'}
                  >
                    <Download size={14} />
                    {updateState.status === 'installing' ? '安装中' : '下载并安装'}
                  </button>
                ) : null}
              </div>
              {['downloading', 'installing'].includes(updateState.status) ? (
                <div className="update-progress" aria-label={`下载进度 ${Math.round(updateProgress)}%`}>
                  <div className="update-progress-track">
                    <span style={{ width: `${Math.max(0, Math.min(100, updateProgress))}%` }} />
                  </div>
                  <strong>{Math.round(updateProgress)}%</strong>
                </div>
              ) : null}
              <div className="update-proxy-preview">
                节点：{normalizeUpdateProxy(draftSettings.updateProxy) || '不使用加速'}
              </div>
              {updateState.message ? <p>{updateState.message}</p> : <p>发布 GitHub Release 后，手机端可在这里检查并下载 APK。</p>}
            </section>
            <button type="button" className="mini-action" onClick={() => setDeveloperOpen((open) => !open)}>
              {developerOpen ? '关闭开发者模式' : '开发者模式'}
            </button>
            <details className="advanced-ui-settings">
              <summary>高级界面设置</summary>
              <label htmlFor="hand-card-scale">手牌卡牌大小 70-250%</label>
              <input
                id="hand-card-scale"
                type="number"
                min="70"
                max="250"
                value={draftSettings.handCardScale ?? DEFAULT_SETTINGS.handCardScale}
                onChange={(event) => setDraftSettings((current) => ({ ...current, handCardScale: event.target.value }))}
              />
              <label htmlFor="hand-gap">手牌间距 -40 到 80</label>
              <input
                id="hand-gap"
                type="number"
                min="-40"
                max="80"
                value={draftSettings.handGap ?? DEFAULT_SETTINGS.handGap}
                onChange={(event) => setDraftSettings((current) => ({ ...current, handGap: event.target.value }))}
              />
              <label htmlFor="hand-text-scale">手牌文字大小 50-200%</label>
              <input
                id="hand-text-scale"
                type="number"
                min="50"
                max="200"
                value={draftSettings.handTextScale ?? DEFAULT_SETTINGS.handTextScale}
                onChange={(event) => setDraftSettings((current) => ({ ...current, handTextScale: event.target.value }))}
              />
              <label htmlFor="board-card-scale">场上卡牌大小 70-180%</label>
              <input
                id="board-card-scale"
                type="number"
                min="70"
                max="180"
                value={draftSettings.boardCardScale ?? DEFAULT_SETTINGS.boardCardScale}
                onChange={(event) => setDraftSettings((current) => ({ ...current, boardCardScale: event.target.value }))}
              />
              <label htmlFor="start-scale">主界面大小 60-160%</label>
              <input
                id="start-scale"
                type="number"
                min="60"
                max="160"
                value={draftSettings.startScale ?? DEFAULT_SETTINGS.startScale}
                onChange={(event) => setDraftSettings((current) => ({ ...current, startScale: event.target.value }))}
              />
              <label htmlFor="game-offset-x">游戏窗口左右移动 -300 到 300</label>
              <input
                id="game-offset-x"
                type="number"
                min="-300"
                max="300"
                value={draftSettings.gameOffsetX ?? DEFAULT_SETTINGS.gameOffsetX}
                onChange={(event) => setDraftSettings((current) => ({ ...current, gameOffsetX: event.target.value }))}
              />
              <label htmlFor="game-offset-y">游戏窗口上下移动 -300 到 300</label>
              <input
                id="game-offset-y"
                type="number"
                min="-300"
                max="300"
                value={draftSettings.gameOffsetY ?? DEFAULT_SETTINGS.gameOffsetY}
                onChange={(event) => setDraftSettings((current) => ({ ...current, gameOffsetY: event.target.value }))}
              />
            </details>
            {developerOpen && (
              <section className="developer-panel">
                <h2>卡牌与代码</h2>
                <div className="developer-card-form">
                  <select defaultValue="" onChange={(event) => applyDeveloperTemplate(event.target.value)}>
                    <option value="" disabled>选择 skill 模板</option>
                    {CUSTOM_CARD_TEMPLATES.map((template) => (
                      <option key={template.label} value={template.label}>{template.label}</option>
                    ))}
                  </select>
                  <input value={devCard.name} onChange={(event) => setDevCard((current) => ({ ...current, name: event.target.value }))} placeholder="新卡牌名字" />
                  <select value={devCard.type} onChange={(event) => setDevCard((current) => ({ ...current, type: event.target.value }))}>
                    <option value="skill">技能</option>
                    <option value="character">角色</option>
                    <option value="equipment">装备</option>
                    <option value="scene">场景</option>
                    <option value="hidden">暗置</option>
                    <option value="food">食物</option>
                  </select>
                  <input value={devCard.artName} onChange={(event) => setDevCard((current) => ({ ...current, artName: event.target.value }))} placeholder="插图文件名或资源名" />
                  <input type="file" accept="image/*" onChange={readDeveloperArt} />
                  {devCard.artDataUrl ? <img className="developer-art-preview" src={devCard.artDataUrl} alt="" /> : null}
                  <textarea value={devCard.code} onChange={(event) => setDevCard((current) => ({ ...current, code: event.target.value }))} placeholder='skill 写法示例：{"effect":"healSelf","value":20,"cost":1}' />
                  <button type="button" className="mini-action" onClick={addDeveloperCard}>保存自定义卡</button>
                </div>
                <details className="developer-skill-guide">
                  <summary>skill 写法</summary>
                  <ul>
                    {CUSTOM_CARD_SKILL_FIELDS.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  <div className="developer-code-examples">
                    {CUSTOM_CARD_CODE_EXAMPLES.map((example) => (
                      <div key={example.title}>
                        <strong>{example.title}</strong>
                        <pre>{example.code}</pre>
                      </div>
                    ))}
                  </div>
                </details>
                <div className="developer-list">
                  {availableDeckCards(draftSettings.developerCards).map((card) => (
                    <details key={card.id}>
                      <summary>
                        <span>{card.name} · {card.type}</span>
                        {card.id?.startsWith('custom-') ? (
                          <button type="button" className="delete-card" onClick={(event) => {
                            event.preventDefault();
                            removeDeveloperCard(card.id);
                          }}>删除</button>
                        ) : null}
                      </summary>
                      <pre>{JSON.stringify({
                        id: card.id,
                        name: card.name,
                        type: card.type,
                        cost: card.cost,
                        valueText: card.valueText,
                        effect: card.effect,
                        text: card.text,
                        skill: card.customCode ?? card.effect ?? 'none',
                        artDataUrl: card.artDataUrl ? 'uploaded' : undefined,
                      }, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              </section>
            )}
          </form>
        )}
        <div className="start-title">
          <span>像素卡牌对战</span>
          <h1>星辉牌局</h1>
          <p>选择对战方式后进入牌局。</p>
        </div>
        <div className="start-stats" aria-label="统计信息">
          <strong>统计信息</strong>
          <span>胜利 {stats.wins}</span>
          <span>失败 {stats.losses}</span>
          <button type="button" className="mini-action leaderboard-button" onClick={loadLeaderboard}>排行榜</button>
        </div>
        {leaderboardOpen && (
          <section className="leaderboard-panel">
            <header>
              <strong>排行榜</strong>
              <button type="button" className="mini-action" onClick={() => setLeaderboardOpen(false)}>关闭</button>
            </header>
            {leaderboardState.status === 'loading' ? <p>{leaderboardState.message}</p> : null}
            {leaderboardState.message && leaderboardState.status !== 'loading' ? <p>{leaderboardState.message}</p> : null}
            <div className="leaderboard-list">
              {leaderboardState.players.slice(0, 10).map((player, index) => (
                <div className="leaderboard-row" key={`${player.name}-${index}`}>
                  <span>{index + 1}</span>
                  <strong>{player.name}</strong>
                  <em>{player.wins}胜 / {player.losses}败</em>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="start-actions">
          <button className="start-card primary" onClick={() => onStart('pve')}>
            <strong>人机对战</strong>
            <span>你操控自己的牌组，对手由 Bot 自动行动。</span>
          </button>
          <button className="start-card" onClick={() => onStart('pvp')}>
            <strong>双人对战</strong>
            <span>同一设备轮流操作，适合本地测试规则。</span>
          </button>
          <button className="start-card" onClick={() => onStart('p2p')}>
            <strong>P2P 联机</strong>
            <span>手动交换信令后远程对局。</span>
          </button>
          <button className="start-card" onClick={() => onStart('lan')}>
            <strong>局域网联机</strong>
            <span>同一 Wi-Fi 下连接房间，默认端口 18781。</span>
          </button>
          <button className="start-card" onClick={() => onStart('relay')}>
            <strong>服务器联机</strong>
            <span>通过服务器大厅创建或加入房间。</span>
          </button>
          <button className="start-card" onClick={() => onStart('ffa4')}>
            <strong>4人自由战</strong>
            <span>你在右下角操作自己，另外三个座位由 AI 控制。</span>
          </button>
          <button className="start-card" onClick={() => onStart('team4')}>
            <strong>4人组队战</strong>
            <span>P1+P3 对 P2+P4，其余座位先由 AI 控制。</span>
          </button>
        </div>
      </section>
    </main>
  );
}

function CoinIntro({ firstPlayer }) {
  return (
    <div className="coin-intro" aria-live="polite">
      <div className="intro-coin">
        <span>{firstPlayer?.id === 'p1' ? '一' : '二'}</span>
      </div>
      <strong>{firstPlayer?.label} 先手</strong>
    </div>
  );
}

function VictoryOverlay({ victor, onRestart, onHome }) {
  return (
    <div className="victory-overlay" aria-live="assertive">
      <article className="victory-panel">
        <span className="victory-kicker">胜负已定</span>
        <h2>{victor.label} 获胜</h2>
        <div className="victory-shine" aria-hidden="true" />
        <div className="victory-actions">
          <button className="primary-action" onClick={onRestart}>
            再来一局
          </button>
          <button className="mini-action" onClick={onHome}>
            回主菜单
          </button>
        </div>
      </article>
    </div>
  );
}

function P2PPanel({
  mode,
  status,
  role,
  offerText,
  answerText,
  signalInput,
  lanUrl,
  lanRoom,
  rooms,
  roomListState,
  error,
  ready,
  onClose,
  onCreateOffer,
  onAcceptOffer,
  onAcceptAnswer,
  onApplySignalInput,
  onConnectLan,
  onCreateRelayRoom,
  onJoinRelayRoom,
  onRefreshRooms,
  onLanUrlChange,
  onLanRoomChange,
  onReady,
  onSignalInput,
  onCopyOffer,
  onCopyAnswer,
  onDisconnect,
}) {
  return (
    <div className="detail-overlay p2p-overlay" onClick={onClose}>
      <article className="p2p-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        <header className="p2p-header">
          <div>
            <h2>{modeLabel(mode)}</h2>
            <p>{status}{role ? ` · ${role === 'host' ? '房主' : '加入方'}` : ''}</p>
          </div>
          <div className="p2p-actions">
            <button className="mini-action" onClick={onDisconnect}>断开</button>
          </div>
        </header>
        {mode === 'p2p' ? (
          <div className="p2p-ready">
            <span className={ready?.local ? 'ready' : ''}>本机{ready?.local ? '已准备' : '未准备'}</span>
            <span className={ready?.remote ? 'ready' : ''}>对方{ready?.remote ? '已准备' : '未准备'}</span>
            <button className="primary-action" onClick={onReady} disabled={ready?.local}>
              我准备好了
            </button>
          </div>
        ) : null}
        {mode !== 'p2p' ? (
          mode === 'relay' ? (
            <section className="room-lobby">
              <div className="room-server-card">
                <label>
                  服务器地址
                  <input value={lanUrl} onChange={(event) => onLanUrlChange(event.target.value)} placeholder="ws://duoduo1215.xyz:18781" />
                </label>
                <button className="mini-action" onClick={onRefreshRooms}>刷新房间</button>
              </div>

              <div className="room-create-card">
                <div>
                  <span className="room-kicker">快速开局</span>
                  <h3>创建房间</h3>
                  <p>创建后会连接服务器并显示你的名字，其他玩家可以在下面的房间列表点击加入。</p>
                </div>
                <button className="primary-action" onClick={onCreateRelayRoom}>创建房间</button>
              </div>

              <div className="room-list-head">
                <strong>可加入房间</strong>
                <span>{rooms?.length ? `${rooms.length} 个等待中` : '暂无房间'}</span>
              </div>
              <div className="room-list">
                {roomListState?.status === 'loading' ? <p className="room-message">正在刷新房间...</p> : null}
                {roomListState?.message ? <p className="room-message error">{roomListState.message}</p> : null}
                {rooms?.length ? rooms.map((room) => (
                  <button className="room-card" key={room.id} onClick={() => onJoinRelayRoom(room.id)}>
                    <span className="room-avatar">{String(room.hostName || '玩').slice(0, 1)}</span>
                    <span className="room-main">
                      <strong>{room.hostName || '玩家'}</strong>
                      <em>房间 {room.id}</em>
                    </span>
                    <span className="room-count">{room.players}/{room.maxPlayers}</span>
                  </button>
                )) : roomListState?.status !== 'loading' ? (
                  <div className="room-empty">
                    <strong>还没有房间</strong>
                    <span>你可以先创建一个，别人刷新后就能看到。</span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="lan-panel">
              <label>
                局域网地址
                <input value={lanUrl} onChange={(event) => onLanUrlChange(event.target.value)} placeholder="ws://电脑IP:18781" />
              </label>
              <label>
                房间号
                <input value={lanRoom} onChange={(event) => onLanRoomChange(event.target.value)} placeholder="room1" />
              </label>
              <button className="primary-action" onClick={() => onConnectLan()}>连接局域网房间</button>
              <p>运行 npm run relay:18781 可启动联机服务器，默认端口 18781。</p>
            </section>
          )
        ) : (
          <div className="p2p-grid">
          <section>
            <h3>房主</h3>
            <button className="primary-action" onClick={onCreateOffer}>创建并复制本机码</button>
            <textarea value={offerText} readOnly placeholder="创建后会自动复制，也可以手动复制" />
            <button className="mini-action" onClick={onCopyOffer} disabled={!offerText}>再复制一次</button>
          </section>
          <section>
            <h3>粘贴对方码</h3>
            <textarea value={signalInput} onChange={(event) => onSignalInput(event.target.value)} placeholder="粘贴后点自动识别" />
            <button className="primary-action" onClick={onApplySignalInput} disabled={!signalInput.trim()}>自动识别并连接</button>
            <div className="p2p-inline">
              <button className="mini-action" onClick={onAcceptOffer}>生成 Answer</button>
              <button className="mini-action" onClick={onAcceptAnswer}>接收 Answer</button>
            </div>
            <textarea value={answerText} readOnly placeholder="回答码会自动复制，也可以手动复制" />
            <button className="mini-action" onClick={onCopyAnswer} disabled={!answerText}>再复制一次</button>
          </section>
          </div>
        )}        {error ? <p className="p2p-error">{error}</p> : null}
      </article>
    </div>
  );
}

function PlayerArea({ player, perspective, inspected, onInspect }) {
  const isEnemy = perspective === 'enemy';
  return (
    <section className={`player-area ${isEnemy ? 'enemy' : 'self'}`}>
      <PlayerBoard player={player} perspective={perspective} inspected={inspected} onInspect={onInspect} />
      <BattleLine player={player} compact={isEnemy} isEnemy={isEnemy} onInspect={onInspect} />
    </section>
  );
}

function FourPlayerSeat({ player, perspective, selected, className = '', inspected, onSelect, onInspect }) {
  if (!player) return null;
  const hpLimit = player.maxHp ?? PLAYER_BASE_HP;
  const spiritLimit = player.maxSpirit ?? PLAYER_BASE_SPIRIT;
  const pollutionLimit = player.maxPollution ?? INITIAL_POLLUTION_LIMIT;
  const portraitCard = player.characters[0] ?? player.hidden.find((card) => boardZoneOf(card) === 'characters');
  const hiddenPortrait = perspective !== 'self' && portraitCard?.type === 'hidden';
  const markers = [
    { className: 'marker-character', count: player.characters.length + player.hidden.filter((card) => boardZoneOf(card) === 'characters').length },
    { className: 'marker-scene', count: player.scenes.length + player.hidden.filter((card) => boardZoneOf(card) === 'scenes').length },
    { className: 'marker-equipment', count: player.equipment.length + player.hidden.filter((card) => boardZoneOf(card) === 'equipment').length },
    { className: 'marker-hidden', count: player.hidden.length },
  ];

  return (
    <button className={`four-seat ${className} ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="four-seat-stats">
        <strong>{player.label}</strong>
        <span className="mini-stat life">● {player.hp}/{hpLimit}</span>
        <span className="mini-stat spirit">● {player.spirit ?? spiritLimit}/{spiritLimit}</span>
        <span className="mini-stat pollution">● {player.pollution}/{pollutionLimit}</span>
      </div>
      <div className="four-seat-portrait">
        {portraitCard ? (
          hiddenPortrait ? <img src={cardBackUrl} alt="" /> : <CardArt card={portraitCard} className="four-seat-art" />
        ) : (
          <div className="default-avatar" />
        )}
      </div>
      <div className="four-seat-markers" aria-hidden="true">
        {markers.map((marker) => (
          <span key={marker.className} className={marker.className}>{marker.count}</span>
        ))}
      </div>
      <div className="four-seat-cards">
        <SlotGroup icon={<Shield size={12} />} title="装备" cards={player.equipment} limit={2} mode={perspective === 'self' ? 'mini' : 'mini'} onInspect={onInspect} />
        <SlotGroup icon={<Zap size={12} />} title="场景" cards={player.scenes ?? []} limit={3} mode="mini" onInspect={onInspect} />
        <SlotGroup
          icon={<Eye size={12} />}
          title="暗置"
          cards={player.hidden}
          limit={2}
          mode={perspective === 'self' ? 'mini' : 'hidden'}
          revealCards={inspected?.viewer === 'p1' ? inspected.cards : []}
          onInspect={onInspect}
        />
      </div>
    </button>
  );
}

function PlayerDetailOverlay({ player, perspective, inspected, onClose, onInspect }) {
  const isSelf = perspective === 'self';
  const hiddenCards = isSelf ? player.hidden : [];
  return (
    <div className="detail-overlay player-detail-overlay" onClick={onClose}>
      <article className="player-detail-panel" onClick={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        <header className="player-detail-header">
          <strong>{player.label}</strong>
          <div className="player-detail-stats">
            <span className="mini-stat life">● {player.hp}/{player.maxHp ?? PLAYER_BASE_HP}</span>
            <span className="mini-stat spirit">● {player.spirit ?? player.maxSpirit ?? PLAYER_BASE_SPIRIT}/{player.maxSpirit ?? PLAYER_BASE_SPIRIT}</span>
            <span className="mini-stat pollution">● {player.pollution}/{player.maxPollution ?? INITIAL_POLLUTION_LIMIT}</span>
            <span className="mini-stat">◆ {player.skill}</span>
          </div>
        </header>
        <div className="player-detail-zones">
          <DetailZone title="角色" cards={player.characters} emptyText="没有明置角色" onInspect={onInspect} />
          <DetailZone title="装备" cards={player.equipment} emptyText="没有装备" onInspect={onInspect} />
          <DetailZone title="场景" cards={player.scenes ?? []} emptyText="没有场景" onInspect={onInspect} />
          <DetailZone
            title="暗置"
            cards={hiddenCards}
            emptyText={isSelf ? '没有暗置牌' : '对方暗置不可见'}
            hidden={!isSelf}
            onInspect={onInspect}
          />
        </div>
      </article>
    </div>
  );
}

function DetailZone({ title, cards, emptyText, hidden = false, onInspect }) {
  return (
    <section className="detail-zone">
      <h3>{title}</h3>
      <div className="detail-zone-cards">
        {hidden ? <div className="detail-zone-empty">{emptyText}</div> : null}
        {!hidden && cards.length === 0 ? <div className="detail-zone-empty">{emptyText}</div> : null}
        {!hidden && cards.map((card) => (
          <button className="detail-zone-card" key={card.instanceId} onClick={() => onInspect(card)}>
            <CardArt card={card} className="detail-zone-art" />
            <span>{card.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PlayerBoard({ player, perspective, inspected, onInspect }) {
  const isEnemy = perspective === 'enemy';
  const inspectedCards = inspected?.cards ?? [];
  const pollutionLimit = player.maxPollution ?? INITIAL_POLLUTION_LIMIT;
  const hpLimit = player.maxHp ?? PLAYER_BASE_HP;
  const spiritLimit = player.maxSpirit ?? PLAYER_BASE_SPIRIT;
  const spiritValue = player.spirit ?? spiritLimit;
  return (
    <section className={`player-board ${isEnemy ? 'enemy' : ''}`}>
      <div className="player-stat">
        <strong>{player.label}</strong>
      </div>
      <div className="life-meter" aria-label={`生命 ${player.hp} / ${hpLimit}`}>
        <div className="meter-label">
          <span>生命</span>
          <span>{player.hp} / {hpLimit}</span>
        </div>
        <div className="meter-track meter-life">
          <div className="meter-fill" style={{ width: `${Math.min(player.hp, hpLimit) / hpLimit * 100}%` }} />
        </div>
      </div>
      <div className="spirit-meter" aria-label={`精神力 ${spiritValue} / ${spiritLimit}`}>
        <div className="meter-label spirit-label">
          <span>
            <img src={spiritIconUrl} alt="" />
            精神力</span>
          <span>{spiritValue} / {spiritLimit}</span>
        </div>
        <div className="meter-track meter-spirit">
          <div className="meter-fill" style={{ width: `${Math.min(spiritValue, spiritLimit) / spiritLimit * 100}%` }} />
        </div>
      </div>
      <div className="skill-chip" aria-label={`技能点 ${player.skill}`}>
        <img src={skillIconUrl} alt="" />
        <span>{player.skill}</span>
        <small>技能点</small>
      </div>
      <div className="pollution-meter" aria-label={`污染 ${player.pollution} / ${pollutionLimit}`}>
        <div className="pollution-label">
          <span>污染</span>
          <span>{player.pollution} / {pollutionLimit}</span>
        </div>
        <div className="pollution-track">
          <div className="pollution-fill" style={{ width: `${Math.min(player.pollution, pollutionLimit) / pollutionLimit * 100}%` }} />
        </div>
      </div>
      <div className="slots">
        <SlotGroup icon={<Shield size={14} />} title="装备" cards={player.equipment} limit={2} mode="mini" onInspect={onInspect} />
        <SlotGroup icon={<Zap size={14} />} title="场景" cards={player.scenes ?? []} limit={3} mode="mini" onInspect={onInspect} />
        <SlotGroup
          icon={<Eye size={14} />}
          title="暗置"
          cards={player.hidden}
          limit={2}
          mode={isEnemy ? 'hidden' : 'mini'}
          revealCards={inspectedCards}
          onInspect={onInspect}
        />
      </div>
    </section>
  );
}

function BattleLine({ player, compact = false, isEnemy = false, onInspect }) {
  const hiddenCharacters = player.hidden.filter((card) => boardZoneOf(card) === 'characters');
  const boardCharacters = [...player.characters, ...hiddenCharacters];
  return (
    <section className={`battle-line ${compact ? 'compact' : ''}` }>
      <div className="line-label">
        <Swords size={14} />
        {'\u89d2\u8272'} {boardCharacters.length}/3
      </div>
      <div className="character-row">
        {Array.from({ length: 3 }).map((_, index) => {
          const card = boardCharacters[index];
          const hidden = isEnemy && card?.type === 'hidden';
          const hpText = card?.currentHp == null ? '\u7279\u6b8a' : `${card.currentHp} \u8840`;
          return card ? (
            <button className={`unit-card ${card?.type === 'hidden' ? 'unit-hidden' : ''}`} key={card.instanceId} onClick={() => hidden ? null : onInspect(card)}>
              {hidden ? <img className="unit-back" src={cardBackUrl} alt="" /> : <CardArt card={card} className="unit-art" />}
              <strong>{hidden ? '\u6697\u7f6e' : card.name}</strong>
              <small>{hidden ? '\u4e0d\u53ef\u89c1' : `${card.atk} \u653b / ${hpText}`}</small>
              {!hidden && card.spirit != null ? <small>{'\u7cbe\u795e'} {card.spirit}</small> : null}
              {!hidden && (card.shield ?? 0) > 0 ? <small>{'\u62a4\u76fe'} {card.shield}</small> : null}
            </button>
          ) : (
            <div className="empty-slot" key={index} />
          );
        })}
      </div>
    </section>
  );
}
function SlotGroup({ icon, title, cards, limit, mode, revealCards = [], onInspect }) {
  return (
    <div className="slot-group">
      <div className="slot-title">
        {icon}
        {title} {cards.length}/{limit}
      </div>
      <div className="slot-row">
        {Array.from({ length: limit }).map((_, index) => {
          const card = cards[index];
          const reveal = revealCards[index];
          if (!card) return <div className="small-empty" key={index} />;
          if (mode === 'hidden') {
            return (
              <button
                className="hidden-back"
                key={card.instanceId}
                onClick={() => reveal ? onInspect(reveal) : null}
              >
                {reveal ? <span>{reveal.name}</span> : <span>暗置</span>}
              </button>
            );
          }
          return (
            <button className={`small-card ${card.type}`} key={card.instanceId} onClick={() => onInspect(card)}>
              {(card.gear || card.tags?.includes('齿轮')) && <Cog className="small-gear" size={12} aria-label="齿轮标记" />}
              <span>{card.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CardMini({ card, disabled, disabledReason = '', selected = false, onClick, onInspect }) {
  const hasGear = card.gear || card.tags?.includes('齿轮');
  return (
    <div className={`hand-card-wrap ${disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}`} title={disabledReason}>
      <button
        className={`card-mini framed-card ${card.type}`}
        style={{ '--card-frame': `url(${cardFrameUrl})` }}
        aria-disabled={disabled}
        onClick={onClick}
      >
          <span className="frame-cost">{card.cost}</span>
          <strong className="frame-name">{card.name}</strong>
          {card.valueText && <span className="frame-value">{card.valueText}</span>}
          <CardArt card={card} />
          {hasGear && (
            <span className="frame-gear" title="齿轮标记" aria-label="齿轮标记">
              <Cog size={13} />
            </span>
        )}
        <p className="frame-text">{card.text}</p>
        <small className="frame-type">{CARD_TYPES[card.type]}</small>
        {isCharacterLike(card) && (
          <em className="frame-stats">
            {card.atk} 攻 / {card.hp == null ? '特殊' : `${card.hp} 血`}
          </em>
        )}
      </button>
      <button className="inspect-card" onClick={onInspect} aria-label={`查看${card.name}`}>
        <Info size={15} />
      </button>
    </div>
    );
  }

function targetEffectSummary(card, actor) {
  if (actor) {
    const parts = [];
    const damage = actor.actionDamage ?? actor.actionBodyDamage ?? actor.actionCharacterDamage ?? actor.atk ?? 0;
    if (damage > 0) parts.push(`${damage}点物伤`);
    if (actor.actionSpiritDamage) parts.push(`-${actor.actionSpiritDamage}精神力`);
    if (actor.actionPolluteEnemy) parts.push(`+${actor.actionPolluteEnemy}污染`);
    if (actor.actionShield) parts.push(`自身+${actor.actionShield}护盾`);
    if (actor.actionEffect === 'itAction') parts.push('选择一个角色死亡');
    return parts.join(' / ') || '选择目标';
  }
  if (!card) return '选择目标';
  if (card.effect === 'killTarget') return '40鐐圭墿浼?;'
  if (card.effect === 'removeEnemyHidden') return '消除一张暗牌';
  if (card.effect === 'destroyEnemyScene') return '摧毁一张场景牌';
  if (card.effect === 'memorySceneRemove') return '移除场景，+10精神力，+10污染';
  if (card.effect === 'feedingContract') return '移除我方非齿轮角色，本体+20血+8精神力+1技能点';
  if (card.effect === 'shieldCard') return '选择一个己方角色+1护盾';
  if (card.effect === 'itEnter') return '选择对方一个角色死亡';
  if (card.effect === 'orcaEnter') return '选择对方角色，护盾失效';
  return card.text ?? '选择目标';
}

function PlayCardBurst({ card }) {
  const hasGear = card.gear || card.tags?.includes('齿轮');
  return (
    <div className="play-card-burst" aria-hidden="true">
      <div
        className={`card-mini play-card-copy framed-card ${card.type}`}
        style={{ '--card-frame': `url(${cardFrameUrl})` }}
      >
        <span className="frame-cost">{card.cost}</span>
        <strong className="frame-name">{card.name}</strong>
        {card.valueText && <span className="frame-value">{card.valueText}</span>}
        <CardArt card={card} />
        {hasGear && (
          <span className="frame-gear">
            <Cog size={13} />
          </span>
        )}
        <p className="frame-text">{card.text}</p>
        <small className="frame-type">{CARD_TYPES[card.type]}</small>
        {isCharacterLike(card) && (
          <em className="frame-stats">
            {card.atk} 攻 / {card.hp == null ? '特殊' : `${card.hp} 血`}
          </em>
        )}
      </div>
      <strong>{card.name}</strong>
    </div>
  );
}

function DamageHeartBurst({ burst }) {
  const count = Math.min(6, Math.max(3, Math.ceil(burst.amount / 7)));
  return (
    <div className={`damage-hit-burst ${burst.side}`} aria-hidden="true">
      <strong>-{burst.amount}</strong>
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} style={{ '--i': index }} />
      ))}
    </div>
  );
}

function CardDetail({ card, onClose }) {
  const hasGear = card.gear || card.tags?.includes('齿轮');
  return (
    <div className="detail-overlay" onClick={onClose}>
      <article className="detail-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        <CardPreview card={card} />
        <section className="detail-copy">
          <div className="detail-title">
            <h2>{card.name}</h2>
            <span>{CARD_TYPES[card.type]}{card.subType ? ` · ${card.subType}` : ''}</span>
          </div>
          <div className="detail-tags">
            <span>消耗 {card.cost}</span>
            {card.valueText && <span>污染 {card.valueText}</span>}
            {isCharacterLike(card) && <span>{card.hp == null ? '特殊生命' : `${card.hp} 生命`}</span>}
            {hasGear && <span>齿轮</span>}
          </div>
          <p>{card.text}</p>
          {card.notes && <small>{card.notes}</small>}
        </section>
      </article>
    </div>
  );
}

function TargetPicker({ card, enemy, enemies, actor, onCancel, onSelect }) {
  const enemyList = enemies?.length ? enemies : [enemy].filter(Boolean);
  const effectText = targetEffectSummary(card, actor);
  const actorPhysicalDamage = actor ? (actor.actionDamage ?? actor.actionBodyDamage ?? actor.actionCharacterDamage ?? actor.atk ?? 0) : 0;
  const pureSpiritAction = Boolean(actor?.actionSpiritDamage && actorPhysicalDamage <= 0 && !actor.actionEffect);
  return (
    <div className="detail-overlay" onClick={onCancel}>
      <article className="target-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onCancel} aria-label="cancel">
          <X size={18} />
        </button>
        <header className="target-header">
          <strong className="target-effect">{effectText}</strong>
          <h2>选择目标</h2>
          <p>{actor ? actor.name : card.name}</p>
        </header>
        <div className="target-grid">
          {actor?.actionShield ? (
            <button className="target-option support-target" onClick={() => onSelect({ type: 'shieldSelf' })}>
              <strong>防御</strong>
              <span>获得 {actor.actionShield} 点护盾</span>
            </button>
          ) : null}
          {actor?.actionSelfPolluteForSkill ? (
            <button className="target-option support-target" onClick={() => onSelect({ type: 'selfPolluteSkill' })}>
              <strong>技能点</strong>
              <span>自身+{actor.actionSelfPolluteForSkill}污染，+1技能点</span>
            </button>
          ) : null}
          {enemyList.map((enemyItem) => (
            <React.Fragment key={enemyItem.id}>
              {actor?.actionPolluteEnemy ? (
                <button className="target-option support-target" onClick={() => onSelect({ type: 'polluteEnemy', enemyId: enemyItem.id })}>
                  <strong>{enemyItem.label}</strong>
                  <span>+{actor.actionPolluteEnemy} 污染</span>
                </button>
              ) : null}
              {actor?.actionSpiritDamage && !pureSpiritAction ? (
                <button className="target-option support-target" onClick={() => onSelect({ type: 'spiritEnemy', enemyId: enemyItem.id })}>
                  <strong>{enemyItem.label}</strong>
                  <span>-{actor.actionSpiritDamage} 精神力</span>
                </button>
              ) : null}
              <button className="target-option body-target" onClick={() => onSelect(pureSpiritAction ? { type: 'spiritEnemy', enemyId: enemyItem.id } : { type: 'body', enemyId: enemyItem.id })}>
                <strong>{enemyItem.label} 本体</strong>
                <span>生命 {enemyItem.hp}</span>
              </button>
              {enemyItem.characters.map((character) => (
                <React.Fragment key={character.instanceId}>
                  <button
                    className="target-option"
                    onClick={() => onSelect(pureSpiritAction ? { type: 'characterSpirit', enemyId: enemyItem.id, instanceId: character.instanceId } : { type: 'character', enemyId: enemyItem.id, instanceId: character.instanceId })}
                  >
                    <CardArt card={character} className="target-art" />
                    <strong>{enemyItem.label} - {character.name}</strong>
                    <span>{character.currentHp == null ? '特殊' : String(character.currentHp) + ' 血'}</span>
                  </button>
                  {actor?.actionSpiritDamage && !pureSpiritAction ? (
                    <button
                      className="target-option support-target"
                      onClick={() => onSelect({ type: 'characterSpirit', enemyId: enemyItem.id, instanceId: character.instanceId })}
                    >
                      <CardArt card={character} className="target-art" />
                      <strong>{enemyItem.label} - {character.name}</strong>
                      <span>-{actor.actionSpiritDamage} 精神力</span>
                    </button>
                  ) : null}
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
          {enemyList.every((enemyItem) => enemyItem.characters.length === 0) && (
            <div className="target-empty">敌方没有明置角色</div>
          )}
        </div>
      </article>
    </div>
  );
}

function WordlessBookPicker({ card, onCancel, onSelect }) {
  const options = [
    { option: 'resetPollution', title: '重置污染', text: '污染变为0，生命上限-5。' },
    { option: 'heal', title: '恢复生命', text: '本体+50血，生命上限-5。' },
    { option: 'spirit', title: '恢复精神', text: '本体+40精神力，生命上限-5。' },
  ];
  return (
    <div className="detail-overlay" onClick={onCancel}>
      <article className="target-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onCancel} aria-label="取消">
          <X size={18} />
        </button>
        <header className="target-header">
          <h2>选择效果</h2>
          <p>《{card.name}》需要选择一种效果。</p>
        </header>
        <div className="target-grid">
          {options.map((item) => (
            <button
              key={item.option}
              className="target-option support-target"
              onClick={() => onSelect({ type: 'wordlessBookOption', option: item.option })}
            >
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

function CardSelectPicker({ card, choices, onCancel, onSelect }) {
  return (
    <div className="detail-overlay" onClick={onCancel}>
      <article className="target-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onCancel} aria-label="取消">
          <X size={18} />
        </button>
        <header className="target-header">
          <h2>选择卡牌</h2>
          <p>《{card.name}》需要选择一张牌。</p>
        </header>
        <div className="target-grid">
          {choices.map((choice) => (
            <button
              key={choice.instanceId}
              className="target-option"
              onClick={() => onSelect({ type: 'selectedCard', instanceId: choice.instanceId })}
            >
              <CardArt card={choice} className="target-art" />
              <strong>{choice.name}</strong>
              <span>{CARD_TYPES[choice.type] ?? choice.subType ?? '卡牌'}</span>
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

function FallChoicePicker({ owner, enemy, onSelect }) {
  return (
    <div className="detail-overlay">
      <article className="target-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="target-header">
          <h2>坠落触发</h2>
          <p>{owner.label} 选择对 {enemy.label} 生效的方式。</p>
        </header>
        <div className="target-grid">
          <button className="target-option support-target" onClick={() => onSelect('spirit25')}>
            <strong>精神坠落</strong>
            <span>{enemy.label}-25精神力</span>
          </button>
          <button className="target-option body-target" onClick={() => onSelect('hp40')}>
            <strong>重创本体</strong>
            <span>{enemy.label}-40血</span>
          </button>
        </div>
      </article>
    </div>
  );
}

function CyclePicker({ hand, onCancel, onSelect }) {
  return (
    <div className="detail-overlay" onClick={onCancel}>
      <article className="target-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onCancel} aria-label="取消">
          <X size={18} />
        </button>
        <header className="target-header">
          <h2>选择弃置牌</h2>
          <p>花费 1 点技能点，弃掉 1 张牌并摸 1 张。</p>
        </header>
        <div className="target-grid">
          {hand.map((card) => (
            <button key={card.instanceId} className="target-option" onClick={() => onSelect(card.instanceId)}>
              <CardArt card={card} className="target-art" />
              <strong>{card.name}</strong>
              <span>{CARD_TYPES[card.type]}</span>
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

function CardPreview({ card }) {
  const hasGear = card.gear || card.tags?.includes('齿轮');
  return (
    <div
      className={`card-mini card-preview framed-card ${card.type}`}
      style={{ '--card-frame': `url(${cardFrameUrl})` }}
    >
      <span className="frame-cost">{card.cost}</span>
      <strong className="frame-name">{card.name}</strong>
      {card.valueText && <span className="frame-value">{card.valueText}</span>}
      <CardArt card={card} />
      {hasGear && (
        <span className="frame-gear" title="齿轮标记" aria-label="齿轮标记">
          <Cog size={13} />
        </span>
      )}
      <p className="frame-text">{card.text}</p>
      <small className="frame-type">{CARD_TYPES[card.type]}</small>
      {isCharacterLike(card) && (
        <em className="frame-stats">
          {card.atk} 攻 / {card.hp == null ? '特殊' : `${card.hp} 血`}
        </em>
      )}
    </div>
  );
}

export {
  setupGame,
  playCard,
  playTargetedKill,
  playSelectedEffectCard,
  playSelectedEnterCard,
  playAiCard,
  runAiStep,
  nextPhase,
  resolveCharacterAction,
  resolveFallChoice,
  drawRoundCards,
  runRoundEndEffects,
  runRoundStartEffects,
  runSmallPhaseEndHiddenTriggers,
  applyPollutionChange,
  applyBodySpiritDamage,
  applyRewindIfDefeated,
  cleanupDefeatedCharacters,
  makeCharacterState,
};

if (typeof document !== 'undefined') {
  const mount = () => createRoot(document.getElementById('root')).render(<App />);
  // 先把持久化数据读进同步缓存（含 localStorage→Preferences 迁移），再渲染，
  // 保证首屏就能拿到名字/胜负/设置。Preferences 不可用（网页版）时也照常渲染。
  initStorage().then(mount, mount);
}

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { STARTING_DECK } from '../src/cardData.js';
import { CARD_ART_FILENAMES } from '../src/cardArtMap.js';

const API_URL = 'https://token.sensenova.cn/v1/images/generations';
const MODEL = 'sensenova-u1-fast';
const envPath = resolve('.env');

if (existsSync(envPath)) {
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);

const VISUAL_PROMPTS = {
  skill_transfer: 'golden gear portal, tiny silhouette stepping through a glowing doorway, blue sparks',
  char_alcoholism: 'warm banquet host with red cheeks holding a cup, cozy kitchen light',
  equip_blast_shield: 'heavy riot shield, dark metal, blue reflection, defensive stance',
  skill_big_chief: 'majestic masked leader crown, commanding gesture, bright authority aura',
  skill_memory_inspect: 'floating magnifying glass over sealed memories, small blue eye glyph, no letters',
  equip_refrigeration: 'cute retro freezer machine, icy mist, pale blue frost crystals',
  equip_great_invasion: 'tiny red battle flag and marching boots, energetic impact burst',
  skill_metal_cabinet: 'sturdy metal locker blocking arrows, grey steel shine',
  skill_ancestral_blessing: 'golden protective charm and soft halo shield, ancient talisman',
  skill_mother_love: 'warm heart-shaped light wrapping a small figure, gentle protective glow',
  hidden_mind_transfer: 'glowing ghost silhouette moving from one body to another, purple psychic trail',
  skill_kill: 'dramatic red slash mark, broken target dummy, impact spark, no symbols',
  char_saintess: 'small saint girl with simple halo and staff, calm white-gold glow',
  equip_corpse_land: 'dark fertile grave soil with tiny sprout and green life glow',
  skill_ziyou: 'free flying paper bird with blue trail, wind swirl',
  hidden_wood_tree: 'strange wooden tree creature with eyes, moss and roots',
  hidden_abandoned_carriage: 'abandoned fantasy cart with cracked wheels, dusty road',
  skill_golden_apple: 'shiny golden apple with magical sparkles and green leaf',
  equip_control_console: 'retro control console with knobs, glowing monitor dots, sci-fi desk',
  skill_mad_inspiration: 'exploding light bulb, colorful idea sparks, sketchbook pages',
  skill_teddy_bear: 'cute teddy bear with mischievous magical aura, tiny stitched heart',
  char_special_employee: 'mysterious uniformed worker holding a tool, shadowy smile',
  char_police: 'pixel police officer with cap and small shield, confident stance',
  char_gun: 'fantasy toy-like pistol with blue energy muzzle flash, safe icon style',
  char_protector: 'armored guardian with large shield, heroic stance, blue-gold highlights',
  hidden_purifier: 'small air purifier machine with purple fog being cleaned into sparkles',
  skill_self_destruct: 'warning device with red button and comic explosion cloud, no text',
  char_darkness: 'cute dark shadow figure with glowing eyes, purple aura',
  skill_id_card: 'blank glowing badge card with shield emblem, no letters or numbers',
  char_monster: 'large friendly monster with horns and claws, strong pose',
  food_bread: 'small loaf of bread with bite mark, warm bakery glow',
  food_enchanted_golden_apple: 'enchanted golden apple with rainbow sparkle aura',
  hidden_fall: 'falling silhouette with wind streaks and broken stone fragments, dramatic downward motion',
  scene_banquet: 'cute banquet table with tiny plates and warm lantern light, festive cozy scene',
  hidden_first_aid: 'fantasy first aid kit with glowing red cross-like gem, healing sparkles, no text',
  skill_abyss_gaze: 'giant mysterious eye emerging from deep purple abyss, psychic ripples',
  char_mtf_agent: 'tactical fantasy agent in dark uniform with visor and compact shield, heroic stance',
  hidden_cleaned_one: 'pale mysterious cleaned survivor with simple mask, sterile blue glow',
  char_extension: 'stretching abstract humanoid with long shadow limbs and eerie teal highlights',
  scene_ancestral_hall: 'small ancestral shrine hall with candles and protective gold charm glow',
  skill_rewind_clock: 'magical clock rewinding with blue time spiral and golden hands, no numbers',
  skill_shadow: 'sharp dark shadow blade cutting through a glowing stage backdrop',
  scene_signal_tower: 'retro radio signal tower with pixel waves and tiny lights',
  scene_vending_machine: 'cute fantasy vending machine with glowing bottles and coin sparkle, no text',
  hidden_blood_test: 'small glass vial of red liquid under blue scanner light, medical fantasy mood',
  hidden_travelers_blood: 'red drop-shaped travel charm with tiny road ribbon and gear sparkle',
  scene_mountain: 'stylized sacred mountain peak with clouds and green healing aura',
  skill_wordless_book: 'ancient blank magic book opened with glowing empty pages and floating runes without letters',
  skill_medicine: 'small potion bottle and herb leaf with gentle cyan healing glow',
  char_it: 'tiny uncanny faceless figure with black cloak and purple spirit flame',
  char_orca: 'cute orca warrior mascot with water splash and confident pose',
  skill_sleeping_pills: 'moonlit sleeping potion capsule with soft stars and drowsy mist, no text',
  skill_bangbang: 'explosive comic impact burst with red and yellow shards, no letters or symbols',
  skill_memory: 'floating memory crystal with faded scene fragments and blue mist',
  skill_feeding_contract: 'mystic contract scroll with food bowl and glowing pact seal, no writing',
};

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function buildPrompt(card) {
  const typeText = {
    character: 'character subject',
    equipment: 'equipment object',
    skill: 'magic skill effect',
    hidden: 'secret hidden object',
    food: 'fantasy food item',
  }[card.type] ?? 'card art subject';
  return [
    '64x64 pixel art standalone illustration sprite.',
    `Visual concept: ${VISUAL_PROMPTS[card.id] ?? 'fantasy game item or character icon'}.`,
    `Subject type: ${typeText}.`,
    'Only draw the central illustration artwork: one clear subject or effect, centered, readable silhouette, cute casual fantasy mini-game style, vibrant color accents, crisp hard pixel edges, simple clean background.',
    'Absolutely no card frame, no card border, no rectangular card layout, no UI panel, no title ribbon, no caption box, no Chinese characters, no English letters, no numbers, no watermark, no logo, no realistic photo, no smooth 3D render, no blur, no anti-aliasing.',
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateOne(card, outPath, size) {
  const apiKey = process.env.SENSENOVA_API_KEY;
  if (!apiKey) {
    throw new Error('Missing SENSENOVA_API_KEY. Set it in your environment or in a local .env file.');
  }

  await mkdir(dirname(outPath), { recursive: true });

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: buildPrompt(card),
      size,
      n: 1,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sensenova image request failed for ${card.id}: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const imageUrl = payload?.data?.[0]?.url;

  if (!imageUrl) {
    throw new Error(`No image URL in response for ${card.id}: ${JSON.stringify(payload)}`);
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Image download failed for ${card.id}: ${imageResponse.status} ${await imageResponse.text()}`);
  }

  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  await writeFile(outPath, bytes);
  console.log(`Saved image: ${outPath}`);
}

const size = readArg('--size', '2048x2048');
const apiKey = process.env.SENSENOVA_API_KEY;

if (!apiKey) {
  console.error('Missing SENSENOVA_API_KEY. Set it in your environment or in a local .env file.');
  process.exit(1);
}

const all = args.includes('--all');
const cardId = readArg('--card', null);
const out = resolve(readArg('--out', 'src/assets/generated/pixel-card-illustration.png'));

if (all) {
  for (const card of STARTING_DECK) {
    const filename = CARD_ART_FILENAMES[card.id] ?? card.id;
    const outPath = resolve(`src/assets/generated/${filename}.png`);
    await generateOne(card, outPath, size);
  }
  console.log(`Generated ${STARTING_DECK.length} card illustrations.`);
} else {
  const card = cardId ? STARTING_DECK.find((item) => item.id === cardId) : STARTING_DECK[0];
  if (!card) {
    throw new Error(`Card not found: ${cardId}`);
  }
  await generateOne(card, out, size);
  console.log(`Prompt: ${buildPrompt(card)}`);
}

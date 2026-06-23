import fs from 'node:fs';
import path from 'node:path';
import { STARTING_DECK } from '../src/cardData.js';
import { CARD_ART_FILENAMES } from '../src/cardArtMap.js';

const customCardTemplates = [
  '{"effect":"healSelf","value":15,"cost":1,"valueText":"+0","text":"我方本体+15血。"}',
  '{"effect":"drawCards","value":2,"cost":0,"valueText":"+10","text":"抽2张牌。"}',
  '{"effect":"damageEnemy","value":10,"cost":1,"valueText":"+10","text":"对方本体-10血。"}',
  '{"hp":10,"spirit":10,"atk":0,"actionCount":1,"actionDamage":5,"actionShield":1,"cost":2,"valueText":"+0","text":"可行动1次。A：5点物伤；B：自身+1护盾。"}',
  '{"effect":"banquet","cost":0,"valueText":"+0","text":"回合末触发：我方全体角色+1血，本体+4血。"}',
  '{"subType":"character","hp":10,"spirit":10,"actionCount":1,"actionDamage":5,"cost":1,"valueText":"+10","text":"暗置角色。可行动1次，造成5点物伤。"}',
];

const generatedDir = path.resolve('src/assets/generated');

const validTypes = new Set(['character', 'equipment', 'scene', 'skill', 'hidden', 'food']);
const handledEffects = new Set([
  'abandonedCarriage',
  'abyssGaze',
  'ancestralBlessing',
  'ancestralHall',
  'banquet',
  'bloodTest',
  'cleanedOne',
  'darknessScene',
  'destroyEnemyScene',
  'drawCards',
  'fall',
  'feedingContract',
  'firstAid',
  'healSelf',
  'inspectAllHidden',
  'inspectHidden',
  'itEnter',
  'killTarget',
  'memorySceneRemove',
  'metalCabinet',
  'mindTransfer',
  'motherLove',
  'mountain',
  'orcaEnter',
  'purifier',
  'reduceSelfPollution',
  'removeEnemyHidden',
  'restoreSpirit',
  'rewindClock',
  'selfDestruct',
  'shieldCard',
  'signalTower',
  'teleport',
  'travelersBlood',
  'trueBodyStrike',
  'vendingMachine',
  'woodTree',
  'wordlessBook',
  'ziyou',
]);

const expected = [
  ['skill_self_destruct', { type: 'skill', cost: 3, valueText: '+20', effect: 'selfDestruct' }],
  ['hidden_fall', { type: 'hidden', subType: 'skill', cost: 0, effect: 'fall' }],
  ['scene_banquet', { type: 'scene', cost: 0, valueText: '+0', effect: 'banquet' }],
  ['hidden_first_aid', { type: 'hidden', subType: 'scene', cost: 2, valueText: '+15', effect: 'firstAid' }],
  ['skill_abyss_gaze', { type: 'skill', cost: 1, valueText: '+25', effect: 'abyssGaze' }],
  ['char_mtf_agent', { type: 'character', cost: 4, valueText: '+0', hp: 15 }],
  ['hidden_cleaned_one', { type: 'hidden', subType: 'character', cost: 1, valueText: '+15', hp: 10, spirit: 20, effect: 'cleanedOne' }],
  ['char_extension', { type: 'character', cost: 3, valueText: '+25', hp: 14, noSpirit: true }],
  ['scene_ancestral_hall', { type: 'scene', cost: 2, valueText: '+0', effect: 'ancestralHall' }],
  ['skill_rewind_clock', { type: 'skill', cost: 1, valueText: '+30', effect: 'rewindClock' }],
  ['skill_shadow', { type: 'skill', cost: 2, valueText: '+30', effect: 'destroyEnemyScene' }],
  ['scene_signal_tower', { type: 'scene', cost: 3, effect: 'signalTower' }],
  ['skill_transfer', { type: 'skill', cost: 1, valueText: '+10', effect: 'teleport' }],
  ['scene_vending_machine', { type: 'scene', cost: 2, valueText: '+5', effect: 'vendingMachine' }],
  ['hidden_blood_test', { type: 'hidden', subType: 'skill', cost: 1, valueText: '+30', effect: 'bloodTest' }],
  ['hidden_travelers_blood', { type: 'hidden', subType: 'skill', cost: 2, valueText: '+20', effect: 'travelersBlood' }],
  ['scene_mountain', { type: 'scene', cost: 1, valueText: '+40', effect: 'mountain', maxTriggers: 3 }],
  ['skill_wordless_book', { type: 'skill', cost: 1, valueText: '+10', effect: 'wordlessBook' }],
  ['scene_darkness', { type: 'scene', cost: 1, valueText: '+20', effect: 'darknessScene' }],
  ['skill_medicine', { type: 'skill', cost: 1, valueText: '+25', effect: 'restoreSpirit' }],
  ['char_it', { type: 'character', cost: 3, valueText: '+40', hp: null, spirit: 3, effect: 'itEnter' }],
  ['char_orca', { type: 'character', cost: 0, valueText: '+20', hp: 10, effect: 'orcaEnter' }],
  ['skill_sleeping_pills', { type: 'skill', cost: 2, valueText: '+10', effect: 'removeEnemyHidden' }],
  ['skill_bangbang', { type: 'skill', cost: 1, valueText: '+70', effect: 'trueBodyStrike' }],
  ['skill_memory', { type: 'skill', cost: 1, valueText: '+20', effect: 'memorySceneRemove' }],
  ['skill_feeding_contract', { type: 'skill', cost: 2, valueText: '+20', effect: 'feedingContract' }],
];

const deckById = new Map(STARTING_DECK.map((card) => [card.id, card]));
const failures = [];

if (deckById.size !== STARTING_DECK.length) {
  failures.push('deck contains duplicate card ids');
}

for (const card of STARTING_DECK) {
  if (!card.id) failures.push(`${card.name ?? 'unknown'}: missing id`);
  if (!card.name) failures.push(`${card.id}: missing name`);
  if (!validTypes.has(card.type)) failures.push(`${card.id}: invalid type ${JSON.stringify(card.type)}`);
  if (!Number.isFinite(Number(card.cost))) failures.push(`${card.id}: cost must be numeric`);
  if (card.valueText != null && !Number.isFinite(Number(card.valueText))) {
    failures.push(`${card.id}: valueText must be a plain numeric pollution delta, got ${JSON.stringify(card.valueText)}`);
  }
  if (!card.text) failures.push(`${card.id}: missing rules text`);
  if (card.effect && !handledEffects.has(card.effect)) failures.push(`${card.id}: unhandled effect ${card.effect}`);
  if (card.type === 'hidden' && !card.subType) failures.push(`${card.id}: hidden card must declare subType`);
  if ((card.type === 'character' || card.subType === 'character') && card.hp !== null && !Number.isFinite(Number(card.hp))) {
    failures.push(`${card.id}: character hp must be numeric or null`);
  }

  const artName = CARD_ART_FILENAMES[card.id];
  if (!artName) {
    failures.push(`${card.id}: missing CARD_ART_FILENAMES entry`);
  } else if (!fs.existsSync(path.join(generatedDir, `${artName}.png`))) {
    failures.push(`${card.id}: missing generated art ${artName}.png`);
  }
}

for (const id of Object.keys(CARD_ART_FILENAMES)) {
  if (!deckById.has(id)) failures.push(`${id}: art map entry has no matching card`);
}

customCardTemplates.forEach((template, index) => {
  try {
    JSON.parse(template);
  } catch {
    failures.push(`custom card template ${index + 1}: invalid JSON`);
  }
});

for (const [id, fields] of expected) {
  const card = deckById.get(id);
  if (!card) {
    failures.push(`${id}: missing card`);
    continue;
  }
  for (const [field, value] of Object.entries(fields)) {
    if (card[field] !== value) {
      failures.push(`${id}: expected ${field}=${JSON.stringify(value)}, got ${JSON.stringify(card[field])}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Objective card audit failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Objective card audit passed: ${STARTING_DECK.length} cards, ${handledEffects.size} effects, and ${expected.length} exact card specs verified.`);

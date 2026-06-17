import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { STARTING_DECK } from '../src/cardData.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-card-core-'));
const bundlePath = path.join(tmpDir, 'core.mjs');

await build({
  entryPoints: ['src/main.jsx'],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  logLevel: 'silent',
  loader: {
    '.png': 'dataurl',
    '.css': 'empty',
  },
  plugins: [
    {
      name: 'replace-vite-glob',
      setup(buildApi) {
        buildApi.onLoad({ filter: /src[\\/]main\.jsx$/ }, async (args) => {
          const source = await fs.readFile(args.path, 'utf8');
          return {
            loader: 'jsx',
            contents: source.replace(
              /const CARD_ART_MODULES = import\.meta\.glob\([\s\S]*?\);\n/,
              'const CARD_ART_MODULES = {};\n',
            ),
          };
        });
      },
    },
  ],
});

const core = await import(`file:///${bundlePath.replaceAll('\\', '/')}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function card(id, extra = {}) {
  const base = STARTING_DECK.find((item) => item.id === id);
  if (!base) throw new Error(`Missing card ${id}`);
  const valueText = base.valueText ?? '';
  const pollutionDelta = Number(valueText) || 0;
  return {
    ...base,
    pollutionDelta,
    instanceId: `${id}-${Math.random().toString(16).slice(2)}`,
    currentHp: base.hp,
    ...extra,
  };
}

function player(id, label) {
  return {
    id,
    label,
    maxHp: 100,
    hp: 100,
    skill: 5,
    maxSpirit: 100,
    spirit: 100,
    pollution: 0,
    maxPollution: 100,
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

function game() {
  return {
    matchId: 'audit',
    players: {
      p1: player('p1', 'P1'),
      p2: player('p2', 'P2'),
    },
    first: 'p1',
    turn: 1,
    phase: 'p1:play',
    log: [],
    inspected: null,
    actionState: null,
    revealedHidden: null,
  };
}

function testTeleportTotals() {
  const g = game();
  const transfer = card('skill_transfer');
  g.players.p1.hand = [transfer, card('skill_memory_inspect')];
  g.players.p1.scenes = [card('scene_vending_machine')];
  g.players.p2.hand = [card('char_gun'), card('food_bread')];
  g.players.p2.scenes = [card('scene_control_console')];

  const next = core.playCard(g, 'p1', transfer);
  assert(next.players.p1.hp === 65, `Teleport should make P1 hp 65, got ${next.players.p1.hp}`);
  assert(next.players.p2.hp === 65, `Teleport should make P2 hp 65, got ${next.players.p2.hp}`);
  assert(next.players.p1.pollution === 80, `Teleport should make P1 pollution 80 including card value, got ${next.players.p1.pollution}`);
  assert(next.players.p2.pollution === 70, `Teleport should make P2 pollution 70, got ${next.players.p2.pollution}`);
  assert(next.players.p2.hand.length === 0, 'Teleport should also discard one extra non-gear enemy hand card.');
}

function testMountainLimit() {
  const g = game();
  const mountain = card('scene_mountain');
  const unit = core.makeCharacterState(card('char_saintess'));
  g.players.p1.scenes = [mountain];
  g.players.p1.characters = [unit];
  g.players.p1.hp = 50;
  g.players.p1.spirit = 50;
  g.players.p1.pollution = 20;
  unit.currentHp = 2;
  unit.spirit = 2;

  core.runRoundEndEffects(g.players, 1);
  core.runRoundEndEffects(g.players, 1);
  core.runRoundEndEffects(g.players, 2);
  core.runRoundEndEffects(g.players, 3);
  core.runRoundEndEffects(g.players, 4);
  assert(mountain.triggerCount === 3, `Mountain should trigger exactly 3 times, got ${mountain.triggerCount}`);
  assert(g.players.p1.hp === 59, `Mountain body hp should be 59, got ${g.players.p1.hp}`);
  assert(g.players.p1.spirit === 59, `Mountain body spirit should be 59, got ${g.players.p1.spirit}`);
  assert(g.players.p1.pollution === 8, `Mountain pollution should be 8, got ${g.players.p1.pollution}`);
  assert(unit.currentHp === 5 && unit.spirit === 5, 'Mountain should heal character hp and spirit exactly 3 times.');
}

function testHiddenFallChoice() {
  const g = game();
  const fall = card('hidden_fall');
  g.players.p1.hidden = [fall];
  core.runSmallPhaseEndHiddenTriggers(g.players);
  assert(g.players.p1.pendingFallChoice?.cardInstanceId === fall.instanceId, 'Fall should create a pending owner choice.');
  const next = core.resolveFallChoice(g, 'p1', 'hp40');
  assert(next.players.p2.hp === 60, `Fall hp choice should reduce enemy hp to 60, got ${next.players.p2.hp}`);
  assert(next.players.p1.hidden.length === 0, 'Fall should disappear after resolving.');
  assert(next.players.p1.discard.some((item) => item.id === 'hidden_fall'), 'Fall should move to discard after resolving.');
}

function testSelfDestructThreshold() {
  const g = game();
  const selfDestruct = card('skill_self_destruct');
  g.players.p1.hand = [selfDestruct];
  g.players.p1.pollutionBursts = 3;
  const enemyUnit = core.makeCharacterState(card('char_monster'));
  g.players.p2.characters = [enemyUnit];
  const next = core.playCard(g, 'p1', selfDestruct);
  assert(next.players.p2.hp === 85, `Self destruct should reduce enemy body hp to 85, got ${next.players.p2.hp}`);
  assert(next.players.p2.spirit === 95, `Self destruct should reduce enemy body spirit to 95, got ${next.players.p2.spirit}`);
  assert(next.players.p2.characters[0].currentHp === (enemyUnit.hp - 15), 'Self destruct should damage enemy characters.');
}

function testTrueBodyStrikeIgnoresReduction() {
  const g = game();
  const bang = card('skill_bangbang');
  g.players.p1.hand = [bang];
  g.players.p2.equipment = [card('equip_blast_shield')];
  const next = core.playCard(g, 'p1', bang);
  assert(next.players.p2.hp === 60, `!! should ignore reduction and make hp 60, got ${next.players.p2.hp}`);
  assert(next.players.p2.spirit === 60, `!! should make spirit 60, got ${next.players.p2.spirit}`);
}

function testFeedingContractRequiresNonGearCharacter() {
  const g = game();
  const contract = card('skill_feeding_contract');
  g.players.p1.hand = [contract];
  g.players.p1.characters = [core.makeCharacterState(card('char_gun'))];
  const blocked = core.playCard(g, 'p1', contract);
  assert(blocked.players.p1.hand.length === 1, 'Feeding contract should not play with only a gear character.');
  g.players.p1.characters = [core.makeCharacterState(card('char_saintess'))];
  const target = g.players.p1.characters[0];
  const next = core.playSelectedEffectCard(g, 'p1', contract, target);
  assert(next.players.p1.characters.length === 0, 'Feeding contract should remove selected non-gear character.');
  assert(next.players.p1.hp === 100, 'Feeding contract should heal body without exceeding max hp.');
  assert(next.players.p1.spirit === 100, 'Feeding contract should heal spirit without exceeding max spirit.');
  assert(next.players.p1.skill === 4, 'Feeding contract should spend 2 skill then refund 1 under the 5 skill cap.');
}

function testBloodTestOneShot() {
  const g = game();
  const blood = card('hidden_blood_test');
  g.players.p1.hidden = [blood];
  g.players.p2.pollutionBursts = 2;
  core.runSmallPhaseEndHiddenTriggers(g.players);
  assert(g.players.p1.hidden.length === 0, 'Blood test should disappear after triggering.');
  assert(g.players.p2.hp === 90, `Blood test should reduce enemy hp by 5n, got ${g.players.p2.hp}`);
  assert(g.players.p2.spirit === 85, `Blood test should reduce enemy body spirit by 15, got ${g.players.p2.spirit}`);
}

function testMtfPassive() {
  const g = game();
  g.players.p1.characters = [core.makeCharacterState(card('char_mtf_agent'))];
  const medicine = card('skill_medicine');
  g.players.p1.hand = [medicine];
  const afterMedicine = core.playCard(g, 'p1', medicine);
  assert(afterMedicine.players.p1.pollution === 20, `MTF should reduce hand-card pollution by 5, got ${afterMedicine.players.p1.pollution}`);

  const kill = card('skill_kill');
  afterMedicine.players.p2.hand = [kill];
  const next = core.playTargetedKill(afterMedicine, 'p2', kill, { type: 'body' });
  assert(next.players.p1.hp === 61, `MTF should reduce incoming non-true damage by 1, got hp ${next.players.p1.hp}`);
}

function testCleanedOneRewritesActions() {
  const g = game();
  const cleaned = card('hidden_cleaned_one');
  const monster = core.makeCharacterState(card('char_monster'));
  g.players.p1.hand = [cleaned];
  g.players.p2.characters = [monster];
  const next = core.playCard(g, 'p1', cleaned);
  const rewritten = next.players.p2.characters[0];
  assert(rewritten.actionDamage === 5, `Cleaned One should rewrite action damage to 5, got ${rewritten.actionDamage}`);
  assert(rewritten.actionSpiritDamage === 3, `Cleaned One should add 3 spirit damage action, got ${rewritten.actionSpiritDamage}`);
  assert(rewritten.damageBonusVsCharacters == null, 'Cleaned One should delete old passives.');
  assert(next.players.p1.hidden.some((item) => item.id === 'hidden_cleaned_one'), 'Cleaned One should enter as hidden character.');
}

function testHiddenCharactersAvoidNormalTargets() {
  const g = game();
  const attacker = core.makeCharacterState(card('char_monster'));
  const hidden = core.makeCharacterState(card('hidden_cleaned_one'));
  g.players.p1.characters = [attacker];
  g.players.p2.hidden = [hidden];
  const next = core.resolveCharacterAction(g, 'p1', attacker.instanceId, { type: 'character', instanceId: hidden.instanceId });
  assert(next.players.p2.hidden[0].currentHp === hidden.currentHp, 'Hidden character should not be hit by normal character attacks.');
}

function testExtensionImmunityAndDecay() {
  const g = game();
  const attacker = core.makeCharacterState(card('char_monster'));
  const extension = core.makeCharacterState(card('char_extension'));
  g.players.p1.characters = [attacker];
  g.players.p2.characters = [extension];
  const afterAttack = core.resolveCharacterAction(g, 'p1', attacker.instanceId, { type: 'character', instanceId: extension.instanceId });
  assert(afterAttack.players.p2.characters[0].currentHp === 14, `Extension should ignore character damage, got ${afterAttack.players.p2.characters[0].currentHp}`);
  core.runRoundEndEffects(afterAttack.players);
  assert(afterAttack.players.p2.characters[0].currentHp === 9, `Extension should lose 5 hp at round end, got ${afterAttack.players.p2.characters[0].currentHp}`);
}

function testAncestralHallPreventsPollution() {
  const g = game();
  g.players.p1.scenes = [card('scene_ancestral_hall')];
  core.applyPollutionChange(g.players.p1, 50);
  assert(g.players.p1.pollution === 0, `Ancestral Hall should prevent pollution, got ${g.players.p1.pollution}`);
}

function testRewindRestoresOwnerOnDefeat() {
  const g = game();
  const rewind = card('skill_rewind_clock');
  g.players.p1.hand = [rewind, card('food_bread')];
  const next = core.playCard(g, 'p1', rewind);
  next.players.p1.hp = 0;
  next.players.p1.hand = [];
  core.applyRewindIfDefeated(next.players, []);
  assert(next.players.p1.hp > 0, 'Rewind Clock should restore owner body when defeated.');
  assert(next.players.p1.hand.some((item) => item.id === 'food_bread'), 'Rewind Clock should restore owner hand data.');
}

function testSceneRemovalAndPersistence() {
  const g = game();
  g.players.p1.scenes = [card('scene_banquet')];
  core.runRoundEndEffects(g.players);
  assert(g.players.p1.scenes.some((item) => item.id === 'scene_banquet'), 'Normal scene should persist after triggering.');

  const shadowGame = game();
  const shadow = card('skill_shadow');
  const enemyScene = card('scene_signal_tower');
  shadowGame.players.p1.hand = [shadow];
  shadowGame.players.p2.scenes = [enemyScene];
  const next = core.playSelectedEffectCard(shadowGame, 'p1', shadow, enemyScene);
  assert(next.players.p2.scenes.length === 0, 'Shadow should destroy selected enemy scene.');
  assert(next.players.p2.discard.some((item) => item.id === 'scene_signal_tower'), 'Destroyed scene should move to discard.');
}

function testStartRoundScenes() {
  const g = game();
  g.players.p1.scenes = [card('scene_signal_tower'), card('scene_vending_machine'), card('scene_darkness')];
  core.runRoundStartEffects(g.players);
  assert(g.players.p1.spirit === 93, `Signal + Darkness should reduce P1 spirit to 93, got ${g.players.p1.spirit}`);
  assert(g.players.p2.spirit === 93, `Signal + Darkness should reduce P2 spirit to 93, got ${g.players.p2.spirit}`);
  assert(g.players.p1.skill === 5, `Vending machine should respect the 5 skill cap for owner, got ${g.players.p1.skill}`);
  assert(g.players.p2.skill === 5, `Vending machine should respect the 5 skill cap for enemy, got ${g.players.p2.skill}`);
  assert(g.players.p1.pollution === 20, `Vending + Darkness should make owner pollution 20, got ${g.players.p1.pollution}`);
  assert(g.players.p2.pollution === 30, `Vending + Darkness should make enemy pollution 30, got ${g.players.p2.pollution}`);
  assert(g.players.p2.hp === 95, `Darkness should reduce enemy hp to 95, got ${g.players.p2.hp}`);
}

function testHiddenSceneTriggersPersist() {
  const g = game();
  const firstAid = card('hidden_first_aid');
  const purifier = card('hidden_purifier');
  g.players.p1.hidden = [firstAid, purifier];
  g.players.p1.hp = 19;
  g.players.p1.pollution = 45;
  core.runSmallPhaseEndHiddenTriggers(g.players);
  assert(g.players.p1.hp === 44, `First Aid should heal to 44, got ${g.players.p1.hp}`);
  assert(g.players.p1.pollution === 40, `Purifier should reduce pollution to 40, got ${g.players.p1.pollution}`);
  assert(g.players.p1.hidden.length === 2, 'Hidden scene cards should persist after their condition triggers.');
}

function testTravelersBloodOneShot() {
  const g = game();
  const blood = card('hidden_travelers_blood');
  const victim = core.makeCharacterState(card('char_saintess'));
  victim.currentHp = 0;
  g.players.p1.hidden = [blood];
  g.players.p1.characters = [victim];
  core.cleanupDefeatedCharacters(g.players, 'p1', []);
  assert(g.players.p1.hidden.length === 0, 'Traveler blood should disappear after a friendly character dies.');
  assert(g.players.p1.hp === 95 && g.players.p2.hp === 95, 'Traveler blood should damage both bodies by 5.');
  assert(g.players.p1.spirit === 95 && g.players.p2.spirit === 95, 'Traveler blood should damage both body spirits by 5.');
}

function testAbyssMedicineItOrcaSleepingMemory() {
  const abyssGame = game();
  const abyss = card('skill_abyss_gaze');
  const p1Unit = core.makeCharacterState(card('char_monster'));
  const p2Unit = core.makeCharacterState(card('char_monster'));
  abyssGame.players.p1.hand = [abyss];
  abyssGame.players.p1.characters = [p1Unit];
  abyssGame.players.p2.characters = [p2Unit];
  const abyssNext = core.playCard(abyssGame, 'p1', abyss);
  assert(abyssNext.players.p2.spirit === 90, `Abyss should reduce enemy body spirit by 10, got ${abyssNext.players.p2.spirit}`);
  assert(abyssNext.players.p1.characters[0].spirit === p1Unit.spirit - 5, 'Abyss should reduce all field character spirit.');
  assert(abyssNext.players.p2.pollution === 20, `Abyss should add 20 enemy pollution, got ${abyssNext.players.p2.pollution}`);

  const medicineGame = game();
  const medicine = card('skill_medicine');
  medicineGame.players.p1.hand = [medicine];
  medicineGame.players.p1.spirit = 50;
  const medicineNext = core.playCard(medicineGame, 'p1', medicine);
  assert(medicineNext.players.p1.spirit === 70, `Medicine should heal 20 spirit, got ${medicineNext.players.p1.spirit}`);

  const itGame = game();
  const it = card('char_it');
  const target = core.makeCharacterState(card('char_monster'));
  itGame.players.p1.hand = [it];
  itGame.players.p2.characters = [target];
  const itNext = core.playSelectedEnterCard(itGame, 'p1', it, target);
  assert(itNext.players.p2.characters.length === 0, 'It should kill selected enemy character on enter.');

  const orcaGame = game();
  const orca = card('char_orca');
  const shielded = core.makeCharacterState(card('char_monster', { shield: 2 }));
  orcaGame.players.p1.hand = [orca];
  orcaGame.players.p2.characters = [shielded];
  const orcaNext = core.playSelectedEnterCard(orcaGame, 'p1', orca, shielded);
  assert(orcaNext.players.p2.characters[0].shield === 0, 'Orca should remove selected character shield on enter.');

  const sleepingGame = game();
  const pills = card('skill_sleeping_pills');
  const hidden = card('hidden_fall');
  sleepingGame.players.p1.hand = [pills];
  sleepingGame.players.p2.hidden = [hidden];
  const sleepingNext = core.playSelectedEffectCard(sleepingGame, 'p1', pills, hidden);
  assert(sleepingNext.players.p2.hidden.length === 0, 'Sleeping pills should remove selected enemy hidden card.');

  const memoryGame = game();
  const memory = card('skill_memory');
  const hiddenScene = card('hidden_purifier');
  memoryGame.players.p1.hand = [memory];
  memoryGame.players.p2.hidden = [hiddenScene];
  const memoryNext = core.playSelectedEffectCard(memoryGame, 'p1', memory, hiddenScene);
  assert(memoryNext.players.p2.hidden.length === 0, 'Memory should remove selected hidden scene.');
  assert(memoryNext.players.p2.spirit === 90, `Memory should reduce enemy spirit by 10, got ${memoryNext.players.p2.spirit}`);
  assert(memoryNext.players.p2.pollution === 10, `Memory should add 10 enemy pollution, got ${memoryNext.players.p2.pollution}`);
}

function testDrawDoesNotReplaceFullHandAndSkillCap() {
  const g = game();
  const fullHand = [
    card('food_bread'),
    card('skill_medicine'),
    card('skill_shadow'),
    card('scene_banquet'),
    card('char_saintess'),
  ];
  g.players.p1.hand = fullHand;
  g.players.p1.deck = [card('skill_bangbang')];
  const beforeIds = g.players.p1.hand.map((item) => item.instanceId).join(',');
  core.drawRoundCards(g.players);
  const afterIds = g.players.p1.hand.map((item) => item.instanceId).join(',');
  assert(afterIds === beforeIds, 'Full hand should not draw, discard, or replace cards.');
  assert(g.players.p1.deck.length === 1, 'Full hand should leave deck untouched.');

  const shortDeckGame = game();
  shortDeckGame.players.p1.hand = [card('food_bread')];
  shortDeckGame.players.p1.deck = [card('skill_bangbang')];
  shortDeckGame.players.p1.discard = [card('skill_memory'), card('skill_shadow')];
  core.drawRoundCards(shortDeckGame.players);
  assert(shortDeckGame.players.p1.hand.length === 2, `Draw should only take the remaining deck cards before recycling, got ${shortDeckGame.players.p1.hand.length}`);
  assert(shortDeckGame.players.p1.deck.length === 0, 'Draw should not recycle discard mid-draw after the deck becomes empty.');
  assert(shortDeckGame.players.p1.discard.length === 2, 'Discard pile should wait until the next draw to recycle.');

  g.players.p1.skill = 4;
  g.players.p1.scenes = [card('scene_vending_machine')];
  core.runRoundStartEffects(g.players);
  assert(g.players.p1.skill === 5, `Skill should cap at 5, got ${g.players.p1.skill}`);
}

function testAiActionAutoAdvancesAfterSkippedCursor() {
  const g = game();
  const actor = core.makeCharacterState(card('char_saintess'));
  actor.actionDamage = 0;
  actor.actionShield = 0;
  actor.actionPolluteEnemy = 0;
  g.phase = 'p2:action';
  g.players.p2.characters = [actor];
  g.actionState = { playerId: 'p2', queue: [actor.instanceId], cursor: 0 };
  const skipped = core.runAiStep(g, 'p2', { allowCycle: false }).game;
  assert(skipped.phase === 'p2:action' && skipped.actionState.cursor === 1, 'AI should advance its action cursor when no action target exists.');
  const advanced = core.runAiStep(skipped, 'p2', { allowCycle: false }).game;
  assert(advanced.phase !== 'p2:action', 'AI should continue from an exhausted action cursor into the next phase.');
}

function testWoodTreeGivesSkill() {
  const g = game();
  g.players.p1.skill = 3;
  g.players.p1.hidden = [core.makeCharacterState(card('hidden_wood_tree'))];
  g.phase = 'p1:action';
  const next = core.nextPhase(g);
  assert(next.players.p1.skill === 5, `Wood Tree should grant +1 skill at new round under the 5 skill cap, got ${next.players.p1.skill}`);
}

function testDeveloperCardsEnterDeck() {
  const customCards = [{
    id: 'custom_heal_test',
    name: 'Custom Heal',
    type: 'skill',
    artDataUrl: 'data:image/png;base64,AA==',
    code: '{"effect":"healSelf","value":7,"cost":1,"valueText":"+0","text":"Heal 7."}',
  }];
  const g = core.setupGame({ mode: 'pve', localName: 'Tester', customCards });
  const allP1Cards = [
    ...g.players.p1.hand,
    ...g.players.p1.deck,
  ];
  const custom = allP1Cards.find((item) => item.id === 'custom_heal_test');
  assert(custom, 'Developer card should be added to the actual deck.');
  assert(custom.effect === 'healSelf' && custom.value === 7, 'Developer card JSON skill code should merge into playable card fields.');
  assert(custom.artDataUrl === customCards[0].artDataUrl, 'Developer card uploaded art data should persist on deck cards.');
}

function testAiPlaysLowUtilityPlayableCard() {
  const g = game();
  g.phase = 'p2:play';
  g.players.p2.hand = [card('skill_memory_inspect')];
  g.players.p2.deck = [card('food_bread')];
  const next = core.runAiStep(g, 'p2', { allowCycle: true });
  assert(next.playedCard?.id === 'skill_memory_inspect', 'AI should play a low-utility playable card instead of passing or cycling first.');
  assert(!next.cycled && !next.advanced, 'AI should not cycle or advance while it can play a card.');
  assert(next.game.players.p2.hand.length === 0, 'AI played card should leave the hand.');
}

function testCommonSkillAndHiddenEffects() {
  const healGame = game();
  healGame.players.p1.hp = 80;
  const apple = card('skill_golden_apple');
  healGame.players.p1.hand = [apple];
  const healNext = core.playCard(healGame, 'p1', apple);
  assert(healNext.players.p1.hp === 95, `Golden Apple should heal 15 hp, got ${healNext.players.p1.hp}`);

  const drawGame = game();
  const inspiration = card('skill_mad_inspiration');
  drawGame.players.p1.hand = [inspiration];
  drawGame.players.p1.deck = [card('food_bread'), card('skill_teddy_bear'), card('skill_memory')];
  const drawNext = core.playCard(drawGame, 'p1', inspiration);
  assert(drawNext.players.p1.hand.length === 2, `Mad Inspiration should draw 2 cards, got ${drawNext.players.p1.hand.length}`);

  const bearGame = game();
  bearGame.players.p1.pollution = 70;
  const bear = card('skill_teddy_bear');
  bearGame.players.p1.hand = [bear];
  const bearNext = core.playCard(bearGame, 'p1', bear);
  assert(bearNext.players.p1.pollution === 50, `Teddy Bear should net pollution to 50 after +20 then -40, got ${bearNext.players.p1.pollution}`);

  const ziyouGame = game();
  const ziyou = card('skill_ziyou');
  ziyouGame.players.p1.hand = [ziyou];
  const ziyouNext = core.playCard(ziyouGame, 'p1', ziyou);
  assert(ziyouNext.players.p2.hp === 90, `Ziyou should reduce enemy hp to 90, got ${ziyouNext.players.p2.hp}`);
  assert(ziyouNext.players.p2.pollution === 35, `Ziyou should add 35 enemy pollution, got ${ziyouNext.players.p2.pollution}`);

  const loveGame = game();
  const love = card('skill_mother_love');
  loveGame.players.p1.hand = [love];
  loveGame.players.p2.hand = [card('food_bread'), card('skill_memory')];
  const loveNext = core.playCard(loveGame, 'p1', love);
  assert(loveNext.players.p2.hp === 90, `Mother Love should reduce enemy hp to 90, got ${loveNext.players.p2.hp}`);
  assert(loveNext.players.p2.pollution === 90, `Mother Love should add 90 enemy pollution, got ${loveNext.players.p2.pollution}`);

  const idGame = game();
  const idCard = card('skill_id_card');
  idGame.players.p1.hand = [idCard];
  idGame.players.p1.characters = [
    core.makeCharacterState(card('char_saintess')),
    core.makeCharacterState(card('char_special_employee')),
  ];
  const idTarget = idGame.players.p1.characters[1];
  const idNext = core.playSelectedEffectCard(idGame, 'p1', idCard, idTarget);
  assert(idNext.players.p1.characters[0].shield === 0, 'ID Card should not shield the first character when the second is selected.');
  assert(idNext.players.p1.characters[1].shield === 1, `ID Card should add 1 shield to selected target, got ${idNext.players.p1.characters[1].shield}`);

  const chiefGame = game();
  const chief = card('skill_big_chief');
  const hidden = card('hidden_fall');
  chiefGame.players.p1.hand = [chief];
  chiefGame.players.p2.hidden = [hidden];
  const chiefNext = core.playCard(chiefGame, 'p1', chief);
  assert(chiefNext.inspected?.cards.length === 1, 'Big Chief should expose enemy hidden cards for inspection.');

  const metalGame = game();
  metalGame.players.p1.hidden = [card('skill_metal_cabinet')];
  const kill = card('skill_kill');
  metalGame.players.p2.hand = [kill];
  const metalNext = core.playTargetedKill(metalGame, 'p2', kill, { type: 'body' });
  assert(metalNext.players.p1.physicalImmuneThisRound, 'Metal Cabinet should grant physical immunity when enemy attacks with a card.');
  assert(metalNext.players.p1.hidden.length === 0, 'Metal Cabinet should be consumed after triggering.');

  const blessingGame = game();
  blessingGame.players.p1.hidden = [card('skill_ancestral_blessing')];
  core.applyPollutionChange(blessingGame.players.p1, 30);
  assert(blessingGame.players.p1.pollution === 0, 'Ancestral Blessing should block incoming pollution.');
  assert(blessingGame.players.p1.cannotPlayThisRound, 'Ancestral Blessing should prevent owner from playing this round.');
}

function testDeathTriggeredScenesAndHiddenCards() {
  const corpseGame = game();
  const dying = core.makeCharacterState(card('char_saintess'));
  dying.currentHp = 0;
  corpseGame.players.p1.hp = 50;
  corpseGame.players.p1.scenes = [card('scene_corpse_land')];
  corpseGame.players.p1.characters = [dying];
  core.cleanupDefeatedCharacters(corpseGame.players, 'p1', []);
  assert(corpseGame.players.p1.hp === 55, `Corpse Land should heal body to 55 after friendly death, got ${corpseGame.players.p1.hp}`);
  assert(corpseGame.players.p1.characters.length === 0, 'Dead friendly character should be removed.');

  const transferGame = game();
  const dead = core.makeCharacterState(card('char_saintess'));
  const stolen = core.makeCharacterState(card('char_monster'));
  dead.currentHp = 0;
  stolen.currentHp = 12;
  transferGame.players.p1.hidden = [card('hidden_mind_transfer')];
  transferGame.players.p1.characters = [dead];
  transferGame.players.p2.characters = [stolen];
  core.cleanupDefeatedCharacters(transferGame.players, 'p1', []);
  assert(transferGame.players.p1.characters.some((item) => item.id === 'char_monster'), 'Mind Transfer should steal an enemy character after friendly death.');
  assert(transferGame.players.p1.hidden.length === 0, 'Mind Transfer should be consumed after triggering.');
  assert(transferGame.players.p2.characters.length === 0, 'Mind Transfer should remove stolen character from enemy board.');
}

const tests = [
  testTeleportTotals,
  testMountainLimit,
  testHiddenFallChoice,
  testSelfDestructThreshold,
  testTrueBodyStrikeIgnoresReduction,
  testFeedingContractRequiresNonGearCharacter,
  testBloodTestOneShot,
  testMtfPassive,
  testCleanedOneRewritesActions,
  testHiddenCharactersAvoidNormalTargets,
  testExtensionImmunityAndDecay,
  testAncestralHallPreventsPollution,
  testRewindRestoresOwnerOnDefeat,
  testSceneRemovalAndPersistence,
  testStartRoundScenes,
  testHiddenSceneTriggersPersist,
  testTravelersBloodOneShot,
  testAbyssMedicineItOrcaSleepingMemory,
  testDrawDoesNotReplaceFullHandAndSkillCap,
  testWoodTreeGivesSkill,
  testDeveloperCardsEnterDeck,
  testAiPlaysLowUtilityPlayableCard,
  testAiActionAutoAdvancesAfterSkippedCursor,
  testCommonSkillAndHiddenEffects,
  testDeathTriggeredScenesAndHiddenCards,
];

for (const test of tests) test();
console.log(`Objective behavior audit passed: ${tests.length} rule simulations verified.`);

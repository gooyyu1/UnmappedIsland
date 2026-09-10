import { describe, expect, it } from 'vitest';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 里心を抑える設え（src/assets/world-codex/furnishings.yaml、docs/world/Characters.md ホームシック節）を、
 * 同梱のYAMLに対して確かめる。**見るのは押し上げる側だけ**——溜まる側と引く側の鎖（日数 → 孤独 →
 * ホームシック → 幸福度）は homesickness.test.ts が持つ。
 *
 * **設えを1つ足したら、この試験は名前を書き足さなくても対象に入る**——furnishing タグを名乗る型を
 * 世界から数え上げるので、点数の合計も持ち出せないことも、足した物ごと見られる。
 */
const codex = bundledCodex();

function propertyId(name: string): number {
  return codex.propertyNames.getId(name);
}

/** furnishing を名乗る型（宣言順）。 */
const FURNISHINGS: readonly string[] = Array.from({ length: codex.objects.count }, (unused, globalId) =>
  codex.objects.get(globalId),
)
  .filter((def) => def.tags.includes(codex.tagNames.getId('furnishing')))
  .map((def) => codex.objectNames.getName(def.globalId));

interface Camp {
  readonly session: WorldSession;
  readonly land: WorldObject;
  readonly player: WorldObject;
}

/** 何も据えていない砂浜と、そこに立つ主人公。 */
function camp(): Camp {
  const session = new WorldSession(codex);
  const world = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
  session.adoptWorld(new World(world, codex));

  const land = session.createObject(codex.objectNames.getId('sandy_beach'));
  expect(land.moveToSlotOrRejection(world.getSlot(codex.slotNames.getId('locations')))).toBeUndefined();
  const player = session.createObject(codex.objectNames.getId('captain'));
  expect(player.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();

  return { session, land, player };
}

/** その砂浜へ設えを1つ据える。 */
function furnish(site: Camp, name: string): WorldObject {
  const furnishing = site.session.createObject(codex.objectNames.getId(name));
  expect(
    furnishing.moveToSlotOrRejection(site.land.getSlot(codex.slotNames.getId('fixtures'))),
    `${name}を据える`,
  ).toBeUndefined();
  return furnishing;
}

/** 今そこに立っている主人公が継いでいる居心地。 */
function comfortOf(site: Camp): number {
  return site.player.getProperty(propertyId('comfort')).getEffectiveValue();
}

/**
 * `snug` の下限（characters/player_character.yaml の comfort の段）。**書き写さずに段から読む**
 * ——境目が動いたら、下の「何個並べれば届くか」もその場で動くべきなので。
 */
function snugFrom(site: Camp): number {
  const snug = site.player.getProperty(propertyId('comfort')).def.lowerBoundOfStage('snug');
  expect(snug, 'snugの下限').toBeDefined();
  return snug!;
}

describe('里心を抑える設え(src/assets/world-codex/furnishings.yaml)', () => {
  it('据えれば、そこに立つ人の居心地になる', () => {
    // 押しているのは場所のほうで、キャラクタは base で継ぐだけ（core.yaml の comfort）。
    const site = camp();
    expect(comfortOf(site), '何も据えていない砂浜').toBe(0);

    furnish(site, FURNISHINGS[0]);
    expect(comfortOf(site)).toBeGreaterThan(0);
  });

  it('ひと通り据えれば、90日目からの募りを止めるsnugに届く', () => {
    // **これが世界で唯一のsnugへの道**（docs/world/Characters.md ホームシック節）。囲いも家も
    // homely止まりなので、ここが届かなくなると90日目以降に打てる手がまた無くなる。
    const site = camp();
    for (const name of FURNISHINGS) furnish(site, name);

    expect(site.player.getProperty(propertyId('comfort')).isInStage('snug'), 'ひと通りの設え').toBe(true);
  });

  it('1つでは届かない——積んで初めてsnugになる', () => {
    // 「どうせ作る1つ」で圧が素通りしないための線（同節）。1つで届くなら、設えを重ねる値打ちが消える。
    for (const name of FURNISHINGS) {
      const site = camp();
      furnish(site, name);
      expect(site.player.getProperty(propertyId('comfort')).isInStage('snug'), name).toBe(false);
    }
  });

  it('どれか1種だけを並べても届く——里心の対策は、ほかの系統の進み具合に縛られない', () => {
    // **ひと通り揃えることはsnugの条件ではない**（同節）。斧の要る物も狩りの要る物も飛ばして、
    // 刃物1本で作れる物だけを並べる道が残っている——**残っていなければ、里心の対策が狩りや
    // 木の伐り出しの後ろへ回る**。1種だけで並べても点あたりの手間がひと通りと近いのは、点数を
    // 手間に比例させてあるから（furnishings.yaml）。**総手間は行き過ぎるぶんだけ上へ振れる。**
    for (const name of FURNISHINGS) {
      const site = camp();
      const one = camp();
      furnish(one, name);
      const needed = Math.ceil(snugFrom(one) / comfortOf(one));
      for (let placed = 0; placed < needed; placed += 1) furnish(site, name);

      expect(site.player.getProperty(propertyId('comfort')).isInStage('snug'), name).toBe(true);
    }
  });

  it('同じ物を並べても効く（連れと違って積み上がる）', () => {
    // 設えは積むほど効いてよく、効き目は掛けた手間に比例させてある（furnishings.yaml）ので、
    // 並べることは近道ではなく払い方の1つ。**囲いの連れはここが逆**（段が1つだけ、farming.yaml）。
    const one = camp();
    furnish(one, FURNISHINGS[0]);
    const two = camp();
    furnish(two, FURNISHINGS[0]);
    furnish(two, FURNISHINGS[0]);

    expect(comfortOf(two)).toBe(comfortOf(one) * 2);
  });

  it('持ち出せない——遠征に慰めは連れて行けない', () => {
    // 手持ちの枠が受けるのは item タグだけ（characters/player_character.yaml）なので、fixture である
    // ことがそのまま「持ち運べる慰めの席を開けない」（docs/world/Characters.md ホームシック節）。
    const site = camp();
    for (const name of FURNISHINGS) {
      const furnishing = site.session.createObject(codex.objectNames.getId(name));
      expect(
        furnishing.moveToSlotOrRejection(site.player.getSlot(codex.slotNames.getId('hand'))),
        `${name}を手に持つ`,
      ).toBeDefined();
    }
  });
});

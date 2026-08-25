import { describe, expect, it } from 'vitest';
import { DescriptionWriter } from '../../src/codex-viewer/describe/Description';
import { defNamesOf } from '../../src/codex-viewer/describe/codexNames';
import {
  createsObject,
  describeInfluencesOn,
  describeObjectDef,
  usesInRecipes,
} from '../../src/codex-viewer/describe/describeObjectDef';
import { describePassive } from '../../src/codex-viewer/describe/describePassive';
import { describeInteraction } from '../../src/codex-viewer/describe/describeInteraction';
import { describeProperty } from '../../src/codex-viewer/describe/describeProperty';
import { describeAccept } from '../../src/codex-viewer/describe/describeSlot';
import type { DefNames } from '../../src/codex-viewer/describe/Description';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 宣言を読める形へ書き出す仕組み（src/codex-viewer/describe）のテスト。
 * 文言そのものより、**読み手が必要とする情報が落ちていないこと**（対象・量・条件・入れ子の深さ、
 * シンボル値が名前に戻ること）を確かめる。
 */

const YAML = `
property_tags:
  nutrition: {}

object_defs:
  world:
    singleton: true
    props:
      hour:
        value: 0
        range: {min: 0, max: 24}
        stages:
          - {name: night}
          - {name: day, min: 6}
        on_max:
          add: {self: {hour: -24, day: 1}}
      day: {value: 1}
      weather:
        value: clear
        stages:
          - {name: rain}
    passives:
      - modify: {child: {warmth: -2}}
        conditions:
          - {prop: hour, in_stage: night}

  coconut:
    tags: [item, food]
    props:
      freshness:
        value: 100
        range: {min: 0, max: 100}
        tags: [nutrition]
      warmth: {value: 0}
    slots:
      contents:
        cell_count: 2
        capacity: 500
        cell: {accept: {tag: food}, max: 3}
    interactions:
      eat:
        trigger: menu
        duration: 10
        conditions:
          - reason: too_far
            prop: freshness
            gt: 0
        add: {actor: {satiety: 20}}
        destroy: self
      cut:
        trigger: {drag: {tag: cutting_tool}}
        pick:
          - weight: 3
            spawn: {object: coconut_half, into: same_slot}
          - weight: {prop: freshness}
            add: {self: {freshness: -10}}

  coconut_half:
    tags: [item]
    props:
      freshness: {value: 100}

  bowl:
    tags: [item]
    props:
      volume: {value: 100}
    recipes:
      carved:
        steps:
          - requires:
              - {object: coconut_half, count: 1, consume: true}
              - {object: sharp_stone, count: 1, consume: false}
            duration: 30

  wild_boar:
    tags: [item]
    props:
      wariness: {value: 0}
    resists:
      - {prop: wariness, gte: 1}

  sharp_stone:
    tags: [item, cutting_tool]
    props:
      weight: {value: 100}

  # 効果の全動詞を1つずつ通すための型。書き出しの取りこぼしを検査するためだけに置く。
  gourd:
    tags: [item]
    props:
      water: {value: 500}
      hydration: {value: 0}
      spilled: {value: 0}
    interactions:
      drink:
        trigger: menu
        transfer: {from: self, from_prop: water, to: actor, to_prop: hydration, amount: 200, to_amount: 4}
        set: {self: {spilled: 1}}
        signal: {actor: gulped}
      tip_over:
        trigger: menu
        transfer:
          from: self
          from_prop: water
          to: parent
          to_prop: spilled
          amount: 999
          allow_overflow: true
          linked_add: {self: {spilled: -1}}
        move: {subject: self, to: parent}
      smash:
        trigger: menu
        destroy: {subject: self, reason: shattered}
`;

function describeAllPassives(def: ObjectDef, names: DefNames, out: DescriptionWriter): void {
  for (const effect of def.passives.declarations) describePassive(effect, names, out);
}

function describeToText(codex: WorldCodex, body: (out: DescriptionWriter) => void): string {
  const writer = new DescriptionWriter();
  body(writer);
  return writer.toPlainText();
}

describe('定義の自己記述（describe）', () => {
  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).buildAndReset();
  const objectDef = (name: string) => codex.objects.get(codex.objectNames.getId(name));
  const names = defNamesOf(codex);

  it('プロパティの初期値・range・段・range系イベントを書き出す', () => {
    const world = objectDef('world');
    const hour = world.tryGetPropertyDef(codex.propertyNames.getId('hour'))!;
    const text = describeToText(codex, (out) => describeProperty(hour, names, out));

    expect(text).toContain('初期値: 0');
    expect(text).toContain('range: 0 〜 24');
    expect(text).toContain('night: どの段にも該当しないとき');
    expect(text).toContain('day: 6以上');
    expect(text).toContain('on_max:');
    // 繰り上げ先（day）への加算は、入れ子（字下げ）としてon_maxの下に置かれる。
    expect(text).toContain('\n  add hour -24');
    expect(text).toContain('\n  add day +1');
  });

  it('シンボル型プロパティの値はシンボル名に戻す', () => {
    const world = objectDef('world');
    const weather = world.tryGetPropertyDef(codex.propertyNames.getId('weather'))!;
    const text = describeToText(codex, (out) => describeProperty(weather, names, out));

    // 値は実行時には数値だが、シンボル型と宣言されていれば名前に戻る（6.6節）。
    expect(text).toContain('初期値: clear');
    // シンボル型の段は名前自体が比較対象なので、段の行は名前だけになる（6.4節）。
    expect(text.split('\n')).toContain('  rain');
  });

  it('持続効果は対象・量・ゲートを書き出す', () => {
    const text = describeToText(codex, (out) => describeAllPassives(objectDef('world'), names, out));

    expect(text).toContain('modify warmth -2');
    expect(text).toContain('hourが段nightにある');
  });

  it('スロットは受け入れる型を書き出す（枠数・容量は数そのものが答えるので持たない）', () => {
    const coconut = objectDef('coconut');
    const slot = coconut.tryGetSlotDef(codex.slotNames.getId('contents'))!;

    expect(describeToText(codex, (out) => describeAccept(slot, names, out))).toBe(
      'foodを持つ型（同種は3個まで）',
    );
    expect(slot.cellCount).toBe(2);
    expect(slot.capacity).toBe(500);
  });

  it('アクションはきっかけ・要件・所要時間・効果をこの順で書き出す', () => {
    const eat = objectDef('coconut').menuTriggers[0];
    const lines = describeToText(codex, (out) => describeInteraction(eat, names, out)).split('\n');

    expect(lines[0]).toBe('trigger: menu');
    expect(lines[1]).toBe('conditions:');
    expect(lines[2]).toContain('freshness > 0');
    expect(lines[2]).toContain('（理由: too_far）');
    expect(lines[3]).toBe('所要時間: 10分');
    expect(lines).toContain('add satiety +20');
    expect(lines).toContain('destroy self');
  });

  it('効果の動詞は、対象と量を書き出す', () => {
    const lines = describeToText(codex, (out) =>
      describeInteraction(objectDef('gourd').menuTriggers[0], names, out),
    ).split('\n');

    expect(lines).toContain('transfer water → hydration（最大200 → 4）');
    expect(lines).toContain('set spilled = 1');
  });

  it('destroyは消し方の名乗り（reason）まで書き出す', () => {
    // 名乗ったかどうかは消された側にしか残らない情報（9.3節）なので、落とすと図鑑からは
    // 「ただ消える」との区別が付かなくなる。
    const lines = describeToText(codex, (out) =>
      describeInteraction(objectDef('gourd').menuTriggers[2], names, out),
    ).split('\n');

    expect(lines).toContain('destroy self（消し方: shattered）');
  });

  it('linked_addと、moveの両端を書き出す', () => {
    const lines = describeToText(codex, (out) =>
      describeInteraction(objectDef('gourd').menuTriggers[1], names, out),
    ).split('\n');

    expect(lines).toContain('transfer water → spilled（最大999）');
    expect(lines).toContain('  add spilled -1（実際に移した量に比例）');
    expect(lines).toContain('move self → parent');
  });

  /**
   * 読み手（EffectReader）が渡さないものは書けない。**渡さないと決めた3つ**を、決めたとおりに
   * 落ちていることで固定する——`spawn`の配置先と`transfer`のあふれ許可は説明に要らない細かさ、
   * `signal`の対象は「避けた」のか「避けられた」のかがYAMLの作者次第で、読む側が意味を持てない。
   */
  it('配置先・あふれ許可・出来事の対象は書かない', () => {
    const text = describeToText(codex, (out) => {
      describeInteraction(objectDef('gourd').menuTriggers[0], names, out);
      describeInteraction(objectDef('gourd').menuTriggers[1], names, out);
      describeInteraction(objectDef('coconut').dragTriggers[0], names, out);
    });

    expect(text).toContain('signal gulped');
    expect(text).not.toContain('→ actor');
    expect(text).not.toContain('あふれても移す');
    expect(text).not.toContain('→ same_slot');
  });

  it('resistsは、持ち主に付けなくなる成立条件を書き出す', () => {
    const text = describeToText(codex, (out) => describeObjectDef(objectDef('wild_boar'), names, out));

    expect(text).toContain('resists: ');
    expect(text).toContain('wariness >= 1');
    // 土地は持ち主にならない（7.13節）ので、成立しても置き場を失うわけではない。
    expect(text).toContain('土地以外の持ち主に付けない');
  });

  it('resistsを宣言していない型には、その行を書かない', () => {
    const text = describeToText(codex, (out) => describeObjectDef(objectDef('coconut'), names, out));

    expect(text).not.toContain('resists');
  });

  it('combinationは相手のタグとpickの候補を書き出す', () => {
    const cut = objectDef('coconut').dragTriggers[0];
    const text = describeToText(codex, (out) => describeInteraction(cut, names, out));

    expect(text).toContain('trigger: cutting_toolを持つ型のカードのドロップ');
    expect(text).toContain('pick:');
    // 候補の効果は候補（weight）より1段深い。
    expect(text).toContain('\n  weight = 3\n    spawn coconut_half');
    // weightはリテラルだけでなくプロパティ参照にもなる（10.2節）。
    expect(text).toContain('weight = freshness');
  });
});

describe('プロパティの逆引き（describeInfluencesOn）', () => {
  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).buildAndReset();
  const objectDef = (name: string) => codex.objects.get(codex.objectNames.getId(name));
  const names = defNamesOf(codex);

  function influences(fromObject: string, ownerObject: string, propertyName: string): string {
    const propertyGlobalId = codex.propertyNames.getId(propertyName);
    return describeToText(codex, (out) =>
      describeInfluencesOn(objectDef(fromObject), propertyGlobalId, fromObject === ownerObject, names, out),
    );
  }

  it('他の型のプロパティを書き換える宣言を見つける', () => {
    expect(influences('world', 'coconut', 'warmth')).toContain('modify warmth -2');
  });

  it('target=selfの宣言は、宣言元自身のプロパティを尋ねたときだけ答える', () => {
    // coconutのcutはself.freshnessを減らす。他の型が持つ同名のfreshnessには届かない。
    expect(influences('coconut', 'coconut', 'freshness')).toContain('add freshness -10');
    expect(influences('coconut', 'world', 'freshness')).toBe('');
  });

  it('自分自身を値域へ丸めるrange系イベントは影響元に挙げない（プロパティ自身を見れば分かる）', () => {
    expect(influences('world', 'world', 'hour')).toBe('');
    // 繰り上げ先（day）から見れば、hourのon_maxは立派な影響元。
    expect(influences('world', 'world', 'day')).toContain('add day +1');
  });
});

describe('生まれる側・材料側からの逆引き', () => {
  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).buildAndReset();
  const objectDef = (name: string) => codex.objects.get(codex.objectNames.getId(name));

  it('pickの奥にあるspawnも、生み出す型として数える', () => {
    // coconutのcutは、pickの候補の中でcoconut_halfをspawnする。
    expect(createsObject(objectDef('coconut'), codex.objectNames.getId('coconut_half'))).toBe(true);
  });

  it('生み出さない型には答えない', () => {
    expect(createsObject(objectDef('coconut'), codex.objectNames.getId('coconut'))).toBe(false);
    expect(createsObject(objectDef('bowl'), codex.objectNames.getId('coconut_half'))).toBe(false);
  });

  it('材料としても道具としても、使う型から完成品を辿れる', () => {
    const bowl = objectDef('bowl');

    const def = (name: string) => codex.objects.get(codex.objectNames.getId(name));
    expect(usesInRecipes(bowl, def('coconut_half'))).toBe(true);
    // 消費しない道具（consume: false）も、そのレシピに関わる型として数える。
    expect(usesInRecipes(bowl, def('sharp_stone'))).toBe(true);
    expect(usesInRecipes(bowl, def('coconut'))).toBe(false);
  });
});

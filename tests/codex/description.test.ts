import { describe, expect, it } from 'vitest';
import { DescriptionWriter } from '../../src/domain/defs/Description';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 定義が自分自身を書き表す仕組み（`describe`、src/domain/defs/Description.ts）のテスト。
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
        range: {min: 0, max: 23}
        stages:
          - {name: night}
          - {name: day, min: 6}
        on_overflow:
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
    actions:
      eat:
        duration: 10
        conditions:
          - reason: too_far
            prop: freshness
            gt: 0
        add: {actor: {satiety: 20}}
        destroy: self
    combinations:
      cut:
        with: cutting_tool
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

  sharp_stone:
    tags: [item, cutting_tool]
    props:
      weight: {value: 100}
`;

function describeToText(codex: WorldCodex, body: (out: DescriptionWriter) => void): string {
  const writer = new DescriptionWriter();
  body(writer);
  return writer.toPlainText();
}

describe('定義の自己記述（describe）', () => {
  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).build();
  const objectDef = (name: string) => codex.objects.get(codex.objectNames.getId(name));

  it('プロパティの初期値・range・段・range系イベントを書き出す', () => {
    const world = objectDef('world');
    const hour = world.getPropertyDef(codex.propertyNames.getId('hour'))!;
    const text = describeToText(codex, (out) => hour.describe(codex, out));

    expect(text).toContain('初期値: 0');
    expect(text).toContain('range: 0 〜 23');
    expect(text).toContain('night: どの段にも該当しないとき');
    expect(text).toContain('day: 6以上');
    expect(text).toContain('on_overflow:');
    // 繰り上げ先（day）への加算は、入れ子（字下げ）としてon_overflowの下に置かれる。
    expect(text).toContain('\n  add hour -24');
    expect(text).toContain('\n  add day +1');
  });

  it('シンボル型プロパティの値はシンボル名に戻す', () => {
    const world = objectDef('world');
    const weather = world.getPropertyDef(codex.propertyNames.getId('weather'))!;
    const text = describeToText(codex, (out) => weather.describe(codex, out));

    // 値は実行時には数値だが、シンボル型と宣言されていれば名前に戻る（6.6節）。
    expect(text).toContain('初期値: clear');
    // シンボル型の段は名前自体が比較対象なので、段の行は名前だけになる（6.4節）。
    expect(text.split('\n')).toContain('  rain');
  });

  it('持続効果は対象・量・ゲートを書き出す', () => {
    const text = describeToText(codex, (out) => objectDef('world').passives.describe(codex, out));

    expect(text).toContain('modify warmth -2');
    expect(text).toContain('hourが段nightにある');
  });

  it('スロットは枠数・容量・受け入れる型を書き出す', () => {
    const coconut = objectDef('coconut');
    const slot = coconut.getSlotDef(codex.slotNames.getId('contents'))!;
    const text = describeToText(codex, (out) => slot.describe(codex, out));

    expect(text).toContain('枠数: 2');
    expect(text).toContain('capacity: 500');
    expect(text).toContain('foodを持つ型（同種は3個まで）');
  });

  it('アクションはきっかけ・要件・所要時間・効果をこの順で書き出す', () => {
    const eat = objectDef('coconut').actions[0];
    const lines = describeToText(codex, (out) => eat.describe(codex, out)).split('\n');

    expect(lines[0]).toBe('show_menu: always');
    expect(lines[1]).toBe('conditions:');
    expect(lines[2]).toContain('freshness > 0');
    expect(lines[2]).toContain('（理由: too_far）');
    expect(lines[3]).toBe('所要時間: 10分');
    expect(lines).toContain('add satiety +20');
    expect(lines).toContain('destroy self');
  });

  it('combinationは相手のタグとpickの候補を書き出す', () => {
    const cut = objectDef('coconut').combinations[0];
    const text = describeToText(codex, (out) => cut.describe(codex, out));

    expect(text).toContain('with: cutting_toolを持つカードのドロップ');
    expect(text).toContain('pick:');
    // 候補の効果は候補（weight）より1段深い。
    expect(text).toContain('\n  weight = 3\n    spawn coconut_half → same_slot');
    // weightはリテラルだけでなくプロパティ参照にもなる（10.2節）。
    expect(text).toContain('weight = freshness');
  });
});

describe('プロパティの逆引き（describeInfluencesOn）', () => {
  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).build();
  const objectDef = (name: string) => codex.objects.get(codex.objectNames.getId(name));

  function influences(fromObject: string, ownerObject: string, propertyName: string): string {
    const propertyGlobalId = codex.propertyNames.getId(propertyName);
    return describeToText(codex, (out) =>
      objectDef(fromObject).describeInfluencesOn(propertyGlobalId, fromObject === ownerObject, codex, out),
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
    // 繰り上げ先（day）から見れば、hourのon_overflowは立派な影響元。
    expect(influences('world', 'world', 'day')).toContain('add day +1');
  });
});

describe('生まれる側・材料側からの逆引き', () => {
  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).build();
  const objectDef = (name: string) => codex.objects.get(codex.objectNames.getId(name));

  it('pickの奥にあるspawnも、生み出す型として数える', () => {
    // coconutのcutは、pickの候補の中でcoconut_halfをspawnする。
    expect(objectDef('coconut').creates(codex.objectNames.getId('coconut_half'))).toBe(true);
  });

  it('生み出さない型には答えない', () => {
    expect(objectDef('coconut').creates(codex.objectNames.getId('coconut'))).toBe(false);
    expect(objectDef('bowl').creates(codex.objectNames.getId('coconut_half'))).toBe(false);
  });

  it('材料としても道具としても、使う型から完成品を辿れる', () => {
    const bowl = objectDef('bowl');

    expect(bowl.usesInRecipes(codex.objectNames.getId('coconut_half'))).toBe(true);
    // 消費しない道具（consume: false）も、そのレシピに関わる型として数える。
    expect(bowl.usesInRecipes(codex.objectNames.getId('sharp_stone'))).toBe(true);
    expect(bowl.usesInRecipes(codex.objectNames.getId('coconut'))).toBe(false);
  });
});

describe('同梱のWorldCodex', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();

  it('すべての型・プロパティ・スロット・操作・レシピが書き出せる', () => {
    const writer = new DescriptionWriter();
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.get(globalId);
      if (def === undefined) continue;
      def.describe(codex, writer);
      def.passives.describe(codex, writer);
      for (const propertyDef of def.enumeratePropertyDefs()) propertyDef.describe(codex, writer);
      for (const slotDef of def.enumerateSlotDefs()) slotDef.describe(codex, writer);
      for (const interaction of [...def.actions, ...def.combinations]) interaction.describe(codex, writer);
      for (const recipe of def.recipes) recipe.describe(codex, writer);
    }

    // 空行（何も書かれていない行）が混ざっていないこと＝どの宣言も言い表せている。
    expect(writer.toLines().every((line) => line.toPlainText().length > 0)).toBe(true);
    expect(writer.toLines().length).toBeGreaterThan(100);
  });
});

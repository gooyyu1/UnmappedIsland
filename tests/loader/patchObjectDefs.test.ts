import { describe, expect, it } from 'vitest';
import type { ActionDef } from '../../src/domain/ActionDef';
import { DescriptionWriter } from '../../src/codex-viewer/describe/Description';
import { defNamesOf } from '../../src/codex-viewer/describe/codexNames';
import { describeInteraction } from '../../src/codex-viewer/describe/describeInteraction';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { LoadReport } from '../../src/loader/LoadReport';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * patch_object_defs（GameElementDefinition.md 3.4節）の検証。
 *
 * 見るのは「当てた結果」と「当てられなかったときの振る舞い」の2つ。後者は、報告先の有無で
 * 止まるか続くかが変わる（AssetPack.md 6.1節）。
 */
const BASE = `
object_defs:
  ground:
    singleton: true
    tags: [location]
    props:
      find_stone: {value: 10}
    actions:
      explore:
        showMenu: always
        pick:
          - weight: {prop: find_stone}
            spawn: {object: stone, into: self}
          - weight: 5
            spawn: {object: twig, into: self}
  stone:
    tags: [item]
  twig:
    tags: [item]
  potion:
    tags: [item]
`;

function build(patchYaml: string, report?: LoadReport): WorldCodex {
  const loader = new WorldCodexYamlLoader().load('base.yaml', BASE);
  return loader.load('pack.yaml', patchYaml, report).build();
}

function describeExplore(codex: WorldCodex): string {
  const def = codex.objects.get(codex.objectNames.getId('ground'));
  const writer = new DescriptionWriter();
  describeInteraction(
    def.actions.find((action) => action.name === 'explore') as ActionDef,
    defNamesOf(codex),
    writer,
  );
  return writer.toPlainText();
}

describe('patch_object_defs', () => {
  it('append: 配列の末尾へ足す（既存の要素は残る）', () => {
    const text = describeExplore(
      build(`
patch_object_defs:
  - append: ground.actions.explore.pick
    value:
      weight: 2
      spawn: {object: potion, into: self}
`),
    );

    expect(text).toContain('potion');
    expect(text).toContain('stone');
  });

  it('add: まだ無いキーを作る', () => {
    const codex = build(`
patch_object_defs:
  - add: ground.actions.rest
    value:
      showMenu: always
      add: {self: {find_stone: 1}}
`);

    expect(codex.objects.get(codex.objectNames.getId('ground')).actions.map((a) => a.name)).toEqual([
      'explore',
      'rest',
    ]);
  });

  it('set: 既にある値を差し替える', () => {
    const codex = build(`
patch_object_defs:
  - set: ground.props.find_stone.value
    value: 99
`);

    const session = new WorldSession(codex);
    const ground = new WorldObject(1, codex.objects.get(codex.objectNames.getId('ground')), session);
    expect(ground.tryGetProperty(codex.propertyNames.getId('find_stone'))?.number ?? 0).toBe(99);
    // 同じプロパティを見ている候補の重みも、差し替えた値で引かれる。
    expect(describeExplore(codex)).toContain('find_stone');
  });

  it('set: whereで選んだ配列の要素を丸ごと差し替える', () => {
    const text = describeExplore(
      build(`
patch_object_defs:
  - set: ground.actions.explore.pick
    where: {spawn: {object: twig, into: self}}
    value:
      weight: 40
      spawn: {object: potion, into: self}
`),
    );

    expect(text).toContain('potion');
    expect(text).not.toContain('twig');
  });

  it('remove: whereで選んだ配列の要素を消す', () => {
    const text = describeExplore(
      build(`
patch_object_defs:
  - remove: ground.actions.explore.pick
    where: {spawn: {object: twig, into: self}}
`),
    );

    expect(text).not.toContain('twig');
    expect(text).toContain('stone');
  });

  it('remove: キーごと消す', () => {
    const codex = build(`
patch_object_defs:
  - remove: ground.actions.explore
`);

    expect(codex.objects.get(codex.objectNames.getId('ground')).actions).toEqual([]);
  });
});

describe('patch_object_defsの誤り', () => {
  it.each([
    ['対象の型が無い', '  - append: swamp.actions.explore.pick\n    value: {weight: 1}'],
    ['配列でないものへappend', '  - append: ground.props.find_stone\n    value: {weight: 1}'],
    ['既にあるキーへadd', '  - add: ground.props.find_stone\n    value: {value: 1}'],
    ['無いキーへset', '  - set: ground.props.find_gold.value\n    value: 1'],
    ['無いものをremove', '  - remove: ground.props.find_gold'],
    ['whereが当てはまらない', '  - remove: ground.actions.explore.pick\n    where: {spawn: {object: gold}}'],
    ['動詞が2つ', '  - add: ground.props.a\n    remove: ground.props.b\n    value: 1'],
    ['パスが型だけ', '  - remove: ground'],
  ])('同梱ぶんなら止まる: %s', (_name, operation) => {
    expect(() => build(`patch_object_defs:\n${operation}\n`)).toThrow(YamlLoadError);
  });

  it('アセットパックなら、その1操作だけを捨てて残りを当てる', () => {
    const report = new LoadReport();

    const codex = build(
      `
patch_object_defs:
  - remove: ground.actions.explore.pick
    where: {spawn: {object: gold, into: self}}
  - append: ground.actions.explore.pick
    value:
      weight: 2
      spawn: {object: potion, into: self}
`,
      report,
    );

    expect(describeExplore(codex), '後続の操作は当たる').toContain('potion');
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].attempted).toBe('remove ground.actions.explore.pick');
    expect(report.problems[0].source).toBe('pack.yaml');
  });

  it('同じ場所を2度差し替えようとしたら、先に読んだ方が残る', () => {
    const report = new LoadReport();

    const codex = build(
      `
patch_object_defs:
  - set: ground.props.find_stone.value
    value: 1
  - set: ground.props.find_stone.value
    value: 2
`,
      report,
    );

    const session = new WorldSession(codex);
    const ground = new WorldObject(1, codex.objects.get(codex.objectNames.getId('ground')), session);
    expect(
      ground.tryGetProperty(codex.propertyNames.getId('find_stone'))?.number ?? 0,
      '先に読んだ方が残る',
    ).toBe(1);
    expect(report.problems).toHaveLength(1);
  });
});

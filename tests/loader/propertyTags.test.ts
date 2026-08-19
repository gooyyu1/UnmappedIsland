import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import type { WorldCodex } from '../../src/domain/WorldCodex';

/** プロパティのタグ（GameElementDefinition.md 6.7節）に対する自動テスト。 */
describe('プロパティのタグ', () => {
  function build(...files: string[]): WorldCodex {
    const loader = new WorldCodexYamlLoader();
    files.forEach((yaml, index) => loader.load(`file${index}.yaml`, yaml));
    return loader.build();
  }

  function instanceOf(codex: WorldCodex, objectDefName: string): WorldObject {
    const def = codex.objects.get(codex.objectNames.getId(objectDefName));
    return new WorldObject(1, def, new WorldSession(codex));
  }

  function propertyNamesWithTag(codex: WorldCodex, object: WorldObject, tagName: string): string[] {
    return object.propertiesWithTag(codex.propertyTagNames.getId(tagName)).map((r) => r.def.name);
  }

  const declaration = `
property_tags:
  status:
  health:
  nutrition:
`;

  it('propsのtagsで付けたタグを、タグ指定で読み出せる', () => {
    const codex = build(
      declaration,
      `
object_defs:
  character:
    props:
      stamina:
        tags: [status, health]
        value: 100
        range: {min: 0, max: 100}
      body_fat:
        tags: [nutrition]
        value: 40
        range: {min: 0, max: 100}
`,
    );
    const character = instanceOf(codex, 'character');

    expect(propertyNamesWithTag(codex, character, 'status')).toEqual(['stamina']);
    expect(propertyNamesWithTag(codex, character, 'health')).toEqual(['stamina']);
    expect(propertyNamesWithTag(codex, character, 'nutrition')).toEqual(['body_fat']);
  });

  it('タグIDは宣言順に振られる（UIのカテゴリの並び順になる）', () => {
    const codex = build(declaration);

    expect(codex.propertyTagNames.count).toBe(3);
    expect([0, 1, 2].map((id) => codex.propertyTagNames.getName(id))).toEqual([
      'status',
      'health',
      'nutrition',
    ]);
  });

  it('property_tagsは別ファイルで宣言していてもよい', () => {
    const codex = build(
      `
object_defs:
  character:
    props:
      stamina:
        tags: [status]
        value: 100
`,
      declaration,
    );

    expect(propertyNamesWithTag(codex, instanceOf(codex, 'character'), 'status')).toEqual(['stamina']);
  });

  it('property_tagsで宣言されていないタグ名はエラーになる', () => {
    const yaml = `
object_defs:
  character:
    props:
      stamina:
        tags: [unknown_tag]
        value: 100
`;
    expect(() => build(declaration, yaml)).toThrow(YamlLoadError);
    expect(() => build(declaration, yaml)).toThrowError(/宣言されていません/);
  });

  it('trait側のタグとobject_def側のタグは足し合わされる（他のフィールドは上書き）', () => {
    const codex = build(
      declaration,
      `
traits:
  vital:
    props:
      stamina:
        tags: [health]
        value: 50
        range: {min: 0, max: 100}
object_defs:
  character:
    traits: [vital]
    props:
      stamina:
        tags: [status]
        value: 80
`,
    );
    const character = instanceOf(codex, 'character');

    expect(propertyNamesWithTag(codex, character, 'status')).toEqual(['stamina']);
    expect(propertyNamesWithTag(codex, character, 'health')).toEqual(['stamina']);
    // valueは上書き、rangeはtrait側を引き継ぐ（5節）という既存の規則は変わらない。
    expect(character.getNumber(codex.propertyNames.getId('stamina'))).toBe(80);
    expect(
      codex.objects
        .get(codex.objectNames.getId('character'))
        .getPropertyDef(codex.propertyNames.getId('stamina'))?.range?.max,
    ).toBe(100);
  });

  it('同じタグをtraitとobject_defの両方で宣言しても重複しない', () => {
    const codex = build(
      declaration,
      `
traits:
  vital:
    props:
      stamina:
        tags: [status]
        value: 50
object_defs:
  character:
    traits: [vital]
    props:
      stamina:
        tags: [status, health]
`,
    );
    const stamina = codex.objects
      .get(codex.objectNames.getId('character'))
      .getPropertyDef(codex.propertyNames.getId('stamina'));

    expect(stamina?.tags).toHaveLength(2);
  });

  it('タグを持たないプロパティは読み出されない', () => {
    const codex = build(
      declaration,
      `
object_defs:
  rock:
    props:
      weight:
        value: 10
`,
    );

    expect(propertyNamesWithTag(codex, instanceOf(codex, 'rock'), 'status')).toEqual([]);
  });

  it('rangeを持つプロパティはratioを、持たないプロパティはundefinedを返す', () => {
    const codex = build(
      declaration,
      `
object_defs:
  character:
    props:
      stamina:
        tags: [status]
        value: 25
        range: {min: 0, max: 100}
      tick_count:
        tags: [status]
        value: 7
`,
    );
    const properties = instanceOf(codex, 'character').propertiesWithTag(
      codex.propertyTagNames.getId('status'),
    );

    // stagesを持たないプロパティはどの域にも入らない扱い（safe）になる。
    expect(
      properties.map((property) => ({
        name: property.def.name,
        value: property.getEffectiveValue(),
        ratio: property.ratio,
        alert: property.alert,
        worsensUpward: property.def.worsensUpward,
      })),
    ).toEqual([
      { name: 'stamina', value: 25, ratio: 0.25, alert: 'safe', worsensUpward: false },
      { name: 'tick_count', value: 7, ratio: undefined, alert: 'safe', worsensUpward: false },
    ]);
  });
});

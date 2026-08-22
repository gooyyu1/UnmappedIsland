import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

/**
 * recipes（GameElementDefinition.md 13節）のロードと、解放条件（同13.3節・SkillSystem.md 4節）の
 * 評価に対する自動テスト。
 */
describe('recipes', () => {
  const load = (yaml: string) => new WorldCodexYamlLoader().load('core.yaml', yaml).build();

  const recipesOf = (codex: ReturnType<typeof load>, objectName: string) =>
    codex.objects.get(codex.objectNames.getId(objectName)).recipes;

  it('requiresはタグでも書ける（道具は用途で求める）', () => {
    const codex = load(`
object_defs:
  sharp_stone:
    tags: [cutting_tool]
  stone_axe:
    tags: [cutting_tool]
  hide: {}
  cloak:
    recipes:
      sewn:
        steps:
          - requires:
              - {object: hide, count: 2, consume: true}
              - {tag: cutting_tool, consume: false}
            duration: 30
`);

    const [step] = recipesOf(codex, 'cloak')[0].steps;
    const def = (name: string) => codex.objects.get(codex.objectNames.getId(name));
    const [material, tool] = step.requirements;

    expect(material.requires(def('hide'))).toBe(true);
    expect(tool.consume).toBe(false);
    // タグの要求は、そのタグを持つどの型でも満たせる。
    expect(tool.requires(def('sharp_stone'))).toBe(true);
    expect(tool.requires(def('stone_axe'))).toBe(true);
    expect(tool.requires(def('hide'))).toBe(false);
  });

  it('requiresのobjectとtagは同時に書けない', () => {
    expect(() =>
      load(`
object_defs:
  hide:
    tags: [pelt]
  cloak:
    recipes:
      sewn:
        steps:
          - requires:
              - {object: hide, tag: pelt, consume: true}
            duration: 30
`),
    ).toThrow(YamlLoadError);
  });

  it('steps/requires/duration/iconを読める', () => {
    const codex = load(`
object_defs:
  wood: {}
  stone_knife: {}
  rope: {}
  axe:
    recipes:
      basic:
        icon: axe_wip.png
        steps:
          - requires:
              - {object: wood, count: 2, consume: true}
              - {object: stone_knife, consume: false}
            duration: 30
          - requires:
              - {object: rope, consume: true}
            duration: 10
`);

    const recipes = recipesOf(codex, 'axe');
    expect(recipes).toHaveLength(1);

    const recipe = recipes[0];
    expect(recipe.name).toBe('basic');
    expect(recipe.icon).toBe('axe_wip.png');
    expect(recipe.steps).toHaveLength(2);

    const [first, second] = recipe.steps;
    expect(first.durationMinutes).toBe(30);
    expect(first.requirements[0].requires(codex.objects.get(codex.objectNames.getId('wood')))).toBe(true);
    expect(first.requirements[0].count).toBe(2);
    expect(first.requirements[0].consume).toBe(true);
    expect(first.requirements[1].consume).toBe(false);

    // countは省略すると1。
    expect(second.requirements[0].count).toBe(1);
  });

  it('conditionsが無いレシピは最初から解放されている', () => {
    const codex = load(`
object_defs:
  wood: {}
  stick:
    recipes:
      basic:
        steps:
          - requires: [{object: wood, consume: true}]
            duration: 5
`);

    expect(recipesOf(codex, 'stick')[0].unmetUnlockRequirement(() => undefined)).toBeUndefined();
  });

  it('conditionsはactorのスキルの段で解放を判定する', () => {
    const codex = load(`
object_defs:
  fiber: {}
  character:
    props:
      skill_cordage:
        value: 0
        stages:
          - {name: novice, min: 0}
          - {name: basic, min: 20}
          - {name: skilled, min: 60}
  basket:
    recipes:
      woven:
        conditions:
          - {subject: actor, prop: skill_cordage, in_stage: skilled}
        steps:
          - requires: [{object: fiber, count: 4, consume: true}]
            duration: 60
`);

    const session = new WorldSession(codex);
    const actor = new WorldObject(1, codex.objects.get(codex.objectNames.getId('character')), session);
    const resolveRoot = (root: string) => (root === 'actor' ? actor : undefined);

    const recipe = recipesOf(codex, 'basket')[0];
    const skillId = codex.propertyNames.getId('skill_cordage');

    expect(recipe.unmetUnlockRequirement(resolveRoot)).toBeDefined();

    actor.tryGetProperty(skillId)?.setNumber(60);
    expect(recipe.unmetUnlockRequirement(resolveRoot)).toBeUndefined();
  });

  it('満たしていない解放条件はreasonつきで取り出せる', () => {
    const codex = load(`
object_defs:
  fiber: {}
  character:
    props:
      skill_cordage:
        value: 0
        stages:
          - {name: novice, min: 0}
          - {name: skilled, min: 60}
  basket:
    recipes:
      woven:
        conditions:
          - {subject: actor, prop: skill_cordage, in_stage: skilled, reason: needs_cordage_skill}
        steps:
          - requires: [{object: fiber, consume: true}]
            duration: 60
`);

    const session = new WorldSession(codex);
    const actor = new WorldObject(1, codex.objects.get(codex.objectNames.getId('character')), session);

    const unmet = recipesOf(codex, 'basket')[0].unmetUnlockRequirement((root) =>
      root === 'actor' ? actor : undefined,
    );

    expect(unmet?.reasonName).toBe('needs_cordage_skill');
  });

  it('conditionsのobjectにactor以外を使うとエラーになる', () => {
    const yaml = `
object_defs:
  fiber: {}
  basket:
    recipes:
      woven:
        conditions:
          - {subject: self, prop: quality, gte: 1}
        steps:
          - requires: [{object: fiber, consume: true}]
            duration: 60
`;
    expect(() => load(yaml)).toThrow(YamlLoadError);
    expect(() => load(yaml)).toThrowError(/self/);
  });

  it('recipesをtraitに書くとエラーになる', () => {
    const yaml = `
traits:
  craftable:
    recipes:
      basic:
        steps:
          - requires: [{object: fiber, consume: true}]
            duration: 5
object_defs:
  fiber: {}
`;
    expect(() => load(yaml)).toThrow(YamlLoadError);
    expect(() => load(yaml)).toThrowError(/trait/);
  });

  it('consumeの省略はエラーになる', () => {
    const yaml = `
object_defs:
  fiber: {}
  basket:
    recipes:
      woven:
        steps:
          - requires: [{object: fiber}]
            duration: 5
`;
    expect(() => load(yaml)).toThrowError(/consume/);
  });

  it('stepsが空のレシピはエラーになる', () => {
    const yaml = `
object_defs:
  basket:
    recipes:
      woven:
        steps: []
`;
    expect(() => load(yaml)).toThrowError(/steps/);
  });

  it('レシピの未知のキーはエラーになる', () => {
    const yaml = `
object_defs:
  fiber: {}
  basket:
    recipes:
      woven:
        unknown_key: 1
        steps:
          - requires: [{object: fiber, consume: true}]
            duration: 5
`;
    expect(() => load(yaml)).toThrowError(/unknown_key/);
  });
});

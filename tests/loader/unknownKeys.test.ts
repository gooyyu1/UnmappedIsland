import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * `object_defs.'名前'` / `traits.'名前'` / `slots.'名前'` の直下に書いた未知キーを、ロード時に弾く
 * こと。容量や「入れ物として扱うか」は書き忘れると静かに効くので、綴り間違いも静かに効く。
 */
describe('宣言の直下の未知キー', () => {
  const load = (yaml: string): void => {
    new WorldCodexYamlLoader().load('test.yaml', yaml).buildAndReset();
  };

  describe("slots.'名前'の直下", () => {
    it('綴り間違いはロードエラーになり、キー名を名指しする', () => {
      expect(() =>
        load(`
object_defs:
  basket:
    slots:
      contents: {capcity: 5}
`),
      ).toThrow(/capcity/);
    });

    it('正しい綴りなら通る', () => {
      expect(() =>
        load(`
object_defs:
  basket:
    slots:
      contents: {capacity: 5}
`),
      ).not.toThrow();
    });

    it('廃止キーは、どこへ書くかを言うエラーのまま（未知キー扱いにしない）', () => {
      expect(() =>
        load(`
object_defs:
  basket:
    slots:
      contents: {accepts: [item]}
`),
      ).toThrow(/廃止されました/);
    });
  });

  describe("object_defs.'名前'の直下", () => {
    it('綴り間違いはロードエラーになり、キー名を名指しする', () => {
      expect(() => load(`object_defs: {basket: {stroage: true}}`)).toThrow(/stroage/);
    });

    it('正しい綴りなら通る', () => {
      expect(() => load(`object_defs: {basket: {storage: true}}`)).not.toThrow();
    });

    it('型自身の素性（traits・singleton・recipes・variation_axes）は通る', () => {
      expect(() =>
        load(`
traits:
  container: {storage: true}
  liquid: {tags: [liquid]}
object_defs:
  water_liquid: {traits: [liquid]}
  basket:
    traits: [container]
    singleton: false
    variation_axes:
      content: {of: {tag: liquid}}
    recipes:
      weave: {steps: [{duration: 10, requires: [{tag: fiber, consume: true}]}]}
`),
      ).not.toThrow();
    });
  });

  describe("traits.'名前'の直下", () => {
    it('綴り間違いはロードエラーになり、キー名を名指しする', () => {
      expect(() => load(`traits: {container: {stroage: true}}`)).toThrow(/stroage/);
    });

    it('正しい綴りなら通る', () => {
      expect(() => load(`traits: {container: {storage: true}}`)).not.toThrow();
    });

    it('object_defだけの素性は、traitに書けば未知キー', () => {
      expect(() => load(`traits: {container: {singleton: true}}`)).toThrow(/singleton/);
      expect(() => load(`traits: {container: {traits: [other]}}`)).toThrow(/traits/);
    });

    it('recipesは、どこへ書くかを言うエラーのまま（未知キー扱いにしない）', () => {
      expect(() => load(`traits: {container: {recipes: {weave: {duration: 10}}}}`)).toThrow(
        /object_defへ書いてください/,
      );
    });
  });

  it('covers・layerは、ローダーが解釈しないまま素通しする（文法として文書化済み）', () => {
    expect(() =>
      load(`
traits:
  worn: {covers: [torso], layer: outer}
object_defs:
  coat: {covers: [torso], layer: outer}
`),
    ).not.toThrow();
  });

  it('YamlLoadErrorとして投げる', () => {
    expect(() => load(`object_defs: {basket: {stroage: true}}`)).toThrow(YamlLoadError);
  });
});

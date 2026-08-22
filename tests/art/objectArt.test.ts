import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { artNameFor } from '../../src/art/objectArt';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** object_defごとの絵の置き場所（src/art/objectArt.ts の規約）。 */
const ART_DIR = 'src/assets/objects';

/**
 * 載り方が違う絵だけが名乗る接尾辞。objectArt.ts の MULTIPLY_SUFFIX に一致していなければならない。
 */
const MULTIPLY_SUFFIX = '_multiply';

/**
 * 絵の解決は「ファイル名＝object_defの識別子」という規約だけで成り立っており、コード側に対応表が無い。
 * 名前を間違えた絵は黙って使われないまま残るため、ここで実在の識別子かどうかを検査する。
 */
describe('object_defごとの絵', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  function artNames(): string[] {
    return readdirSync(ART_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.slice(0, -'.png'.length));
  }

  /** ファイル名が指すobject_defの識別子（乗算の絵は接尾辞を外したもの）。 */
  function objectNameOf(fileName: string): string {
    return fileName.endsWith(MULTIPLY_SUFFIX) ? fileName.slice(0, -MULTIPLY_SUFFIX.length) : fileName;
  }

  /**
   * `art_by_stage`（GameElementDefinition.md 6.4節）が宣言している `<object_defの識別子>_<art接尾辞>`
   * の一覧。素の識別子・`_multiply`と並ぶ、正当なファイル名の第3の形。
   */
  function stageArtNames(): Set<string> {
    const names = new Set<string>();
    for (let id = 0; id < codex.objectNames.count; id++) {
      const objectName = codex.objectNames.getName(id);
      for (const suffix of codex.objects.get(id).artSuffixes()) names.add(`${objectName}_${suffix}`);
    }
    return names;
  }

  it('ファイル名は、実在するobject_defの識別子である', () => {
    const names = artNames();
    expect(names.length, '検査対象が無い（置き場所が変わっていないか）').toBeGreaterThan(0);
    const knownStageArtNames = stageArtNames();

    for (const name of names) {
      if (knownStageArtNames.has(name)) continue;
      expect(
        codex.objectNames.tryGetId(objectNameOf(name)),
        `'${name}.png' に対応するobject_defが無い`,
      ).toBeDefined();
    }
  });

  it('ファイル名は識別子の命名規則（3.2節）に従う', () => {
    for (const name of artNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  /**
   * 気を失った動物は、死体の絵をそのまま借りる（CardView.md 5.1節）。借りられるのは死体の型が
   * `<動物>_carcass` と名付けられているからで、この規約が崩れても絵は黙って生きた姿のままになる
   * ——ロードは通り、画面も出るので、ここで検査しないと気付けない。
   */
  it('気を失った動物の絵は、その動物の死体の絵になる', () => {
    const animals = codex.objectDefNamesWithTag('animal');
    expect(animals.length, '検査対象が無い（animalタグが変わっていないか）').toBeGreaterThan(0);
    // **まだ絵の無い動物は見ない。** 生きた姿すら描かれていない相手には借りる元が無く、宣言と絵を
    // 別々の時に用意できるのは artNameFor の既定動作そのもの（objectArt.ts）。描いた瞬間から、
    // 死体の絵が揃っているかを下の検査が見る。
    const drawn = new Set(artNames());

    for (const animal of animals.filter((animal) => drawn.has(animal))) {
      const objectDef = codex.objects.get(codex.objectNames.getId(animal));
      const suffix = objectDef
        .tryGetPropertyDef(codex.propertyNames.getId('consciousness'))
        ?.artSuffixOf(0 /* 気を失っている */);
      expect(suffix, `'${animal}' の気絶した段が絵を宣言していない`).toBeDefined();

      const carcass = `${animal}_${suffix}`;
      expect(
        codex.objectNames.tryGetId(carcass),
        `'${animal}' の気絶した絵が指す '${carcass}' という型が無い`,
      ).toBeDefined();
      expect(artNameFor(animal, suffix), `'${carcass}.png' が無いので生きた姿のまま出る`).toBe(carcass);
    }
  });
});

/**
 * art_by_stage（GameElementDefinition.md 6.4節）の絵の名前解決。lacerationは`_multiply`層しか
 * 持たない実在の絵で、ここでは「接尾辞付きファイルが実在するか」だけを見る材料として流用する。
 */
describe('artNameFor', () => {
  it('接尾辞のファイルが実在すれば、そちらの名前を返す', () => {
    expect(artNameFor('laceration', 'multiply')).toBe('laceration_multiply');
  });

  it('接尾辞のファイルがまだ無ければ、型自身の名前へ落ちる', () => {
    expect(artNameFor('laceration', 'not_drawn_yet')).toBe('laceration');
  });

  it('接尾辞を渡さなければ、型自身の名前をそのまま返す', () => {
    expect(artNameFor('laceration', undefined)).toBe('laceration');
  });
});

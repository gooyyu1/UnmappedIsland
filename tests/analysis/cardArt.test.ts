import { beforeAll, describe, expect, it } from 'vitest';
import { typesShowingOwnArtOnCard } from '../../src/analysis/cardArt';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WORLD_TIME_YAML } from '../support/worldYaml';

/** 「札に自分の絵を映す型」の判定（`src/analysis/cardArt.ts`）。 */
describe('typesShowingOwnArtOnCard', () => {
  // 変種の軸の値（液体と、食べ物の加工）・作りかけ・その素の型が揃う最小の世界。
  // **レシピの名前を型の名前と重ねる**（`bark`）——作りかけの軸の値はレシピの名前なので、型の名前と
  // 取り違えると、その型が数えられなくなる。
  const YAML = `
in_progress_tags: [item]
traits:
  water_content:
    tags: [liquid]
  cured:
    tags: [preserved]
object_defs:
  water_liquid:
    traits: [water_content]
  dried:
    traits: [cured]
  jar:
    tags: [item]
    variation_axes:
      content: {of: {tag: liquid}}
  meat:
    tags: [item]
    variation_axes:
      cure: {of: {object: dried}}
  bark:
    tags: [item]
  rope:
    tags: [item]
    recipes:
      bark:
        steps:
          - requires: [{object: bark, count: 1, consume: true}]
            duration: 30
`;

  let codex: WorldCodex;
  let shown: Set<string>;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loader.load('world.yaml', WORLD_TIME_YAML);
    codex = loader.load('card_art.yaml', YAML).buildAndReset();
    shown = new Set(typesShowingOwnArtOnCard(codex).map((def) => def.name));
  });

  it('素の型は、変種や作りかけを持っていても数える', () => {
    expect([...shown].sort()).toEqual(['bark', 'jar', 'meat', 'rope']);
  });

  it('変種の軸の値は数えない（個体が作られない）', () => {
    expect(shown.has('water_liquid')).toBe(false);
    expect(shown.has('dried')).toBe(false);
  });

  it('生成型は数えない（素の型の絵を映す）', () => {
    const generated = [...codex.objects].filter((def) => codex.isGenerated(def));
    // 中身入り・加工済み・作りかけがどれも生成されていなければ、下の検査は何も見ていない。
    const bases = new Set(generated.map((def) => codex.baseOf(def).name));
    expect([...bases].sort()).toEqual(['jar', 'meat', 'rope']);
    for (const def of generated) expect(shown.has(def.name), def.name).toBe(false);
  });

  it('世界そのものは数えない（どのスロットにも入らない）', () => {
    expect(shown.has(codex.vocabulary.world.worldObject)).toBe(false);
  });
});

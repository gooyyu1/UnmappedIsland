import { beforeAll, describe, expect, it } from 'vitest';
import type { CardFilter } from '../../src/domain/CardFilter';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldSession } from '../../src/domain/WorldSession';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * フィルターバーのボタン（`card_filters`、docs/ui/ScreenLayout.md 8.1節）が、**同梱の定義で
 * 実際にどの札を残すか**の自動テスト。
 *
 * **合成YAMLでは確かめられない。** 残るかどうかを決めているのはタグの張り方そのもので、
 * その場で宣言した最小の世界では「自分の張り方が自分の期待どおりか」しか見られない。
 */
describe('フィルターバーの絞り込み', () => {
  let codex: WorldCodex;
  let session: WorldSession;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    session = new WorldSession(codex);
  });

  /** そのidのボタン（無ければテストが落ちる）。 */
  function filter(id: string): CardFilter {
    const found = codex.cardFilters.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`フィルター'${id}'が無い`);
    return found;
  }

  /** その型の個体1つ。 */
  function object(name: string): WorldObject {
    return session.createObject(codex.objectNames.getId(name));
  }

  /** 挙げた型のうち、そのボタンで残るものの名前。 */
  function remaining(id: string, names: readonly string[]): readonly string[] {
    const button = filter(id);
    return names.filter((name) => button.matches(object(name)));
  }

  it('ボタンは、宣言した順に8つ並ぶ（「すべて」はワールドに置かない）', () => {
    expect(codex.cardFilters.map((entry) => entry.id)).toEqual([
      'filter_food',
      'filter_water',
      'filter_fire',
      'filter_tool',
      'filter_container',
      'filter_wear',
      'filter_shelter',
      'filter_travel',
    ]);
    expect(codex.cardFilters.map((entry) => entry.id)).not.toContain('filter_all');
  });

  it('指しているタグは、どれも名乗る型を持つ（綴りの誤り検知）', () => {
    // ロード時には落とせない（タグはファイルをまたいで付く、8.1.3節）ので、世界を丸ごと読んだ
    // ここで見る。綴りを間違えたタグは、黙って何も残さないボタンになる。
    const defs = Array.from({ length: codex.objects.count }, (_, globalId) => codex.objects.get(globalId));
    const unused = codex.cardFilters.flatMap((entry) =>
      entry.tagGlobalIds
        .filter((tagGlobalId) => !defs.some((def) => def.tags.includes(tagGlobalId)))
        .map((tagGlobalId) => `${entry.id}: ${codex.tagNames.getName(tagGlobalId)}`),
    );

    expect(unused, '名乗る型が1つも無いタグ').toEqual([]);
  });

  it('食は、食べられる物だけでなく焼ける物・炉・塩を残す', () => {
    // 生の芋はfoodを持たない（焼いて初めて食べ物になる）。塩は味付けと塩蔵の物で、食べ物ではない
    // （salt.yaml）。石も炉で焼いて湯を沸かす道具なのでroastableを名乗る（fire.yamlのheat_soaking）。
    // どれも料理の場に並んでいなければ仕事にならない。
    const shown = ['taro', 'three_stone_hearth', 'salt', 'stone', 'cord'];
    expect(remaining('filter_food', shown)).toEqual(['taro', 'three_stone_hearth', 'salt', 'stone']);
  });

  it('火は炉と燃料を残し、食のボタンと炉を分け合う', () => {
    // 1枚の札が複数のボタンに出てよい（8.1.1節）。炉は食にも火にも出る。
    const shown = ['three_stone_hearth', 'thick_branch', 'taro'];
    expect(remaining('filter_fire', shown)).toEqual(['three_stone_hearth', 'thick_branch']);
  });

  it('住まいは、雨風をしのげる物だけを残す', () => {
    const shown = ['shallow_cave', 'three_stone_hearth', 'stone'];
    expect(remaining('filter_shelter', shown)).toEqual(['shallow_cave']);
  });

  it('遠出は、道と海の経路と船を残す', () => {
    expect(remaining('filter_travel', ['path', 'route_to_shore', 'raft', 'stone'])).toEqual([
      'path',
      'route_to_shore',
      'raft',
    ]);
  });

  it('当たる物を中に持つ入れ物も残る（空の入れ物は残らない）', () => {
    const basket = object('woven_basket');
    const contents = codex.slotNames.getId('contents');
    expect(filter('filter_food').matches(basket), '空の籠').toBe(false);

    expect(object('taro').moveToSlotOrRejection(basket.getSlot(contents))).toBeUndefined();
    expect(filter('filter_food').matches(basket), '芋を入れた籠').toBe(true);
  });

  it('外から覗けないスロットの中身は、残す理由にならない', () => {
    // 洞窟は場所であって開いて中を見る入れ物ではない（visible_slotsを名乗らない、8.1.4節）。
    // 中に芋を置いても、外から食べ物が在るとは分からない。
    const cave = object('shallow_cave');
    expect(
      object('taro').moveToSlotOrRejection(cave.getSlot(codex.slotNames.getId('items'))),
    ).toBeUndefined();

    expect(filter('filter_food').matches(cave)).toBe(false);
  });
});

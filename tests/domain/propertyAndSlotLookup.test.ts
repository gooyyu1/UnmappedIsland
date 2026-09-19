import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldSession } from '../../src/domain/WorldSession';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * プロパティ・スロットの引き方（WorldObject.tryGetProperty / getProperty / tryGetSlot / getSlot）に
 * 対する自動テスト。
 *
 * 持っていないことを許さない版が捕まえたいのは**YAMLの書き間違い**なので、何が無いのかを名前で
 * 言えることまでを仕様として確かめる。
 */
describe('プロパティ・スロットの引き方', () => {
  const codex = new WorldCodexYamlLoader()
    .load(
      'core.yaml',
      `
object_defs:
  path:
    props:
      travel_minutes: {value: 60}
      width: {value: 2}
    slots:
      contents: {}
  stone:
    props:
      weight: {value: 1}
`,
    )
    .buildAndReset();

  const spawn = (name: string) => new WorldSession(codex).createObject(codex.objectNames.getId(name));

  it('全部を答える口は、propsの宣言順でその物のプロパティを返す', () => {
    // 絞らずに全部が要る側（画面のプロパティ一覧）は、定義から1つずつ引き当てずにこれを読む。
    const path = spawn('path');

    expect(path.allProperties().map((property) => property.def.name)).toEqual(['travel_minutes', 'width']);
    expect(path.allProperties()[0], '引き当てで得るものと同じ1つ').toBe(
      path.tryGetProperty(codex.propertyNames.getId('travel_minutes')),
    );
  });

  it('持たないものはtryGet系ならundefined', () => {
    const stone = spawn('stone');

    expect(stone.tryGetProperty(codex.propertyNames.getId('travel_minutes'))).toBeUndefined();
    expect(stone.tryGetSlot(codex.slotNames.getId('contents'))).toBeUndefined();
  });

  it('get系は、無いものを名前で言って投げる', () => {
    const stone = spawn('stone');

    expect(() => stone.getProperty(codex.propertyNames.getId('travel_minutes'))).toThrowError(
      "'stone' はプロパティ 'travel_minutes' を持ちません。",
    );
    expect(() => stone.getSlot(codex.slotNames.getId('contents'))).toThrowError(
      "'stone' はスロット 'contents' を持ちません。",
    );
  });

  it('配られていないIDは、宣言されていないことと混ぜずに投げる', () => {
    // **「この物が持っていない」と「そもそも誰にも配られていない番号」は別の話。** 前者はYAMLの
    // 書き間違い（上の試験が見ている文面）で、後者は名前を経由せずに数を作った引き方の間違い。
    // 畳むと、壊れたIDを渡した側が「持っていない」を受け取って先へ進む。
    //
    // このcodexが配っていないIDを渡す試験なので、**IDを作れる唯一の口（NameRegistry）を通れない**
    // ——素の数から型を跨ぐのはここだけで、その理由がこの試験そのもの。
    const unissued = codex.propertyNames.count as PropertyGlobalId;
    expect(() => spawn('stone').getProperty(unissued)).toThrowError(
      `グローバルID ${codex.propertyNames.count} は、この名前空間が配った番号ではありません`,
    );
    expect(() => spawn('stone').tryGetProperty(-1 as PropertyGlobalId)).toThrowError(
      'この名前空間が配った番号ではありません',
    );
  });
});

/**
 * `WorldObject.allProperties` が渡すもの（同口のdoc）。**実体を渡すが、顔ぶれが変わるのは型の
 * 差し替えだけ**という組み合わせなので、どちらへ倒しても読み手の見えるものが変わる。
 */
describe('allPropertiesが渡すもの', () => {
  const codex = new WorldCodexYamlLoader()
    .load(
      'core.yaml',
      `
traits:
  # 変種にだけプロパティを配るtrait。素の型はashを持たないので、顔ぶれが替わったことが名前で分かる。
  burnt:
    tags: [burnt]
    props:
      ash: {value: 1}
object_defs:
  torch:
    props:
      fuel: {value: 3}
      heat: {value: 1}
    variation_axes:
      state: {of: {tag: burnt}}
  burnt_torch:
    traits: [burnt]
`,
    )
    .buildAndReset();

  it('並びは実体だが、顔ぶれが替わるのは型の差し替えだけ', () => {
    const session = new WorldSession(codex);
    const torch = session.createObject(codex.objectNames.getId('torch'));
    const fuelId = codex.propertyNames.getId('fuel');

    const read = torch.allProperties();
    expect(read, '読むたびに詰め替えない（1枚の札を描く間に何度も読む側が居る）').toBe(torch.allProperties());
    torch.getProperty(fuelId).setNumber(2);
    expect(read[0].number, 'PropertyValueは実体なので、値の変化はそのまま見える').toBe(2);

    torch.becomeAlong(new Map([['state', 'burnt_torch']]));

    expect(
      read.map((property) => property.def.name),
      '顔ぶれは並びごと替わるので、読んだ並びは差し替えの前のまま',
    ).toEqual(['fuel', 'heat']);
    expect(read[0], '居るのも前の型のPropertyValue').not.toBe(torch.getProperty(fuelId));
    expect(
      torch.allProperties().map((property) => property.def.name),
      '読み直せば今の顔ぶれが返る（traitが配るぶんが前に並ぶ）',
    ).toEqual(['ash', 'fuel', 'heat']);
  });
});

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
    // 書き間違いで、後者は引き方——別の世界が配ったIDや、名前を経由せずに作った数——の間違い。
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

    // 配られてはいるが、この物が宣言していないほうは、今までどおり名前で言う。
    expect(() => spawn('stone').getProperty(codex.propertyNames.getId('travel_minutes'))).toThrowError(
      "'stone' はプロパティ 'travel_minutes' を持ちません。",
    );
  });
});

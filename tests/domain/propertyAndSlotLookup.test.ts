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

  it('codexが知らないIDは、名前を出せないことごと伝える', () => {
    // 名前で引けなかった側（NameRegistryに登録の無い名前）がここへ来る。名前を出せないこと自体が
    // 手掛かりになるので、IDのまま見せる。
    //
    // このcodexが配っていないIDを渡す試験なので、**IDを作れる唯一の口（NameRegistry）を通れない**
    // ——素の数から型を跨ぐのはここだけで、その理由がこの試験そのもの。
    const unissued = -1 as PropertyGlobalId;
    expect(() => spawn('stone').getProperty(unissued)).toThrowError(
      "'stone' はプロパティ(id=-1)を持ちません。",
    );
  });
});

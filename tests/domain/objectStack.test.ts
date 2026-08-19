import { describe, expect, it } from 'vitest';
import { ObjectStack } from '../../src/domain/ObjectStack';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

// ObjectStack.tryInsert（7.6節）が「同種（Matches: ObjectDef・代表ObjectDef列が一致）だけが積み重なる」
// というスタックの不変条件を、呼び出し側の事前確認に依存せず自分自身で守ることを検証する。
describe('ObjectStack', () => {
  const yaml = `
object_defs:
  coin: {}
  gem: {}
`;

  function load() {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  it('同じObjectDefのオブジェクトはスタックへ合流する', () => {
    const codex = load();
    const session = new WorldSession(codex);
    const coin = codex.objects.get(codex.objectNames.getId('coin'));

    const stack = new ObjectStack(new WorldObject(1, coin, session));
    const another = new WorldObject(2, coin, session);

    expect(stack.tryInsert(another)).toBe(true);
    expect(stack.members).toHaveLength(2);
    expect(stack.members).toContain(another);
  });

  it('異なるObjectDefは挿入に失敗し、メンバーを変更しない', () => {
    const codex = load();
    const session = new WorldSession(codex);
    const coin = codex.objects.get(codex.objectNames.getId('coin'));
    const gem = codex.objects.get(codex.objectNames.getId('gem'));

    const stack = new ObjectStack(new WorldObject(1, coin, session));
    const intruder = new WorldObject(2, gem, session);

    expect(stack.tryInsert(intruder), '別ObjectDefは合流できない（スタック不可）').toBe(false);
    expect(stack.members, '挿入失敗時はメンバーを一切変更しない').toHaveLength(1);
    expect(stack.members).not.toContain(intruder);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldChange } from '../../src/domain/WorldChange';
import type { WorldSignal } from '../../src/domain/WorldSignal';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { fixedRng } from '../support/rng';

/**
 * 起きたことを告げる効果（signal、GameElementDefinition.md 9.8節）の自動テスト。
 *
 * 狙いは「世界の形が変わらない出来事」を観測できること——空振りは「何も起きなかった」ではなく
 * 「外したことが起きた」（docs/engine/HuntingSystem.md 6.3節）。定義はこのファイル専用の最小Codexで
 * 書き、実データの値の変更に引きずられないようにする。
 */
describe('signal(起きたことの告知)', () => {
  const YAML = `
object_defs:
  world:
    props:
      day: {value: 0}
      hour: {value: 0}
      minute: {value: 0}
      minutes_per_tick: {value: 15}
    slots:
      locations: {cell: {accept: {tag: location}}}
  ground:
    tags: [location]
    slots:
      items: {cell: {accept: {tag: item}}}
      beasts: {cell: {accept: {tag: beast}}}
  stick:
    tags: [item]
    props:
      volume: {value: 100}
  # 重ねた物で殴られる獣。当たれば物が消え、外れれば世界は何も変わらない。
  beast:
    tags: [beast]
    props:
      # 下限を割ったら自分から「弱った」と告げる（rangeイベントからも告げられることの検査）。
      stamina:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          signal: weakened
    combinations:
      # 重ねてきた物の側について告げる（対象を書く形の検査）。
      shrug_off:
        with: {tag: item}
        signal: {dragged: bounced}
      hit_me:
        with: {tag: item}
        pick:
          - weight: 70
            destroy: dragged
            signal: hit
          - weight: 30
            signal: missed
    actions:
      exhaust:
        add:
          self: {stamina: -1}
      # actorを渡さずに実行すると、この対象は解決できない。
      roar:
        signal: {actor: startled}
`;

  /** 当たる側（重み70）を引くrollと、外す側（重み30）を引くroll。 */
  const HITS = 0.5;
  const MISSES = 0.95;

  let codex: WorldCodex;
  let session: WorldSession;
  let ground: WorldObject;
  let beast: WorldObject;

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('signals.yaml', YAML).build();
    open(HITS);
  });

  function open(roll: number): void {
    session = new WorldSession(codex, undefined, fixedRng(roll));
    const worldInstance = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(worldInstance, codex));
    ground = spawn('ground');
    expect(ground.moveToSlot(worldInstance.getSlot(codex.slotNames.getId('locations')))).toBeUndefined();
    beast = placeOnGround('beast', 'beasts');
  }

  const spawn = (name: string): WorldObject => session.spawn(codex.objectNames.getId(name));

  function placeOnGround(name: string, slotName = 'items'): WorldObject {
    const object = spawn(name);
    expect(object.moveToSlot(ground.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return object;
  }

  /** bodyの実行中に告げられた出来事を「誰の身に・何が」の形で並べる。 */
  function observe(body: () => void): string[] {
    const seen: WorldSignal[] = [];
    session.observeSignals((signal) => seen.push(signal), body);
    return seen.map((signal) => `${signal.object.def.name}: ${signal.name}`);
  }

  it('世界の形が変わらない回でも、起きたことが観測できる', () => {
    // これがsignalを持つ理由そのもの。出入りの側（observeChanges）には何も現れない。
    open(MISSES);
    const stick = placeOnGround('stick');
    const changes: WorldChange[] = [];

    const seen = observe(() => {
      session.observeChanges(
        (change) => changes.push(change),
        () => {
          expect(
            beast
              .combinationsWith(stick, undefined)
              .find((c) => c.name === 'hit_me')
              ?.tryExecute() === true,
          ).toBe(true);
        },
      );
    });

    expect(seen).toEqual(['beast: missed']);
    expect(changes, '世界の形は何も変わっていない').toEqual([]);
    expect(stick.parent, '重ねた物もそのまま残る').toBe(ground);
  });

  it('対象を省くと、効果を宣言した側（self）に起きたこととして告げる', () => {
    const stick = placeOnGround('stick');

    const seen = observe(() => {
      expect(
        beast
          .combinationsWith(stick, undefined)
          .find((c) => c.name === 'hit_me')
          ?.tryExecute() === true,
      ).toBe(true);
    });

    expect(seen).toEqual(['beast: hit']);
  });

  it('対象を書けば、宣言した側とは別のオブジェクトに起きたこととして告げる', () => {
    // 殴った側が「相手が避けた」と告げる形。どの札の上の出来事かは、宣言した型ではなく効果が決める。
    const stick = placeOnGround('stick');

    const seen = observe(() => {
      expect(
        beast
          .combinationsWith(stick, undefined)
          .find((c) => c.name === 'shrug_off')
          ?.tryExecute() === true,
      ).toBe(true);
    });

    expect(seen).toEqual(['stick: bounced']);
  });

  it('解決できない対象へは何も告げない', () => {
    // 他の命令が対象を解決できないときと同じ扱い（actorを渡さずに実行している）。
    const seen = observe(() => {
      expect(beast.tryGetAction('roar', undefined)?.tryExecute() === true).toBe(true);
    });

    expect(seen).toEqual([]);
  });

  it('どの候補を引いたかで、違う出来事が告げられる', () => {
    const first = observe(() => {
      expect(
        beast
          .combinationsWith(placeOnGround('stick'), undefined)
          .find((c) => c.name === 'hit_me')
          ?.tryExecute() === true,
      ).toBe(true);
    });
    open(MISSES);
    const second = observe(() => {
      expect(
        beast
          .combinationsWith(placeOnGround('stick'), undefined)
          .find((c) => c.name === 'hit_me')
          ?.tryExecute() === true,
      ).toBe(true);
    });

    expect(first).toEqual(['beast: hit']);
    expect(second).toEqual(['beast: missed']);
  });

  it('rangeイベントからも告げられる（狩猟に限らない汎用の語彙）', () => {
    // rangeイベントの効果は対象がselfに限られるが、省略形（`signal: weakened`）がそのまま
    // selfを指すので、書ける形が減るだけで使えなくはならない。
    const seen = observe(() => {
      expect(beast.tryGetAction('exhaust', undefined)?.tryExecute() === true).toBe(true);
    });

    expect(seen).toEqual(['beast: weakened']);
  });

  it('観測していない間に告げられた分は残らない（溜め置きはしない）', () => {
    const stick = placeOnGround('stick');
    expect(
      beast
        .combinationsWith(stick, undefined)
        .find((c) => c.name === 'hit_me')
        ?.tryExecute() === true,
    ).toBe(true);

    const seen = observe(() => {
      // 何もしない。
    });

    expect(seen).toEqual([]);
  });

  it('観測は入れ子にでき、抜けると外側へ戻る', () => {
    // observeChanges・observeTicksと同じ規約。解除を呼び出し側に任せない。
    const outer: string[] = [];
    const inner: string[] = [];
    const strike = (): void => {
      expect(
        beast
          .combinationsWith(placeOnGround('stick'), undefined)
          .find((c) => c.name === 'hit_me')
          ?.tryExecute() === true,
      ).toBe(true);
    };

    session.observeSignals(
      (signal) => outer.push(signal.name),
      () => {
        strike();
        session.observeSignals((signal) => inner.push(signal.name), strike);
        strike();
      },
    );

    expect(inner, '内側が観測している間は内側だけへ流れる').toEqual(['hit']);
    expect(outer, '抜けた後は外側へ戻る').toEqual(['hit', 'hit']);
  });

  it('対象キーでない名前を書くとロードエラーになる', () => {
    // mappingの形で書けるのは対象キー（self/parent/actor/dragged）だけ。他の命令と同じ綴りの
    // 間違いを、その場で捕まえる。
    const load = (signal: string): (() => unknown) => {
      const yaml = `
object_defs:
  beast:
    actions:
      roar:
        signal: ${signal}
`;
      return () => new WorldCodexYamlLoader().load('bad.yaml', yaml).build();
    };

    expect(load('{name: missed}'), '対象キーではない').toThrow(YamlLoadError);
    expect(load('{dragged: missed}'), 'draggedはcombinationsの中だけ').toThrow(YamlLoadError);
    expect(load('{ancestor: missed}'), 'オブジェクトそのものを指せない').toThrow(YamlLoadError);
  });
});

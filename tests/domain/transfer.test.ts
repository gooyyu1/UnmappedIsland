import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

describe('transfer効果（WorldObject.applyActiveEffect）の実行', () => {
  let nextInstanceId: number;

  beforeEach(() => {
    nextInstanceId = 1;
  });

  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  function spawn(codex: WorldCodex, objectName: string): WorldObject {
    const def = codex.objects.get(codex.objectNames.getId(objectName));
    return new WorldObject(nextInstanceId++, def, new WorldSession(codex));
  }

  it('sourceとdestinationの双方に十分な余裕があればamount分だけ移動する', () => {
    const yaml = `
object_defs:
  player:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
  canteen:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
`;
    const codex = load(yaml);
    const waterId = codex.propertyNames.getId('water_amount');
    const hydrationId = codex.propertyNames.getId('hydration');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player');
    const canteen = spawn(codex, 'canteen');

    const executed = canteen.tryExecuteAction('drink', actor, session);

    expect(executed).toBe(true);
    expect(canteen.getNumber(waterId), 'amount(2000)だけ減る').toBe(3000);
    expect(actor.getNumber(hydrationId), 'amount(2000)だけ増える').toBe(2000);
  });

  it('sourceの在庫がamount未満なら在庫分だけにクランプされる', () => {
    const yaml = `
object_defs:
  player2:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
  canteen2:
    props:
      water_amount:
        value: 500
        range: {min: 0, max: 4800}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
`;
    const codex = load(yaml);
    const waterId = codex.propertyNames.getId('water_amount');
    const hydrationId = codex.propertyNames.getId('hydration');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player2');
    const canteen = spawn(codex, 'canteen2');

    canteen.tryExecuteAction('drink', actor, session);

    expect(canteen.getNumber(waterId), '容器に実際に入っていた分(500)しか出せない').toBe(0);
    expect(actor.getNumber(hydrationId), '実際に出せた分(500)しか回復しない').toBe(500);
  });

  it('transferの配列で1回のアクションから複数の移送が適用される', () => {
    const yaml = `
object_defs:
  player_multi:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
      vitamin:
        value: 0
        range: {min: 0, max: 28800}
  canteen_multi:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
      juice_amount:
        value: 3000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          - amount: 2000
            from_prop: water_amount
            to_object: actor
            to_prop: hydration
          - amount: 1000
            from_prop: juice_amount
            to_object: actor
            to_prop: vitamin
`;
    const codex = load(yaml);
    const waterId = codex.propertyNames.getId('water_amount');
    const juiceId = codex.propertyNames.getId('juice_amount');
    const hydrationId = codex.propertyNames.getId('hydration');
    const vitaminId = codex.propertyNames.getId('vitamin');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player_multi');
    const canteen = spawn(codex, 'canteen_multi');

    const executed = canteen.tryExecuteAction('drink', actor, session);

    expect(executed).toBe(true);
    expect(canteen.getNumber(waterId)).toBe(3000);
    expect(canteen.getNumber(juiceId)).toBe(2000);
    expect(actor.getNumber(hydrationId)).toBe(2000);
    expect(actor.getNumber(vitaminId)).toBe(1000);
  });

  it('allow_overflowがfalseなら移送先の残容量にクランプされ、残りはsourceに残る', () => {
    const yaml = `
object_defs:
  player3:
    props:
      hydration:
        value: 28700
        range: {min: 0, max: 28800}
  canteen3:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
`;
    const codex = load(yaml);
    const waterId = codex.propertyNames.getId('water_amount');
    const hydrationId = codex.propertyNames.getId('hydration');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player3');
    const canteen = spawn(codex, 'canteen3');

    canteen.tryExecuteAction('drink', actor, session);

    expect(actor.getNumber(hydrationId), '残容量(100)分しか回復しない').toBe(28800);
    expect(canteen.getNumber(waterId), '収まらない分(1900)は容器に残る(水を無駄にしない)').toBe(4900);
  });

  it('allow_overflowがtrueなら移送先の容量を無視して全量出し、超過分は失われる', () => {
    const yaml = `
object_defs:
  player4:
    props:
      hydration:
        value: 28700
        range: {min: 0, max: 28800}
  canteen4:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
          allow_overflow: true
`;
    const codex = load(yaml);
    const waterId = codex.propertyNames.getId('water_amount');
    const hydrationId = codex.propertyNames.getId('hydration');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player4');
    const canteen = spawn(codex, 'canteen4');

    canteen.tryExecuteAction('drink', actor, session);

    expect(canteen.getNumber(waterId), 'toの残容量を見ずにamount(2000)そのまま出す').toBe(3000);
    expect(
      actor.getNumber(hydrationId),
      'range超過分はtoのon_overflow既定動作(range.maxへクランプ)で失われる(あふれた分は無駄になる)',
    ).toBe(28800);
  });

  it('from_object/to_objectを省略するとselfをデフォルトにする', () => {
    const yaml = `
object_defs:
  cauldron:
    props:
      water_amount:
        value: 3000
        range: {min: 0, max: 4800}
      broth_amount:
        value: 0
        range: {min: 0, max: 4800}
    actions:
      pour_in:
        transfer:
          amount: 1000
          from_prop: water_amount
          to_prop: broth_amount
`;
    const codex = load(yaml);
    const waterId = codex.propertyNames.getId('water_amount');
    const brothId = codex.propertyNames.getId('broth_amount');

    const session = new WorldSession(codex);
    const cauldron = spawn(codex, 'cauldron');

    const executed = cauldron.tryExecuteAction('pour_in', undefined, session);

    expect(executed, 'from_object/to_objectを省略してもself同士で成立する').toBe(true);
    expect(cauldron.getNumber(waterId)).toBe(2000);
    expect(cauldron.getNumber(brothId)).toBe(1000);
  });

  it('linked_addは全量移送されたときにamountの全量分スケールされる', () => {
    const yaml = `
object_defs:
  player5:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
      wakefulness:
        value: 0
        range: {min: 0, max: 28800}
  canteen5:
    props:
      tea_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 1200
          from_prop: tea_amount
          to_object: actor
          to_prop: hydration
          linked_add:
            actor:
              wakefulness: 200
`;
    const codex = load(yaml);
    const teaId = codex.propertyNames.getId('tea_amount');
    const hydrationId = codex.propertyNames.getId('hydration');
    const wakefulnessId = codex.propertyNames.getId('wakefulness');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player5');
    const canteen = spawn(codex, 'canteen5');

    canteen.tryExecuteAction('drink', actor, session);

    expect(actor.getNumber(hydrationId), 'amount(1200)分を全量移送する').toBe(1200);
    expect(actor.getNumber(wakefulnessId), '全量移送時はlinked_addも全量(200)適用される').toBe(200);
    expect(canteen.getNumber(teaId)).toBe(3800);
  });

  it('linked_addは一部しか移送されなかったときは比例してスケールされる', () => {
    const yaml = `
object_defs:
  player6:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
      wakefulness:
        value: 0
        range: {min: 0, max: 28800}
  canteen6:
    props:
      tea_amount:
        value: 600
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 1200
          from_prop: tea_amount
          to_object: actor
          to_prop: hydration
          linked_add:
            actor:
              wakefulness: 200
`;
    const codex = load(yaml);
    const teaId = codex.propertyNames.getId('tea_amount');
    const hydrationId = codex.propertyNames.getId('hydration');
    const wakefulnessId = codex.propertyNames.getId('wakefulness');

    const session = new WorldSession(codex);
    const actor = spawn(codex, 'player6');
    const canteen = spawn(codex, 'canteen6');

    canteen.tryExecuteAction('drink', actor, session);

    expect(actor.getNumber(hydrationId), '在庫(600)の分しか移送されない').toBe(600);
    expect(
      actor.getNumber(wakefulnessId),
      '実際に移送された量(600)に比例してlinked_addもスケールされる(200 * 600 / 1200 = 100)',
    ).toBe(100);
    expect(canteen.getNumber(teaId)).toBe(0);
  });
});

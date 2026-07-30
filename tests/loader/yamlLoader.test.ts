import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';

/**
 * YAMLローダー（複数ファイル・複数ディレクトリからのWorldCodex構築、GameElementDefinition.md 3・5節）
 * に対する自動テスト。
 */
describe('WorldCodexYamlLoader', () => {
  // ------------------------------------------------------------------
  // 基本: 1ファイル内のobject_defs
  // ------------------------------------------------------------------

  it('プロパティ値が識別子として不正なシンボルはエラーになる', () => {
    const yaml = `
object_defs:
  sky2:
    props:
      weather:
        value: "not a valid symbol!"
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrow(YamlLoadError);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/シンボル名/);
  });

  // ------------------------------------------------------------------
  // 複数ファイル・複数回のload呼び出し: 分割してもまとめて読める
  // ------------------------------------------------------------------

  it('複数回のload呼び出しにまたがってobject_defsをマージできる', () => {
    const core = `
object_defs:
  ground:
    slots:
      pile: {}
`;
    const foods = `
object_defs:
  apple:
    props:
      freshness:
        value: 5
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', core).load('foods.yaml', foods).build();

    expect(codex.objectNames.tryGetId('ground')).toBeDefined();
    expect(codex.objectNames.tryGetId('apple')).toBeDefined();
  });

  it('同一object_def名の重複はエラーになる', () => {
    const a = `
object_defs:
  rock: {}
`;
    const b = `
object_defs:
  rock: {}
`;
    expect(() => new WorldCodexYamlLoader().load('a.yaml', a).load('b.yaml', b).build()).toThrowError(/rock/);
  });

  // ------------------------------------------------------------------
  // 重複は出所を問わず常にエラー（「後勝ちで上書き」という規則は持たない）
  // ------------------------------------------------------------------

  it('別々のload呼び出しにまたがるobject_def名の重複もエラーになる（追加のつもりで誤って上書きする事故を防ぐ）', () => {
    // MODによる意図的な差し替えは、専用のpatch文法で別途表現する想定。
    const baseYaml = `
object_defs:
  torch:
    props:
      fuel:
        value: 10
`;
    const modYaml = `
object_defs:
  torch:
    props:
      fuel:
        value: 999
`;
    expect(() =>
      new WorldCodexYamlLoader().load('base.yaml', baseYaml).load('mod.yaml', modYaml).build(),
    ).toThrowError(/torch/);
  });

  // ------------------------------------------------------------------
  // traits（mixin）
  // ------------------------------------------------------------------

  it('2つのtraitが同名のpropsを持つとエラーになる', () => {
    const yaml = `
traits:
  trait_a:
    props:
      shared:
        value: 1
  trait_b:
    props:
      shared:
        value: 2
object_defs:
  thing:
    traits: [trait_a, trait_b]
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/shared/);
  });

  it('存在しないtraitへの参照はエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    traits: [does_not_exist]
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/does_not_exist/);
  });

  // ------------------------------------------------------------------
  // passive / stage / rangeイベント
  // ------------------------------------------------------------------

  it('シンボル型プロパティのstageにminを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    props:
      weather:
        value: clear
        stages:
          - name: bad
            min: 1
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/min/);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/シンボル型/);
  });

  it('stagesのalertは、その段にいる間に値がどの域にあるかとして読み込まれる', () => {
    const yaml = `
object_defs:
  character:
    props:
      hydration:
        value: 100
        range: {min: 0, max: 100}
        stages:
          - name: dehydrated
            alert: fatal
          - name: thirsty
            min: 20
            alert: caution
          - name: hydrated
            min: 60
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const prop = codex.objects
      .get(codex.objectNames.getId('character'))
      .getPropertyDef(codex.propertyNames.getId('hydration'))!;

    expect(prop.alertLevelOf(100), 'alert未指定の段は安全域').toBe('safe');
    expect(prop.alertLevelOf(20)).toBe('caution');
    expect(prop.alertLevelOf(0)).toBe('fatal');
  });

  it('stagesの未知のalertはエラーになる', () => {
    const yaml = `
object_defs:
  character:
    props:
      hydration:
        value: 100
        stages:
          - name: dry
            alert: deadly
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrow(YamlLoadError);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/deadly/);
  });

  it('passivesはマッピング形式を許容せず、常に配列である必要がある', () => {
    const yaml = `
object_defs:
  torch:
    props:
      fuel:
        value: 10
        passives:
          accumulate:
            self:
              fuel: -1
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/配列/);
  });

  it('条件の異なる複数のpassivesブロックはそれぞれ別のゲート付き効果になる', () => {
    // passivesを配列にした動機そのもの: 同じ対象(parent)に対して、装備するスロットごとに
    // 異なるmodify量を与えたい場合、conditions違いの複数ブロックが必要になる。
    const yaml = `
object_defs:
  character:
    props:
      attack:
        value: 10
    slots:
      main_hand: {}
      off_hand: {}
  sword:
    passives:
      - conditions:
          - {in_slot: main_hand}
        modify:
          parent:
            attack: 5
      - conditions:
          - {in_slot: off_hand}
        modify:
          parent:
            attack: 2
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const attackId = codex.propertyNames.getId('attack');
    const mainHandId = codex.slotNames.getId('main_hand');
    const offHandId = codex.slotNames.getId('off_hand');

    const session = new WorldSession(codex);
    const characterInstance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('character')),
      session,
    );
    const swordInstance = new WorldObject(2, codex.objects.get(codex.objectNames.getId('sword')), session);

    expect(swordInstance.moveToSlot(characterInstance, mainHandId, session.codex.wellKnown)).toBeUndefined();
    expect(characterInstance.getEffectiveValue(attackId)).toBe(15); // main_handでは+5

    expect(swordInstance.moveToSlot(characterInstance, offHandId, session.codex.wellKnown)).toBeUndefined();
    expect(characterInstance.getEffectiveValue(attackId)).toBe(12); // off_handへ持ち替えると+2に切り替わる
  });

  it('on_shortfallはrangeが無いとエラーになる', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        on_shortfall:
          destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/range/);
  });

  it('on_shortfallの対象にself以外を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_shortfall:
          destroy: parent
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/on_shortfall/);
  });

  it('propの未知のキーはエラーになる（廃止されたon_min/on_maxを含む）', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_min:
          destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/未知のキー/);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/on_min/);
  });

  // ------------------------------------------------------------------
  // 構文エラー
  // ------------------------------------------------------------------

  it('1つのYAMLマッピング内でのキー重複はエラーになる', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 1
      life:
        value: 2
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrow(YamlLoadError);
  });

  // ------------------------------------------------------------------
  // actions / combinations
  // ------------------------------------------------------------------

  it('conditionsとactiveを持つactionをパースできる', () => {
    const yaml = `
object_defs:
  apple:
    props:
      freshness:
        value: 5
    actions:
      eat:
        showMenu: always
        conditions:
          - {object: actor, prop: satiety, op: lt, value: 100}
        add:
          actor:
            satiety: 10
        destroy: self
  player:
    props:
      satiety:
        value: 100
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();

    const apple = codex.objects.get(codex.objectNames.getId('apple'));
    const satietyId = codex.propertyNames.getId('satiety');
    const session = new WorldSession(codex);
    const appleInstance = new WorldObject(1, apple, session);
    const player = new WorldObject(2, codex.objects.get(codex.objectNames.getId('player')), session);

    expect(appleInstance.tryExecuteAction('eat', player, session)).toBe(false); // actor.satiety=100 は lt 100 を満たさない
    player.setNumber(satietyId, 99);
    expect(appleInstance.tryExecuteAction('eat', player, session)).toBe(true); // actor.satiety=99 は lt 100 を満たす
  });

  it('andでdragged対象を持つcombinationをパースできる', () => {
    const yaml = `
object_defs:
  wood:
    combinations:
      chop:
        with: axe_tool
        conditions:
          - {object: dragged, prop: durability, op: gt, value: 0}
        spawn: {object: logs}
        destroy: self
        add:
          dragged:
            durability: -1
  logs: {}
  axe_tool:
    tags: [axe_tool]
    props:
      durability:
        value: 10
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const durabilityId = codex.propertyNames.getId('durability');

    const wood = codex.objects.get(codex.objectNames.getId('wood'));
    const session = new WorldSession(codex);
    const woodInstance = new WorldObject(1, wood, session);
    const axe = new WorldObject(2, codex.objects.get(codex.objectNames.getId('axe_tool')), session);

    axe.setNumber(durabilityId, 0);
    expect(woodInstance.tryExecuteCombination(axe, undefined, 'chop', session)).toBe(false); // dragged.durability=0 のとき条件 gt 0 を満たさない
    axe.setNumber(durabilityId, 10);
    expect(woodInstance.tryExecuteCombination(axe, undefined, 'chop', session)).toBe(true); // dragged.durability=10 のとき条件 gt 0 を満たす
    expect(axe.getNumber(durabilityId)).toBe(9); // add: dragged.durability: -1 が適用される
    expect(woodInstance.parent).toBeUndefined(); // destroy: self が適用される
  });

  it('2つのtraitが同名のactionを持つとエラーになる', () => {
    const yaml = `
traits:
  trait_a:
    actions:
      use:
        destroy: self
  trait_b:
    actions:
      use:
        destroy: self
object_defs:
  thing:
    traits: [trait_a, trait_b]
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/use/);
  });

  it('actionsでdragged対象を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        destroy: dragged
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/dragged/);
  });

  it('activeでchild対象を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        destroy: child
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/child/);
  });

  it('showMenuに未対応の値を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        showMenu: sometimes
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/showMenu/);
  });

  it('objectにworldを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {object: world, prop: day, op: gt, value: 0}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/world/);
  });

  it('conditionのvalueにmaxを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {object: actor, prop: satiety, op: lt, value: max}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/max/);
  });

  it('conditionの葉はobject/opを省略するとself/eqとして扱われる', () => {
    const yaml = `
object_defs:
  thing:
    props:
      mode:
        value: 1
    actions:
      use:
        conditions:
          - {prop: mode, value: 1}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();

    const thing = codex.objects.get(codex.objectNames.getId('thing'));
    const modeId = codex.propertyNames.getId('mode');
    const session = new WorldSession(codex);
    const thingInstance = new WorldObject(1, thing, session);

    expect(thingInstance.tryExecuteAction('use', undefined, session)).toBe(true); // object/op省略時は self.mode == 1 の等価比較として成立する
    thingInstance.setNumber(modeId, 2);
    expect(thingInstance.tryExecuteAction('use', undefined, session)).toBe(false); // self.mode != 1 では不成立
  });

  it('conditionでin_slotとpropを同時に指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {in_slot: equip, prop: hp, value: 1}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/slot/);
  });

  it('conditionのin_slotにopを同時に指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {in_slot: equip, op: eq}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/未知のキー/);
  });

  it('スロット中身判定はタグ付きの子がスロットに居るときだけ真になる', () => {
    const yaml = `
object_defs:
  box:
    slots:
      content:
        accepts:
          - {tag: marker, max: 1}
    actions:
      use:
        conditions:
          - {slot: content, tag: red}
        destroy: self
  red_marker:
    tags: [marker, red]
  blue_marker:
    tags: [marker, blue]
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const contentSlotId = codex.slotNames.getId('content');

    const session = new WorldSession(codex);
    const box = new WorldObject(1, codex.objects.get(codex.objectNames.getId('box')), session);
    const redMarker = new WorldObject(2, codex.objects.get(codex.objectNames.getId('red_marker')), session);
    redMarker.moveToSlot(box, contentSlotId, session.codex.wellKnown);

    expect(box.tryExecuteAction('use', undefined, session)).toBe(true); // contentスロットにredタグのマーカーがあるので実行される
  });

  it('スロット中身判定はタグが異なる、または空のときは偽になる', () => {
    const yaml = `
object_defs:
  box2:
    slots:
      content:
        accepts:
          - {tag: marker, max: 1}
    actions:
      use:
        conditions:
          - {slot: content, tag: red}
        destroy: self
  blue_marker2:
    tags: [marker, blue]
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const contentSlotId = codex.slotNames.getId('content');

    const session = new WorldSession(codex);
    const box = new WorldObject(1, codex.objects.get(codex.objectNames.getId('box2')), session);
    expect(box.tryExecuteAction('use', undefined, session)).toBe(false); // contentスロットが空なので実行されない

    const blueMarker = new WorldObject(
      2,
      codex.objects.get(codex.objectNames.getId('blue_marker2')),
      session,
    );
    blueMarker.moveToSlot(box, contentSlotId, session.codex.wellKnown);
    expect(box.tryExecuteAction('use', undefined, session)).toBe(false); // contentスロットの中身がredタグを持たない(blueタグ)ので実行されない
  });

  it('conditionのslotにtagを指定しないとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {slot: content}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/tag/);
  });

  it('slotを伴わないtagはobjectのタグ判定としてパースされる', () => {
    const yaml = `
object_defs:
  thing:
    tags: [red]
    actions:
      use:
        conditions:
          - {tag: red}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const session = new WorldSession(codex);
    const thing = new WorldObject(1, codex.objects.get(codex.objectNames.getId('thing')), session);

    expect(thing.tryExecuteAction('use', undefined, session)).toBe(true);
  });

  it('conditionのvalueをプロパティ参照にすると、2つの動的プロパティを比較できる', () => {
    const yaml = `
object_defs:
  bottle:
    props:
      content:
        value: empty
    combinations:
      pour_in:
        with: liquid_container
        conditions:
          - {prop: content, op: eq, value: {object: dragged, prop: content}}
        destroy: self
  bottle_source:
    tags: [liquid_container]
    props:
      content:
        value: water
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();

    const session = new WorldSession(codex);
    const bottle = new WorldObject(1, codex.objects.get(codex.objectNames.getId('bottle')), session);
    const sameContent = new WorldObject(
      2,
      codex.objects.get(codex.objectNames.getId('bottle_source')),
      session,
    );

    expect(bottle.tryExecuteCombination(sameContent, undefined, 'pour_in', session)).toBe(false); // self(empty)とdragged(water)のcontentが異なるので不成立

    const contentId = codex.propertyNames.getId('content');
    bottle.setProperty(contentId, codex.symbolNames.getId('water'));
    expect(bottle.tryExecuteCombination(sameContent, undefined, 'pour_in', session)).toBe(true); // selfとdraggedのcontentが同じ(water)なので成立
  });

  it('プロパティ参照のvalueにinを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {prop: content, op: in, value: {object: dragged, prop: content}}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/in/);
  });

  it('setのvalueにプロパティ参照を書くとエラーになる（リテラルのみ、9.2節）', () => {
    const yaml = `
object_defs:
  bottle2:
    props:
      content:
        value: empty
    combinations:
      pour_in:
        with: liquid_container2
        set:
          self:
            content: {object: dragged, prop: content}
  oil_source:
    tags: [liquid_container2]
    props:
      content:
        value: oil
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/スカラー値/);
  });

  it('anyコンビネータはいずれかの葉が真であれば一致する', () => {
    const yaml = `
object_defs:
  player: {}
  thing:
    props:
      hp:
        value: 5
      mp:
        value: 5
    actions:
      use:
        conditions:
          - any:
              - {prop: hp, op: gte, value: 100}
              - {prop: mp, op: gte, value: 5}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();

    const thing = codex.objects.get(codex.objectNames.getId('thing'));
    const session = new WorldSession(codex);
    const falseCase = new WorldObject(1, thing, session);
    const trueCase = new WorldObject(2, thing, session);
    const hpId = codex.propertyNames.getId('hp');
    const mpId = codex.propertyNames.getId('mp');

    falseCase.setNumber(hpId, 99);
    falseCase.setNumber(mpId, 4);
    expect(falseCase.tryExecuteAction('use', undefined, session)).toBe(false); // hp(99)もmp(4)も条件を満たさないため不成立

    expect(trueCase.tryExecuteAction('use', undefined, session)).toBe(true); // hp(5)はgte 100を満たさないが、mp(5)がgte 5を満たすのでanyとして成立する
  });

  it('notコンビネータは内側の葉を反転する', () => {
    const yaml = `
object_defs:
  thing:
    props:
      locked:
        value: 1
    actions:
      use:
        conditions:
          - not: {prop: locked, value: 1}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();

    const session = new WorldSession(codex);
    const thingInstance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('thing')), session);

    expect(thingInstance.tryExecuteAction('use', undefined, session)).toBe(false); // locked(1)がprop:1と一致するため、not: {...}は偽になる
  });

  it('stageによる強制ゲートとconditionsは併用でき、両方を満たす間だけ有効になる', () => {
    // ステージ強制ゲート(WhenOwnStage)とconditionsは併用でき、両方を満たす間だけ有効になる
    // （WhenOwnStageAndConditions、GameElementDefinition.md 8.2節）。
    const yaml = `
object_defs:
  campfire:
    props:
      heat:
        value: 0
        stages:
          - name: unlit
          - name: lit
            min: 1
            passives:
              - conditions:
                  - {in_slot: fuel_slot}
                modify:
                  child:
                    warmth: 5
    slots:
      fuel_slot: {}
      storage: {}
  log:
    props:
      warmth:
        value: 0
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const heatId = codex.propertyNames.getId('heat');
    const warmthId = codex.propertyNames.getId('warmth');
    const fuelSlotId = codex.slotNames.getId('fuel_slot');
    const storageSlotId = codex.slotNames.getId('storage');

    const session = new WorldSession(codex);
    const campfireInstance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('campfire')),
      session,
    );
    const logInstance = new WorldObject(2, codex.objects.get(codex.objectNames.getId('log')), session);

    expect(logInstance.moveToSlot(campfireInstance, fuelSlotId, session.codex.wellKnown)).toBeUndefined();
    expect(logInstance.getEffectiveValue(warmthId)).toBe(0); // fuel_slotには入っているが、heatがunlitステージのためボーナスなし

    campfireInstance.setProperty(heatId, 1);
    expect(logInstance.getEffectiveValue(warmthId)).toBe(5); // litステージかつfuel_slot条件の両方を満たすのでボーナスが乗る

    expect(logInstance.moveToSlot(campfireInstance, storageSlotId, session.codex.wellKnown)).toBeUndefined();
    expect(logInstance.getEffectiveValue(warmthId)).toBe(0); // litステージのままでもfuel_slotから外れるとボーナスが消える
  });

  it('activeとpickを同時に指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        destroy: self
        pick:
          - weight: 1
            destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/pick/);
  });

  // ------------------------------------------------------------------
  // tags（4節）: accepts.tag / combinations.with のマッチング
  // ------------------------------------------------------------------

  it('スロットのacceptsでtagとobjectを同時に指定するとエラーになる', () => {
    const yaml = `
object_defs:
  cauldron2:
    slots:
      ingredients:
        accepts:
          - {tag: spice, object: raw_meat, max: 1}
  raw_meat: {}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(
      /同時に指定できません/,
    );
  });

  it('スロットのacceptsでtagもobjectも指定しないとエラーになる', () => {
    const yaml = `
object_defs:
  cauldron3:
    slots:
      ingredients:
        accepts:
          - {max: 1}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(
      /いずれかが必要です/,
    );
  });

  // ------------------------------------------------------------------
  // on_overflow
  // ------------------------------------------------------------------

  it('on_overflowはrangeが無いとエラーになる', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        on_overflow:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/range/);
  });

  it('on_overflowをパースし、実行時に適用する', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 45
        range: {min: 0, max: 59}
        on_overflow:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
`;
    const codex = new WorldCodexYamlLoader().load('clock.yaml', yaml).build();

    const clock = codex.objects.get(codex.objectNames.getId('clock'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, clock, session);
    instance.setProperty(codex.propertyNames.getId('minute'), 60); // 手動で溢れさせる
    instance.tick(session); // accumulate契機は無いが、既に溢れているのでon_overflowだけが発火する

    expect(instance.getNumber(codex.propertyNames.getId('minute'))).toBe(0);
    expect(instance.getNumber(codex.propertyNames.getId('hour'))).toBe(1);
  });

  it('on_overflowの対象にself以外を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        range: {min: 0, max: 59}
        on_overflow:
          add: {parent: {minute: -60}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/on_overflow/);
  });

  it('on_overflowを省略するとselfをmaxへクランプする既定効果になる', () => {
    // rangeだけ定義してon_overflowを省略すると、「自分自身をRange.Maxへsetする」既定の
    // ActiveEffectが自動生成され、上限クランプとして機能する。
    const yaml = `
object_defs:
  gauge:
    props:
      value:
        value: 90
        range: {min: 0, max: 100}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();

    const gauge = codex.objects.get(codex.objectNames.getId('gauge'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, gauge, session);
    instance.setProperty(codex.propertyNames.getId('value'), 150);
    instance.tick(session);

    expect(instance.getNumber(codex.propertyNames.getId('value'))).toBe(100); // 既定のon_overflowにより100へクランプされる
  });

  // ------------------------------------------------------------------
  // on_shortfall（on_overflowの下限側の鏡像）
  // ------------------------------------------------------------------

  it('on_shortfallはrangeが無いとエラーになる', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        on_shortfall:
          set: {self: {minute: 0}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/range/);
  });

  it('on_shortfallの対象にself以外を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        range: {min: 0, max: 59}
        on_shortfall:
          add: {parent: {minute: 60}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/on_shortfall/);
  });

  it('on_shortfallをパースし、実行時に適用する', () => {
    // on_overflowの下限側の鏡像。addで折り返し量・繰り下げ量を一度に加減算する（on_overflowと
    // 同じく、setより堅牢）。
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 5
        range: {min: 0, max: 59}
        on_shortfall:
          add: {self: {minute: 60, hour: -1}}
      hour:
        value: 1
`;
    const codex = new WorldCodexYamlLoader().load('clock.yaml', yaml).build();

    const clock = codex.objects.get(codex.objectNames.getId('clock'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, clock, session);
    instance.setProperty(codex.propertyNames.getId('minute'), -10); // 手動で下回らせる
    instance.tick(session);

    expect(instance.getNumber(codex.propertyNames.getId('minute'))).toBe(50);
    expect(instance.getNumber(codex.propertyNames.getId('hour'))).toBe(0);
  });

  it('on_shortfallを省略するとselfをminへクランプする既定効果になる', () => {
    const yaml = `
object_defs:
  gauge:
    props:
      value:
        value: 10
        range: {min: 0, max: 100}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();

    const gauge = codex.objects.get(codex.objectNames.getId('gauge'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, gauge, session);
    instance.setProperty(codex.propertyNames.getId('value'), -50);
    instance.tick(session);

    expect(instance.getNumber(codex.propertyNames.getId('value'))).toBe(0); // 既定のon_shortfallにより0へクランプされる
  });

  it('object: ancestorは、そのプロパティを持たない祖先を素通りして最も近い定義元を見つける', () => {
    const yaml = `
object_defs:
  room:
    props:
      weather:
        value: 1
    slots:
      contents: {}
  character:
    slots:
      pocket: {}
  food:
    actions:
      check:
        conditions:
          - {object: ancestor, prop: weather, op: eq, value: 1}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const contentsSlotId = codex.slotNames.getId('contents');
    const pocketSlotId = codex.slotNames.getId('pocket');

    const session = new WorldSession(codex);
    const roomInstance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('room')), session);
    const characterInstance = new WorldObject(
      2,
      codex.objects.get(codex.objectNames.getId('character')),
      session,
    );
    const foodInstance = new WorldObject(3, codex.objects.get(codex.objectNames.getId('food')), session);

    expect(characterInstance.moveToSlot(roomInstance, contentsSlotId, codex.wellKnown)).toBeUndefined();
    expect(foodInstance.moveToSlot(characterInstance, pocketSlotId, codex.wellKnown)).toBeUndefined();

    expect(foodInstance.tryExecuteAction('check', undefined, session)).toBe(true); // characterはweatherを持たないため素通りし、roomのweather(1)と比較して真になる
  });

  it('destroyの対象にancestorを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        destroy: ancestor
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/ancestor/);
  });

  it('in_slot判定でobjectにancestorを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {object: ancestor, in_slot: somewhere}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/ancestor/);
  });
});

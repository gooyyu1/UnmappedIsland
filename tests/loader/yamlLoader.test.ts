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

  it('プロパティの値・範囲・段・量は小数で書ける', () => {
    // 連続量は小数を持てる（GameElementDefinition.md 6節）。刻みを桁で稼ぐ必要が無くなるので、
    // 「1tick分 = 1」のまま細かい傾きを直接書ける。
    const yaml = `
object_defs:
  pond:
    props:
      moisture:
        value: 0.5
        range: {min: -1.5, max: 2.25}
        stages:
          - {name: shallow}
          - {name: deep, min: 1.75}
        passives:
          - add:
              self:
                moisture: -0.35
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const def = codex.objects.get(codex.objectNames.getId('pond'));
    const moistureId = codex.propertyNames.getId('moisture');
    const prop = def.getPropertyDef(moistureId)!;

    expect(prop.range).toEqual({ min: -1.5, max: 2.25 });
    expect(prop.isInStage(1.75, 'deep'), '段の閾値も小数で刻める').toBe(true);
    expect(prop.isInStage(1.74, 'deep')).toBe(false);

    const session = new WorldSession(codex);
    const pond = session.spawn(codex.objectNames.getId('pond'));
    expect(pond.getNumber(moistureId), '初期値も小数').toBe(0.5);

    pond.tick(session);

    expect(pond.getNumber(moistureId), '毎tickの加減算も小数で効く').toBeCloseTo(0.15, 10);
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

  it('alertの深刻さは、rangeを持つプロパティでは下から上へ単調でなければならない', () => {
    // 上下どちらの端も悪い量（体温）は、バーの塗りをどちら向きに読ませるか決められない。
    const yaml = `
object_defs:
  character:
    props:
      body_temperature:
        value: 37
        range: {min: 30, max: 44}
        stages:
          - {name: hypothermia, alert: danger}
          - {name: normal, min: 36}
          - {name: hyperthermia, min: 38, alert: danger}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/単調/);
  });

  it('rangeを持たなければ、両端が深刻な段を宣言できる（バーにならないため）', () => {
    const yaml = `
object_defs:
  character:
    props:
      body_temperature:
        value: 37
        stages:
          - {name: hypothermia, alert: danger}
          - {name: normal, min: 36}
          - {name: hyperthermia, min: 38, alert: danger}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const prop = codex.objects
      .get(codex.objectNames.getId('character'))
      .getPropertyDef(codex.propertyNames.getId('body_temperature'))!;

    expect(prop.alertDirection).toBe('mixed');
  });

  it('段のalertが上がっていくプロパティは、増えるほど悪いものとして扱われる', () => {
    const yaml = `
object_defs:
  character:
    props:
      load:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: light}
          - {name: heavy, min: 50, alert: caution}
          - {name: too_heavy, min: 80, alert: danger}
      satiety:
        value: 100
        range: {min: 0, max: 100}
        stages:
          - {name: starving, alert: danger}
          - {name: fed, min: 80}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const objectDef = codex.objects.get(codex.objectNames.getId('character'));
    const directionOf = (name: string) =>
      objectDef.getPropertyDef(codex.propertyNames.getId(name))!.alertDirection;

    expect(directionOf('load')).toBe('up');
    expect(directionOf('satiety')).toBe('down');
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

  it('廃止したスロットのキーは、書き換え先を示して落とす', () => {
    // 黙って無視すると、制約が効いているつもりの宣言が通ってしまう（SlotSystem.md 2節）。
    const retired: readonly (readonly [string, RegExp])[] = [
      ['accepts:\n          - {tag: item, max: 1}', /accept/],
      ['unit_capacity: 3', /cell_count/],
      ['fixed_positions: true', /cell_count/],
      ['stackable: false', /object_def/],
    ];
    for (const [line, expected] of retired) {
      const yaml = `
object_defs:
  box:
    slots:
      contents:
        ${line}
`;
      const load = (): unknown => new WorldCodexYamlLoader().load('core.yaml', yaml).build();
      expect(load, line).toThrow(YamlLoadError);
      expect(load, line).toThrowError(expected);
    }
  });

  it('cellsとcellは同時に書けない（枠の数がどちらで決まるか分からなくなる）', () => {
    const yaml = `
object_defs:
  box:
    slots:
      contents:
        cell: {accept: {tag: item}}
        cells:
          - {accept: {tag: item}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/同時に/);
  });

  it('cellsを並べた数がそのまま枠の数なので、cell_countは併記できない', () => {
    const yaml = `
object_defs:
  box:
    slots:
      contents:
        cell_count: 2
        cells:
          - {accept: {tag: item}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/cell_count/);
  });

  it('passivesはマッピング形式を許容せず、常に配列である必要がある', () => {
    const yaml = `
object_defs:
  torch:
    props:
      fuel:
        value: 10
        passives:
          add:
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

    expect(swordInstance.moveToSlot(characterInstance, mainHandId)).toBeUndefined();
    expect(characterInstance.getEffectiveValue(attackId)).toBe(15); // main_handでは+5

    expect(swordInstance.moveToSlot(characterInstance, offHandId)).toBeUndefined();
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
          - {object: actor, prop: satiety, lt: 100}
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
          - {object: dragged, prop: durability, gt: 0}
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
          - {object: world, prop: day, gt: 0}
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
          - {object: actor, prop: satiety, lt: max}
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
          - {prop: mode, eq: 1}
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
          - {in_slot: equip, prop: hp, eq: 1}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/slot/);
  });

  it('その主語では使えない演算子キーを書くとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    actions:
      use:
        conditions:
          - {in_slot: equip, lt: 5}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/未知のキー/);
  });

  it('演算子キーを1つも書かないとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    props:
      durability: {value: 10}
    actions:
      use:
        conditions:
          - {prop: durability}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).build()).toThrowError(/演算子キー/);
  });

  it('1つの葉に演算子キーを並べると、そのすべてを満たすときだけ真になる（暗黙のAND）', () => {
    const yaml = `
object_defs:
  thing:
    props:
      temperature: {value: 25}
    actions:
      use:
        conditions:
          - {prop: temperature, gte: 20, lt: 30}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const session = new WorldSession(codex);
    const thingDef = codex.objects.get(codex.objectNames.getId('thing'));
    const temperature = codex.propertyNames.getId('temperature');

    const inRange = new WorldObject(1, thingDef, session);
    expect(inRange.tryExecuteAction('use', undefined, session), '20以上30未満').toBe(true);

    const tooHot = new WorldObject(2, thingDef, session);
    tooHot.setNumber(temperature, 30, session);
    expect(tooHot.tryExecuteAction('use', undefined, session), '上限は含まない').toBe(false);

    const tooCold = new WorldObject(3, thingDef, session);
    tooCold.setNumber(temperature, 19, session);
    expect(tooCold.tryExecuteAction('use', undefined, session)).toBe(false);
  });

  it('in_stageは、値が今その段にいるときだけ真になる', () => {
    const yaml = `
object_defs:
  thing:
    props:
      load:
        value: 0
        stages:
          - {name: light}
          - {name: too_heavy, min: 100}
    actions:
      use:
        conditions:
          - not: {prop: load, in_stage: too_heavy}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const session = new WorldSession(codex);
    const thingDef = codex.objects.get(codex.objectNames.getId('thing'));
    const load = codex.propertyNames.getId('load');

    const light = new WorldObject(1, thingDef, session);
    expect(light.tryExecuteAction('use', undefined, session)).toBe(true);

    const heavy = new WorldObject(2, thingDef, session);
    heavy.setNumber(load, 100, session);
    expect(heavy.tryExecuteAction('use', undefined, session), '段に入ると実行できない').toBe(false);
  });

  it('満たしていない要件のreasonを、実行前に引ける', () => {
    const yaml = `
object_defs:
  thing:
    props:
      durability: {value: 0}
    actions:
      use:
        conditions:
          - {in_slot: hand}
          - reason: broken
            not: {prop: durability, lte: 0}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const session = new WorldSession(codex);
    const thing = new WorldObject(1, codex.objects.get(codex.objectNames.getId('thing')), session);

    // 宣言順で最初に落ちるのはreasonを持たないin_slot判定なので、理由は出さない。
    expect(thing.actionUnmetRequirement('use', undefined)?.reasonName).toBeUndefined();
  });

  it('スロット中身判定はタグ付きの子がスロットに居るときだけ真になる', () => {
    const yaml = `
object_defs:
  box:
    slots:
      content:
        cell: {accept: {tag: marker}}
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
    redMarker.moveToSlot(box, contentSlotId);

    expect(box.tryExecuteAction('use', undefined, session)).toBe(true); // contentスロットにredタグのマーカーがあるので実行される
  });

  it('スロット中身判定はタグが異なる、または空のときは偽になる', () => {
    const yaml = `
object_defs:
  box2:
    slots:
      content:
        cell: {accept: {tag: marker}}
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
    blueMarker.moveToSlot(box, contentSlotId);
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
          - {prop: content, eq: {object: dragged, prop: content}}
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
          - {prop: content, in: {object: dragged, prop: content}}
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
              - {prop: hp, gte: 100}
              - {prop: mp, gte: 5}
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
          - not: {prop: locked, eq: 1}
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

    expect(logInstance.moveToSlot(campfireInstance, fuelSlotId)).toBeUndefined();
    expect(logInstance.getEffectiveValue(warmthId)).toBe(0); // fuel_slotには入っているが、heatがunlitステージのためボーナスなし

    campfireInstance.setProperty(heatId, 1);
    expect(logInstance.getEffectiveValue(warmthId)).toBe(5); // litステージかつfuel_slot条件の両方を満たすのでボーナスが乗る

    expect(logInstance.moveToSlot(campfireInstance, storageSlotId)).toBeUndefined();
    expect(logInstance.getEffectiveValue(warmthId)).toBe(0); // litステージのままでもfuel_slotから外れるとボーナスが消える
  });

  it('9節の命令は、動詞ごとの優先順位ではなく書かれた順に適用される', () => {
    // 同じ2つの命令を書く順だけ入れ替えると、結果も入れ替わる（GameElementDefinition.md 9.7節）。
    const yaml = `
object_defs:
  tally:
    props:
      n: {value: 0}
    actions:
      add_then_set:
        add: {self: {n: 1}}
        set: {self: {n: 5}}
      set_then_add:
        set: {self: {n: 5}}
        add: {self: {n: 1}}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const session = new WorldSession(codex);
    const nId = codex.propertyNames.getId('n');
    const tallyDef = codex.objects.get(codex.objectNames.getId('tally'));

    const addThenSet = new WorldObject(1, tallyDef, session);
    expect(addThenSet.tryExecuteAction('add_then_set', undefined, session)).toBe(true);
    expect(addThenSet.getNumber(nId)).toBe(5);

    const setThenAdd = new WorldObject(2, tallyDef, session);
    expect(setThenAdd.tryExecuteAction('set_then_add', undefined, session)).toBe(true);
    expect(setThenAdd.getNumber(nId)).toBe(6);
  });

  it('9節の命令とpickは同じ場所に並べて書ける', () => {
    // 分岐に関わらず必ず起こること（add）と、分岐する部分（pick）を、共通処理を候補へ複製せずに書ける。
    const yaml = `
object_defs:
  worker:
    props:
      fatigue: {value: 0}
      mark: {value: 0}
    actions:
      turn:
        add: {self: {fatigue: 1}}
        pick:
          - weight: 1
            set: {self: {mark: 7}}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    const session = new WorldSession(codex);
    const worker = new WorldObject(1, codex.objects.get(codex.objectNames.getId('worker')), session);

    expect(worker.tryExecuteAction('turn', undefined, session)).toBe(true);
    expect(worker.getNumber(codex.propertyNames.getId('fatigue'))).toBe(1);
    expect(worker.getNumber(codex.propertyNames.getId('mark'))).toBe(7);
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
        cell: {accept: {tag: spice, object: raw_meat}}
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
        cell: {accept: {}}
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
    instance.tick(session); // passivesのadd契機は無いが、既に溢れているのでon_overflowだけが発火する

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
          - {object: ancestor, prop: weather, eq: 1}
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

    expect(characterInstance.moveToSlot(roomInstance, contentsSlotId)).toBeUndefined();
    expect(foodInstance.moveToSlot(characterInstance, pocketSlotId)).toBeUndefined();

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

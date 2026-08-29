import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrow(YamlLoadError);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /シンボル名/,
    );
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
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const def = codex.objects.get(codex.objectNames.getId('pond'));
    const moistureId = codex.propertyNames.getId('moisture');
    const prop = def.tryGetPropertyDef(moistureId)!;

    expect(prop.range).toEqual({ min: -1.5, max: 2.25 });
    expect(prop.isInStage(1.75, 'deep'), '段の閾値も小数で刻める').toBe(true);
    expect(prop.isInStage(1.74, 'deep')).toBe(false);

    const session = new WorldSession(codex);
    const pond = session.createObject(codex.objectNames.getId('pond'));
    expect(pond.tryGetProperty(moistureId)?.number ?? 0, '初期値も小数').toBe(0.5);

    pond.tick();

    expect(pond.tryGetProperty(moistureId)?.number ?? 0, '毎tickの加減算も小数で効く').toBeCloseTo(0.15, 10);
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
    const codex = new WorldCodexYamlLoader()
      .load('core.yaml', core)
      .load('foods.yaml', foods)
      .buildAndReset();

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
    expect(() => new WorldCodexYamlLoader().load('a.yaml', a).load('b.yaml', b).buildAndReset()).toThrowError(
      /rock/,
    );
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
      new WorldCodexYamlLoader().load('base.yaml', baseYaml).load('mod.yaml', modYaml).buildAndReset(),
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/shared/);
  });

  it('存在しないtraitへの参照はエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    traits: [does_not_exist]
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /does_not_exist/,
    );
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/min/);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /シンボル型/,
    );
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
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const prop = codex.objects
      .get(codex.objectNames.getId('character'))
      .tryGetPropertyDef(codex.propertyNames.getId('hydration'))!;

    expect(prop.alertOf(100), 'alert未指定の段は安全域').toBe('safe');
    expect(prop.alertOf(20)).toBe('caution');
    expect(prop.alertOf(0)).toBe('fatal');
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/単調/);
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
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const prop = codex.objects
      .get(codex.objectNames.getId('character'))
      .tryGetPropertyDef(codex.propertyNames.getId('body_temperature'))!;

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
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const objectDef = codex.objects.get(codex.objectNames.getId('character'));
    const directionOf = (name: string) =>
      objectDef.tryGetPropertyDef(codex.propertyNames.getId(name))!.alertDirection;

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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrow(YamlLoadError);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/deadly/);
  });

  // ------------------------------------------------------------------
  // art_by_stage（段による絵の差し替え、GameElementDefinition.md 6.4節）
  // ------------------------------------------------------------------

  it('art_by_stageが指すプロパティの段が宣言したartを、artSuffixesとして読み出せる', () => {
    const yaml = `
object_defs:
  campfire:
    art_by_stage: heat
    props:
      heat:
        value: 0
        stages:
          - {name: out}
          - {name: ember, min: 1, art: lit}
          - {name: blaze, min: 60, art: lit}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const def = codex.objects.get(codex.objectNames.getId('campfire'));

    expect(def.artByStagePropertyGlobalId).toBe(codex.propertyNames.getId('heat'));
    // 複数の段が同じart値を宣言しても、artSuffixesは重複を持たない。
    expect(def.artSuffixes()).toEqual(['lit']);
  });

  it('art_by_stageが指すプロパティを持たないとエラーになる', () => {
    const yaml = `
object_defs:
  campfire:
    art_by_stage: heat
    props:
      fuel:
        value: 0
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/heat/);
  });

  it('art_by_stageが指すプロパティがstagesを持たないとエラーになる', () => {
    const yaml = `
object_defs:
  campfire:
    art_by_stage: heat
    props:
      heat:
        value: 0
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/stages/);
  });

  it('art_by_stageが指す以外のプロパティの段にartを書くとエラーになる（1オブジェクト1絵の原則）', () => {
    const yaml = `
object_defs:
  monkey:
    art_by_stage: consciousness
    props:
      consciousness:
        value: 100
        stages:
          - {name: unconscious, art: fainted}
      wariness:
        value: 0
        stages:
          - {name: calm, art: sleepy}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/wariness/);
  });

  it('art_by_stageを持たないobject_defの段にartを書くとエラーになる', () => {
    const yaml = `
object_defs:
  monkey:
    props:
      consciousness:
        value: 100
        stages:
          - {name: unconscious, art: fainted}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /consciousness/,
    );
  });

  it('art_by_stageは、trait側の宣言も参照できる', () => {
    const yaml = `
traits:
  hearth:
    art_by_stage: heat
    props:
      heat:
        value: 0
        stages:
          - {name: out}
          - {name: lit, min: 1, art: lit}
object_defs:
  campfire:
    traits: [hearth]
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const def = codex.objects.get(codex.objectNames.getId('campfire'));

    expect(def.artByStagePropertyGlobalId).toBe(codex.propertyNames.getId('heat'));
  });

  it('art_by_stageが複数のtraitで重複して宣言されるとエラーになる', () => {
    const yaml = `
traits:
  trait_a:
    props:
      heat: {value: 0, stages: [{name: out}]}
    art_by_stage: heat
  trait_b:
    props:
      fuel: {value: 0, stages: [{name: none}]}
    art_by_stage: fuel
object_defs:
  campfire:
    traits: [trait_a, trait_b]
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /art_by_stage/,
    );
  });

  it('art_by_stageが指さないプロパティの段がartを宣言しているとエラーになる', () => {
    // 1オブジェクト1絵（GameElementDefinition.md 6.4節）。黙って無視すると、書いたartが効いている
    // つもりのまま出ない。
    const yaml = `
object_defs:
  campfire:
    art_by_stage: heat
    props:
      heat: {value: 0, stages: [{name: out}]}
      fuel: {value: 0, stages: [{name: none, art: empty}]}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrow(YamlLoadError);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /段にartを書けるのは/,
    );
  });

  it('gaugeの向きとstagesのalertの向きが食い違うとエラーになる', () => {
    // 「どちらが危ないか」を二度言うことになるので、食い違いを許すと片方だけが正しく見える（6.8節）。
    const yaml = `
object_defs:
  torch:
    props:
      fuel:
        value: 30
        range: {min: 0, max: 30}
        gauge: {min: good, max: bad}
        stages:
          - {name: full, min: 20, alert: safe}
          - {name: low, min: 0, alert: fatal}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrow(YamlLoadError);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /gaugeの向き/,
    );
  });

  it('rangeを持つプロパティのalertが上下どちらの端でも深刻だとエラーになる', () => {
    // バーの塗りの向きが決められない（6.4節）。両側が悪い量は、片側だけの度合いを別のプロパティにする。
    const yaml = `
object_defs:
  body:
    props:
      temperature:
        value: 37
        range: {min: 30, max: 42}
        stages:
          - {name: cold, min: 30, alert: fatal}
          - {name: normal, min: 36, alert: safe}
          - {name: hot, min: 39, alert: fatal}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrow(YamlLoadError);
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /上下どちらの端でも深刻/,
    );
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
      const load = (): unknown => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/同時に/);
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /cell_count/,
    );
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/配列/);
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
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
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

    expect(swordInstance.moveToSlotOrRejection(characterInstance.getSlot(mainHandId))).toBeUndefined();
    expect(characterInstance.tryGetProperty(attackId)?.getEffectiveValue() ?? 0).toBe(15); // main_handでは+5

    expect(swordInstance.moveToSlotOrRejection(characterInstance.getSlot(offHandId))).toBeUndefined();
    expect(characterInstance.tryGetProperty(attackId)?.getEffectiveValue() ?? 0).toBe(12); // off_handへ持ち替えると+2に切り替わる
  });

  it('on_minはrangeが無いとエラーになる', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        on_min:
          destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/range/);
  });

  it('modifyで書き換えられるプロパティにon_minを書くとエラーになる', () => {
    // 端のイベントは実体値で発火し、段やバーは実効値で読む（GameElementDefinition.md 6.3節）。
    // 両方を持つと見えている値と起きることがずれるが、そのときの挙動をまだ決めていない。
    const yaml = `
object_defs:
  beast:
    props:
      blood:
        value: 100
        range: {min: 0, max: 100}
        on_min:
          destroy: self
  charm:
    passives:
      - modify: {parent: {blood: 50}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/charm/);
  });

  it('baseを持つプロパティにon_maxを書くとエラーになる', () => {
    // 土台から受け取る値も実効値にしか乗らないので、modifyと同じ理由で噛み合わない。
    const yaml = `
object_defs:
  thing:
    props:
      warmth:
        value: 0
        base: {subject: ancestor}
        range: {min: 0, max: 10}
        on_max:
          destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/base/);
  });

  it('baseにsubject: selfを書いてpropを省くとエラーになる', () => {
    // 省略時の既定は同名なので、自分自身が土台になってしまう（6.5節）。
    const yaml = `
object_defs:
  thing:
    props:
      warmth: {value: 0, base: {subject: self}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/prop/);
  });

  it('baseがselfを辿って自分へ戻るとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    props:
      a: {value: 0, base: {subject: self, prop: b}}
      b: {value: 0, base: {subject: self, prop: a}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/base/);
  });

  it('baseのsubjectに、宣言元から辿れない相手は書けない', () => {
    // propsの宣言は「誰かが操作している場面」とは限らない（ReferenceScope.declaration）。
    const yaml = `
object_defs:
  thing:
    props:
      warmth: {value: 0, base: {subject: agent, prop: warmth}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/agent/);
  });

  it('fillを宣言する型がweightを持たないとエラーになる', () => {
    // 抱えている量の重さ（fill × density）を載せる先が要る（ContainerSystem.md 1節）。
    const yaml = `
object_defs:
  puddle:
    props:
      fill: {value: 100}
      density: {value: 1}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/weight/);
  });

  it('weightにon_maxを書くとエラーになる（中身の伝播がmodifyだから）', () => {
    // 伝播はエンジンが生やすmodify（containerPropagation）なので、modifyされるプロパティに
    // 端のイベントを書けないという一般の規則がそのまま効く（6.3節）。
    const yaml = `
object_defs:
  crate:
    props:
      weight:
        value: 0
        range: {min: 0, max: 100}
        on_max:
          destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/on_max/);
  });

  it('required_propsが要求するプロパティを持たない型はエラーになる', () => {
    // タグを名乗った以上、そのタグに要る値は揃っているはず（GameElementDefinition.md 4.2節）。
    const yaml = `
required_props:
  item: [weight]
object_defs:
  stone:
    tags: [item]
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/weight/);
  });

  it('required_propsの要求は複数のファイルから足せる', () => {
    // パックが自分のタグの約束を書き足す。後から現れた宣言は上書きではなく合流する（4.2節）。
    const base = `
required_props:
  item: [weight]
object_defs:
  stone:
    tags: [item]
    props:
      weight: {value: 500}
`;
    const pack = `
required_props:
  item: [volume]
`;
    expect(() =>
      new WorldCodexYamlLoader().load('core.yaml', base).load('pack.yaml', pack).buildAndReset(),
    ).toThrowError(/volume/);
  });

  it('required_propsのタグを持たない型は何も要求されない', () => {
    const yaml = `
required_props:
  item: [weight]
object_defs:
  cloud:
    props:
      height: {value: 1000}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).not.toThrow();
  });

  it('on_minの対象にagentを指定するとエラーになる（rangeイベントに操作者は居ない）', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_min:
          destroy: agent
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/agent/);
  });

  it('on_minのweightにagentを指定するとエラーになる（rangeイベントに操作者は居ない）', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_min:
          pick:
            - weight: {subject: agent, prop: luck}
              destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/agent/);
  });

  it('on_minのweightの積にagentを混ぜてもエラーになる（積の因子も同じ場所の参照）', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_min:
          pick:
            - weight: {prop: life, times: {subject: agent, prop: luck}}
              destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/agent/);
  });

  it('propの未知のキーはエラーになる', () => {
    const yaml = `
object_defs:
  log:
    props:
      life:
        value: 0
        range: {min: 0, max: 100}
        on_exhausted:
          destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /未知のキー/,
    );
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /on_exhausted/,
    );
  });

  // ------------------------------------------------------------------
  // 型で指す行き先（to_object / into_object）
  // ------------------------------------------------------------------

  /**
   * 型の名前で行き先を指せるのは、世界にただ1つ在る型だけ（GameElementDefinition.md 9.4節・9.6節）。
   * 複数在りうる型を指すと、どの個体へ行くかは世界の形が決めてしまう——島へ戻る航路が、出た浜では
   * なく島で最初の浜へ着いていた（#931）。書いた時点で分かる誤りなので、ロード時に落とす。
   */
  const shoreYaml = (extra: string): string => `
object_defs:
  sandy_beach:${extra}
    slots:
      stuff: {}
  raft:
    interactions:
      sail:
        trigger: menu
        move: {subject: self, to_object: sandy_beach}
`;

  it('to_objectが非singletonの型を指すとエラーになる', () => {
    expect(() => new WorldCodexYamlLoader().load('core.yaml', shoreYaml('')).buildAndReset()).toThrowError(
      /sandy_beach/,
    );
  });

  it('to_objectがsingletonの型を指せば通る', () => {
    expect(() =>
      new WorldCodexYamlLoader().load('core.yaml', shoreYaml('\n    singleton: true')).buildAndReset(),
    ).not.toThrow();
  });

  it('into_objectが非singletonの型を指すとエラーになる', () => {
    const yaml = `
object_defs:
  crate:
    slots:
      items: {}
  seed: {}
  sprouter:
    props:
      fuse:
        value: 0
        range: {min: 0, max: 10}
        on_min:
          spawn: {object: seed, into_object: crate}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/crate/);
  });

  /**
   * 型を値に持つプロパティ（GameElementDefinition.md 6.9節）。**検査は`to_object`に直接書いたときと
   * 同じ**——どこに書いても「その型のインスタンスを1つ指す」ことに変わりはないので、複数在りうる型を
   * 指せてはならない。
   */
  const neighbourYaml = (extra: string): string => `
object_defs:
  kelp_belt:${extra}
    slots:
      stuff: {}
  coastal_waters:
    props:
      zone_toward_mainland: {value: {object: kelp_belt}}
`;

  it('propsに書いた型が非singletonならエラーになる', () => {
    expect(() =>
      new WorldCodexYamlLoader().load('core.yaml', neighbourYaml('')).buildAndReset(),
    ).toThrowError(/kelp_belt/);
  });

  it('propsに書いた型がsingletonなら通る', () => {
    expect(() =>
      new WorldCodexYamlLoader().load('core.yaml', neighbourYaml('\n    singleton: true')).buildAndReset(),
    ).not.toThrow();
  });

  it('to_objectが型を値に持たないプロパティを引くとエラーになる', () => {
    // **プロパティの値は数のままなので、実行時には無関係な型を引くか、黙って何も起きないかになる。**
    // どちらの宣言（型の名前・プロパティ）で書いても、指せているかはロード時に分かる。
    const yaml = `
object_defs:
  kelp_belt:
    singleton: true
    slots:
      stuff: {}
  raft:
    props:
      storm_drift: {value: 0}
    interactions:
      sail:
        trigger: menu
        move: {subject: self, to_object: {prop: storm_drift}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /storm_drift/,
    );
  });

  it('propsの型に未知のキーを混ぜるとエラーになる', () => {
    const yaml = `
object_defs:
  kelp_belt:
    singleton: true
    slots:
      stuff: {}
  coastal_waters:
    props:
      zone_toward_mainland: {value: {object: kelp_belt, min: 1}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /未知のキー/,
    );
  });

  it('指した型が別のファイルでsingletonを名乗っていれば通る', () => {
    // 相手の型は自分の宣言より後に読まれうるので、検査は全ファイルを読み終えてから行う。
    const raft = `
object_defs:
  raft:
    interactions:
      sail:
        trigger: menu
        move: {subject: self, to_object: coastal_waters}
`;
    const sea = `
object_defs:
  coastal_waters:
    singleton: true
    slots:
      stuff: {}
`;
    expect(() =>
      new WorldCodexYamlLoader().load('raft.yaml', raft).load('sea.yaml', sea).buildAndReset(),
    ).not.toThrow();
  });

  it('to_objectが定義の無い型名を指すとエラーになる', () => {
    const yaml = `
object_defs:
  raft:
    interactions:
      sail:
        trigger: menu
        move: {subject: self, to_object: coastal_watrs}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /coastal_watrs/,
    );
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrow(YamlLoadError);
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
    interactions:
      eat:
        trigger: menu
        conditions:
          - {subject: agent, prop: satiety, lt: 100}
        add:
          agent:
            satiety: 10
        destroy: self
  player:
    props:
      satiety:
        value: 100
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

    const apple = codex.objects.get(codex.objectNames.getId('apple'));
    const satietyId = codex.propertyNames.getId('satiety');
    const session = new WorldSession(codex);
    const appleInstance = new WorldObject(1, apple, session);
    const player = new WorldObject(2, codex.objects.get(codex.objectNames.getId('player')), session);

    expect(appleInstance.tryGetAction('eat', player)?.tryExecute() === true).toBe(false); // agent.satiety=100 は lt 100 を満たさない
    player.tryGetProperty(satietyId)?.setNumber(99);
    expect(appleInstance.tryGetAction('eat', player)?.tryExecute() === true).toBe(true); // agent.satiety=99 は lt 100 を満たす
  });

  it('andでinstrument対象を持つcombinationをパースできる', () => {
    const yaml = `
object_defs:
  wood:
    interactions:
      chop:
        trigger: {drag: {tag: axe_tool}}
        conditions:
          - {subject: instrument, prop: durability, gt: 0}
        spawn: {object: logs}
        destroy: self
        add:
          instrument:
            durability: -1
  logs: {}
  axe_tool:
    tags: [axe_tool]
    props:
      durability:
        value: 10
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const durabilityId = codex.propertyNames.getId('durability');

    const wood = codex.objects.get(codex.objectNames.getId('wood'));
    const session = new WorldSession(codex);
    const woodInstance = new WorldObject(1, wood, session);
    const axe = new WorldObject(2, codex.objects.get(codex.objectNames.getId('axe_tool')), session);

    axe.tryGetProperty(durabilityId)?.setNumber(0);
    expect(
      woodInstance
        .combinationsWith(axe, undefined)
        .find((c) => c.name === 'chop')
        ?.tryExecute() === true,
    ).toBe(false); // instrument.durability=0 のとき条件 gt 0 を満たさない
    axe.tryGetProperty(durabilityId)?.setNumber(10);
    expect(
      woodInstance
        .combinationsWith(axe, undefined)
        .find((c) => c.name === 'chop')
        ?.tryExecute() === true,
    ).toBe(true); // instrument.durability=10 のとき条件 gt 0 を満たす
    expect(axe.tryGetProperty(durabilityId)?.number ?? 0).toBe(9); // add: instrument.durability: -1 が適用される
    expect(woodInstance.parent).toBeUndefined(); // destroy: self が適用される
  });

  it('2つのtraitが同名のactionを持つとエラーになる', () => {
    const yaml = `
traits:
  trait_a:
    interactions:
      use:
        trigger: menu
        destroy: self
  trait_b:
    interactions:
      use:
        trigger: menu
        destroy: self
object_defs:
  thing:
    traits: [trait_a, trait_b]
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/use/);
  });

  it('actionsでinstrument対象を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        destroy: instrument
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /instrument/,
    );
  });

  it('destroyのマップが空だとエラーになる', () => {
    // subjectの既定がselfなので`destroy: {}`も動いてしまうが、それは何も書かずに`destroy: self`を
    // 得る抜け道（9.3節）。漏れても困らなくすると、漏れたままの定義がそのまま正しいことになる。
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        destroy: {}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/subject/);
  });

  it('destroyのマップにreasonだけを書くのは通る（対象はself）', () => {
    // 名乗りだけを添えた消滅は、対象を省いた書き方であって書き漏らしではない（9.3節）。
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        destroy: {reason: smitten}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).not.toThrow();
  });

  it('activeでchild対象を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        destroy: child
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/child/);
  });

  it('triggerに未対応の値を指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: sometimes
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/trigger/);
  });

  it('triggerを書かないとエラーになる（何が起こすか分からない操作を作らない）', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/trigger/);
  });

  it('きっかけがdragでないのにallow_multipleを書くと未知のキーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        allow_multiple: true
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /allow_multiple/,
    );
  });

  it('objectにworldを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        conditions:
          - {subject: world, prop: day, gt: 0}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/world/);
  });

  it('conditionのvalueにmaxを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        conditions:
          - {subject: agent, prop: satiety, lt: max}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/max/);
  });

  it('conditionの葉はobject/opを省略するとself/eqとして扱われる', () => {
    const yaml = `
object_defs:
  thing:
    props:
      mode:
        value: 1
    interactions:
      use:
        trigger: menu
        conditions:
          - {prop: mode, eq: 1}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

    const thing = codex.objects.get(codex.objectNames.getId('thing'));
    const modeId = codex.propertyNames.getId('mode');
    const session = new WorldSession(codex);
    const thingInstance = new WorldObject(1, thing, session);

    expect(thingInstance.tryGetAction('use', undefined)?.tryExecute() === true).toBe(true); // object/op省略時は self.mode == 1 の等価比較として成立する
    thingInstance.tryGetProperty(modeId)?.setNumber(2);
    expect(thingInstance.tryGetAction('use', undefined)?.tryExecute() === true).toBe(false); // self.mode != 1 では不成立
  });

  it('conditionでin_slotとpropを同時に指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        conditions:
          - {in_slot: equip, prop: hp, eq: 1}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/slot/);
  });

  it('その主語では使えない演算子キーを書くとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        conditions:
          - {in_slot: equip, lt: 5}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /未知のキー/,
    );
  });

  it('演算子キーを1つも書かないとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    props:
      durability: {value: 10}
    interactions:
      use:
        trigger: menu
        conditions:
          - {prop: durability}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /演算子キー/,
    );
  });

  it('1つの葉に演算子キーを並べると、そのすべてを満たすときだけ真になる（暗黙のAND）', () => {
    const yaml = `
object_defs:
  thing:
    props:
      temperature: {value: 25}
    interactions:
      use:
        trigger: menu
        conditions:
          - {prop: temperature, gte: 20, lt: 30}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const thingDef = codex.objects.get(codex.objectNames.getId('thing'));
    const temperature = codex.propertyNames.getId('temperature');

    const inRange = new WorldObject(1, thingDef, session);
    expect(inRange.tryGetAction('use', undefined)?.tryExecute() === true, '20以上30未満').toBe(true);

    const tooHot = new WorldObject(2, thingDef, session);
    tooHot.tryGetProperty(temperature)?.setNumber(30);
    expect(tooHot.tryGetAction('use', undefined)?.tryExecute() === true, '上限は含まない').toBe(false);

    const tooCold = new WorldObject(3, thingDef, session);
    tooCold.tryGetProperty(temperature)?.setNumber(19);
    expect(tooCold.tryGetAction('use', undefined)?.tryExecute() === true).toBe(false);
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
    interactions:
      use:
        trigger: menu
        conditions:
          - not: {prop: load, in_stage: too_heavy}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const thingDef = codex.objects.get(codex.objectNames.getId('thing'));
    const load = codex.propertyNames.getId('load');

    const light = new WorldObject(1, thingDef, session);
    expect(light.tryGetAction('use', undefined)?.tryExecute() === true).toBe(true);

    const heavy = new WorldObject(2, thingDef, session);
    heavy.tryGetProperty(load)?.setNumber(100);
    expect(heavy.tryGetAction('use', undefined)?.tryExecute() === true, '段に入ると実行できない').toBe(false);
  });

  it('満たしていない要件のreasonを、実行前に引ける', () => {
    const yaml = `
object_defs:
  thing:
    props:
      durability: {value: 0}
    interactions:
      use:
        trigger: menu
        conditions:
          - {in_slot: hand}
          - reason: broken
            not: {prop: durability, lte: 0}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const thing = new WorldObject(1, codex.objects.get(codex.objectNames.getId('thing')), session);

    // 宣言順で最初に落ちるのはreasonを持たないin_slot判定なので、理由は出さない。
    expect(thing.tryGetAction('use', undefined)?.unmetRequirement()?.reasonName).toBeUndefined();
  });

  it('スロット中身判定はタグ付きの子がスロットに居るときだけ真になる', () => {
    const yaml = `
object_defs:
  box:
    slots:
      content:
        cell: {accept: {tag: marker}}
    interactions:
      use:
        trigger: menu
        conditions:
          - {slot: content, matches: {tag: red}}
        destroy: self
  red_marker:
    tags: [marker, red]
  blue_marker:
    tags: [marker, blue]
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const contentSlotId = codex.slotNames.getId('content');

    const session = new WorldSession(codex);
    const box = new WorldObject(1, codex.objects.get(codex.objectNames.getId('box')), session);
    const redMarker = new WorldObject(2, codex.objects.get(codex.objectNames.getId('red_marker')), session);
    redMarker.moveToSlotOrRejection(box.getSlot(contentSlotId));

    expect(box.tryGetAction('use', undefined)?.tryExecute() === true).toBe(true); // contentスロットにredタグのマーカーがあるので実行される
  });

  it('スロット中身判定はタグが異なる、または空のときは偽になる', () => {
    const yaml = `
object_defs:
  box2:
    slots:
      content:
        cell: {accept: {tag: marker}}
    interactions:
      use:
        trigger: menu
        conditions:
          - {slot: content, matches: {tag: red}}
        destroy: self
  blue_marker2:
    tags: [marker, blue]
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const contentSlotId = codex.slotNames.getId('content');

    const session = new WorldSession(codex);
    const box = new WorldObject(1, codex.objects.get(codex.objectNames.getId('box2')), session);
    expect(box.tryGetAction('use', undefined)?.tryExecute() === true).toBe(false); // contentスロットが空なので実行されない

    const blueMarker = new WorldObject(
      2,
      codex.objects.get(codex.objectNames.getId('blue_marker2')),
      session,
    );
    blueMarker.moveToSlotOrRejection(box.getSlot(contentSlotId));
    expect(box.tryGetAction('use', undefined)?.tryExecute() === true).toBe(false); // contentスロットの中身がredタグを持たない(blueタグ)ので実行されない
  });

  it('conditionのslotにmatchesを指定しないとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        conditions:
          - {slot: content}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/matches/);
  });

  it('slotを伴わないmatchesは、subject自身への型判定としてパースされる', () => {
    const yaml = `
object_defs:
  thing:
    tags: [red]
    interactions:
      use:
        trigger: menu
        conditions:
          - {matches: {tag: red}}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const thing = new WorldObject(1, codex.objects.get(codex.objectNames.getId('thing')), session);

    expect(thing.tryGetAction('use', undefined)?.tryExecute() === true).toBe(true);
  });

  it('matchesはobject指定でも書ける（枠のacceptと同じ二択）', () => {
    const yaml = `
object_defs:
  altar:
    slots:
      offering:
        cell: {accept: {tag: gem}}
    interactions:
      use:
        trigger: menu
        conditions:
          - {slot: offering, matches: {object: ruby}}
        destroy: self
  ruby:
    tags: [gem]
  sapphire:
    tags: [gem]
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const offeringSlotId = codex.slotNames.getId('offering');
    const session = new WorldSession(codex);
    const spawn = (name: string, id: number): WorldObject =>
      new WorldObject(id, codex.objects.get(codex.objectNames.getId(name)), session);

    const altar = spawn('altar', 1);
    const sapphire = spawn('sapphire', 2);
    expect(sapphire.moveToSlotOrRejection(altar.getSlot(offeringSlotId))).toBeUndefined();
    expect(altar.tryGetAction('use', undefined)?.tryExecute() === true, '同じタグの別の型では偽').toBe(false);

    sapphire.destroy();
    const ruby = spawn('ruby', 3);
    expect(ruby.moveToSlotOrRejection(altar.getSlot(offeringSlotId))).toBeUndefined();
    expect(altar.tryGetAction('use', undefined)?.tryExecute() === true).toBe(true);
  });

  it('slot・in_slot判定はsubjectが指すオブジェクトを見る（selfとは限らない）', () => {
    const yaml = `
object_defs:
  altar2:
    interactions:
      offer:
        trigger: {drag: {tag: box_tag}}
        conditions:
          - {subject: instrument, slot: content, matches: {tag: gem_tag}}
          - {subject: instrument, in_slot: items}
        destroy: self
  box:
    tags: [box_tag]
    slots:
      content: {}
  gem:
    tags: [gem_tag]
  ground:
    slots:
      items: {}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const spawn = (name: string, id: number): WorldObject =>
      new WorldObject(id, codex.objects.get(codex.objectNames.getId(name)), session);

    const altar = spawn('altar2', 1);
    const box = spawn('box', 2);
    const gem = spawn('gem', 3);
    const ground = spawn('ground', 4);
    expect(box.moveToSlotOrRejection(ground.getSlot(codex.slotNames.getId('items')))).toBeUndefined();

    expect(
      altar
        .combinationsWith(box, undefined)
        .find((c) => c.name === 'offer')
        ?.tryExecute() === true,
      'instrumentの中身が空なら偽',
    ).toBe(false);

    expect(gem.moveToSlotOrRejection(box.getSlot(codex.slotNames.getId('content')))).toBeUndefined();
    expect(
      altar
        .combinationsWith(box, undefined)
        .find((c) => c.name === 'offer')
        ?.tryExecute() === true,
    ).toBe(true);
  });

  it('conditionのvalueをプロパティ参照にすると、2つの動的プロパティを比較できる', () => {
    const yaml = `
object_defs:
  bottle:
    props:
      content:
        value: empty
    interactions:
      pour_in:
        trigger: {drag: {tag: liquid_container}}
        conditions:
          - {prop: content, eq: {subject: instrument, prop: content}}
        destroy: self
  bottle_source:
    tags: [liquid_container]
    props:
      content:
        value: water
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

    const session = new WorldSession(codex);
    const bottle = new WorldObject(1, codex.objects.get(codex.objectNames.getId('bottle')), session);
    const sameContent = new WorldObject(
      2,
      codex.objects.get(codex.objectNames.getId('bottle_source')),
      session,
    );

    expect(
      bottle
        .combinationsWith(sameContent, undefined)
        .find((c) => c.name === 'pour_in')
        ?.tryExecute() === true,
    ).toBe(false); // self(empty)とinstrument(water)のcontentが異なるので不成立

    const contentId = codex.propertyNames.getId('content');
    bottle.getProperty(contentId).setNumberWithoutEvents(codex.symbolNames.getId('water'));
    expect(
      bottle
        .combinationsWith(sameContent, undefined)
        .find((c) => c.name === 'pour_in')
        ?.tryExecute() === true,
    ).toBe(true); // selfとinstrumentのcontentが同じ(water)なので成立
  });

  it('プロパティ参照のvalueにinを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        conditions:
          - {prop: content, in: {subject: instrument, prop: content}}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/in/);
  });

  it('setのvalueに他のプロパティの値を読む形は書けない（9.2節）', () => {
    // 値の位置に書けるマップは「その対象キーが名指す個体」（`{subject: parent}`）だけで、`prop`は
    // 書けない——値の算出をYAMLへ持ち込まないという9.2節の規則は、個体を書けるようになっても変わらない。
    const yaml = `
object_defs:
  bottle2:
    props:
      content:
        value: empty
    interactions:
      pour_in:
        trigger: {drag: {tag: liquid_container2}}
        set:
          self:
            content: {subject: instrument, prop: content}
  oil_source:
    tags: [liquid_container2]
    props:
      content:
        value: oil
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /未知のキー 'prop'/,
    );
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
    interactions:
      use:
        trigger: menu
        conditions:
          - any:
              - {prop: hp, gte: 100}
              - {prop: mp, gte: 5}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

    const thing = codex.objects.get(codex.objectNames.getId('thing'));
    const session = new WorldSession(codex);
    const falseCase = new WorldObject(1, thing, session);
    const trueCase = new WorldObject(2, thing, session);
    const hpId = codex.propertyNames.getId('hp');
    const mpId = codex.propertyNames.getId('mp');

    falseCase.tryGetProperty(hpId)?.setNumber(99);
    falseCase.tryGetProperty(mpId)?.setNumber(4);
    expect(falseCase.tryGetAction('use', undefined)?.tryExecute() === true).toBe(false); // hp(99)もmp(4)も条件を満たさないため不成立

    expect(trueCase.tryGetAction('use', undefined)?.tryExecute() === true).toBe(true); // hp(5)はgte 100を満たさないが、mp(5)がgte 5を満たすのでanyとして成立する
  });

  it('notコンビネータは内側の葉を反転する', () => {
    const yaml = `
object_defs:
  thing:
    props:
      locked:
        value: 1
    interactions:
      use:
        trigger: menu
        conditions:
          - not: {prop: locked, eq: 1}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

    const session = new WorldSession(codex);
    const thingInstance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('thing')), session);

    expect(thingInstance.tryGetAction('use', undefined)?.tryExecute() === true).toBe(false); // locked(1)がprop:1と一致するため、not: {...}は偽になる
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
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
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

    expect(logInstance.moveToSlotOrRejection(campfireInstance.getSlot(fuelSlotId))).toBeUndefined();
    expect(logInstance.tryGetProperty(warmthId)?.getEffectiveValue() ?? 0).toBe(0); // fuel_slotには入っているが、heatがunlitステージのためボーナスなし

    campfireInstance.getProperty(heatId).setNumberWithoutEvents(1);
    expect(logInstance.tryGetProperty(warmthId)?.getEffectiveValue() ?? 0).toBe(5); // litステージかつfuel_slot条件の両方を満たすのでボーナスが乗る

    expect(logInstance.moveToSlotOrRejection(campfireInstance.getSlot(storageSlotId))).toBeUndefined();
    expect(logInstance.tryGetProperty(warmthId)?.getEffectiveValue() ?? 0).toBe(0); // litステージのままでもfuel_slotから外れるとボーナスが消える
  });

  it('9節の命令は、動詞ごとの優先順位ではなく書かれた順に適用される', () => {
    // 同じ2つの命令を書く順だけ入れ替えると、結果も入れ替わる（GameElementDefinition.md 9.7節）。
    const yaml = `
object_defs:
  tally:
    props:
      n: {value: 0}
    interactions:
      add_then_set:
        trigger: menu
        add: {self: {n: 1}}
        set: {self: {n: 5}}
      set_then_add:
        trigger: menu
        set: {self: {n: 5}}
        add: {self: {n: 1}}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const nId = codex.propertyNames.getId('n');
    const tallyDef = codex.objects.get(codex.objectNames.getId('tally'));

    const addThenSet = new WorldObject(1, tallyDef, session);
    expect(addThenSet.tryGetAction('add_then_set', undefined)?.tryExecute() === true).toBe(true);
    expect(addThenSet.tryGetProperty(nId)?.number ?? 0).toBe(5);

    const setThenAdd = new WorldObject(2, tallyDef, session);
    expect(setThenAdd.tryGetAction('set_then_add', undefined)?.tryExecute() === true).toBe(true);
    expect(setThenAdd.tryGetProperty(nId)?.number ?? 0).toBe(6);
  });

  it('9節の命令とpickは同じ場所に並べて書ける', () => {
    // 分岐に関わらず必ず起こること（add）と、分岐する部分（pick）を、共通処理を候補へ複製せずに書ける。
    const yaml = `
object_defs:
  worker:
    props:
      fatigue: {value: 0}
      mark: {value: 0}
    interactions:
      turn:
        trigger: menu
        add: {self: {fatigue: 1}}
        pick:
          - weight: 1
            set: {self: {mark: 7}}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    const session = new WorldSession(codex);
    const worker = new WorldObject(1, codex.objects.get(codex.objectNames.getId('worker')), session);

    expect(worker.tryGetAction('turn', undefined)?.tryExecute() === true).toBe(true);
    expect(worker.tryGetProperty(codex.propertyNames.getId('fatigue'))?.number ?? 0).toBe(1);
    expect(worker.tryGetProperty(codex.propertyNames.getId('mark'))?.number ?? 0).toBe(7);
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
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
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /いずれかが必要です/,
    );
  });

  it('combinationsのwithでtagとobjectを同時に指定するとエラーになる', () => {
    const yaml = `
object_defs:
  hearth3:
    interactions:
      ignite:
        trigger: {drag: {tag: tinder, object: burning_tinder3}}
        destroy: instrument
  burning_tinder3: {}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /同時に指定できません/,
    );
  });

  it('ドラッグのきっかけの相手をスカラーで書くとエラーになる（acceptと同じ{tag|object}の形）', () => {
    const yaml = `
object_defs:
  hearth4:
    interactions:
      ignite:
        trigger: {drag: tinder}
        destroy: instrument
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /マッピングである必要があります/,
    );
  });

  it('allow_multipleは、まとめた枚数を数える器を持たない効果ではエラーになる', () => {
    const yaml = `
object_defs:
  altar:
    interactions:
      offer:
        trigger: {drag: {tag: offering}, allow_multiple: true}
        destroy: instrument
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /器を1つだけ持つ効果です/,
    );
  });

  it('allow_multipleは、pickを含む効果ではエラーになる（引くたびに起きることが変わる）', () => {
    const yaml = `
object_defs:
  altar2:
    props:
      offerings:
        value: 0
        range: {min: 0, max: 10}
    interactions:
      offer:
        trigger: {drag: {tag: offering}, allow_multiple: true}
        transfer: {amount: 1, from: instrument, from_prop: weight, to_prop: offerings}
        pick:
          - weight: 1
            destroy: instrument
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /器を1つだけ持つ効果です/,
    );
  });

  // ------------------------------------------------------------------
  // on_max
  // ------------------------------------------------------------------

  it('on_maxはrangeが無いとエラーになる', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        on_max:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/range/);
  });

  it('on_maxをパースし、実行時に適用する', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 45
        range: {min: 0, max: 60}
        on_max:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
`;
    const codex = new WorldCodexYamlLoader().load('clock.yaml', yaml).buildAndReset();

    const clock = codex.objects.get(codex.objectNames.getId('clock'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, clock, session);
    instance.getProperty(codex.propertyNames.getId('minute')).setNumberWithoutEvents(60); // 手動で溢れさせる
    instance.tick(); // passivesのadd契機は無いが、既に溢れているのでon_maxだけが発火する

    expect(instance.tryGetProperty(codex.propertyNames.getId('minute'))?.number ?? 0).toBe(0);
    expect(instance.tryGetProperty(codex.propertyNames.getId('hour'))?.number ?? 0).toBe(1);
  });

  it('on_maxの対象にagentを指定するとエラーになる（rangeイベントに操作者は居ない）', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        range: {min: 0, max: 60}
        on_max:
          add: {agent: {minute: -60}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/agent/);
  });

  it('on_maxの対象にparentを指定できる（遡る起点は自分なので解決先を持つ）', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 55
        range: {min: 0, max: 60}
        on_max:
          add: {parent: {hour: 1}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).not.toThrow();
  });

  it('on_maxを省略するとselfをmaxへクランプする既定効果になる', () => {
    // rangeだけ定義してon_maxを省略すると、「自分自身をRange.Maxへsetする」既定の
    // ActiveEffectが自動生成され、上限クランプとして機能する。
    const yaml = `
object_defs:
  gauge:
    props:
      value:
        value: 90
        range: {min: 0, max: 100}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

    const gauge = codex.objects.get(codex.objectNames.getId('gauge'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, gauge, session);
    instance.getProperty(codex.propertyNames.getId('value')).setNumberWithoutEvents(150);
    instance.tick();

    expect(instance.tryGetProperty(codex.propertyNames.getId('value'))?.number ?? 0).toBe(100); // 既定のon_maxにより100へクランプされる
  });

  // ------------------------------------------------------------------
  // on_min（on_maxの下限側の鏡像）
  // ------------------------------------------------------------------

  it('on_minはrangeが無いとエラーになる', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        on_min:
          set: {self: {minute: 0}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/range/);
  });

  it('on_minの対象にinstrumentを指定するとエラーになる（rangeイベントに重ねる相手は居ない）', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 0
        range: {min: 0, max: 60}
        on_min:
          add: {instrument: {minute: 60}}
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(
      /instrument/,
    );
  });

  it('on_minをパースし、実行時に適用する', () => {
    // on_maxの下限側の鏡像。addで折り返し量・繰り下げ量を一度に加減算する（on_maxと
    // 同じく、setより堅牢）。
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 5
        range: {min: 0, max: 60}
        on_min:
          add: {self: {minute: 60, hour: -1}}
      hour:
        value: 1
`;
    const codex = new WorldCodexYamlLoader().load('clock.yaml', yaml).buildAndReset();

    const clock = codex.objects.get(codex.objectNames.getId('clock'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, clock, session);
    instance.getProperty(codex.propertyNames.getId('minute')).setNumberWithoutEvents(-10); // 手動で下回らせる
    instance.tick();

    expect(instance.tryGetProperty(codex.propertyNames.getId('minute'))?.number ?? 0).toBe(50);
    expect(instance.tryGetProperty(codex.propertyNames.getId('hour'))?.number ?? 0).toBe(0);
  });

  it('on_minを省略するとselfをminへクランプする既定効果になる', () => {
    const yaml = `
object_defs:
  gauge:
    props:
      value:
        value: 10
        range: {min: 0, max: 100}
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

    const gauge = codex.objects.get(codex.objectNames.getId('gauge'));

    const session = new WorldSession(codex);
    const instance = new WorldObject(1, gauge, session);
    instance.getProperty(codex.propertyNames.getId('value')).setNumberWithoutEvents(-50);
    instance.tick();

    expect(instance.tryGetProperty(codex.propertyNames.getId('value'))?.number ?? 0).toBe(0); // 既定のon_minにより0へクランプされる
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
    interactions:
      check:
        trigger: menu
        conditions:
          - {subject: ancestor, prop: weather, eq: 1}
        destroy: self
`;
    const codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
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

    expect(characterInstance.moveToSlotOrRejection(roomInstance.getSlot(contentsSlotId))).toBeUndefined();
    expect(foodInstance.moveToSlotOrRejection(characterInstance.getSlot(pocketSlotId))).toBeUndefined();

    expect(foodInstance.tryGetAction('check', undefined)?.tryExecute() === true).toBe(true); // characterはweatherを持たないため素通りし、roomのweather(1)と比較して真になる
  });

  it('destroyの対象にancestorを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        destroy: ancestor
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/ancestor/);
  });

  it('in_slot判定でobjectにancestorを指定するとエラーになる', () => {
    const yaml = `
object_defs:
  thing:
    interactions:
      use:
        trigger: menu
        conditions:
          - {subject: ancestor, in_slot: somewhere}
        destroy: self
`;
    expect(() => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset()).toThrowError(/ancestor/);
  });
});

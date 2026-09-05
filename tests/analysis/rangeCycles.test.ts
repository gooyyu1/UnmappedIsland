import { describe, expect, it } from 'vitest';
import { externalTickDeltasOf, externalTickDeltasOn, rangeCyclesOf } from '../../src/analysis/rangeCycles';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * tick毎に動く値がrangeの端へ届くまでの周期（`src/analysis/rangeCycles.ts`）の検証。
 *
 * 見るのは次のところ。**条件つきの増減（`GameElementDefinition.md` 8.2節）をどう組み合わせるか**
 * ——問いは「合算するか」ではなく「どの組み合わせが同時に成立しうるか」で、成立しえない組み合わせを
 * 1つの場合として数えると、増減が打ち消し合って周期そのものが消える。**端から戻る量をどう測るか**
 * （`RangeEventReadout`）——`add`で足して戻すのも`set`で書き戻すのも、上端から戻るのも下端から
 * 戻るのも、同じ1つの向き（端からrangeの内側へ）で測らないと、周期が端によって別の意味になる。
 * そして**外からの押し手をどう束ねるか**——速さは幅にできるが、止まるまでと効き始めはできない。
 * 限度や立ち上がりの違うものを束ねると、どの仕掛けも持っていない押し手ができる。
 *
 * 形はどれも同梱の定義から採っているが、宣言はここに置く（tests/architecture/testKinds.test.ts）。
 */
describe('rangeの端へ届くまでの周期（rangeCycles）', () => {
  const YAML = `
object_defs:
  # 祖先が名乗る環境。条件の相手として要るだけで、値そのものは読まれない。
  world:
    props:
      ambient_temperature: {value: 26, range: {min: -10, max: 45}}
      ambient_brightness: {value: 0, range: {min: -6, max: 17}}
      wetness: {value: 0, range: {min: 0, max: 1}}

  # 凍死する者（characters/player_character.yamlのwarmth）。気温を同じ境目の逆向きの演算子で
  # 見ている3ブロックは、どの2つも同時には成立しない。
  camper:
    tags: [item]
    props:
      chill_point: {value: 16}
      sheltered: {value: 0}
      warmth:
        value: 700
        range: {min: 0, max: 700}
        on_min: {destroy: self}
        passives:
          - conditions:
              - {subject: ancestor, prop: ambient_temperature, lt: {prop: chill_point}}
              - any:
                  - {prop: sheltered, gte: 1}
                  - {subject: ancestor, prop: wetness, lt: 1}
            add: {self: {warmth: -2}}
          - conditions:
              - {subject: ancestor, prop: ambient_temperature, lt: {prop: chill_point}}
              - {prop: sheltered, eq: 0}
              - {subject: ancestor, prop: wetness, gte: 1}
            add: {self: {warmth: -6}}
          - conditions:
              - {subject: ancestor, prop: ambient_temperature, gte: {prop: chill_point}}
            add: {self: {warmth: 8}}

  # 塩田（salt.yaml）。常時効く増減を持たず、晴れて乾く分と雨で戻る分だけが動かす。
  salt_pan:
    tags: [fixture]
    props:
      drying_remaining:
        value: 24
        range: {min: 0, max: 24}
        on_min:
          add: {self: {drying_remaining: 24}}
          spawn: {object: salt, into: self}
        passives:
          - conditions: [{subject: ancestor, prop: ambient_brightness, gte: 14}]
            add: {self: {drying_remaining: -1}}
          - conditions: [{subject: ancestor, prop: wetness, gte: 1}]
            add: {self: {drying_remaining: 2}}
    slots:
      salt:
        cell_count: 4
        cell: {accept: {tag: item}}

  salt:
    tags: [item]

  # 閉じ込められた獣（TrapSystem.md 5.4節）。渇くのも飲むのも同じゲートの下だが、飲めるのは
  # 囲いの水が残っている間だけなので、渇きだけが効く場合がある。
  pen:
    tags: [fixture]
    slots:
      catch:
        cell_count: 1
        cell: {accept: {tag: quarry}}
    props:
      drinking_water: {value: 0, range: {min: 0, max: 4000}}

  beast:
    tags: [item, quarry]
    props:
      hydration:
        value: 336
        range: {min: 0, max: 336}
        on_min: {destroy: self}
        passives:
          - conditions: [{in_slot: catch}]
            add: {self: {hydration: -1}}
          - conditions: [{in_slot: catch}]
            transfer:
              from: parent
              from_prop: drinking_water
              to_prop: hydration
              amount: 25
              to_amount: 1

  # 海区（voyage.yaml）。荒天にさらされた時間が上端へ届くと、押し流して0から数え直す。折り返しに
  # addではなくsetを使うのは、上端が海区ごとに違うから——引く量を書くと、折り返す点も海区ごとに
  # 書き写すことになる。
  sea_zone:
    tags: [fixture]
    props:
      storm_drift:
        value: 0
        range: {min: 0, max: 16}
        on_max:
          set: {self: {storm_drift: 0}}
        passives:
          - add: {self: {storm_drift: 1}}

  # 山頂（locations.yaml）。on_maxを書くと補われるはずの既定のクランプ（自分を上端へset、6.3節）が
  # 消えるので、著者がそれを自分で書き写している。端に置き直すだけで、戻ってはいない。
  peak:
    tags: [fixture]
    props:
      exploration_progress:
        value: 0
        range: {min: 0, max: 10}
        on_max:
          set: {self: {exploration_progress: 10}}
        passives:
          - add: {self: {exploration_progress: 1}}

  # 時計の分（core.yamlのminute）と同じ、上端で引いて折り返す形。実際の時計は毎tickの繰り上げを
  # ゲーム側（WorldSession）が持つので、ここでは進む分を宣言に置いてある。
  clock:
    tags: [fixture]
    props:
      minute:
        value: 0
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60}}
        passives:
          - add: {self: {minute: 15}}

  # 血と水を奪う傷。**奪う経路が2つあり、止まるまでも効き始めも違う**——出血は負った瞬間から効いて
  # 自分のbleedingが尽きる4 tickで止まり、膿み続ける傷が奪う分はinfectionがsepticへ届く320 tick後から
  # 効いて止まらない。膿が奪う水の速さは段で変わる。
  gash:
    tags: [injury]
    props:
      bleeding:
        value: 100
        range: {min: 0, max: 100}
        passives:
          - add: {self: {bleeding: -25}}
      infection:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: clean}
          - {name: festering, min: 40}
          - {name: septic, min: 80}
        passives:
          - add: {self: {infection: 0.25}}
    passives:
      - conditions: [{prop: bleeding, gte: 1}]
        add: {parent: {blood: -15}}
      - conditions: [{prop: infection, in_stage: festering}]
        add: {parent: {hydration: -1}}
      - conditions: [{prop: infection, in_stage: septic}]
        add: {parent: {blood: -40, hydration: -2}}

  # 血の多い獣（animals.yamlのwild_boar）。上の傷を負い、血が尽きれば倒れる。
  boar:
    tags: [item]
    props:
      blood:
        value: 4600
        range: {min: 0, max: 4600}
        on_min: {destroy: self}
    slots:
      injuries:
        cell_count: 4
        cell: {accept: {tag: injury}}
`;

  const codex = new WorldCodexYamlLoader().load('rangeCycles.yaml', YAML).buildAndReset();

  /** 宣言した型のうち、その名前のもの。 */
  function defOf(objectName: string) {
    return [...codex.objects].find((candidate) => candidate.name === objectName)!;
  }

  /** その型の、そのプロパティが持つ周期（1つだけのはず）。 */
  function cycleOf(objectName: string, propertyName: string) {
    return rangeCyclesOf(defOf(objectName)).filter(
      (cycle) => codex.propertyNames.getName(cycle.propertyGlobalId) === propertyName,
    );
  }

  it('同じ値を逆向きの演算子で見ているブロックは、同時に成立しない場合として数える', () => {
    // -2・-6・+8のどの2つも同時には成立しない。全部を1つの場合として足すと0になり、下端へ向かう
    // 周期が丸ごと消える（凍死が日をまたぐ長さの列から落ちていた）。
    // 最も遅いのは寒い所に居る-2で700/2=350 tick、最も速いのは雨の野ざらしの-6で116.67 tick。
    expect(cycleOf('camper', 'warmth')).toMatchObject([
      { minutes: 350 * 15, shortestMinutes: (700 / 6) * 15, destroysSelf: true, repeats: false },
    ]);
  });

  it('常時効く増減が無く、条件つきが逆を向いていても、下端へ向かう場合が残る', () => {
    // -1と+2は同時にも起こりうるが、乾く-1だけが効く場合もある。合計（+1）の向きだけで見ると
    // 上端へ向かうものとして読まれ、塩を生むon_minが1つも立たなくなる。
    const [cycle] = cycleOf('salt_pan', 'drying_remaining');
    expect(cycle).toMatchObject({ minutes: 24 * 15, repeats: true });
    expect(cycle.step.outputs).toHaveLength(1);
  });

  it('在庫から流れ込む輸送は、それが止まって渇く場合も数える', () => {
    // 渇く-1と飲む+1は同じゲートを持つが、飲めるのは囲いの水が残っている間だけ。両方を必ず
    // 重なるものとして足すと0になり、渇きの期限が消える。
    expect(cycleOf('beast', 'hydration')).toMatchObject([
      { minutes: 336 * 15, shortestMinutes: 336 * 15, destroysSelf: true },
    ]);
  });

  it('上端からsetで書き戻す仕掛けが、繰り返す仕掛けとして数えられる', () => {
    // 増減しか数えないと戻り0と読まれ、押し流しが「一度きり」になる。戻り量は上端16から書き戻し先の
    // 0までの16で、+1/tickなので16 tickごとに回る。
    expect(cycleOf('sea_zone', 'storm_drift')).toMatchObject([{ minutes: 16 * 15, repeats: true }]);
  });

  it('端へ置き直すだけのsetは、戻っていない', () => {
    // 書き戻し先が上端そのものなので戻り量は0。ここを「上端ぶん戻った」と読むと、既定のクランプを
    // 持つ全プロパティが繰り返す仕掛けになる。周期は初期値0から上端10までの10 tick。
    expect(cycleOf('peak', 'exploration_progress')).toMatchObject([{ minutes: 10 * 15, repeats: false }]);
  });

  it('上端から引いて戻る仕掛けも、下端から足して戻るものと同じ向きで数える', () => {
    // 戻り量を符号つきの増減のまま見ると、上端から戻るものだけが負になって数から漏れる。
    // 60を引いて0へ戻るので戻り量は60、+15/tickなので4 tickごと。
    expect(cycleOf('clock', 'minute')).toMatchObject([{ minutes: 4 * 15, repeats: true }]);
  });

  /** その型が親へ与える押し手のうち、そのプロパティを動かすもの。 */
  function externalDeltasOf(objectName: string, propertyName: string) {
    const propertyGlobalId = codex.propertyNames.getId(propertyName);
    return externalTickDeltasOf(defOf(objectName), 'parent')
      .filter((delta) => delta.propertyGlobalId === propertyGlobalId)
      .map(({ slowest, fastest, maxTotal, ticksUntilStart }) => ({
        slowest,
        fastest,
        maxTotal,
        ticksUntilStart,
      }));
  }

  it('止まるまでの違う押し手は、束ねずに別々に並べる', () => {
    // 速さは幅として持てるが、止まるまでは幅を持てない。1つに束ねると最も遅い-15と「止まらない」が
    // ひと組になり、どちらの経路も持っていない押し手ができる。
    expect(externalDeltasOf('gash', 'blood')).toEqual([
      { slowest: -15, fastest: -15, maxTotal: 60, ticksUntilStart: 0 },
      { slowest: -40, fastest: -40, maxTotal: undefined, ticksUntilStart: 320 },
    ]);
  });

  it('効き始めの違う押し手も、束ねずに別々に並べる', () => {
    // 段が上がるほど速く奪うが、速い側は遅い側より後からしか効かない。1つの幅に束ねると
    // 「膿み始めた時点で-2」という、どちらの段も持っていない押し手ができる。
    // 0から+0.25/tickなので、festering（40）へは160 tick、septic（80）へは320 tick。
    expect(externalDeltasOf('gash', 'hydration')).toEqual([
      { slowest: -1, fastest: -1, maxTotal: undefined, ticksUntilStart: 160 },
      { slowest: -2, fastest: -2, maxTotal: undefined, ticksUntilStart: 320 },
    ]);
  });

  it('段に入って初めて効く押し手では、その段へ届くまでの時間も周期に入る', () => {
    // 固まるまでの60mLでは4,600mLは尽きないので、失血死は敗血症の-40/tickだけが起こす。その-40は
    // 傷が膿み切ってから効き始めるので、倒れるまでは320 + 115＝435 tick。立ち上がりを数えないと、
    // 負った瞬間から血が減るものとして115 tickになっていた。
    const external = externalTickDeltasOn(defOf('boar'), [...codex.objects]);

    expect(
      rangeCyclesOf(defOf('boar'), undefined, external).filter(
        (cycle) => codex.propertyNames.getName(cycle.propertyGlobalId) === 'blood',
      ),
    ).toMatchObject([{ minutes: (320 + 115) * 15, destroysSelf: true, drivenBy: defOf('gash').globalId }]);
  });
});

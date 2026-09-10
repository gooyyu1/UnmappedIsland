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
 * そして**外からの押し手をどう束ねるか**——問いは自分のプロパティの側と同じで、同時に効く分は
 * 足し合わせ、同時には効かない分が1つの押し手の取りうる量として並ぶ。束ねられるのは効いている間が
 * 同じものどうしだけで、立ち上がりや止まるまでの違うものを1つにすると、どの仕掛けも持っていない
 * 押し手ができる。
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

  # 見張り台。上端へ届くたびに、まだ印が立っていなければ書き戻して数え直す（voyage.yamlの
  # exploration_progressと同じ条件つきのon_max）。**満たさない回は既定のクランプへ倒れる**ので、
  # 著者の書き戻しと「上端へ置き直す」が1つの宣言に同居している。
  lookout:
    tags: [fixture]
    props:
      marked: {value: 0}
      watch_progress:
        value: 0
        range: {min: 0, max: 8}
        on_max:
          conditions:
            - {prop: marked, eq: 0}
          set: {self: {watch_progress: 3}}
        passives:
          - add: {self: {watch_progress: 1}}

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

  # 焼けただれ。**「その段以上」で縛られた押し手**——焦げ始めてから水を奪い、上の段へ抜けても
  # 奪い続ける。ちょうどその段でだけ効く傷の膿みと分かれるのはここ。
  burn:
    tags: [injury]
    props:
      charring:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: reddened}
          - {name: blistered, min: 40}
          - {name: charred, min: 80}
        passives:
          - add: {self: {charring: 0.25}}
    passives:
      - conditions: [{prop: charring, in_stage_or_above: blistered}]
        add: {parent: {hydration: -1}}

  # 焼け石（characters/player_character.yamlのwarmthを上げる側）。**段の下端を割って効かなくなる
  # 押し手**——熱いうちだけ置かれた場所を暖める。熱は冷める一方なので、止まるのは熱が尽きたときでは
  # なく、hotの下端（60）を割ったとき。
  hot_stone:
    tags: [item]
    props:
      heat:
        value: 100
        range: {min: 0, max: 100}
        stages:
          - {name: cold}
          - {name: hot, min: 60}
        passives:
          - add: {self: {heat: -5}}
    passives:
      - conditions: [{prop: heat, in_stage: hot}]
        add: {parent: {ambient_temperature: 2}}

  # 布に包んだ温石。**「その段以上」でも下へは抜ける**——上へ抜けても成立したままなのが焼けただれ
  # （burn）との違いで、名指した段の下端を割れば外れるのは焼け石と変わらない。
  wrapped_stone:
    tags: [item]
    props:
      heat:
        value: 100
        range: {min: 0, max: 100}
        stages:
          - {name: cold}
          - {name: hot, min: 60}
        passives:
          - add: {self: {heat: -5}}
    passives:
      - conditions: [{prop: heat, in_stage_or_above: hot}]
        add: {parent: {ambient_temperature: 2}}

  # 凍傷。**受け皿の段（6.4節）に居ることを求める押し手**——巡りが鈍っている間、持ち主の熱を奪う。
  # 巡りは落ちる一方だが、受け皿には下端が無いので、下端まで落ちても段は外れない。
  frostbite:
    tags: [injury]
    props:
      circulation:
        value: 30
        range: {min: 0, max: 100}
        stages:
          - {name: numb}
          - {name: flowing, min: 60}
        passives:
          - add: {self: {circulation: -1}}
    passives:
      - conditions: [{prop: circulation, in_stage: numb}]
        add: {parent: {warmth: -2}}

  # 炉（fire.yamlのhearth）。**火力は段の下に置かれた増減で育つ**（8.2節）ので、tickAmountsOfは
  # そこを数えず、読める増減は雨で削られる分だけになる。焼く分は火力の段の下に在り、生まれた時点の
  # 火力（0）はその段の下端（5）より下——**まだ入っていない段を、下へ抜けたことにしてはならない**。
  # したことにすると、焼く押し手が丸ごと消える。いつ入るかを答えるのは効き始めの側。
  firepit:
    tags: [fixture]
    props:
      fuel:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: none}
          - name: stocked
            min: 1
            passives:
              - conditions: [{prop: heat, gt: 0}]
                add: {self: {heat: 2}}
      heat:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: out}
          - name: coals
            min: 5
            passives:
              - add:
                  self: {fuel: -0.5}
                  child: {cooking_progress: 1}
    passives:
      - conditions: [{subject: ancestor, prop: wetness, gte: 1}]
        add: {self: {heat: -4}}
    slots:
      fire:
        cell_count: 1
        cell: {accept: {tag: roastable}}

  raw_meat:
    tags: [item, roastable]
    props:
      cooking_progress: {value: 0, range: {min: 0, max: 40}}

  # 刺さったままの棘。抜けない痛みで常に血がにじみ、雨に打たれている間はさらに裂ける。どちらも
  # 止まらず負った瞬間から効くので、起こるのは-1と-5——**-4だけになる場面は無い**。
  thorn:
    tags: [barb]
    passives:
      - add: {parent: {blood: -1}}
      - conditions: [{subject: ancestor, prop: wetness, gte: 1}]
        add: {parent: {blood: -4}}

  # 毒針。**毒の残る間だけ効き、深く刺さっているほど速く注ぎ込む**。段は同時に2つを取れないので
  # 起こるのは-3か-9のどちらかで、どちらも毒が尽きる20 tickで止まる。
  sting:
    tags: [barb]
    props:
      venom:
        value: 40
        range: {min: 0, max: 40}
        passives:
          - add: {self: {venom: -2}}
      lodging:
        value: 0
        range: {min: 0, max: 1}
        stages:
          - {name: shallow}
          - {name: deep, min: 1}
    passives:
      - conditions:
          - {prop: venom, gte: 1}
          - {prop: lodging, in_stage: shallow}
        add: {parent: {blood: -3}}
      - conditions:
          - {prop: venom, gte: 1}
          - {prop: lodging, in_stage: deep}
        add: {parent: {blood: -9}}

  # 燃える松明。**同じ排他の対を、自分の値と相手の値の両方へ書いてある**——火勢の段は同時に2つを
  # 取れないので、燃料の減りも持ち主の渇きも-1か-4のどちらかになる。同じ問いに答える数え上げが
  # 2箇所に分かれていると、片方にだけ直しが入って、自分の増減の側と押し手の側で違う答えが出る。
  torch:
    tags: [item]
    props:
      flame:
        value: 0
        range: {min: 0, max: 1}
        stages:
          - {name: smoldering}
          - {name: blazing, min: 1}
      fuel:
        value: 100
        range: {min: 0, max: 100}
        on_min: {destroy: self}
        passives:
          - conditions: [{prop: flame, in_stage: smoldering}]
            add: {self: {fuel: -1}}
          - conditions: [{prop: flame, in_stage: blazing}]
            add: {self: {fuel: -4}}
    passives:
      - conditions: [{prop: flame, in_stage: smoldering}]
        add: {parent: {hydration: -1}}
      - conditions: [{prop: flame, in_stage: blazing}]
        add: {parent: {hydration: -4}}

  # 棘の刺さる小獣。**押し手が2つの量を取る**（雨で裂ける棘）ので、押される周期はその数だけ
  # 場合を持つ——どの場合も自分の条件つきは数えないので、進む条件は押し手が傍に在ることだけ。
  hare:
    tags: [item]
    props:
      blood:
        value: 100
        range: {min: 0, max: 100}
        on_min: {destroy: self}
    slots:
      barbs:
        cell_count: 2
        cell: {accept: {tag: barb}}

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

  # 膿むだけの傷（injuries.yamlのopen_wound）。**血には触れない**——押し上げるのは宿主の全身の菌
  # だけで、そこから先の症状も死に方も知らない。上のgashと別の枠へ入れるのは、直に血を奪う道が
  # 混ざると、押した先の段を辿った道だけを見られないから。
  suppurating_cut:
    tags: [injury, suppurating]
    props:
      infection:
        value: 0
        range: {min: 0, max: 100}
        stages:
          - {name: clean}
          - {name: septic, min: 80}
        passives:
          - add: {self: {infection: 0.25}}
    passives:
      - conditions: [{prop: infection, in_stage: septic}]
        add: {parent: {pathogen: 0.35}}

  # 傷から全身へ回られる獣（animals.yamlのbeast）。**傷が動かすのは菌だけ**で、血を削るのは菌が
  # septicemicへ届いて初めて開く、獣自身の増減（8.2節）になる。
  sow:
    tags: [item]
    props:
      pathogen:
        value: 0
        range: {min: 0, max: 9}
        stages:
          - name: sterile
            passives:
              # 菌の居ない体は活力が戻る。**生まれた時点で入っている段**なので、開けたのは押し手では
              # ない——辿ると、傷が傍に在って初めて活力が戻ることになる。
              - add: {self: {vitality: 1}}
          - name: feverish
            min: 5
            passives:
              # 熱で余計に渇く（characters/player_character.yamlのpathogen）。**押し手はこの段を
              # 開けたそばから上へ押し抜けさせる**ので、効くのは下のsepticemicへ入るまでの間だけ。
              - add: {self: {thirst: -10}}
          - name: septicemic
            min: 7
            passives:
              - add: {self: {blood: -40, fever: 1}}
              # 囲いに閉じ込められている間だけ余計に渇く（animals.yamlのpathogen）。段のほかにも
              # 縛りがあるので、押されている間に成立するかは定義からは決まらない。
              - conditions: [{in_slot: catch}]
                add: {self: {hydration: -2}}
      vitality: {value: 0, range: {min: 0, max: 100}}
      thirst:
        value: 100
        range: {min: 0, max: 100}
        on_min: {destroy: self}
      hydration:
        value: 336
        range: {min: 0, max: 336}
        on_min: {destroy: self}
      # 菌が開けた段が、さらに開ける段。
      fever:
        value: 0
        range: {min: 0, max: 40}
        stages:
          - {name: none}
          - name: raging
            min: 20
            passives:
              - add: {self: {stamina: -10}}
      stamina:
        value: 100
        range: {min: 0, max: 100}
        on_min: {destroy: self}
      blood:
        value: 4600
        range: {min: 0, max: 4600}
        on_min:
          destroy: self
          spawn: {object: sow_carcass}
    slots:
      injuries:
        cell_count: 4
        cell: {accept: {tag: suppurating}}

  sow_carcass:
    tags: [item]

  # 血だけを流し続ける傷（injuries.yamlのbite_wound）。**押し下げる押し手**——奪うのは宿主の血だけ
  # で、そこから先の弱り方は知らない。押し上げる傷（suppurating_cut）と別の枠へ入れるのは、上へ
  # 開く道が混ざると、押し下げて開いた段だけを見られないから。
  seeping_bite:
    tags: [seeping]
    passives:
      - add: {parent: {blood: -10}}

  # 血を失って弱る獣（characters/player_character.yamlのbloodの段）。**血の段は上からしか入らない**
  # ——傷が押し下げて初めてhemorrhagingが開き、そこで削られる体力が尽きて倒れる。
  #
  # 血に個体差を持たせてあるのは、**段から遠いロールが向きで裏返る**のを見るため（6.2節）。押し下げ
  # られる値では、重く出た個体のほうが段から遠い。
  doe:
    tags: [item]
    props:
      blood:
        value: {min: 3000, max: 4000}
        range: {min: 0, max: 4000}
        stages:
          - {name: exsanguinated}
          - name: hemorrhaging
            min: 1000
            passives:
              # 気が遠のく。開いた段の中で尽きるので、押し切られる前に倒れる。
              - add: {self: {stamina: -10}}
              # 体そのものの弱り。**開いた段を割って抜けるほうが先**なので、この-0.5では尽きない。
              - add: {self: {vitality: -0.5}}
          - {name: replete, min: 2000}
      stamina:
        value: 100
        range: {min: 0, max: 100}
        on_min: {destroy: self}
      vitality:
        value: 100
        range: {min: 0, max: 100}
        on_min: {destroy: self}
      # 血が減っている間ずっと痛む。**「その段以上」へ上から入るということは起こらない**——生まれた
      # 時点でhemorrhagingより上に在る値は、既にこの条件を成立させている。
      pain:
        value: 0
        range: {min: 0, max: 40}
    passives:
      - conditions: [{prop: blood, in_stage_or_above: hemorrhaging}]
        add: {self: {pain: 1}}
    slots:
      injuries:
        cell_count: 4
        cell: {accept: {tag: seeping}}
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

  it('条件つきのon_maxは、満たさない回へ倒れる既定のクランプではなく著者の効果で読む', () => {
    // 排他な2つを両方渡すと、読み下す側は宣言順に直積で畳む＝順に起こるものとして扱うので、後に来る
    // クランプ（上端へ置き直す）が著者の書き戻しに勝ち、戻り0＝一度きりと読まれる。戻り量は上端8から
    // 書き戻し先の3までの5で、+1/tickなので5 tickごとに回る。
    expect(cycleOf('lookout', 'watch_progress')).toMatchObject([
      { minutes: 5 * 15, shortestMinutes: 5 * 15, repeats: true },
    ]);
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

  /** その型が隣の物（既定では親）へ与える押し手のうち、そのプロパティを動かすもの。 */
  function externalDeltasOf(objectName: string, propertyName: string, root: 'parent' | 'child' = 'parent') {
    const propertyGlobalId = codex.propertyNames.getId(propertyName);
    return externalTickDeltasOf(defOf(objectName), root)
      .filter((delta) => delta.propertyGlobalId === propertyGlobalId)
      .map(({ amounts, ticksUntilStart, ticksUntilStop }) => ({
        amounts,
        ticksUntilStart,
        ticksUntilStop,
      }));
  }

  it('効いている間の重ならない押し手は、束ねずに別々に並べる', () => {
    // 出血は負った瞬間から4 tickだけ、膿んだ傷が奪う分は320 tick後から止まらずに効く。重なる時が
    // 無いので足し合わせた-55は起こらず、1つの幅に束ねると最も遅い-15と「止まらない」がひと組に
    // なって、どちらの経路も持っていない押し手ができる。
    expect(externalDeltasOf('gash', 'blood')).toEqual([
      { amounts: [-15], ticksUntilStart: 0, ticksUntilStop: 4 },
      { amounts: [-40], ticksUntilStart: 320, ticksUntilStop: undefined },
    ]);
  });

  it('効き始めの違う押し手も、束ねずに別々に並べる', () => {
    // 段が上がるほど速く奪うが、速い側は遅い側より後からしか効かない。1つの幅に束ねると
    // 「膿み始めた時点で-2」という、どちらの段も持っていない押し手ができる。
    // 0から+0.25/tickなので、festering（40）へは160 tick、septic（80）へは320 tick。
    expect(externalDeltasOf('gash', 'hydration')).toEqual([
      { amounts: [-1], ticksUntilStart: 160, ticksUntilStop: 320 },
      { amounts: [-2], ticksUntilStart: 320, ticksUntilStop: undefined },
    ]);
  });

  it('段を上へ抜けて止まるのは、ちょうどその段で縛られた押し手だけ', () => {
    // 見ている値が尽きるまでしか数えないと、増える一方のinfectionでは尽きる時が来ず、festeringの
    // 間だけ効く-1が「止まらない」として残る。**「その段以上」は上へ抜けても成立したまま**なので、
    // 同じに扱うと焦げ切った傷が水を奪うのを止めてしまう。効き始めはどちらも名指した段の下端（40）。
    expect(externalDeltasOf('burn', 'hydration')).toEqual([
      { amounts: [-1], ticksUntilStart: 160, ticksUntilStop: undefined },
    ]);
  });

  it('段の下端を割って効かなくなる押し手は、値が尽きるより先に止まる', () => {
    // 冷めていく熱を段で見ている押し手は、値が0まで尽きるより先に段を出る。段の条件が見ている値を
    // 「尽きるまで」でも数えると、100が-5で尽きる20 tickになり、暖められる時間が倍を超えて延びる。
    // 100から-5/tickなので、hotの下端60を割るのは9 tick目（8 tick後はちょうど60＝まだhot）。
    // **「その段以上」も下端は同じ**——上へ抜けないことと、下へ抜けないことは別。
    expect(externalDeltasOf('hot_stone', 'ambient_temperature')).toEqual([
      { amounts: [2], ticksUntilStart: 0, ticksUntilStop: 9 },
    ]);
    expect(externalDeltasOf('wrapped_stone', 'ambient_temperature')).toEqual([
      { amounts: [2], ticksUntilStart: 0, ticksUntilStop: 9 },
    ]);
  });

  it('受け皿の段に居ることを求める押し手は、値が下端まで落ちても止まらない', () => {
    // 受け皿（6.4節）には下端が無いので、下へ抜けようが無い。段の条件が見ている値を「尽きるまで」でも
    // 数えると、巡りが0へ落ちる30 tickで止まるものとして数えられる。
    expect(externalDeltasOf('frostbite', 'warmth')).toEqual([
      { amounts: [-2], ticksUntilStart: 0, ticksUntilStop: undefined },
    ]);
  });

  it('生まれた時点で段の下端より下に在る値は、下へ抜けたことにならない', () => {
    // 炉の火力は段の下に置かれた増減で育つので、読める増減は雨で削られる分だけ。生まれた時点の
    // 火力（0）を「coalsの下端（5）を割った」と読むと、焼く押し手が生まれた瞬間に止まったことに
    // なって消える——その段へ入るのはこれからで、いつ入るかは効き始めの側が答える。
    expect(externalDeltasOf('firepit', 'cooking_progress', 'child')).toEqual([
      { amounts: [1], ticksUntilStart: 0, ticksUntilStop: undefined },
    ]);
  });

  it('同時に効く押し手は足し合わせる', () => {
    // 常時にじむ-1と、雨の間だけ裂ける-4は同時に起こる。別々の押し手として並べると、雨だけが
    // 効いている-4という起こらない速さが数に入る。実際に起こるのは-1と-5。
    expect(externalDeltasOf('thorn', 'blood')).toEqual([
      { amounts: [-1, -5], ticksUntilStart: 0, ticksUntilStop: undefined },
    ]);
  });

  it('段で入れ替わる押し手は、止まるまでが速さで変わっても1つに収まる', () => {
    // どちらも毒が尽きる20 tickで止まり、同時には効かない。止まるまでを動かせる総量で持つと
    // 60mLと180mLの別々の押し手に見え、同時に起こりえない段の代替が2本の仕掛けとして数えられる。
    expect(externalDeltasOf('sting', 'blood')).toEqual([
      { amounts: [-3, -9], ticksUntilStart: 0, ticksUntilStop: 20 },
    ]);
  });

  it('同じ排他の対は、自分の増減の側でも押し手の側でも同じ組み合わせになる', () => {
    // 火勢の段は同時に2つを取れないので、燃料が尽きるまでは-1で100 tick・-4で25 tick、持ち主から
    // 水を奪うのも-1と-4。両側が同じ数え上げを呼ばないと、片方だけが2つを足した-5を持つ。
    expect(cycleOf('torch', 'fuel')).toMatchObject([
      { minutes: 100 * 15, shortestMinutes: 25 * 15, destroysSelf: true },
    ]);
    expect(externalDeltasOf('torch', 'hydration')).toEqual([
      { amounts: [-1, -4], ticksUntilStart: 0, ticksUntilStop: undefined },
    ]);
  });

  it('押し手に押される周期が要るのは、押し手が傍に在ることだけ', () => {
    // 押し手は取りうる量のぶんだけ場合を作り、そのどれもが自分の条件つきを数えない。畳まないと
    // 「条件を1つも要らない」が量の数だけ並ぶので、棘（-1と-5）では2本になっていた。
    const external = externalTickDeltasOn(defOf('hare'), [...codex.objects]);

    expect(
      rangeCyclesOf(defOf('hare'), undefined, external)
        .filter((cycle) => cycle.drivenBy === defOf('thorn').globalId)
        .map((cycle) => cycle.gatedBy),
    ).toEqual([[[]]]);
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

  /** その型の、そのプロパティが持つ周期のうち、外から押されて回るもの。 */
  function drivenCyclesOf(objectName: string, propertyName: string) {
    const def = defOf(objectName);
    return rangeCyclesOf(def, undefined, externalTickDeltasOn(def, [...codex.objects])).filter(
      (cycle) =>
        cycle.drivenBy !== undefined && codex.propertyNames.getName(cycle.propertyGlobalId) === propertyName,
    );
  }

  it('押した先で開く段が動かす、相手自身の別のプロパティも押し手が動かす', () => {
    // 傷が動かすのは菌だけで、血には一切触れない。押し手が直に動かす分しか辿らないと、罠に掛けて
    // 傷を負わせ、放っておけば死体になる道が丸ごと消える。傷がsepticへ届くまで320 tick、そこから
    // 菌が0.35でsepticemic（7）へ20 tick、開いた-40で4,600mLが尽きるまで115 tick。
    expect(drivenCyclesOf('sow', 'blood')).toMatchObject([
      {
        minutes: (320 + 20 + 115) * 15,
        destroysSelf: true,
        drivenBy: defOf('suppurating_cut').globalId,
      },
    ]);
  });

  it('辿るのは1段だけで、開いた段が開ける次の段までは辿らない', () => {
    // 菌はsepticemicで熱も押し上げ、熱はragingで体力を削る。2段目まで辿ると、傷が傍に在るだけで
    // 体力の尽きる周期が立つ——その段が開き続けているかを決めるのは押し手ではなく相手自身の値で、
    // その動きは段で切り替わる増減を含む（tickAmountsOfが数えていない）。
    expect(drivenCyclesOf('sow', 'stamina')).toEqual([]);
  });

  it('押し手が開けた段は、同じ押し手がそのまま上へ抜けさせる', () => {
    // 熱で渇く分はfeverish（5〜7）に居る間だけ効くが、押し上げているのは止まらない押し手なので、
    // 開いた5 tick後にはsepticemicへ抜けて止まる。押し手が止まるまでだけを引き継ぐと、この-10が
    // 永久に効くものとして数えられ、渇きで死ぬ周期が立つ。
    expect(drivenCyclesOf('sow', 'thirst')).toEqual([]);
  });

  it('段のほかにも縛りのある増減は、押し手が開けたものとして数えない', () => {
    // 囲いに居る間だけ効く渇きは、押されている間に成立するとは限らない（押されている間は自分の
    // 条件つきを数えない、totalsWithDriverと同じ理由）。
    expect(drivenCyclesOf('sow', 'hydration')).toEqual([]);
  });

  it('生まれた時点で入っている段が動かす分は、押し手が開けたものではない', () => {
    // 菌の居ない体が活力を戻すのは、傷が在ろうと無かろうと起こる。押し手に付けると、傷が傍に
    // 在って初めて活力が戻る周期になる。
    expect(drivenCyclesOf('sow', 'vitality')).toEqual([]);
  });

  it('押し下げる押し手が開ける段も辿る', () => {
    // 血を流す傷は宿主の血を奪うだけで、気の遠のきには触れない。段は下からしか開かないものとして
    // 数えると、流血で倒れる道が丸ごと消える。上端2,000を割ってhemorrhagingへ入るのは-10で201 tick
    // （段から遠い＝重く出た4,000から数える。2,000へ着いた時点ではまだ段の上）、そこから開いた
    // -10で体力100が10 tick。軽く出た3,000を採ると101 tickになり、押し手を控えめに数えるという
    // 約束が押す向きによって破れる。
    expect(drivenCyclesOf('doe', 'stamina')).toMatchObject([
      { minutes: (201 + 10) * 15, destroysSelf: true, drivenBy: defOf('seeping_bite').globalId },
    ]);
  });

  it('押し手が開けた段は、同じ押し手がそのまま下へ割って抜けさせる', () => {
    // 段の下端1,000を割るのは-10で301 tickなので、開いている間は100 tickしか無い。-0.5で100を
    // 削り切るには200 tick要るので、この周期は立たない。上へ抜ける場合しか止まらないことにすると、
    // 押し切られた後も削り続けるものとして数えられ、弱って倒れる周期が立つ。
    expect(drivenCyclesOf('doe', 'vitality')).toEqual([]);
  });

  it('「その段以上」へ上から入ることは起こらない', () => {
    // 血が減っている間ずっと痛む分は、生まれた時点（4,000）で既に成立している——押し下げる押し手は
    // その条件を開けていない。上端を割った時点で開いたことにすると、傷が傍に在って初めて痛み
    // 始めることになる。
    expect(drivenCyclesOf('doe', 'pain')).toEqual([]);
  });
});

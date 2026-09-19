import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { characterDefNames } from '../../src/domain/generation/NewGame';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import { TICKS_PER_DAY } from '../../src/domain/worldTime';

/**
 * bedding.yamlの寝床とハンモックを、実ファイルの定義だけで検証する。
 *
 * 見たいのは、**差した部品が回復量を動かすこと**（docs/world/Bedding.md 4節。段ごとのブロックが
 * 重なる形）と、**その差が頭打ちに呑まれずに観測できること**（同節。一晩ぶんが体力の上限を下回る
 * 位置に置いてある）、**寝ている間だけ寒さの入口が段のぶん下がること**（docs/world/Bedding.md 4.2節）、
 * **支点を持たない土地ではハンモックが寝床にならないこと**（同6.1節）、それに**据えたハンモックを
 * そのまま次の土地へ持ち出しても、傷んだぶんが戻らないこと**（同6.2節）。
 *
 * **部品を差す前後を同じ物差しで測る。** 差しても量が動かない書き方——上積みのブロックを落とす・
 * ゲートが枠の中身を見ない——なら、2つの数が並ぶ。
 */

// describe.eachへ渡すため、beforeAllを待たずに読み込み時から引ける形で持つ（組み上げは使い回される）。
const characters = characterDefNames(bundledCodex());

describe('bedding.yamlの寝床とハンモック', () => {
  let codex: WorldCodex;
  let staminaId: PropertyGlobalId;
  let wakefulnessId: PropertyGlobalId;
  let warmthId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    staminaId = codex.propertyNames.getId('stamina');
    wakefulnessId = codex.propertyNames.getId('wakefulness');
    warmthId = codex.propertyNames.getId('warmth');
  });

  /** その土地にプレイヤーが立っている世界。 */
  function open(landName: string, characterName: string = SAMPLE_CHARACTER) {
    const session = new WorldSession(codex);
    const world = session.createObject(codex.objectNames.getId('world'));
    session.adoptWorld(new World(world));
    const land = spawnInto(session, landName, world, 'locations');
    const player = spawnInto(session, characterName, land, 'characters');
    makeBrightEnoughForAnyAction(player, codex);
    return { session, world, land, player };
  }

  function spawnInto(
    session: WorldSession,
    objectName: string,
    parent: WorldObject,
    slotName: string,
  ): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /**
   * その寝床でその休息を1回取ったときに、実際に戻った体力と眠気。
   *
   * **空身・無痛の個体で測る**ので、受け取る量は宣言そのまま（charactersYaml.test.tsのtakeRestと
   * 同じ足場）。眠気だけは誰も担がなくても-1/tickで減るので、経過ぶんを差し引く。頭打ちに掛からない
   * よう、体力は空から、眠気は経過ぶん＋1だけ残した位置から始める。
   */
  function restOn(
    bed: WorldObject,
    player: WorldObject,
    actionName: string,
  ): { stamina: number; wakefulness: number } {
    const SPARE = 1;
    const action = () => bed.tryGetAction(actionName, player);
    const spent = (action()?.executionMinutes() ?? 0) / 15;

    player.getProperty(staminaId).setNumber(0);
    player.getProperty(wakefulnessId).setNumber(spent + SPARE);

    expect(action()?.tryExecute(), actionName).toBe(true);

    return {
      stamina: player.getProperty(staminaId).number,
      wakefulness: player.getProperty(wakefulnessId).number - spent - SPARE,
    };
  }

  /** その休息が動かした tick 数。 */
  function ticksOf(bed: WorldObject, player: WorldObject, actionName: string): number {
    return (bed.tryGetAction(actionName, player)?.executionMinutes() ?? 0) / 15;
  }

  /**
   * その休息だけで眠気の釣り合いを取る1日のうち、眠っているほうの tick 数
   * （docs/world/Bedding.md 4.1節。地面の仮眠だけなら8時間、寝床の睡眠なら6時間）。
   *
   * **測った正味から出す。** 起きている間は -1/tick なので、眠るぶんの正味との比がそのまま割り振りに
   * なる——地面の8時間・寝床の6時間をここへ書き写すと、宣言を動かしたときに古い割り振りのまま通る。
   */
  function ticksAsleepPerDay(netWakefulness: number, ticks: number): number {
    return TICKS_PER_DAY / (netWakefulness / ticks + 1);
  }

  /** 砂浜に据えた寝床。部品を差すなら`withFrame`。 */
  function bedOnBeach(withFrame: boolean, characterName: string = SAMPLE_CHARACTER) {
    const { session, land, player } = open('sandy_beach', characterName);
    const bed = spawnInto(session, 'bed', land, 'fixtures');
    if (withFrame) spawnInto(session, 'bed_frame', bed, 'structure');
    return { bed, player };
  }

  it('骨組みを差すと、同じ睡眠で戻る体力が増える', () => {
    // docs/world/Bedding.md 4節の段2。上積みのブロックが、枠の中身を見て重なる。
    //
    // **測るのは通しの睡眠のほう。** 段の差がいちばん効くのがここで、一晩ぶんが体力の上限を越える
    // 位置にあると、空から測っても2つの数が上限で並んでしまう。
    const bare = bedOnBeach(false);
    const framed = bedOnBeach(true);

    expect(restOn(framed.bed, framed.player, 'sleep').stamina).toBeGreaterThan(
      restOn(bare.bed, bare.player, 'sleep').stamina,
    );
  });

  describe.each(characters)('%s の体力に対して', (characterName) => {
    /** そのキャラクタの体力の上限。 */
    function staminaMax(): number {
      const range = codex.objects
        .get(codex.objectNames.getId(characterName))
        .tryGetPropertyDef(staminaId)?.range;
      if (range === undefined) throw new Error(`'${characterName}' の体力がrangeを持ちません。`);
      return range.max;
    }

    it.each([
      ['敷物だけの寝床', () => bedOnBeach(false, characterName)],
      ['骨組みを差した寝台', () => bedOnBeach(true, characterName)],
    ])('%s は、通しで眠っても体力を満タンにしない', (_label, set) => {
      // docs/world/Bedding.md 4節。**段の差が観測できるのは、一晩ぶんが上限を下回るときだけ**
      // ——越えていると、空から通しで眠れば段によらず満タンになり、骨組みを差した意味が消える。
      const { bed, player } = set();

      expect(restOn(bed, player, 'sleep').stamina).toBeLessThan(staminaMax());
    });

    it('据えたハンモックも、通しで眠って体力を満タンにしない', () => {
      const { session, land, player } = open('forest', characterName);
      const slung = spawnInto(session, 'hammock', land, 'fixtures');

      expect(restOn(slung, player, 'sleep').stamina).toBeLessThan(staminaMax());
    });
  });

  it('骨組みを差した一晩が、重い荷を担ぎ通した1日ぶんとちょうど釣り合う', () => {
    // docs/world/Characters.md 荷重の効き方節。**削る側を動かさずに回復の側を置いた**位置なので、
    // load の段の削りと寝床の宣言のどちらを動かしても、ここが落ちる。
    const framed = bedOnBeach(true);
    const sleepTicks = ticksOf(framed.bed, framed.player, 'sleep');
    const restored = restOn(framed.bed, framed.player, 'sleep').stamina;

    expect(restored).toBe(heavyDrainPerTick() * (TICKS_PER_DAY - sleepTicks));
  });

  it('敷物を敷けば、1日に戻る体力が地面の上を上回る', () => {
    // docs/world/Bedding.md 4節。**1時間あたりで上回るだけでは足りない**——寝床の上は眠る時間が
    // 2時間短いので、割が地面の 2/3 まで下がると1日の合計で逆転し、敷物を敷くほど損になる。
    const { bed, player } = bedOnBeach(false);

    expect(perDay(bed, player, 'sleep')).toBeGreaterThan(perDay(player, player, 'nap'));
  });

  /** その休息だけで夜を回したときに、1日で戻る体力。休息の主は寝床でもキャラクタ自身でもよい。 */
  function perDay(host: WorldObject, player: WorldObject, actionName: string): number {
    const ticks = ticksOf(host, player, actionName);
    const rest = restOn(host, player, actionName);
    return (rest.stamina / ticks) * ticksAsleepPerDay(rest.wakefulness, ticks);
  }

  /** `heavy` を担いでいる間に、1 tickで削られる体力（characters/medic.yaml の load の段）。 */
  function heavyDrainPerTick(): number {
    const { session, player } = open('sandy_beach');
    const hand = player.getSlot(codex.slotNames.getId('hand'));
    // 石は1つ1000gで束ねられるので枠は1つで足りる。医師のheavyは16500gから。
    for (let i = 0; i < 17; i++)
      expect(
        session.createObject(codex.objectNames.getId('stone')).moveToSlotOrRejection(hand),
      ).toBeUndefined();
    expect(player.getProperty(codex.propertyNames.getId('load')).isInStage('heavy')).toBe(true);

    const before = player.getProperty(staminaId).number;
    player.tick();
    return before - player.getProperty(staminaId).number;
  }

  it('骨組みを差しても、戻る眠気は変わらない', () => {
    // 同4節。**眠気が戻る量は段によらない**——18時間起きて6時間眠るという釣り合いを、寝床の段が
    // 動かさないため。
    const bare = bedOnBeach(false);
    const framed = bedOnBeach(true);

    expect(restOn(framed.bed, framed.player, 'sleep').wakefulness).toBe(
      restOn(bare.bed, bare.player, 'sleep').wakefulness,
    );
  });

  it('寝床の上では、仮眠2回と睡眠1回がちょうど同じだけ戻る', () => {
    // 同4節。**段ごとに1つの定数なので、寝床のぶんは長さに正比例する**——キャラクタ側が持つ
    // 「まとめて休むほど得」が効くのは地面の上だけ（charactersYaml.test.tsの単調性）。
    const napped = bedOnBeach(false);
    const slept = bedOnBeach(false);
    const nap = restOn(napped.bed, napped.player, 'nap');
    const sleep = restOn(slept.bed, slept.player, 'sleep');

    expect(nap.wakefulness * 2).toBe(sleep.wakefulness);
    expect(nap.stamina * 2).toBe(sleep.stamina);
  });

  it('据えたハンモックは、骨組みを差した寝台と同じだけ戻す', () => {
    // 同6節。**寝台の上位ではなく別系統**なので、回復量では上に立たない。差は寝床になる場所
    // （支点が要る）・伸ばしろ（詰め物を足す先が無い）・持ち出し（そのまま次の土地へ運べる）のほう。
    const hammock = open('forest');
    const framed = bedOnBeach(true);
    const slung = spawnInto(hammock.session, 'hammock', hammock.land, 'fixtures');

    expect(restOn(slung, hammock.player, 'nap').stamina).toBe(
      restOn(framed.bed, framed.player, 'nap').stamina,
    );
  });

  describe('寝ている間だけ、寒さの入口を押し下げる（docs/world/Bedding.md 4.2節）', () => {
    /** 何も着ていない素の寒さの入口（℃）と、いちばん深い一着の名前と押し下げ（℃）。 */
    let bareChillPoint: number;
    let deepestGarment: { readonly name: string; readonly drop: number };

    beforeAll(() => {
      // **どちらも書き写さずに実ファイルから引く。** 素の入口は player_character.yaml、一着ごとの
      // 押し下げは clothing.yaml のものなので、そちらを動かせば下の各テストが落ちる——4.2節が
      // 「いちばん深い一着より浅い」と衣類を基準に深さを決めているため、基準の側が動けば主張も動く。
      const probe = new WorldSession(codex);
      const chillPointId = codex.propertyNames.getId('chill_point');
      const equippableId = codex.tagNames.getId('equippable');

      /** その一着を着たキャラクタの寒さの入口（℃）。何も着せないなら素の入口。 */
      const thresholdWearing = (garmentName?: string): number => {
        const wearer = probe.createObject(codex.objectNames.getId(SAMPLE_CHARACTER));
        if (garmentName !== undefined)
          expect(
            probe
              .createObject(codex.objectNames.getId(garmentName))
              .moveToSlotOrRejection(wearer.getSlot(codex.vocabulary.world.equipmentSlotId)),
            garmentName,
          ).toBeUndefined();
        return wearer.getProperty(chillPointId).getEffectiveValue();
      };

      bareChillPoint = thresholdWearing();
      deepestGarment = [...codex.objects]
        .filter((objectDef) => !codex.isGenerated(objectDef) && objectDef.tags.includes(equippableId))
        .map((objectDef) => ({
          name: objectDef.name,
          drop: bareChillPoint - thresholdWearing(objectDef.name),
        }))
        .reduce((best, entry) => (entry.drop > best.drop ? entry : best));
    });

    /** 眠る先の段——据える設置物と、差し込む部品（差さないならundefined）、押し下げ（℃）。 */
    interface Tier {
      readonly label: string;
      readonly fixture: string;
      readonly part: string | undefined;
      readonly drop: number;
    }

    /**
     * 段ごとの押し下げ。**1℃は体の下の乾いた層、もう1℃は地面から離れること**なので、層だけの敷物と
     * 離れるだけの据えたハンモックが並び、両方を持つ寝台だけが2℃になる（docs/world/Bedding.md 4.2節）。
     */
    const TIERS: readonly Tier[] = [
      { label: '敷物だけの寝床', fixture: 'bed', part: undefined, drop: 1 },
      { label: '骨組みを差した寝台', fixture: 'bed', part: 'bed_frame', drop: 2 },
      { label: '据えたハンモック', fixture: 'hammock', part: undefined, drop: 1 },
    ];

    /** その段の寝床を砂浜に据える。砂浜は海抜ぶんの差を持たないので、気温は空そのまま。 */
    function layDown(tier: Tier) {
      const { session, world, land, player } = open('sandy_beach');
      const bed = spawnInto(session, tier.fixture, land, 'fixtures');
      if (tier.part !== undefined) spawnInto(session, tier.part, bed, 'structure');
      return { session, world, bed, player };
    }

    /** いちばん深い一着を着せる。寝床の押し下げはこれと加算で重なる（docs/world/Bedding.md 4.2節）。 */
    function wearDeepestGarment(session: WorldSession, player: WorldObject): void {
      const garment = session.createObject(codex.objectNames.getId(deepestGarment.name));
      expect(
        garment.moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.equipmentSlotId)),
        deepestGarment.name,
      ).toBeUndefined();
    }

    /** その段の寝床で眠っている間、押し下げた先とちょうど釣り合う気温（℃）。 */
    function balancedTemperature(tier: Tier): number {
      return bareChillPoint - deepestGarment.drop - tier.drop;
    }

    /**
     * 気温へ寄与する段を、通しの睡眠を終えるまで乗り換わらない位置へ置く（core.yaml）。**跨ぐと
     * 眠っている途中で気温が動いて、据えた大小が入れ替わる。**
     *
     * 動く段は2つ。**日射の帯**（`ambient_brightness`）は夜が18時から翌6時まで続くので、20時から
     * 6時間眠っても出ない。**季節の貯水池**（`thermal_level`）は`calm`で毎tick下がり、既定値から
     * 睡眠2回ぶんで`mild`の下限を割るので、**下限へ張り付ける**——`cool`の底なら減っても
     * クランプで動かず、乾季の向きへ振れても1季節ぶん登るまで帯を出ない。
     */
    function setNightSky(world: WorldObject): void {
      world.getProperty(codex.propertyNames.getId('hour')).setNumber(20);
      const thermalLevel = world.getProperty(codex.propertyNames.getId('thermal_level'));
      thermalLevel.setNumber(thermalLevel.def.range?.min ?? 0);
      expect(
        world.getProperty(codex.propertyNames.getId('ambient_brightness')).isInStage('dark'),
        '20時の空が夜の帯にある',
      ).toBe(true);
    }

    /**
     * 空の気温をその摂氏へ据える。**実体値ではなく実効値で合わせる**——worldのambient_temperatureには
     * 日射と季節の段がmodifyで乗る（core.yaml）ので、書いた値がそのまま気温になるとは限らない。
     *
     * **合わせるのは据えた時点の実効値だけ**なので、寄与する段が乗り換わらないことは`setNightSky`が
     * 先に担保する。
     */
    function setSkyTemperature(world: WorldObject, celsius: number): void {
      setNightSky(world);
      const temperature = world.getProperty(codex.propertyNames.getId('ambient_temperature'));
      temperature.setNumber(celsius);
      temperature.setNumber(celsius - (temperature.getEffectiveValue() - celsius));
      expect(temperature.getEffectiveValue(), `空を${celsius}℃にする`).toBe(celsius);
    }

    /** 満タンだと戻りが頭打ちに掛かるので、熱を半分にしてから測る。 */
    function halveWarmth(player: WorldObject): number {
      const warmth = player.getProperty(warmthId);
      warmth.setNumber((warmth.def.range?.max ?? 0) / 2);
      return warmth.number;
    }

    /**
     * その休息を1回取る間に動いた熱（kcal）。押し下げが効くのはこの間だけ。
     *
     * **経過の前後で気温が動いていないことを確かめる。** 動いていれば、測った熱は「据えた気温での
     * 増減」ではなく途中で気温が変わったものの混ざりもので、釣り合いを見たことにならない
     * （`setNightSky` が担保している側）。
     */
    function warmthWhileResting(
      world: WorldObject,
      bed: WorldObject,
      player: WorldObject,
      actionName: string,
    ): number {
      const temperature = world.getProperty(codex.propertyNames.getId('ambient_temperature'));
      const celsius = temperature.getEffectiveValue();
      const before = halveWarmth(player);

      expect(bed.tryGetAction(actionName, player)?.tryExecute(), actionName).toBe(true);

      expect(temperature.getEffectiveValue(), `${actionName}の間、空は${celsius}℃のまま`).toBe(celsius);

      return player.getProperty(warmthId).number - before;
    }

    /** 眠らずに1 tick置いたときに動いた熱（kcal）。 */
    function warmthWhileAwake(player: WorldObject): number {
      const before = halveWarmth(player);

      player.tick();

      return player.getProperty(warmthId).number - before;
    }

    it.each(TIERS)('$label で眠っている間だけ、寒さの入口が$drop℃下がる', (tier) => {
      const { session, world, bed, player } = layDown(tier);
      wearDeepestGarment(session, player);
      const balanced = balancedTemperature(tier);

      // 起きている間は寝床の押し下げが乗らないので、押し下げた先の気温で削られる。**据えた寝床の
      // 傍に立っているだけでは効かない**ことが、ここで分かれる。
      setSkyTemperature(world, balanced);
      expect(warmthWhileAwake(player), `${balanced}℃では起きていると削られる`).toBeLessThan(0);

      // 眠っている間は乗るので、ちょうど釣り合って戻る（境目以上は戻り、VitalsSystem.md 8.4節）。
      expect(warmthWhileResting(world, bed, player, 'sleep'), `${balanced}℃では眠れば戻る`).toBeGreaterThan(
        0,
      );

      // 1℃下は押し下げた先の下なので、眠っても削られる。深さを増やせばここが落ちる。
      setSkyTemperature(world, balanced - 1);
      expect(
        warmthWhileResting(world, bed, player, 'sleep'),
        `${balanced - 1}℃では眠っても削られる`,
      ).toBeLessThan(0);
    });

    it.each(TIERS)('$label は、仮眠でも通しの睡眠と同じだけ押し下げる', (tier) => {
      // docs/world/Bedding.md 4.2節。**押し下げは境目への寄与なので、長さに比例しない**——同じ夜で
      // 仮眠と睡眠のどちらを取っても、削られるか戻るかは同じに決まる。
      //
      // **両側を見る。** 釣り合う気温で戻ることだけを見ると、仮眠の側を深くしても落ちない。
      const { session, world, bed, player } = layDown(tier);
      wearDeepestGarment(session, player);
      const balanced = balancedTemperature(tier);

      setSkyTemperature(world, balanced);
      expect(warmthWhileResting(world, bed, player, 'nap'), `${balanced}℃では戻る`).toBeGreaterThan(0);

      setSkyTemperature(world, balanced - 1);
      expect(warmthWhileResting(world, bed, player, 'nap'), `${balanced - 1}℃では削られる`).toBeLessThan(0);
    });

    it('いちばん深い段でも、いちばん深い一着より浅い', () => {
      // 同4.2節。**南国の寝床で効く分の大半は保温ではない**（同2節）ので、寝床は保温の主役に
      // ならない位置に留める——衣類の側を寝床より浅くすれば、ここが落ちる。
      const deepestTier = TIERS.reduce((best, tier) => (tier.drop > best.drop ? tier : best));

      expect(deepestTier.drop, deepestTier.label).toBeLessThan(deepestGarment.drop);
    });

    it.each(TIERS)('$label でも、一着も持たずに空がいちばん冷える夜は越せない', (tier) => {
      // 同4.2節。**押し下げが浅いのは、南国の寝床で効く分の大半が保温ではないため**（同2節）
      // ——寝床は衣類や火の代わりにはならず、その上へ段のぶんを足すだけ。
      const { world, bed, player } = layDown(tier);

      // 涼しい季節の夜。**気温は書き写さずにcore.yamlから引く**ので、季節や日射の寄与を動かせば
      // ここを読む側が落ちる。
      setNightSky(world);

      expect(warmthWhileResting(world, bed, player, 'sleep')).toBeLessThan(0);
    });
  });

  it('支点の無い土地では、据えても寝床にならない', () => {
    // 同6.1節。支点は土地の宣言（locations.yamlのhanging_anchor）で、見るのは`ancestor`。
    const { session, land, player } = open('wasteland');
    const hammock = spawnInto(session, 'hammock', land, 'fixtures');

    expect(hammock.tryGetAction('sleep', player)?.unmetRequirement()?.reasonName).toBe('no_anchor');
  });

  it('担いだままでは寝られない', () => {
    // 同6.2節。**寝床になるのは据えている間だけ**——手持ちのまま寝られると、支点のある土地を
    // 探す理由がまるごと消える。
    const { session, player } = open('forest');
    const hammock = spawnInto(session, 'hammock', player, 'hand');

    expect(hammock.tryGetAction('sleep', player)?.unmetRequirement()?.reasonName).toBe('not_slung');
  });

  it('持ち上げて別の土地へ据え直しても、傷んだぶんは戻らない', () => {
    // 同6.2節・8節。**巻いた網と吊った網を型で分けない**のはこのため——分けると据えるたびに
    // 個体が入れ替わり、傷みが消える（GameElementDefinition.md 9.4節）。
    const { session, world, land, player } = open('forest');
    const hammock = spawnInto(session, 'hammock', land, 'fixtures');
    const durabilityId = codex.propertyNames.getId('durability');
    const worn = hammock.getProperty(durabilityId).number - 1;
    hammock.getProperty(durabilityId).setNumber(worn);

    // 担いで、支点のある別の土地へ移り、据え直す。
    expect(hammock.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
    const next = spawnInto(session, 'forest', world, 'locations');
    expect(player.moveToSlotOrRejection(next.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
    expect(hammock.moveToSlotOrRejection(next.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();

    expect(hammock.getProperty(durabilityId).number, '同じ個体のまま運ばれる').toBe(worn);
    expect(hammock.tryGetAction('sleep', player)?.unmetRequirement()).toBeUndefined();
  });
});

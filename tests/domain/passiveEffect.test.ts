import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

// modify/add（GameElementDefinition.md 8節）の実行時集計と、on_max/on_min
// （6.3節、値がRangeの外へ出た際にselfへ適用されるactive内容）に対する自動テスト。
describe('PassiveEffect', () => {
  let sessions: Map<WorldCodex, WorldSession>;

  beforeEach(() => {
    sessions = new Map();
  });

  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
  }

  /** 1つのcodexから作る物は同じセッションに属する（WorldObject.session）。 */
  function spawn(codex: WorldCodex, objectName: string): WorldObject {
    let session = sessions.get(codex);
    if (session === undefined) {
      session = new WorldSession(codex);
      sessions.set(codex, session);
    }
    return session.createObject(codex.objectNames.getId(objectName));
  }

  // ------------------------------------------------------------------
  // modify: 都度導出（getEffectiveValue）。実体値そのものは書き換えない。
  // ------------------------------------------------------------------
  describe('modify: 都度導出（getEffectiveValue）。実体値そのものは書き換えない。', () => {
    it('selfへのmodifyはspawn直後から効く', () => {
      const yaml = `
object_defs:
  torch:
    props:
      brightness:
        value: 1
    passives:
      - modify:
          self:
            brightness: 2
`;
      const codex = load(yaml);
      const brightnessId = codex.propertyNames.getId('brightness');

      const instance = spawn(codex, 'torch');

      expect(instance.tryGetProperty(brightnessId)?.getEffectiveValue() ?? 0).toBe(3);
    });

    it('同じObjectDefから複数spawnしても、プロパティの状態は独立している', () => {
      // PropertyDef.initialValueWithoutRollは全WorldObjectで共有されるテンプレートのため、cloneし忘れると
      // 片方への加算・効果登録がもう片方へ漏れる。2体spawnし、互いに影響しないことを確認する。
      const yaml = `
object_defs:
  torch:
    props:
      brightness:
        value: 1
    passives:
      - add:
          self:
            brightness: 5
`;
      const codex = load(yaml);
      const brightnessId = codex.propertyNames.getId('brightness');

      const first = spawn(codex, 'torch');
      const second = spawn(codex, 'torch');

      first.tryGetProperty(brightnessId)?.add(10);
      first.tick();

      expect(first.tryGetProperty(brightnessId)?.number ?? 0).toBe(16); // 1体目: 1(初期値) + 10(add) + 5(passivesのadd)
      expect(second.tryGetProperty(brightnessId)?.number ?? 0).toBe(1); // 2体目は未タッチのまま初期値のはず
    });

    it('setPropertyは生値だけを差し替え、登録済みのincoming効果は保持される', () => {
      const yaml = `
object_defs:
  torch:
    props:
      brightness:
        value: 1
    passives:
      - modify:
          self:
            brightness: 2
`;
      const codex = load(yaml);
      const brightnessId = codex.propertyNames.getId('brightness');
      const instance = spawn(codex, 'torch');

      instance.getProperty(brightnessId).setNumberWithoutEvents(10);

      expect(instance.tryGetProperty(brightnessId)?.number ?? 0).toBe(10); // 生値だけを差し替える
      expect(instance.tryGetProperty(brightnessId)?.getEffectiveValue() ?? 0).toBe(12); // 既存のincoming（modify）は維持される
    });

    it('in_slot条件付きのparentへのmodifyは、そのスロットに入っている間だけ効く', () => {
      const yaml = `
object_defs:
  character:
    props:
      defense:
        value: 10
    slots:
      equip: {}
      inventory: {}
  armor:
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            defense: 5
`;
      const codex = load(yaml);
      const defenseId = codex.propertyNames.getId('defense');
      const equipSlotId = codex.slotNames.getId('equip');
      const inventorySlotId = codex.slotNames.getId('inventory');

      const characterInstance = spawn(codex, 'character');
      const armorInstance = spawn(codex, 'armor');

      expect(characterInstance.tryGetProperty(defenseId)?.getEffectiveValue() ?? 0).toBe(10); // 装備前はボーナスなし

      expect(armorInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId))).toBeUndefined();
      expect(characterInstance.tryGetProperty(defenseId)?.getEffectiveValue() ?? 0).toBe(15); // equipに入っている間はボーナスが乗る

      expect(armorInstance.moveToSlotOrRejection(characterInstance.getSlot(inventorySlotId))).toBeUndefined();
      expect(characterInstance.tryGetProperty(defenseId)?.getEffectiveValue() ?? 0).toBe(10); // 同じ親のままequip以外へ移すとボーナスが外れる
    });

    it('別の親へ移動すると、元の親へのmodifyは消える', () => {
      const yaml = `
object_defs:
  character:
    props:
      defense:
        value: 10
    slots:
      equip: {}
  chest:
    slots:
      storage: {}
  armor:
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            defense: 5
`;
      const codex = load(yaml);
      const defenseId = codex.propertyNames.getId('defense');
      const equipSlotId = codex.slotNames.getId('equip');
      const storageSlotId = codex.slotNames.getId('storage');

      const characterInstance = spawn(codex, 'character');
      const chestInstance = spawn(codex, 'chest');
      const armorInstance = spawn(codex, 'armor');

      expect(armorInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId))).toBeUndefined();
      expect(characterInstance.tryGetProperty(defenseId)?.getEffectiveValue() ?? 0).toBe(15);

      expect(armorInstance.moveToSlotOrRejection(chestInstance.getSlot(storageSlotId))).toBeUndefined();
      expect(characterInstance.tryGetProperty(defenseId)?.getEffectiveValue() ?? 0).toBe(10); // 別の親へ移動したら元の親からの登録は消える
    });

    it('childへのmodifyは、スロットに入った子自身を条件判定の基準にする', () => {
      const yaml = `
object_defs:
  preserving_container:
    slots:
      storage: {}
    passives:
      - conditions:
          - {in_slot: storage}
        modify:
          child:
            decay_rate: -1
  food:
    props:
      decay_rate:
        value: 3
`;
      const codex = load(yaml);
      const decayRateId = codex.propertyNames.getId('decay_rate');
      const storageSlotId = codex.slotNames.getId('storage');

      const containerInstance = spawn(codex, 'preserving_container');
      const foodInstance = spawn(codex, 'food');

      expect(foodInstance.tryGetProperty(decayRateId)?.getEffectiveValue() ?? 0).toBe(3); // 格納前は影響なし

      expect(foodInstance.moveToSlotOrRejection(containerInstance.getSlot(storageSlotId))).toBeUndefined();
      expect(foodInstance.tryGetProperty(decayRateId)?.getEffectiveValue() ?? 0).toBe(2); // storageに入っている間は腐敗速度が下がる
    });

    it('selfのown_stage条件は、再登録なしでステージの遷移を追跡する', () => {
      const yaml = `
object_defs:
  battery:
    props:
      charge:
        value: 100
        stages:
          - name: full
            min: 50
            passives:
              - modify:
                  self:
                    output: 10
          - name: low
      output:
        value: 5
`;
      const codex = load(yaml);
      const chargeId = codex.propertyNames.getId('charge');
      const outputId = codex.propertyNames.getId('output');

      const instance = spawn(codex, 'battery');

      expect(instance.tryGetProperty(outputId)?.getEffectiveValue() ?? 0).toBe(15); // chargeが満タンなのでfullステージのボーナスが乗る

      instance.getProperty(chargeId).setNumberWithoutEvents(10);

      expect(instance.tryGetProperty(outputId)?.getEffectiveValue() ?? 0).toBe(5); // chargeがlowステージへ落ちたのでボーナスが消える（再登録なし）
    });

    it('複数のpassiveによるmodifyは合算される', () => {
      const yaml = `
object_defs:
  character:
    props:
      defense:
        value: 10
    slots:
      equip: {}
  helmet:
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            defense: 3
  armor:
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            defense: 5
`;
      const codex = load(yaml);
      const defenseId = codex.propertyNames.getId('defense');
      const equipSlotId = codex.slotNames.getId('equip');

      const characterInstance = spawn(codex, 'character');
      const helmetInstance = spawn(codex, 'helmet');
      const armorInstance = spawn(codex, 'armor');

      expect(helmetInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId))).toBeUndefined();
      expect(armorInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId))).toBeUndefined();

      expect(characterInstance.tryGetProperty(defenseId)?.getEffectiveValue() ?? 0).toBe(18);
    });

    it('modify後の実効値はrangeでクランプされる', () => {
      const yaml = `
object_defs:
  character:
    props:
      defense:
        value: 95
        range: {min: 0, max: 100}
    slots:
      equip: {}
  armor:
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            defense: 20
`;
      const codex = load(yaml);
      const defenseId = codex.propertyNames.getId('defense');
      const equipSlotId = codex.slotNames.getId('equip');

      const characterInstance = spawn(codex, 'character');
      const armorInstance = spawn(codex, 'armor');

      expect(armorInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId))).toBeUndefined();

      expect(characterInstance.tryGetProperty(defenseId)?.getEffectiveValue() ?? 0).toBe(100);
    });

    it('持っていないプロパティのgetEffectiveValueは0を返す', () => {
      const yaml = `
object_defs:
  rock:
    props:
      weight:
        value: 5
  other_with_size:
    props:
      volume:
        value: 1
`;
      const codex = load(yaml);
      const volumeId = codex.propertyNames.getId('volume');

      const rockInstance = spawn(codex, 'rock');

      expect(rockInstance.tryGetProperty(volumeId)?.getEffectiveValue() ?? 0).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // add: tick毎に実体値そのものへ加減算する（不可逆）。getEffectiveValueには現れない。
  // ------------------------------------------------------------------
  describe('add: tick毎に実体値そのものへ加減算する（不可逆）。getEffectiveValueには現れない。', () => {
    it('selfへのpassivesのaddはtick時にのみ実体値へ反映される', () => {
      const yaml = `
object_defs:
  candle:
    props:
      wax:
        value: 100
    passives:
      - add:
          self:
            wax: -1
`;
      const codex = load(yaml);
      const waxId = codex.propertyNames.getId('wax');

      const instance = spawn(codex, 'candle');

      expect(instance.tryGetProperty(waxId)?.getEffectiveValue() ?? 0).toBe(100); // tick前は変化しない

      instance.tick();
      expect(instance.tryGetProperty(waxId)?.getEffectiveValue() ?? 0).toBe(99); // tick1回で実体値が減る

      instance.tick();
      expect(instance.tryGetProperty(waxId)?.getEffectiveValue() ?? 0).toBe(98); // tick毎に加算され続ける
    });

    it('in_slot条件付きのparentへのpassivesのaddは、装着している間だけtick毎に効く', () => {
      const yaml = `
object_defs:
  character:
    props:
      hydration:
        value: 100
    slots:
      conditions: {}
  trash:
    slots:
      storage: {}
  bleeding:
    passives:
      - conditions:
          - {in_slot: conditions}
        add:
          parent:
            hydration: -5
`;
      const codex = load(yaml);
      const hydrationId = codex.propertyNames.getId('hydration');
      const conditionsSlotId = codex.slotNames.getId('conditions');
      const storageSlotId = codex.slotNames.getId('storage');

      const characterInstance = spawn(codex, 'character');
      const trashInstance = spawn(codex, 'trash');
      const bleedingInstance = spawn(codex, 'bleeding');

      characterInstance.tick();
      expect(characterInstance.tryGetProperty(hydrationId)?.getEffectiveValue() ?? 0).toBe(100); // 装着前はtickしても変化なし

      expect(
        bleedingInstance.moveToSlotOrRejection(characterInstance.getSlot(conditionsSlotId)),
      ).toBeUndefined();
      characterInstance.tick();
      expect(characterInstance.tryGetProperty(hydrationId)?.getEffectiveValue() ?? 0).toBe(95); // conditionsに入っている間はtick毎に減る

      expect(bleedingInstance.moveToSlotOrRejection(trashInstance.getSlot(storageSlotId))).toBeUndefined();
      characterInstance.tick();
      expect(characterInstance.tryGetProperty(hydrationId)?.getEffectiveValue() ?? 0).toBe(95); // 取り除いた後はtickしても変化しない
    });

    it('parentへのpassivesのaddは、宣言側own_stageの遷移を再登録なしで追跡する', () => {
      const yaml = `
object_defs:
  character:
    props:
      temperature:
        value: 36
    slots:
      conditions: {}
  infection:
    props:
      progress:
        value: 0
        stages:
          - name: none
            min: 0
          - name: mild
            min: 20
            passives:
              - add:
                  parent:
                    temperature: 1
`;
      const codex = load(yaml);
      const temperatureId = codex.propertyNames.getId('temperature');
      const progressId = codex.propertyNames.getId('progress');
      const conditionsSlotId = codex.slotNames.getId('conditions');

      const characterInstance = spawn(codex, 'character');
      const infectionInstance = spawn(codex, 'infection');

      expect(
        infectionInstance.moveToSlotOrRejection(characterInstance.getSlot(conditionsSlotId)),
      ).toBeUndefined();

      characterInstance.tick();
      expect(characterInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(36); // progressがnoneの間は上がらない

      infectionInstance.getProperty(progressId).setNumberWithoutEvents(30);
      characterInstance.tick();
      expect(characterInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(37); // mildへ遷移した後は毎tick上がる（再登録なし）
    });

    it('modifyとpassivesのaddは互いの評価経路に漏れ出さない', () => {
      const yaml = `
object_defs:
  character:
    props:
      stamina:
        value: 50
    slots:
      equip: {}
  boots:
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            stamina: 10
  exhaustion:
    passives:
      - conditions:
          - {in_slot: equip}
        add:
          parent:
            stamina: -1
`;
      const codex = load(yaml);
      const staminaId = codex.propertyNames.getId('stamina');
      const equipSlotId = codex.slotNames.getId('equip');

      const characterInstance = spawn(codex, 'character');
      const bootsInstance = spawn(codex, 'boots');
      const exhaustionInstance = spawn(codex, 'exhaustion');

      expect(bootsInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId))).toBeUndefined();
      expect(
        exhaustionInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId)),
      ).toBeUndefined();

      expect(characterInstance.tryGetProperty(staminaId)?.getEffectiveValue() ?? 0).toBe(60); // modifyだけが都度加味される（実体値は50のまま）

      characterInstance.tick();
      expect(characterInstance.tryGetProperty(staminaId)?.getEffectiveValue() ?? 0).toBe(59); // tickでpassivesのaddだけが実体値へ入る(50-1+10=59)
    });

    it('PropertyValue.registeredContributionsはmodify/addの種別を問わず全件を返す', () => {
      const yaml = `
object_defs:
  character:
    props:
      stamina:
        value: 50
    slots:
      equip: {}
  boots:
    passives:
      - conditions:
          - {in_slot: equip}
        modify:
          parent:
            stamina: 10
  exhaustion:
    passives:
      - conditions:
          - {in_slot: equip}
        add:
          parent:
            stamina: -1
`;
      const codex = load(yaml);
      const staminaId = codex.propertyNames.getId('stamina');
      const equipSlotId = codex.slotNames.getId('equip');

      const characterInstance = spawn(codex, 'character');
      const bootsInstance = spawn(codex, 'boots');
      const exhaustionInstance = spawn(codex, 'exhaustion');

      expect(bootsInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId))).toBeUndefined();
      expect(
        exhaustionInstance.moveToSlotOrRejection(characterInstance.getSlot(equipSlotId)),
      ).toBeUndefined();

      const incoming = characterInstance.tryGetProperty(staminaId)?.registeredContributions ?? [];

      // 種別（modify/add）はPassiveEffectの内部事情で外から見えないため、declarerで両方の
      // 効果が種別を問わず1つの一覧に載ることを確認する（bootsはmodify、exhaustionはpassivesのadd）。
      expect(incoming.length).toBe(2);
      expect(incoming.some((c) => c.declarer === bootsInstance)).toBe(true);
      expect(incoming.some((c) => c.declarer === exhaustionInstance)).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // on_max / on_min / destroy / spawn: 値がRangeの外へ出た際にselfへ適用されるactive内容。
  // ------------------------------------------------------------------
  describe('on_max / on_min / destroy / spawn: 値がRangeの外へ出た際にselfへ適用されるactive内容。', () => {
    it('on_maxが発火するとdestroy: selfで自分自身が破棄される', () => {
      const yaml = `
object_defs:
  holder:
    slots:
      items: {}
  bomb:
    props:
      pressure:
        value: 100
        range: {min: 0, max: 99}
        on_max:
          destroy: self
`;
      const codex = load(yaml);
      const itemsSlotId = codex.slotNames.getId('items');

      const containerInstance = spawn(codex, 'holder');
      const bombInstance = spawn(codex, 'bomb');
      expect(bombInstance.moveToSlotOrRejection(containerInstance.getSlot(itemsSlotId))).toBeUndefined();

      containerInstance.tick();

      expect(bombInstance.parent).toBeUndefined();
      const slot = containerInstance.tryGetSlot(itemsSlotId);
      expect(slot?.contents.length).toBe(0);
    });

    it('値がmax以下の間はon_maxが発火しない', () => {
      const yaml = `
object_defs:
  holder:
    slots:
      items: {}
  tank:
    props:
      pressure:
        value: 50
        range: {min: 0, max: 100}
        on_max:
          destroy: self
`;
      const codex = load(yaml);
      const itemsSlotId = codex.slotNames.getId('items');

      const containerInstance = spawn(codex, 'holder');
      const tankInstance = spawn(codex, 'tank');
      expect(tankInstance.moveToSlotOrRejection(containerInstance.getSlot(itemsSlotId))).toBeUndefined();

      containerInstance.tick();

      expect(tankInstance.parent).toBeDefined(); // on_maxは上限以下では発火しない
    });

    it('tickは子のtickを直接呼ばなくても子孫へ再帰する', () => {
      const yaml = `
object_defs:
  backpack:
    slots:
      items: {}
  power_cell:
    props:
      charge:
        value: 10
    passives:
      - add:
          self:
            charge: -1
`;
      const codex = load(yaml);
      const itemsSlotId = codex.slotNames.getId('items');
      const chargeId = codex.propertyNames.getId('charge');

      const containerInstance = spawn(codex, 'backpack');
      const batteryInstance = spawn(codex, 'power_cell');
      expect(batteryInstance.moveToSlotOrRejection(containerInstance.getSlot(itemsSlotId))).toBeUndefined();

      containerInstance.tick();

      expect(batteryInstance.tryGetProperty(chargeId)?.getEffectiveValue() ?? 0).toBe(9);
    });

    it('on_minが発火するとdestroy: selfで自分自身が破棄される', () => {
      const yaml = `
object_defs:
  lantern_holder:
    slots:
      items: {}
  torch:
    props:
      durability:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
`;
      const codex = load(yaml);
      const itemsSlotId = codex.slotNames.getId('items');

      const containerInstance = spawn(codex, 'lantern_holder');
      const torchInstance = spawn(codex, 'torch');
      expect(torchInstance.moveToSlotOrRejection(containerInstance.getSlot(itemsSlotId))).toBeUndefined();

      containerInstance.tick();

      expect(torchInstance.parent).toBeUndefined();
      const slot = containerInstance.tryGetSlot(itemsSlotId);
      expect(slot?.contents.length).toBe(0);
    });

    it('into: selfのspawnは自分自身が持つスロットへ入る', () => {
      const yaml = `
object_defs:
  bush:
    slots:
      ground: {}
    props:
      ripeness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: berry
            into: self
  berry: {}
`;
      const codex = load(yaml);
      const groundSlotId = codex.slotNames.getId('ground');

      const bushInstance = spawn(codex, 'bush');

      bushInstance.tick();

      const slot = bushInstance.tryGetSlot(groundSlotId);
      expect(slot?.contents.length).toBe(1);
      expect(slot?.contents[0]?.def.name).toBe('berry'); // into: selfなので、自分自身が持つスロットへ入る
    });

    it('intoを省略したspawnは、自分がいたのと同じスロットへ入る', () => {
      const yaml = `
object_defs:
  clearing2:
    slots:
      ground: {}
  wet_log:
    props:
      freshness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: rotten_log
  rotten_log: {}
`;
      const codex = load(yaml);
      const groundSlotId = codex.slotNames.getId('ground');

      const locationInstance = spawn(codex, 'clearing2');
      const wetLogInstance = spawn(codex, 'wet_log');
      expect(wetLogInstance.moveToSlotOrRejection(locationInstance.getSlot(groundSlotId))).toBeUndefined();

      locationInstance.tick();

      expect(wetLogInstance.parent).toBeUndefined(); // wet_log自身は破棄される
      const slot = locationInstance.tryGetSlot(groundSlotId);
      expect(slot?.contents.length).toBe(1);
      expect(slot?.contents[0]?.def.name).toBe('rotten_log'); // 自分がいたのと同じslotにrotten_logが入る
    });

    it('起点自身のスロットがcapacity超過で拒否すると、親へ強制伝播する', () => {
      // fallbackはYAML側で選べず、常に起点自身の親へ強制的に伝播する。ここでは起点(self=geode)が
      // 持つ唯一のスロットがcapacity超過で拒否するため、geodeの親(box)の先頭スロットへ
      // accepts/capacityを無視して伝播することを確認する。
      const yaml = `
object_defs:
  small_box:
    slots:
      shelf: {}
  boulder:
    props:
      volume:
        value: 10
  geode:
    slots:
      cavity:
        capacity: 5
    props:
      ripeness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: boulder
            into: self
`;
      const codex = load(yaml);
      const shelfSlotId = codex.slotNames.getId('shelf');
      const cavitySlotId = codex.slotNames.getId('cavity');

      const boxInstance = spawn(codex, 'small_box');
      const geodeInstance = spawn(codex, 'geode');
      expect(geodeInstance.moveToSlotOrRejection(boxInstance.getSlot(shelfSlotId))).toBeUndefined();

      boxInstance.tick();

      const cavitySlot = geodeInstance.tryGetSlot(cavitySlotId);
      const shelfSlot = boxInstance.tryGetSlot(shelfSlotId);

      expect(cavitySlot?.contents.length).toBe(0); // boulderはgeode自身のcavityにcapacity超過で入らない
      expect(shelfSlot?.contents.length).toBe(2); // geode自身とboulderの両方がbox.shelfに並ぶ（親への強制伝播）
      expect(shelfSlot?.contents.some((c) => c.def.name === 'boulder')).toBe(true);
    });

    it('起点自身のスロットがaccepts制約で拒否すると、親へ強制伝播する', () => {
      const yaml = `
object_defs:
  cave:
    slots:
      floor: {}
  pebble: {}
  gold_nugget:
    tags: [gold_nugget]
  vein:
    slots:
      ore_pocket:
        cell: {accept: {tag: gold_nugget}}
    props:
      yield:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: pebble
            into: self
`;
      const codex = load(yaml);
      const floorSlotId = codex.slotNames.getId('floor');
      const orePocketSlotId = codex.slotNames.getId('ore_pocket');

      const caveInstance = spawn(codex, 'cave');
      const veinInstance = spawn(codex, 'vein');
      expect(veinInstance.moveToSlotOrRejection(caveInstance.getSlot(floorSlotId))).toBeUndefined();

      caveInstance.tick();

      const orePocketSlot = veinInstance.tryGetSlot(orePocketSlotId);
      const floorSlot = caveInstance.tryGetSlot(floorSlotId);

      expect(orePocketSlot?.contents.length).toBe(0); // pebbleはore_pocketのaccepts制約(gold_nuggetのみ)で入らない
      expect(floorSlot?.contents.length).toBe(2); // vein自身とpebbleの両方がcave.floorに並ぶ（親への強制伝播）
      expect(floorSlot?.contents.some((c) => c.def.name === 'pebble')).toBe(true);
    });

    it('accept.objectは指定したObjectDefそのものにだけマッチする', () => {
      // レシピ制作中オブジェクトが特定の素材の型だけを受け入れたい場合など、そのためだけの単発タグを
      // 新設するまでもないケース向けにaccept.objectを使う。枠ごとに要件が違うので、cellsで並べる。
      const yaml = `
object_defs:
  stew_in_progress:
    slots:
      ingredients:
        cells:
          - {accept: {object: raw_meat}}
          - {accept: {tag: spice}, max: 4}
  raw_meat: {}
  raw_fish: {}
  salt:
    tags: [spice]
`;
      const codex = load(yaml);
      const ingredientsSlotId = codex.slotNames.getId('ingredients');

      const stewInstance = spawn(codex, 'stew_in_progress');
      const meatInstance = spawn(codex, 'raw_meat');
      const fishInstance = spawn(codex, 'raw_fish');
      const saltInstance = spawn(codex, 'salt');

      // objectで指定した'raw_meat'そのものは受け入れられる
      expect(meatInstance.moveToSlotOrRejection(stewInstance.getSlot(ingredientsSlotId))).toBeUndefined();
      // 'raw_meat'とは異なる型であり、tagも持たないため拒否される
      expect(fishInstance.moveToSlotOrRejection(stewInstance.getSlot(ingredientsSlotId))).toBeDefined();
      // objectとは別に、tagのルールも同じaccepts内で併用できる
      expect(saltInstance.moveToSlotOrRejection(stewInstance.getSlot(ingredientsSlotId))).toBeUndefined();
    });

    it('起点への配置が失敗し伝播先の親も無ければ、spawnは何もしない', () => {
      const yaml = `
object_defs:
  pebble2:
    props:
      volume:
        value: 10
  vein2:
    slots:
      contents:
        capacity: 1
    props:
      yield:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: pebble2
            into: self
`;
      const codex = load(yaml);
      const contentsSlotId = codex.slotNames.getId('contents');

      const veinInstance = spawn(codex, 'vein2'); // 親を持たない(どこにも格納されていない)

      veinInstance.tick();

      const slot = veinInstance.tryGetSlot(contentsSlotId);
      // pebble2はcapacity超過で入れず、vein2には親が無いため伝播先も無く、どこにも配置されない
      expect(slot?.contents.length).toBe(0);
    });

    it('on_min文脈にはagentが無いため、into: agentのspawnは何も配置しない', () => {
      const yaml = `
object_defs:
  clearing3:
    slots:
      ground: {}
  berry: {}
  bush:
    props:
      ripeness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: berry
            into: agent
`;
      const codex = load(yaml);
      const groundSlotId = codex.slotNames.getId('ground');

      const locationInstance = spawn(codex, 'clearing3');
      const bushInstance = spawn(codex, 'bush');
      expect(bushInstance.moveToSlotOrRejection(locationInstance.getSlot(groundSlotId))).toBeUndefined();

      locationInstance.tick();

      expect(bushInstance.parent).toBeUndefined(); // bush自身は破棄される
      const slot = locationInstance.tryGetSlot(groundSlotId);
      expect(slot?.contents.length).toBe(0); // agentルートはon_min文脈では解決できないため、berryはどこにも配置されない
    });

    it('同じtick内で複数の子が自分自身を破棄しても、tickは正常に完了する', () => {
      const yaml = `
object_defs:
  trashcan:
    slots:
      contents: {}
  junk:
    props:
      integrity:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
`;
      const codex = load(yaml);
      const contentsSlotId = codex.slotNames.getId('contents');

      const containerInstance = spawn(codex, 'trashcan');
      const junk1 = spawn(codex, 'junk');
      const junk2 = spawn(codex, 'junk');
      const junk3 = spawn(codex, 'junk');

      expect(junk1.moveToSlotOrRejection(containerInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(junk2.moveToSlotOrRejection(containerInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(junk3.moveToSlotOrRejection(containerInstance.getSlot(contentsSlotId))).toBeUndefined();

      containerInstance.tick(); // 例外を投げればテスト自体が失敗する

      const slot = containerInstance.tryGetSlot(contentsSlotId);
      expect(slot?.contents.length).toBe(0);
      expect(junk1.parent).toBeUndefined();
      expect(junk2.parent).toBeUndefined();
      expect(junk3.parent).toBeUndefined();
    });

    it('destroyは繰り返し呼んでも安全（冪等）', () => {
      const yaml = `
object_defs:
  box:
    slots:
      contents: {}
  trinket: {}
`;
      const codex = load(yaml);
      const contentsSlotId = codex.slotNames.getId('contents');

      const boxInstance = spawn(codex, 'box');
      const itemInstance = spawn(codex, 'trinket');
      expect(itemInstance.moveToSlotOrRejection(boxInstance.getSlot(contentsSlotId))).toBeUndefined();

      itemInstance.destroy();
      expect(itemInstance.parent).toBeUndefined();

      itemInstance.destroy(); // 例外を投げればテスト自体が失敗する
      expect(itemInstance.parent).toBeUndefined();
    });

    it('tickの最中に親が破棄されても、子はこぼれ出て次のtickから動き続ける', () => {
      // innerBoxは自分自身のon_minによって、outerBox.tick()の実行中に破棄される。その子
      // (battery)は単独で在れるので、道連れにならずouterBoxへこぼれ出る（7.9節）。
      //
      // こぼれた先はもう子を数え終えているので、そのtickの残りは動かない（1 tickぶんの取りこぼしは、
      // 1日96 tickの刻みに対して無視できる）。**壊れないこと**がここでの要件で、値はその観測でしかない。
      const yaml = `
object_defs:
  outer_box:
    slots:
      items: {}
  inner_box:
    slots:
      items: {}
    props:
      integrity:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
  cell:
    props:
      charge:
        value: 10
    passives:
      - add:
          self:
            charge: -1
`;
      const codex = load(yaml);
      const itemsSlotId = codex.slotNames.getId('items');
      const chargeId = codex.propertyNames.getId('charge');

      const outerInstance = spawn(codex, 'outer_box');
      const innerInstance = spawn(codex, 'inner_box');
      const batteryInstance = spawn(codex, 'cell');

      expect(innerInstance.moveToSlotOrRejection(outerInstance.getSlot(itemsSlotId))).toBeUndefined();
      expect(batteryInstance.moveToSlotOrRejection(innerInstance.getSlot(itemsSlotId))).toBeUndefined();

      outerInstance.tick();

      expect(innerInstance.parent).toBeUndefined(); // inner_boxは自分自身のon_minにより破棄される
      expect(batteryInstance.parent, '子は道連れにならず、祖父へこぼれ出る').toBe(outerInstance);
      expect(
        batteryInstance.tryGetProperty(chargeId)?.getEffectiveValue() ?? 0,
        'こぼれたtickは動かない',
      ).toBe(10);

      outerInstance.tick();
      expect(batteryInstance.tryGetProperty(chargeId)?.getEffectiveValue() ?? 0, '次のtickからは動く').toBe(
        9,
      );
    });
  });

  // ------------------------------------------------------------------
  // conditions（14節）は実効値を見る
  // ------------------------------------------------------------------
  describe('conditions（14節）は実効値を見る', () => {
    it('conditionsは生値ではなく実効値を見る', () => {
      const yaml = `
object_defs:
  thing:
    props:
      source:
        value: 10
        passives:
          - modify:
              self:
                source: 5
      target:
        value: 0
        passives:
          - conditions:
              - {prop: source, gte: 15}
            modify:
              self:
                target: 100
`;
      const codex = load(yaml);
      const targetId = codex.propertyNames.getId('target');

      const instance = spawn(codex, 'thing');

      // sourceの生値は10のままだが、実効値(10+5=15)を見るゲートは条件を満たす
      expect(instance.tryGetProperty(targetId)?.getEffectiveValue() ?? 0).toBe(100);
    });

    it('conditionsが循環参照するとスタックオーバーフローの代わりにエラーを投げる', () => {
      const yaml = `
object_defs:
  circular:
    props:
      a:
        value: 0
        passives:
          - conditions:
              - {prop: b, gte: 0}
            modify:
              self:
                a: 1
      b:
        value: 0
        passives:
          - conditions:
              - {prop: a, gte: 0}
            modify:
              self:
                b: 1
`;
      const codex = load(yaml);
      const aId = codex.propertyNames.getId('a');

      const instance = spawn(codex, 'circular');

      expect(() => instance.tryGetProperty(aId)?.getEffectiveValue() ?? 0).toThrowError(/循環参照/);
    });
  });

  // ------------------------------------------------------------------
  // base: 土台にした相手の実効値へ、自分の値を加算する（6.5節）。
  // ------------------------------------------------------------------
  describe('base: 土台にした相手の実効値へ、自分の値を加算する（6.5節）。', () => {
    it('baseは同名プロパティを定義していない中間の祖先を素通りし、最も近い定義済み祖先の実効値を土台にする', () => {
      const yaml = `
object_defs:
  room:
    props:
      temperature:
        value: 20
    slots:
      contents: {}
  character:
    slots:
      inventory: {}
  food:
    props:
      temperature:
        value: -2
        base: {subject: ancestor}
`;
      const codex = load(yaml);
      const temperatureId = codex.propertyNames.getId('temperature');
      const contentsSlotId = codex.slotNames.getId('contents');
      const inventorySlotId = codex.slotNames.getId('inventory');

      const roomInstance = spawn(codex, 'room');
      const characterInstance = spawn(codex, 'character');
      const foodInstance = spawn(codex, 'food');

      expect(foodInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(-2); // 未接続の間は祖先が見つからず寄与0

      expect(characterInstance.moveToSlotOrRejection(roomInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(foodInstance.moveToSlotOrRejection(characterInstance.getSlot(inventorySlotId))).toBeUndefined();

      // characterはtemperatureを持たないため素通りし、roomの実効値(20)に自分のオフセット(-2)を加算する
      expect(foodInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(18);
    });

    it('baseは同名プロパティを定義している最も近い祖先で探索を止める', () => {
      const yaml = `
object_defs:
  room:
    props:
      temperature:
        value: 20
    slots:
      contents: {}
  tent:
    props:
      temperature:
        value: 5
    slots:
      contents: {}
  food:
    props:
      temperature:
        value: 0
        base: {subject: ancestor}
`;
      const codex = load(yaml);
      const temperatureId = codex.propertyNames.getId('temperature');
      const contentsSlotId = codex.slotNames.getId('contents');

      const roomInstance = spawn(codex, 'room');
      const tentInstance = spawn(codex, 'tent');
      const foodInstance = spawn(codex, 'food');

      expect(tentInstance.moveToSlotOrRejection(roomInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(foodInstance.moveToSlotOrRejection(tentInstance.getSlot(contentsSlotId))).toBeUndefined();

      // tent自身がtemperatureを定義しているため、そこで探索が止まりroom(20)までは遡らない
      expect(foodInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(5);
    });

    it('baseは自分の別のプロパティも土台にできる（subject: self）', () => {
      const yaml = `
object_defs:
  location:
    props:
      ambient_brightness:
        value: -3
      hand_brightness:
        value: 2
        base: {subject: self, prop: ambient_brightness}
`;
      const codex = load(yaml);
      const handId = codex.propertyNames.getId('hand_brightness');

      expect(spawn(codex, 'location').tryGetProperty(handId)?.getEffectiveValue()).toBe(-1);
    });

    it('baseは祖先の別名のプロパティも土台にできる（subject: ancestor, prop: 別名）', () => {
      const yaml = `
object_defs:
  location:
    props:
      ambient_brightness:
        value: -3
    slots:
      contents: {}
  lantern:
    props:
      looking_brightness:
        value: 4
        base: {subject: ancestor, prop: ambient_brightness}
`;
      const codex = load(yaml);
      const lookingId = codex.propertyNames.getId('looking_brightness');
      const contentsSlotId = codex.slotNames.getId('contents');

      const locationInstance = spawn(codex, 'location');
      const lanternInstance = spawn(codex, 'lantern');

      expect(lanternInstance.tryGetProperty(lookingId)?.getEffectiveValue()).toBe(4); // 未接続の間は土台が無く自分の値だけ

      expect(lanternInstance.moveToSlotOrRejection(locationInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(lanternInstance.tryGetProperty(lookingId)?.getEffectiveValue()).toBe(1);
    });

    it('baseが読むのは土台のクランプ済みの実効値', () => {
      const yaml = `
object_defs:
  location:
    props:
      ambient_brightness:
        value: -20
        range: {min: -6, max: 17}
      hand_brightness:
        value: 1
        base: {subject: self, prop: ambient_brightness}
`;
      const codex = load(yaml);
      const handId = codex.propertyNames.getId('hand_brightness');

      // 土台はrangeの下限(-6)で止まってから渡る（-20+1ではない）。
      expect(spawn(codex, 'location').tryGetProperty(handId)?.getEffectiveValue()).toBe(-5);
    });
  });

  // ------------------------------------------------------------------
  // modify/addのancestorターゲット: 自分の直接の親から遡り、対象プロパティを定義している
  // 最初の祖先へ効果を及ぼす。
  // ------------------------------------------------------------------
  describe('modify/addのancestorターゲット: 自分の直接の親から遡り、対象プロパティを定義している最初の祖先へ効果を及ぼす。', () => {
    it('ancestorへのmodifyは、対象プロパティを定義している最も近い祖先に効く', () => {
      const yaml = `
object_defs:
  room:
    props:
      temperature:
        value: 20
    slots:
      contents: {}
  fireplace:
    passives:
      - modify:
          ancestor:
            temperature: 5
`;
      const codex = load(yaml);
      const temperatureId = codex.propertyNames.getId('temperature');
      const contentsSlotId = codex.slotNames.getId('contents');

      const roomInstance = spawn(codex, 'room');
      const fireplaceInstance = spawn(codex, 'fireplace');

      expect(roomInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(20); // 暖炉を置く前は補正なし

      expect(fireplaceInstance.moveToSlotOrRejection(roomInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(roomInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(25); // 暖炉を置くと部屋の気温が+5される

      fireplaceInstance.destroy();
      expect(roomInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(20); // 暖炉が無くなれば補正も消える
    });

    it('ancestorへのmodifyは、対象プロパティを定義していない中間の入れ物を素通りする', () => {
      const yaml = `
object_defs:
  room:
    props:
      temperature:
        value: 20
    slots:
      contents: {}
  cart:
    slots:
      contents: {}
  fireplace:
    passives:
      - modify:
          ancestor:
            temperature: 5
`;
      const codex = load(yaml);
      const temperatureId = codex.propertyNames.getId('temperature');
      const contentsSlotId = codex.slotNames.getId('contents');

      const roomInstance = spawn(codex, 'room');
      const cartInstance = spawn(codex, 'cart');
      const fireplaceInstance = spawn(codex, 'fireplace');

      expect(cartInstance.moveToSlotOrRejection(roomInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(fireplaceInstance.moveToSlotOrRejection(cartInstance.getSlot(contentsSlotId))).toBeUndefined();

      // cartはtemperatureを持たないため素通りし、roomへ直接効果が及ぶ
      expect(roomInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(25);
    });

    it('中の祖先に効いている物ごと移動しても、寄与は二重にならない', () => {
      // 親を持たないうちに中へ入れた子は、その部分木の中で祖先を見つけて既に登録している。移動の
      // たびに登録し直す仕組みなので、解除を伴わずに再登録すると寄与が積み増さる。
      const yaml = `
object_defs:
  room:
    slots:
      contents: {}
  stove:
    props:
      temperature:
        value: 20
    slots:
      contents: {}
  fire:
    passives:
      - modify:
          ancestor:
            temperature: 5
`;
      const codex = load(yaml);
      const temperatureId = codex.propertyNames.getId('temperature');
      const contentsSlotId = codex.slotNames.getId('contents');

      const roomInstance = spawn(codex, 'room');
      const stoveInstance = spawn(codex, 'stove');
      const fireInstance = spawn(codex, 'fire');

      // 竈はまだどこにも置かれていない。火は竈の中に祖先を見つける。
      expect(fireInstance.moveToSlotOrRejection(stoveInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(stoveInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(25);

      // 火から見た祖先は竈のままなので、竈を部屋へ運んでも温度は変わらない。
      expect(stoveInstance.moveToSlotOrRejection(roomInstance.getSlot(contentsSlotId))).toBeUndefined();
      expect(stoveInstance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(25);
    });

    it('祖先自身が移動すると、ancestorへのmodifyは再帰的に解決し直される', () => {
      const yaml = `
object_defs:
  room:
    props:
      temperature:
        value: 20
    slots:
      contents: {}
  cart:
    slots:
      contents: {}
  fireplace:
    passives:
      - modify:
          ancestor:
            temperature: 5
`;
      const codex = load(yaml);
      const temperatureId = codex.propertyNames.getId('temperature');
      const contentsSlotId = codex.slotNames.getId('contents');

      const room1Instance = spawn(codex, 'room');
      const room2Instance = spawn(codex, 'room');
      const cartInstance = spawn(codex, 'cart');
      const fireplaceInstance = spawn(codex, 'fireplace');

      expect(cartInstance.moveToSlotOrRejection(room1Instance.getSlot(contentsSlotId))).toBeUndefined();
      expect(fireplaceInstance.moveToSlotOrRejection(cartInstance.getSlot(contentsSlotId))).toBeUndefined();

      expect(room1Instance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(25); // room1に置かれたcartの中の暖炉がroom1を温める
      expect(room2Instance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(20); // room2にはまだ何も影響していない

      // 暖炉自身ではなく、暖炉を運ぶcart(祖先)がroom2へ移動する。
      expect(cartInstance.moveToSlotOrRejection(room2Instance.getSlot(contentsSlotId))).toBeUndefined();

      // cartが立ち去ったのでroom1への補正は消える（再帰的な再解決が効いている証拠）
      expect(room1Instance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(20);
      // cartの中の暖炉は、暖炉自身は動いていないのに新しいroom2を正しく温める
      expect(room2Instance.tryGetProperty(temperatureId)?.getEffectiveValue() ?? 0).toBe(25);
    });

    it('ancestorへのpassivesのaddは、対象プロパティを定義している最も近い祖先へtick毎に積み上がる', () => {
      const yaml = `
object_defs:
  room:
    props:
      soot:
        value: 0
    slots:
      contents: {}
  fireplace:
    passives:
      - add:
          ancestor:
            soot: 1
`;
      const codex = load(yaml);
      const sootId = codex.propertyNames.getId('soot');
      const contentsSlotId = codex.slotNames.getId('contents');

      const roomInstance = spawn(codex, 'room');
      const fireplaceInstance = spawn(codex, 'fireplace');

      expect(fireplaceInstance.moveToSlotOrRejection(roomInstance.getSlot(contentsSlotId))).toBeUndefined();

      roomInstance.tick();
      roomInstance.tick();

      expect(roomInstance.tryGetProperty(sootId)?.number ?? 0).toBe(2); // passivesのaddのancestorターゲットもtick毎に部屋のsootへ積み上がる
    });
  });
});

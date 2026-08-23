import { describe, expect, it } from 'vitest';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

// on_max（GameElementDefinition.md 6.3節）に対する自動テスト。値が変わった直後にcheckRangeEventsが
// 再評価されるため、補正の連鎖は宣言順やTickの回数に依存せず同じtick()内で解決される。
// YAMLパーサ経由のテストはyamlLoader.test.tsを参照。
describe('rangeイベント', () => {
  function load(yaml: string) {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  it('sessionを渡してAddNumberを呼ぶと、Tick()を待たずにその場でon_maxが補正する', () => {
    // Tick()を待たず、addNumberにsessionを渡した瞬間にon_maxが判定・適用されることを確認する。
    // これにより、値がrangeの外側（この例では60）にある状態が外部から観測される瞬間は生じない。
    const yaml = `
object_defs:
  clock_immediate:
    props:
      minute:
        value: 45
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
`;
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const session = new WorldSession(codex);

    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('clock_immediate')),
      session,
    );

    instance.tryGetProperty(minuteId)?.add(15); // 45+15=60 > 59。Tick()は一度も呼んでいない

    expect(instance.tryGetProperty(minuteId)?.number ?? 0, 'Tick()を呼んでいなくても、その場で折り返る').toBe(
      0,
    );
    expect(instance.tryGetProperty(hourId)?.number ?? 0).toBe(1);
  });

  it('PropertyValueを直に書き換えても、rangeイベントは同じように判定される', () => {
    // 値を変えた後に何を判定すべきかを知っているのはPropertyValue自身なので、addの効果（ActiveEffect）を
    // 通したかどうかで挙動が変わってはいけない。
    const yaml = `
object_defs:
  clock_direct:
    props:
      minute:
        value: 45
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
`;
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('clock_direct')), session);

    instance.tryGetProperty(minuteId)!.add(15);

    expect(instance.tryGetProperty(minuteId)?.number ?? 0, 'その場で折り返る').toBe(0);
    expect(instance.tryGetProperty(hourId)?.number ?? 0).toBe(1);
  });

  it('on_max省略時の既定合成（自身をrange.maxへset）は無限再帰を起こさない', () => {
    // on_maxを省略した場合の既定合成（「自分自身をrange.maxへset」）は、値がちょうど境界に
    // 着地した後は同じ値への再setになる（差分0）。addNumberが差分0を何もしないことで、
    // applyRangeEventsAt→applyActiveEffect→setNumber→addNumberという無限再帰を防いでいることを確認する。
    const yaml = `
object_defs:
  tank_immediate:
    props:
      pressure:
        value: 5
        range: {min: 0, max: 10}
        # on_maxを指定しない: YAMLコンバータが「自分自身をrange.maxへset」を既定合成する
`;
    const codex = load(yaml);
    const pressureId = codex.propertyNames.getId('pressure');
    const session = new WorldSession(codex);

    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('tank_immediate')),
      session,
    );

    instance.tryGetProperty(pressureId)?.add(5); // 5+5=10 >= max(10)。例外・制御不能なスタックオーバーフローを起こさなければ成功

    expect(instance.tryGetProperty(pressureId)?.number ?? 0).toBe(10);
  });

  it('range上限を超えるとTick()でプロパティが折り返り、繰り上げ先へ伝播する', () => {
    const yaml = `
object_defs:
  clock:
    props:
      minute:
        value: 45
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
    passives:
      - add:
          self:
            minute: 15
`;
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('clock')), session);

    instance.tick(); // 45 + 15 = 60 > 59 なので折り返す

    expect(instance.tryGetProperty(minuteId)?.number ?? 0).toBe(0);
    expect(instance.tryGetProperty(hourId)?.number ?? 0).toBe(1);
  });

  it('on_maxでsetとaddを併用すると、setで自身が絶対値に戻りaddで繰り上げ先へ伝播する', () => {
    // set: {self: {minute: 0}} + add: {self: {hour: 1}} という、core.yamlが実際に使っている文法
    // （passivesのaddの"-60"のような差分指定ではなく、setで絶対値へ戻す）を検証する。
    const yaml = `
object_defs:
  clock_set:
    props:
      minute:
        value: 45
        range: {min: 0, max: 60}
        on_max:
          set: {self: {minute: 0}}
          add: {self: {hour: 1}}
      hour:
        value: 0
    passives:
      - add:
          self:
            minute: 15
`;
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('clock_set')), session);

    instance.tick(); // 45 + 15 = 60 > 59 なので折り返す

    expect(instance.tryGetProperty(minuteId)?.number ?? 0, 'setにより絶対値0へ戻る（差分ではなく代入）').toBe(
      0,
    );
    expect(instance.tryGetProperty(hourId)?.number ?? 0).toBe(1);
  });

  it('値がrange内に収まっていればTick()で折り返らない', () => {
    const yaml = `
object_defs:
  clock2:
    props:
      minute:
        value: 10
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 0
    passives:
      - add:
          self:
            minute: 15
`;
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('clock2')), session);

    instance.tick(); // 10 + 15 = 25、59以下なので折り返さない

    expect(instance.tryGetProperty(minuteId)?.number ?? 0).toBe(25);
    expect(instance.tryGetProperty(hourId)?.number ?? 0).toBe(0);
  });

  it('on_maxの補正が連鎖し、1回のTick()の中でrange幅の複数span分が解決する', () => {
    // on_maxの補正自体(add: {self: {minute: -10}}})がaddNumberを通るため、その場でもう一度
    // checkRangeEventsが評価される。1tickでrangeの幅を複数回分飛び越えていても、この連鎖により
    // 1回のTick()呼び出しの中だけで完全に解決される。
    const yaml = `
object_defs:
  clock3:
    props:
      minute:
        value: 35
        range: {min: 0, max: 9}
        on_max:
          add: {self: {minute: -10, hour: 1}}
      hour:
        value: 0
`;
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('clock3')), session);

    instance.tick();
    expect(
      instance.tryGetProperty(minuteId)?.number ?? 0,
      '3span分の補正が1回のTick()の中で連鎖的に解決される',
    ).toBe(5);
    expect(instance.tryGetProperty(hourId)?.number ?? 0).toBe(3);

    instance.tick();
    expect(instance.tryGetProperty(minuteId)?.number ?? 0, '範囲内に収まった後は何もしない').toBe(5);
    expect(instance.tryGetProperty(hourId)?.number ?? 0).toBe(3);
  });

  it('宣言順で後にあるプロパティへの繰り上げも、同じTick()の中で連鎖して解決する', () => {
    // minuteがhourより先に宣言されていれば、minute.tickが先に走り繰り上げを適用した直後に
    // hour.tickが走るため、hour自身の溢れも同じtick内で連鎖して解決する
    // （ループは無いが、宣言順どおりに1回ずつ処理が進むだけで足りる）。
    const yaml = `
object_defs:
  clock4:
    props:
      minute:
        value: 50
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
      hour:
        value: 23
        range: {min: 0, max: 24}
        on_max:
          add: {self: {hour: -24, day: 1}}
      day:
        value: 1
    passives:
      - add:
          self:
            minute: 15
`;
    // 50+15=65 -> minute=5, hour+1(23->24, さらに折り返す)
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const dayId = codex.propertyNames.getId('day');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('clock4')), session);

    instance.tick();

    expect(instance.tryGetProperty(minuteId)?.number ?? 0).toBe(5);
    expect(
      instance.tryGetProperty(hourId)?.number ?? 0,
      '23+1=24は範囲(0-23)を超えるため、同じtick内でhour自身も折り返す',
    ).toBe(0);
    expect(instance.tryGetProperty(dayId)?.number ?? 0, 'hourの繰り上げでdayも+1される').toBe(2);
  });

  it('宣言順に関わらず、先に宣言されたプロパティへの繰り上げも同じTick()の中で連鎖して解決する', () => {
    // hourがminuteより先に宣言されていても、minuteのon_maxが行うadd: {self: {hour: 1}}}が
    // addNumberを通るため、その場でhour自身のcheckRangeEventsも即座に評価される。宣言順に関わらず
    // 同じTick()呼び出しの中で連鎖的に解決される。
    const yaml = `
object_defs:
  clock5:
    props:
      hour:
        value: 23
        range: {min: 0, max: 24}
        on_max:
          add: {self: {hour: -24, day: 1}}
      day:
        value: 1
      minute:
        value: 50
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
    passives:
      - add:
          self:
            minute: 15
`;
    // 50+15=65 -> minute=5, hour+1(23->24)
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const hourId = codex.propertyNames.getId('hour');
    const dayId = codex.propertyNames.getId('day');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('clock5')), session);

    instance.tick();

    expect(instance.tryGetProperty(minuteId)?.number ?? 0).toBe(5);
    expect(
      instance.tryGetProperty(hourId)?.number ?? 0,
      'hourがminuteより先に宣言されていても、即座に連鎖して折り返る',
    ).toBe(0);
    expect(instance.tryGetProperty(dayId)?.number ?? 0, 'hourの繰り上げでdayも同じTick()内で+1される').toBe(
      2,
    );
  });

  it('on_maxの加算先プロパティをこのobject_defが持たない場合は黙って無視される', () => {
    // add（ActiveEffect）の通常の規約と同じ: このobject_defが持たないプロパティへの
    // 加算は、たとえ同名のプロパティを別のobject_defが持っていて名前自体は登録されていても、
    // 黙って無視される（エラーにしない）。
    const yaml = `
object_defs:
  a_clock2:
    props:
      minute:
        value: 45
        range: {min: 0, max: 60}
        on_max:
          add: {self: {minute: -60, hour: 1}}
    passives:
      - add:
          self:
            minute: 15
  b_something2:
    props:
      hour:
        value: 0
`;
    // a_clock2はhourを持たない。b_something2が同名プロパティを持つ(名前だけは登録される)
    const codex = load(yaml);
    const minuteId = codex.propertyNames.getId('minute');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('a_clock2')), session);

    instance.tick(); // 例外を投げればテスト自体が失敗する

    expect(instance.tryGetProperty(minuteId)?.number ?? 0).toBe(0);
  });

  it('折り返しと別プロパティへの加算を1つのon_maxに併記すると、span数だけ加算される', () => {
    // gaugeは0-100を循環するプロパティ。1tickでの加算(+250)がrangeの幅を複数span分飛び越えても、
    // on_maxの補正が連鎖するため、併記したalarm_countへの加算はspanごとに1回ずつ適用される
    // （「境界を越えた回数を数える」は折り返しと同じon_maxに併記すれば足りる）。
    const yaml = `
object_defs:
  tank2:
    props:
      gauge:
        value: 0
        range: {min: 0, max: 100}
        on_max:
          add: {self: {gauge: -101, alarm_count: 1}}
      alarm_count:
        value: 0
    passives:
      - add:
          self:
            gauge: 250
`;
    const codex = load(yaml);
    const gaugeId = codex.propertyNames.getId('gauge');
    const alarmId = codex.propertyNames.getId('alarm_count');
    const session = new WorldSession(codex);

    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('tank2')), session);

    instance.tick(); // 0 + 250 = 250 > 100。250 -> 149 -> 48 と2回連鎖する

    expect(instance.tryGetProperty(gaugeId)?.number ?? 0).toBe(48);
    expect(
      instance.tryGetProperty(alarmId)?.number ?? 0,
      '2span分の折り返しでalarm_countも2回加算される',
    ).toBe(2);
  });
});

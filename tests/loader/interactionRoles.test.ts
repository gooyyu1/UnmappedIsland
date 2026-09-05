import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 操作の3役（`agent`・`instrument`・`patient`）を書ける場所（GameElementDefinition.md 11.5節
 * 「役を書ける場所」）に対する自動テスト。
 *
 * **表の行×3役をそのまま並べる。** 表は「唯一の一覧」なので、可否がずれたらどの行のどの役かが
 * ここで分かる。`✕`（居るが書けない）と`—`（そもそも居ない）はどちらもロード時エラーだが、理由が
 * 違うので文面まで見る——`patient`の`✕`は「居ないから」ではない。
 */
describe('役を書ける場所（11.5節の表）', () => {
  const load = (yaml: string) => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

  /** 表の1マス。`ok`なら書ける、文字列ならロード時エラーの理由に含まれる語。 */
  type Verdict = 'ok' | string;

  /** `—`: その場所に居ないので解決先を持たない。役ごとに文面が違う。 */
  const ABSENT: Readonly<Record<string, string>> = {
    agent: '誰かが操作している場面とは限りません',
    instrument: '働きかけに使われる物が運ばれてきません',
    patient: '働きかけられる物が居ません',
  };

  /** `✕`: 居るが書けない。操作の宣言はpatientに乗るので、`self`と同じ物になる。 */
  const SAME_AS_SELF = "'self'と同じ物を指します";

  /**
   * 役を`subject`として1つ書いた世界。**どの行でも同じ条件式を置く**ので、可否の差は置き場所だけから
   * 出る。参照先の`stamina`は誰も持たなくてよい——見るのはロードが通るかどうかだけ。
   */
  const places: readonly {
    readonly name: string;
    readonly yaml: (role: string) => string;
    readonly verdicts: Readonly<Record<string, Verdict>>;
  }[] = [
    {
      name: '参加者のprops（base）',
      yaml: (role) => `
object_defs:
  path:
    props:
      travel_minutes: {value: 60, base: {subject: ${role}, prop: travel_delay}}
`,
      verdicts: { agent: 'ok', instrument: 'ok', patient: 'ok' },
    },
    {
      name: '参加者のprops（passives）',
      yaml: (role) => `
object_defs:
  path:
    props:
      travel_minutes: {value: 60}
    passives:
      - conditions: [{subject: ${role}, prop: stamina, gt: 0}]
        add: {${role}: {stamina: -1}}
`,
      verdicts: { agent: 'ok', instrument: 'ok', patient: 'ok' },
    },
    {
      name: 'interactions（menu）',
      yaml: (role) => `
object_defs:
  path:
    interactions:
      travel:
        trigger: menu
        conditions: [{subject: ${role}, prop: stamina, gt: 0}]
`,
      verdicts: { agent: 'ok', instrument: ABSENT.instrument, patient: SAME_AS_SELF },
    },
    {
      name: 'interactions（tick）',
      yaml: (role) => `
object_defs:
  beast:
    interactions:
      turn:
        trigger: tick
        conditions: [{subject: ${role}, prop: stamina, gt: 0}]
`,
      verdicts: { agent: 'ok', instrument: ABSENT.instrument, patient: SAME_AS_SELF },
    },
    {
      name: 'interactions（drag）',
      yaml: (role) => `
object_defs:
  hammer:
    tags: [hammer]
  nut:
    interactions:
      crack:
        trigger: {drag: {tag: hammer}}
        conditions: [{subject: ${role}, prop: stamina, gt: 0}]
`,
      verdicts: { agent: 'ok', instrument: 'ok', patient: SAME_AS_SELF },
    },
    {
      name: 'put_in',
      yaml: (role) => `
object_defs:
  splint:
    slots:
      treatment:
        put_in: {duration: {subject: ${role}, prop: stamina}}
`,
      verdicts: { agent: 'ok', instrument: 'ok', patient: SAME_AS_SELF },
    },
    {
      name: 'レシピの解放条件',
      yaml: (role) => `
object_defs:
  hide: {}
  cloak:
    recipes:
      sewn:
        conditions: [{subject: ${role}, prop: stamina, gt: 0}]
        steps:
          - requires: [{object: hide, count: 1, consume: true}]
            duration: 30
`,
      verdicts: { agent: 'ok', instrument: ABSENT.instrument, patient: ABSENT.patient },
    },
    {
      name: 'crafting_conditions',
      yaml: (role) => `
crafting_conditions:
  - {subject: ${role}, prop: stamina, gte: 5}
`,
      verdicts: { agent: 'ok', instrument: ABSENT.instrument, patient: ABSENT.patient },
    },
    {
      name: 'on_max / on_min',
      yaml: (role) => `
object_defs:
  torch:
    props:
      fuel:
        value: 10
        range: {min: 0, max: 10}
        on_min:
          conditions: [{subject: ${role}, prop: stamina, gt: 0}]
          destroy: self
`,
      verdicts: { agent: ABSENT.agent, instrument: ABSENT.instrument, patient: ABSENT.patient },
    },
    {
      name: 'resists',
      yaml: (role) => `
object_defs:
  wild_boar:
    resists: [{subject: ${role}, prop: stamina, gt: 0}]
`,
      verdicts: { agent: ABSENT.agent, instrument: ABSENT.instrument, patient: ABSENT.patient },
    },
  ];

  for (const place of places)
    for (const [role, verdict] of Object.entries(place.verdicts))
      it(`${place.name}: ${role} は${verdict === 'ok' ? '書ける' : '書けない'}`, () => {
        if (verdict === 'ok') {
          expect(() => load(place.yaml(role))).not.toThrow();
          return;
        }
        expect(() => load(place.yaml(role))).toThrowError(new RegExp(escapeForRegExp(verdict)));
      });

  it('可逆な寄与（modify）を押せるのは、一意な参加者であるagentだけ（8.3節）', () => {
    const modifyTo = (role: string) => `
object_defs:
  path:
    props:
      travel_minutes: {value: 60}
    passives:
      - modify: {${role}: {travel_delay: 5}}
`;

    expect(() => load(modifyTo('agent'))).not.toThrow();
    for (const role of ['instrument', 'patient'])
      expect(() => load(modifyTo(role)), `${role}へは押せない`).toThrowError(/可逆な寄与/);
  });
});

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

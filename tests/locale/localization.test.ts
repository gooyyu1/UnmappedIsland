import { describe, expect, it } from 'vitest';
import { parseLocale } from '../../src/locale/Localization';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

describe('Localization(表示文字列の対応表)', () => {
  const locale = parseLocale(
    'ja.yaml',
    `
object_texts:
  default:
    display_name: 使われない名前
    props:
      exploration_progress:
        display_name: 探索の進み具合
        description: 共通の説明
      hydration:
        display_name: 水分
        icon: 💧
    interactions:
      eat:
        display_name: 食べる
      pour_in:
        display_name: 注ぎ移す
  coconut:
    display_name: ヤシの実
    description: 硬い殻に覆われた実。
    props:
      freshness:
        display_name: 鮮度
    interactions:
      eat:
        display_name: かじる
        description: 殻を割って中身を食べる。
`,
  );

  it('オブジェクト自身のdisplay_nameとdescriptionを引ける', () => {
    expect(locale.object('coconut').displayName).toBe('ヤシの実');
    expect(locale.object('coconut').description).toBe('硬い殻に覆われた実。');
  });

  it('未登録のオブジェクトは識別子を表示名にし、説明は持たない', () => {
    expect(locale.object('thick_branch').displayName).toBe('thick_branch');
    expect(locale.object('thick_branch').description).toBeUndefined();
  });

  it('props・操作の表示文字列を引ける（メニュー型とドラッグ型は分けない）', () => {
    expect(locale.object('coconut').prop('freshness').displayName).toBe('鮮度');
    expect(locale.object('coconut').interaction('eat').displayName).toBe('かじる');
    expect(locale.object('coconut').interaction('eat').description).toBe('殻を割って中身を食べる。');
    // pour_in はドラッグ型だが、引き方はメニュー型と同じ。
    expect(locale.object('captain').interaction('pour_in').displayName).toBe('注ぎ移す');
  });

  it('名前の代わりに置ける絵を引ける（宣言が無ければundefined）', () => {
    expect(locale.object('captain').prop('hydration').icon).toBe('💧');
    expect(locale.object('coconut').prop('freshness').icon, '書いていないプロパティ').toBeUndefined();
    expect(locale.object('coconut').prop('weight').icon, 'どこにも定義が無いプロパティ').toBeUndefined();
  });

  it('オブジェクト側に定義が無いメンバーはdefaultエントリへフォールバックする', () => {
    const texts = locale.object('coconut').prop('exploration_progress');

    expect(texts.displayName).toBe('探索の進み具合');
    expect(texts.description).toBe('共通の説明');
    // オブジェクト自身が未登録でも、defaultのメンバーは引ける。
    expect(locale.object('sandy_beach').prop('exploration_progress').displayName).toBe('探索の進み具合');
  });

  it('オブジェクト側の定義はdefaultエントリより優先される', () => {
    expect(locale.object('coconut').interaction('eat').displayName).toBe('かじる');
    expect(locale.object('thick_branch').interaction('eat').displayName, 'defaultの側').toBe('食べる');
  });

  it('defaultエントリのdisplay_nameはオブジェクトの表示名には使われない', () => {
    expect(locale.object('thick_branch').displayName).toBe('thick_branch');
  });

  it('どこにも定義が無いメンバーは識別子を表示名にする', () => {
    expect(locale.object('coconut').prop('weight').displayName).toBe('weight');
    expect(locale.object('coconut').interaction('burn').displayName).toBe('burn');
    expect(locale.object('coconut').interaction('mix').description).toBeUndefined();
  });

  it('変種の名前は、{base}に素の型の表示名・{value}に軸の値の名前が入る', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  default:
    variation_names:
      content: '{value}入りの{base}'
  canteen:
    display_name: 水筒
  jar:
    display_name: 甕
    variation_names:
      content: '{base}（{value}）'
`,
    );

    expect(texts.object('canteen').variationName('content', '水筒', '水'), 'defaultの書式').toBe(
      '水入りの水筒',
    );
    expect(texts.object('jar').variationName('content', '甕', '水'), '自分の書式が優先される').toBe(
      '甕（水）',
    );
  });

  it('その軸の書式が無ければ、素の型の名前のまま', () => {
    expect(locale.object('coconut').variationName('content', 'ヤシの実', '水')).toBe('ヤシの実');
    expect(
      locale.object('thick_branch').variationName('content', 'thick_branch', '水'),
      '未登録なら識別子',
    ).toBe('thick_branch');
  });

  it('差し込んだ名前の中のプレースホルダは置換されない', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  default:
    variation_names:
      content: '{value}入りの{base}'
  canteen:
    display_name: '{value}筒'
`,
    );

    expect(texts.object('canteen').variationName('content', '{value}筒', '水')).toBe('水入りの{value}筒');
  });

  it('object_textsの節が無い・空のファイルでも読める', () => {
    expect(parseLocale('ja.yaml', '').object('coconut').displayName).toBe('coconut');
    expect(parseLocale('ja.yaml', 'ui:\n  ok: OK\n').object('coconut').displayName).toBe('coconut');
  });

  it('操作を実行できない理由の文言を引ける（未登録ならundefined）', () => {
    const withReasons = parseLocale('ja.yaml', 'reason_texts:\n  too_heavy: 荷が重すぎる。\n');

    expect(withReasons.reason('too_heavy')).toBe('荷が重すぎる。');
    expect(withReasons.reason('unknown_reason'), '未登録なら理由を出さない').toBeUndefined();
  });

  it('消し方の名乗りの文言を引ける（未登録なら識別子）', () => {
    const texts = parseLocale(
      'ja.yaml',
      'destroy_reason_texts:\n  dehydrated: 渇き\nstage_texts:\n  drowned: 水没\n',
    );

    expect(texts.destroyReason('dehydrated')).toBe('渇き');
    expect(texts.destroyReason('drowned'), '段は別の名前空間なので引かない').toBe('drowned');
    expect(texts.destroyReason('crushed'), '未登録でも名乗ったことは伝える').toBe('crushed');
  });

  it('画面に出る段の文言を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'stage_texts:\n  unconscious: 気絶\n');

    expect(texts.stage('unconscious')).toBe('気絶');
    expect(texts.stage('dazed'), '未登録でもカードには何か出す').toBe('dazed');
  });

  it('告げられた出来事の文言を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'signal_texts:\n  missed: 空振り\n');

    expect(texts.signal('missed')).toBe('空振り');
    expect(texts.signal('dodged'), '未登録でも札の上には何か出す').toBe('dodged');
  });

  it('プロパティのタグの表示名を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'property_tag_texts:\n  nutrition:\n    display_name: 栄養\n');

    expect(texts.propertyTag('nutrition').displayName).toBe('栄養');
    expect(texts.propertyTag('health').displayName).toBe('health');
  });

  it('シンボル型プロパティの値の表示名を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'symbol_texts:\n  scorching:\n    display_name: 灼熱\n');

    expect(texts.symbol('scorching').displayName).toBe('灼熱');
    expect(texts.symbol('drizzle').displayName).toBe('drizzle');
  });

  it('表示文字列がスカラーでなければエラーになる', () => {
    expect(() =>
      parseLocale('ja.yaml', 'object_texts:\n  coconut:\n    display_name: {ja: ヤシの実}\n'),
    ).toThrow(YamlLoadError);
    expect(() => parseLocale('ja.yaml', 'object_texts:\n  coconut: ヤシの実\n')).toThrow(YamlLoadError);
  });
});

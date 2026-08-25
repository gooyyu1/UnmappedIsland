import { describe, expect, it } from 'vitest';
import { CoverageGuaranteeDef, GenerationScopeDef } from '../../src/domain/generation/GenerationScopeDef';
import type { GenerationScopeParams } from '../../src/domain/generation/GenerationScopeDef';

/**
 * 生成スコープの構築が、値の並び順ではなく名前で行われることの検査。
 *
 * 値の大半が数値なので、位置で並べる形では隣どうしを取り違えても型検査が通っていた（島の差し渡し
 * 6700mと歩く速さ4000m/時を入れ替えても、コンパイルもロードも成功した）。**確かめたい挙動が
 * 「型検査で止まること」そのもの**なので、止まる形は `@ts-expect-error` で書く——止まらなくなれば
 * 「エラーが出ていない」として `npm run typecheck` が赤くなる。
 */
describe('GenerationScopeDefの構築', () => {
  /** 全部を互いに違う値にする（取り違えが値の一致で隠れないように）。 */
  const ISLAND: GenerationScopeParams = {
    name: 'island',
    siteCountMin: 10,
    siteCountMax: 20,
    coastBandMaxDistance: 15,
    clampsHullSitesToCoast: true,
    interiorBias: 0.6,
    extraEdgeDetourThreshold: 1.8,
    diameterMeters: 6700,
    walkMetersPerHour: 4000,
    climbMetersPerHour: 600,
    elevationAxis: 'elevation',
    elevationTopMeters: 400,
    maxSitesPerType: 3,
    crowdingPenaltyPerDuplicate: 0.25,
    guarantees: [new CoverageGuaranteeDef('peak', 1, 'elevation', 'max')],
  };

  it('名前で渡した値が、同じ名前のフィールドへ入る', () => {
    const scope = new GenerationScopeDef(ISLAND);

    expect(scope.name).toBe('island');
    expect(scope.siteCountMin).toBe(10);
    expect(scope.siteCountMax).toBe(20);
    expect(scope.coastBandMaxDistance).toBe(15);
    expect(scope.clampsHullSitesToCoast).toBe(true);
    expect(scope.interiorBias).toBe(0.6);
    expect(scope.extraEdgeDetourThreshold).toBe(1.8);
    expect(scope.diameterMeters).toBe(6700);
    expect(scope.walkMetersPerHour).toBe(4000);
    expect(scope.climbMetersPerHour).toBe(600);
    expect(scope.elevationAxis).toBe('elevation');
    expect(scope.elevationTopMeters).toBe(400);
    expect(scope.maxSitesPerType).toBe(3);
    expect(scope.crowdingPenaltyPerDuplicate).toBe(0.25);
    expect(scope.guarantees[0].locationType).toBe('peak');
  });

  it('位置で並べる形は、型検査で止まる', () => {
    const scope = new GenerationScopeDef(
      'island',
      // @ts-expect-error 引数は名前付きの1個だけなので、2個目以降が余ってここで止まる。位置で
      // 並べる形は同じ型が連続するので、取り違えても型では止まらなかった。
      10,
      20,
      15,
      true,
      0.6,
      1.8,
      6700,
      4000,
      600,
      'elevation',
      400,
      3,
      0.25,
      [],
    );

    // 止めなければ、2個目以降は読まれずに落ちる（値が1つも入らない）。
    expect(scope.diameterMeters).toBeUndefined();
  });

  it('名前を1つ落とした引数は、型検査で止まる', () => {
    const { walkMetersPerHour: dropped, ...withoutWalkSpeed } = ISLAND;

    // @ts-expect-error walkMetersPerHourが無い。省略を許すと、既定値を持たない値が黙って欠ける。
    const scope = new GenerationScopeDef(withoutWalkSpeed);

    // 止めなければ、落とした値（dropped）はどこにも入らない。
    expect(dropped).toBe(4000);
    expect(scope.walkMetersPerHour).toBeUndefined();
  });

  it('綴りの違う名前は、型検査で止まる', () => {
    const scope = new GenerationScopeDef({
      ...ISLAND,
      // @ts-expect-error diameterMetersの綴り違い。名前が合わなければ、渡したつもりの値はどこへも入らない。
      diamaterMeters: 9000,
    });

    expect(scope.diameterMeters).toBe(6700);
  });

  it('名前の合う型違いは、型検査で止まる', () => {
    const scope = new GenerationScopeDef({
      ...ISLAND,
      // @ts-expect-error 数値の欄に文字列。歩く速さと標高軸の名前のような取り違えは、ここで止まる。
      walkMetersPerHour: 'elevation',
    });

    // 止めなければ、数値の欄に文字列が入ったまま通る（速さの検査 `<= 0` も素通りする）。
    expect(typeof scope.walkMetersPerHour).toBe('string');
  });
});

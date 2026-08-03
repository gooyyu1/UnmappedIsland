/**
 * 液体ごとの、中身のバー（Card）の色。
 *
 * 何色に見えるかはその液体自身の性質なので、容器側にも表示側の都合にも持たせず、液体の
 * object_defの識別子（liquid_containers.yaml）で引く1か所へ集める。液体を1種類足したら
 * ここへ1行足す——足し忘れは tests/game/liquidColor.test.ts が捕まえる。
 */
const LIQUID_COLORS: ReadonlyMap<string, number> = new Map([
  ['water_liquid', 0x2f86d8],
  ['tea_liquid', 0x6f8f3c],
  ['oil_liquid', 0xe0b422],
]);

/** 色の分からない液体（旧セーブ・MOD）の代役。中身があること自体は見えるようにする。 */
const UNKNOWN_LIQUID_COLOR = 0x9aa0a6;

export function liquidColorOf(liquidDefName: string | undefined): number {
  if (liquidDefName === undefined) return UNKNOWN_LIQUID_COLOR;
  return LIQUID_COLORS.get(liquidDefName) ?? UNKNOWN_LIQUID_COLOR;
}

/** 色を定義してある液体の識別子（自動テストが実在の液体と突き合わせる）。 */
export function coloredLiquidNames(): readonly string[] {
  return [...LIQUID_COLORS.keys()];
}

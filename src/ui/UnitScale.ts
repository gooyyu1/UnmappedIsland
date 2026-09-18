/**
 * u単位の長さをピクセルへ直せる相手。**画面の寸法そのものは受け取らない**——汎用部品が要るのは
 * 換算だけで、どんな画面に敷かれるかは知らないまま描ける。
 */
export interface UnitScale {
  px(units: number): number;
}

/** 文字の大きさもu単位から直せる相手。文字を置くものだけが要る（labels.addLabel）。 */
export interface FontScale extends UnitScale {
  fontPx(units: number): number;
}

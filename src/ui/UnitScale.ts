/** u単位の長さをピクセルへ直せる相手（ScreenMetrics）。 */
export interface UnitScale {
  px(units: number): number;
}

/** 文字の大きさもu単位から直せる相手。文字を置くものだけが要る（labels.addLabel）。 */
export interface FontScale extends UnitScale {
  fontPx(units: number): number;
}

import { COLOR } from './theme';

/** フィールドエリア全体にかぶせる1枚の色（ScreenLayout.md 7.5.1節 空の明るさ）。 */
export interface SkyTint {
  readonly color: number;
  readonly alpha: number;
  /** 加算合成にするか。明るい側は加算にしないと、色が白く濁って明るく見えない。 */
  readonly additive: boolean;
}

/**
 * 翳りも輝きも足さない明るさ。曇りの日中（時間帯+2〜+5、天気+2）がここに当たる。
 *
 * `sunlight` は時間帯と天気を1つに畳んだ実効値（core.yaml）で、夜は天気によらず0へクランプされる。
 * 明るさをこの値から引くことで、**真夜中の快晴が明るくなる**ような取り違えが起きない。
 */
const NEUTRAL_SUNLIGHT = 7;

/** 取りうる最大の明るさ。灼熱（天気+10）の日中（時間帯+5）。 */
const BRIGHTEST_SUNLIGHT = 15;

/** 真っ暗（sunlight 0）のときの翳りの濃さと、最も明るいときの輝きの強さ。 */
const MAX_DIM = 0.42;
const MAX_GLOW = 0.14;

/**
 * 翳りの効き方。1未満だと、日射が下がり始めた側で速く濃くなる。**暗さは、光が少し減っただけで
 * 大きく効く**（日中の嵐と曇りの日射の差は2しかないが、目には曇りよりずっと暗く映る）。
 */
const DIM_CURVE = 0.5;

/**
 * その日射のときにフィールドエリアへかぶせる色。かぶせるものが無ければundefined。
 *
 * 暗い側と明るい側で色が違うのは、翳りは影の色（青みのある暗色）、輝きは陽の色（暖色）だから。
 */
export function skyTintFor(sunlight: number | undefined): SkyTint | undefined {
  if (sunlight === undefined || sunlight === NEUTRAL_SUNLIGHT) return undefined;

  if (sunlight < NEUTRAL_SUNLIGHT) {
    const depth = (NEUTRAL_SUNLIGHT - Math.max(0, sunlight)) / NEUTRAL_SUNLIGHT;
    return { color: COLOR.skyShade, alpha: MAX_DIM * depth ** DIM_CURVE, additive: false };
  }

  const height =
    (Math.min(BRIGHTEST_SUNLIGHT, sunlight) - NEUTRAL_SUNLIGHT) / (BRIGHTEST_SUNLIGHT - NEUTRAL_SUNLIGHT);
  return { color: COLOR.skyGlow, alpha: MAX_GLOW * height, additive: true };
}

import { ISLAND_RADIUS } from './SitePlacer';

/**
 * 軸のlayered_noiseジェネレータが使う、シード付きの格子値ノイズ（value noise）。
 * 整数格子点に整数ハッシュで[0,1)の値を置き、その間を滑らかに補間する。状態を持たない純関数で、
 * 同じ(シード, 座標, パラメータ)は常に同じ値を返す（シード再現性の土台）。外部ライブラリに
 * 依存しない自前実装（Unity非依存のDomain層で完結させるため）。
 *
 * [0, 1) のノイズ値。座標はSitePlacer.ISLAND_RADIUSで正規化してから周波数を掛ける
 * （frequency=島の直径あたりの起伏の数の目安）。octavesは周波数2倍・振幅1/2で重ねる。
 */
export function sample(seed: number, x: number, y: number, octaves: number, frequency: number): number {
  let total = 0;
  let amplitude = 1;
  let amplitudeSum = 0;
  let freq = frequency;

  for (let octave = 0; octave < octaves; octave++) {
    total +=
      amplitude * sampleSingle(seed + octave * 101, (x / ISLAND_RADIUS) * freq, (y / ISLAND_RADIUS) * freq);
    amplitudeSum += amplitude;
    amplitude *= 0.5;
    freq *= 2;
  }

  return total / amplitudeSum;
}

function sampleSingle(seed: number, u: number, v: number): number {
  const u0 = Math.floor(u);
  const v0 = Math.floor(v);
  const fu = smoothStep(u - u0);
  const fv = smoothStep(v - v0);

  const a = latticeValue(seed, u0, v0);
  const b = latticeValue(seed, u0 + 1, v0);
  const c = latticeValue(seed, u0, v0 + 1);
  const d = latticeValue(seed, u0 + 1, v0 + 1);

  const top = a + (b - a) * fu;
  const bottom = c + (d - c) * fu;
  return top + (bottom - top) * fv;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 整数格子点(xi, yi)の[0,1)の値。乗算と xorshift による決定的な整数ハッシュ。 */
function latticeValue(seed: number, xi: number, yi: number): number {
  let h = Math.imul(seed, 374761393) >>> 0;
  h = (h + Math.imul(xi, 668265263)) >>> 0;
  h = (h + Math.imul(yi, 2246822519)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

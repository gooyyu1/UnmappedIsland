import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { FONT_FAMILY } from '../looks/theme';

/** 粒の大きさ。 */
const PARTICLE_SIZE = 80;

/**
 * 吸い込まれるまでの時間は距離で決める（1uあたり）。**時間を固定すると速さが揃わない**——同じ演出の
 * 中で、近い粒ほど遅く、遠い粒ほど速く見えてしまう。
 */
const FLY_MS_PER_UNIT = 1;

/**
 * その時間の下限と上限。下限が無いと、湧いた所へすぐ吸われる短い弧（発生源がキャラクタ自身のとき）が
 * 一瞬で消えて見えない。
 */
const FLY_MIN_MS = 450;
const FLY_MAX_MS = 1400;

/**
 * 吸い寄せられる曲線の強さ。**大きいほど、湧いた所の近くに長く留まってから動き出す**——増えたのが
 * どの札からかを読ませたいので、道中より出どころに時間を割く。3で、飛ぶ時間の半分を過ぎても
 * まだ1割ほどしか進んでいない。
 */
const PULL_POWER = 3;

/** 湧き出す点を、発生源の札の縁からどれだけ外へ出すか（uの範囲でばらつかせる）。 */
const SPAWN_MARGIN_MIN = 4;
const SPAWN_MARGIN_MAX = 40;

/** 吸い込まれる先を、キャラクタの札の中心からどれだけずらすか（uの半径でばらつかせる）。 */
const ARRIVAL_SCATTER = 40;

/**
 * 弧のふくらみ＝始点と終点を結ぶ直線に対する垂直方向のずれ。**固定量と距離の割合の和**にする——
 * 割合だけにすると、発生源がキャラクタ自身のとき（距離がほぼ0）に弧が消えて直線になる。
 * 符号は粒ごとに変えるので、同じ場所から出た粒が左右へ散る。
 */
const ARC_FIXED = 70;
const ARC_RATIO = 0.16;

/**
 * 湧き出し切るまでと、吸い込まれ切る前の、透け具合を動かす区間（**経過時間**に対する割合）。
 *
 * 位置と同じ曲線（PULL_POWER）で測ってはならない——出どころに長く留まる曲線なので、湧いてから
 * 半分の時間を使って現れることになり、はっきり見えている間が残らない。
 */
const FADE_IN = 0.08;
const FADE_OUT = 0.12;

/**
 * 操作がキャラクタの値を増やしたことを見せる粒（CardInteraction.md 10節）。
 *
 * **発生源の札の縁から湧き、キャラクタの札の中心へ吸われる**、という1つの規則だけで動く。発生源が
 * キャラクタ自身（休息のような自分で起こす操作）でも、始点は自分の縁の外・終点は自分の中心なので、
 * 外へ膨らんでから内へ沈む短い弧になる——泡が湧いて収まる見え方が、同じ式から出る。
 */
export function emitGainParticles(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  options: {
    /** 飛ばす絵（プロパティのアイコン、Localization.md）。 */
    readonly icon: string;
    readonly count: number;
    readonly from: Rect;
    readonly to: Rect;
    /** 湧き出しを散らす時間。行動の経過を見せている間いっぱいに散らす。 */
    readonly spreadMs: number;
    readonly depth: number;
  },
): void {
  const { icon, count, from, to, spreadMs, depth } = options;
  const size = metrics.fontPx(PARTICLE_SIZE);
  const scatter = metrics.px(ARRIVAL_SCATTER);
  const arcFixed = metrics.px(ARC_FIXED);

  for (let index = 0; index < count; index++) {
    const start = pointOnEdge(from, metrics);
    const end = {
      x: to.x + to.width / 2 + Phaser.Math.FloatBetween(-scatter, scatter),
      y: to.y + to.height / 2 + Phaser.Math.FloatBetween(-scatter, scatter),
    };
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const control = arcControl(start, end, distance, arcFixed);

    const particle = scene.add
      .text(start.x, start.y, icon, { fontFamily: FONT_FAMILY, fontSize: `${size}px` })
      .setOrigin(0.5)
      .setDepth(depth)
      .setAlpha(0);

    const flight = { t: 0 };
    scene.tweens.add({
      targets: flight,
      t: 1,
      // 湧き出しは行動の経過いっぱいに散らす。等間隔だと粒が列に見えるので、間隔ごとに揺らす。
      delay: (spreadMs * index) / count + Phaser.Math.FloatBetween(0, spreadMs / Math.max(count, 1)),
      duration: Phaser.Math.Clamp((distance / metrics.px(1)) * FLY_MS_PER_UNIT, FLY_MIN_MS, FLY_MAX_MS),
      // 吸い寄せられるので、離れ際は遅く、着く直前が最も速い（PULL_POWER）。
      ease: (progress: number) => progress ** PULL_POWER,
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        const { t } = flight;
        const inverse = 1 - t;
        particle.setPosition(
          inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
          inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
        );
        const elapsed = tween.progress;
        particle.setAlpha(Math.min(elapsed / FADE_IN, 1, (1 - elapsed) / FADE_OUT));
      },
      onComplete: () => particle.destroy(),
    });
  }
}

/** 札の中心から見てランダムな向きに、縁まで伸ばして少しはみ出させた点。 */
function pointOnEdge(rect: Rect, metrics: ScreenMetrics): { x: number; y: number } {
  const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // その向きで縁に当たるまでの距離。0除算を避けるため、成分が潰れている軸は見ない。
  const toSide = Math.abs(cos) < 1e-6 ? Infinity : rect.width / 2 / Math.abs(cos);
  const toTop = Math.abs(sin) < 1e-6 ? Infinity : rect.height / 2 / Math.abs(sin);
  const distance =
    Math.min(toSide, toTop) + metrics.px(Phaser.Math.FloatBetween(SPAWN_MARGIN_MIN, SPAWN_MARGIN_MAX));

  return { x: rect.x + rect.width / 2 + cos * distance, y: rect.y + rect.height / 2 + sin * distance };
}

/** 二次ベジェの制御点。中点から、直線に対して垂直な向きへずらす。 */
function arcControl(
  start: { x: number; y: number },
  end: { x: number; y: number },
  distance: number,
  fixed: number,
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const offset =
    (fixed + distance * ARC_RATIO) * Phaser.Math.FloatBetween(0.5, 1) * (Phaser.Math.Between(0, 1) * 2 - 1);

  // 距離が0でも弧を残すため、向きが決まらないときは横向きへ逃がす。
  const normalX = distance < 1e-6 ? 1 : -dy / distance;
  const normalY = distance < 1e-6 ? 0 : dx / distance;

  return { x: (start.x + end.x) / 2 + normalX * offset, y: (start.y + end.y) / 2 + normalY * offset };
}

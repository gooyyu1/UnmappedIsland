/**
 * ワールドを変える操作1回を、頼まれてから見せ終わるまで運ぶ手順（CardInteraction.md 7節）。
 *
 * **決めるのは順序だけで、実際に見せるのは組み立て側（PlayScene）**。順序そのものに意味があり、
 * かつ入れ替えても例外は出ず画面が静かにおかしくなるだけの箇所——出来事は並びを差し替える前、
 * 増減はステータスへ反映する前——をここへ集めて、画面を作らずに確かめられるようにする。
 */

import type { EndingKind } from '../../domain/wrappers/Ending';

/**
 * 画面が今見せている最中のこと（PlayScene.activity）。
 *
 * - `idle`: 何も見せていない。操作を受け付けるのはこの間だけ。
 * - `exploring`: 探索の結果待ち。
 * - `elapsing`: 時間の経過を見せている。
 * - `transiting`: 土地を移って画面を作り直している。
 */
export type Activity = 'idle' | 'exploring' | 'elapsing' | 'transiting';

/**
 * ワールドを変える操作を受け付けるか。
 *
 * **見せている最中の画面は、今のワールドを映していない**——経過中は過去の時点を再現していて
 * （recordChange）、場面転換中は作り直しを暗幕で隠している。並んでいる札は既に古い対象を指して
 * いるので、そこからの操作を受け付けると、見えているものと起きることが食い違う。
 */
export function runsOperation(activity: Activity): boolean {
  return activity === 'idle';
}

/**
 * 行動の途中の値を見せているか。画面にはまだ経過前・経過中の状態が出ているので、バーもカードも
 * 減った分を縮めずに溜める（ProgressBar.setRatio）。
 *
 * **場面転換中は違う**——移った先の並びを作っている最中で、見せているのは経過し切った後の値。
 */
export function isMidAction(activity: Activity): boolean {
  return activity === 'elapsing' || activity === 'exploring';
}

/**
 * 経過を見せる手順（この順に実行する）。
 *
 * - `death`: 画面を死ぬ直前のまま止めてダイアログだけを出す。**これだけで終わる**——経過も結果も
 *   見せず、この先の操作も受け付けない。
 * - `gains`: 操作が増やしたキャラクタの値を粒にして飛ばす。効果が適用されるのは経過し切った時点
 *   だが、増えた量は押した瞬間に決まっている（ワールドは先に進み切っている）ので待たない。
 * - `replay`: 控えを実時間で再生する（ElapsePlayback）。**ここだけ時間がかかる**ので、続きは
 *   再生し切ってから運ぶ。
 * - `elapsed`: 経過し切った時点の並びを見せる（afterPlaybackSteps）。
 * - `escape`: 周回の終わりを出す。**見せ終わってから**——死と違って画面を止める必要はない。
 *   本土へ渡ったのは筏で、プレイヤーはその中に居るまま（現在地は筏）なので、映し直しても足元の
 *   物は入れ替わらない。
 */
export type PlaybackStep = 'death' | 'gains' | 'replay' | 'elapsed' | 'escape';

/**
 * minutesは経過するゲーム内時間（分）。0なら実時間をかけずに結果まで進む。
 * endingは周回の決着（Ending.kind）で、まだ終わっていなければundefined。
 */
export function playbackSteps(options: {
  readonly ending: EndingKind | undefined;
  readonly minutes: number;
}): readonly PlaybackStep[] {
  if (options.ending === 'death') return ['death'];

  const steps: PlaybackStep[] = options.minutes > 0 ? ['gains', 'replay', 'elapsed'] : ['gains', 'elapsed'];
  if (options.ending === 'escape') steps.push('escape');
  return steps;
}

/**
 * 経過し切った時点で運ぶ手順（この順に実行する）。
 *
 * - `refresh`: 今のワールドから画面の表示内容を作り直す。
 * - `noteChanges`: ステータスの増減を控える。**値を反映する前**——反映してしまうと、増減の記号を
 *   出す側（showInformation）が差を見られない。
 * - `found`: 見つかったものを発見物の枠へ引き取る（探索だけ）。**並びを差し替える前**——出どころの
 *   矩形は今出ている並びの上にしか無い。
 * - `transit`: 暗転したフィールドエリアを移動先のものへ作り直して明転する。
 * - `signals`: 告げられた出来事を札の上へ浮かべる。**並びを差し替える前**——効果がその物を消して
 *   いれば、差し替えた後の画面にその札はもう無い。
 * - `view`: 並びを差し替える。
 */
export type AfterPlaybackStep = 'refresh' | 'noteChanges' | 'found' | 'transit' | 'signals' | 'view';

/**
 * - moved: 土地を移った操作か。移った場合は出来事を出さない——出来事が起きた札は置いてきた土地の
 *   並びに居るので、指すべき札が無い。
 * - found: 探索の結果を見せるか。探索は土地を移らないので、transitとは同時に起きない。
 */
export function afterPlaybackSteps(options: {
  readonly moved: boolean;
  readonly found?: boolean;
}): readonly AfterPlaybackStep[] {
  const steps: AfterPlaybackStep[] = ['refresh', 'noteChanges'];
  if (options.found === true) steps.push('found');
  if (options.moved) steps.push('transit');
  else steps.push('signals', 'view');
  return steps;
}

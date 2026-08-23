import type { WorldCodex } from '../../domain/WorldCodex';
import type { StartedGame } from '../../domain/generation/NewGame';
import type { InteractionGains } from '../../domain/PropertyGain';
import type { WorldChange } from '../../domain/WorldChange';
import type { WorldSignal } from '../../domain/WorldSignal';
import type { Localization } from '../../locale/Localization';
import type { PlayScreenView } from './PlayScreenView';
import { fromGameSession, withFrozenCards } from './PlayScreenView';
import type { CardPlace } from './cardPlaces';
import { cardPlacesOf } from './cardPlaces';
import type { StatusDelta } from './statusChanges';
import { mergedStatuses, statusChangesBetween } from './statusChanges';

/**
 * ワールドを変えている途中の、あるtick境界での表示内容（runAndRecordChange）。
 *
 * ワールドは操作の実行時に一気に進み切るが、画面は実時間をかけて追いかける。経過中のtickで起きた変化を
 * その瞬間に見せるため、tickごとの表示内容を控えておいて再生する。
 */
export interface RecordedView {
  /** この控えが映している時刻（ゲーム内の総経過分。tick境界の絶対時刻になる）。 */
  readonly minutes: number;
  readonly view: PlayScreenView;
  /** 行動開始時からのステータスの増減。控えた時点までの分だけを見せる。 */
  readonly statusChanges: ReadonlyMap<string, StatusDelta>;
  /**
   * このtickで起きた物の出入り。**矩形に直すのは再生する時点**——出どころの札の位置は、その時点の
   * 画面（1つ前のtickの控え）にしか無い（HuntingSystem.md 6.1節）。
   */
  readonly changes: readonly WorldChange[];

  /** このtickで告げられた出来事（WorldSignal）。出す場所の決め方は出入りと同じ。 */
  readonly signals: readonly WorldSignal[];
}

/**
 * ワールドを変えた経過の控え（runAndRecordChange）。
 *
 * 経過し切った時刻の控えは持たない（その並びは行動の効果まで含めてonElapsedが見せる）ため、
 * そこで起きた出入りだけが控えから漏れる。changesAtEndがその分を引き取る。
 */
export interface Recording {
  /** 経過中の各tick境界の控え（実時間をかけて再生する分）。 */
  readonly ticks: readonly RecordedView[];
  /** 経過し切った時点で見せる分の出入り。 */
  readonly changesAtEnd: readonly WorldChange[];
  /**
   * 同じく、経過し切った時点で見せる分の出来事。アクションの効果は時間が経ち切ってから適用される
   * （ActionSystem.md 2節）ので、**操作が告げる出来事は通常こちらに入る**。
   */
  readonly signalsAtEnd: readonly WorldSignal[];
  /** 操作そのものが増やしたキャラクタの値（PropertyGain）。粒にして飛ばす（showGains）。 */
  readonly gains: readonly InteractionGains[];
}

/** 常に見えている3つのレーンが今映している場所（土地に居なければ手持ちだけ）。 */
function shownPlacesOf(game: StartedGame): readonly CardPlace[] {
  const location = game.player.location;
  if (location === undefined) return [];

  const places = cardPlacesOf(game.player, location);
  return [places('fixtures'), places('items'), places('hand')];
}

/**
 * ワールドを変える操作を実行し、経過中の各tick時点の表示内容を控えて返す（RecordedView）。
 *
 * ワールドはこの中で進み切る。経過中のtickは物を腐らせたり道具を壊したりするので、その変化が
 * 「45分の行動の15分目に起きた」と分かるよう、tickごとの表示内容を控える。実時間での再生は
 * 呼び出し側の仕事（PlayScene.passTime）——**ここは何も表示しない**ので、操作の列を与えて
 * 各tickの見え方を検査するテストがそのまま書ける。
 *
 * windowPlaceは、開いている子ウィンドウが映している場所。控えたviewをあとから表示するので、
 * **画面が引きうる場所の並びは控えた時点のものへ焼き付ける**（withFrozenCards）——3つのレーンと、
 * 開いている子ウィンドウ。焼き付けないと、経過を見せている途中の画面に行動の結果が先に現れる。
 */
export function runAndRecordChange(
  game: StartedGame,
  codex: WorldCodex,
  locale: Localization,
  windowPlace: CardPlace | undefined,
  change: () => void,
): Recording {
  const before = fromGameSession(game, codex, locale);
  // 出ていない行の増減も取りこぼさないよう、比べる元は全ステータス（重複は先勝ち）。
  const statusesBefore = mergedStatuses(before.statuses, before.propertyCategories);
  const recorded: RecordedView[] = [];
  let changes: WorldChange[] = [];
  let signals: WorldSignal[] = [];
  const gains: InteractionGains[] = [];

  game.session.observeGains(
    (interactionGains) => gains.push(interactionGains),
    () => {
      game.session.observeChanges(
        (worldChange) => changes.push(worldChange),
        () => {
          game.session.observeSignals(
            (signal) => signals.push(signal),
            () => {
              game.session.observeTicks(() => {
                const view = withFrozenCards(fromGameSession(game, codex, locale), [
                  ...shownPlacesOf(game),
                  windowPlace,
                ]);
                recorded.push({
                  minutes: game.world.totalMinutes,
                  view,
                  statusChanges: statusChangesBetween(
                    statusesBefore,
                    mergedStatuses(view.statuses, view.propertyCategories),
                  ),
                  changes,
                  signals,
                });
                changes = [];
                signals = [];
              }, change);
            },
          );
        },
      );
    },
  );

  const endedAt = game.world.totalMinutes;
  const ended = recorded.filter((snapshot) => snapshot.minutes >= endedAt);
  return {
    ticks: recorded.filter((snapshot) => snapshot.minutes < endedAt),
    changesAtEnd: [...ended.flatMap((snapshot) => snapshot.changes), ...changes],
    signalsAtEnd: [...ended.flatMap((snapshot) => snapshot.signals), ...signals],
    gains,
  };
}

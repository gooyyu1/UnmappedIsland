import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import { FLY_EASE, FLY_MS } from './cardFlight';

/**
 * 指の下の分身の後ろへ重ねて見せる枚数の上限と、1枚ごとのずらし幅（u単位）。
 * 何枚運んでいるかは右上の数字が正確に伝えるので、後ろの札は「1枚ではない」と分かれば足りる。
 */
const FAN_MAX = 4;
const FAN_OFFSET = 14;

/**
 * 指が運んでいる札——ポインタに追従する分身と、その後ろへ重ねてついてきた札
 * （CardInteraction.md 2節 カードのドラッグ＆ドロップ）。
 *
 * 札の出入りは必ず飛んで見せる。増えた1枚は元の枠から飛んできて（addOne）、あふれたぶんは
 * 元の枠へ飛んで帰る（keepAtMost）。落とさずに離せば全部が帰る（disband）。**手から離れた札は
 * 指について行かない**——帰る札は静止した層へ移し、元の枠まで真っ直ぐ飛ぶ。
 *
 * 元の束に何枚残っているかもここが数える。手に在る札も帰り道の空中の札もまだ束には居ないので、
 * そのぶん減る。残りをどう見せるか（数字・持ち出されて0になった枠の姿）は元のカード自身が決める
 * （Card.setRemaining）。
 */
export class CarriedCards {
  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;

  /** レーンに残っている元のカードと、掴んだ時点で映していた枚数。 */
  private readonly source: Card;
  private readonly sourceCount: number;
  /** 元の枠の今の矩形。レーンはスクロールで動くので、飛ぶたびに引き直す。 */
  private readonly home: () => Rect;
  /** 掴んだカードの見た目だけを写したもの。分身も、ついてくる札も、これで作る。 */
  private readonly face: CardContent;

  // 作る順がそのまま重なりの順。帰る札は手前に出る理由が無いので一番奥、ついてくる札は分身の
  // すぐ後ろ、指が運んでいる分身は常に見えている必要があるので一番手前。
  private readonly flightLayer: Phaser.GameObjects.Container;
  private readonly pile: Phaser.GameObjects.Container;
  private readonly ghost: Card;

  /** ついてきた枚数（分身の1枚は含まない）と、そのうち後ろに見えている札（新しいものが先頭）。 */
  private followers = 0;
  private readonly fan: Card[] = [];

  /** 元の枠へ帰る途中の札の数。着くまでは束にも手にも居ない。 */
  private flyingHome = 0;

  /** 掴んだ1枚が手（または帰り道の空中）に在るか。分身が元の枠へ着いたときだけ倒れる。 */
  private grabbed = true;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, source: Card, home: () => Rect) {
    this.scene = scene;
    this.metrics = metrics;
    this.source = source;
    this.sourceCount = source.content.count ?? 1;
    this.home = home;
    this.face = cardFace(source.content);

    this.flightLayer = scene.add.container(0, 0);
    this.pile = scene.add.container(0, 0);
    this.ghost = new Card(scene, metrics, 0, 0, this.face);
    this.refresh();
  }

  /** 運んでいる枚数（分身の1枚を含む）。そのままCardDrop.countになる。 */
  get count(): number {
    return 1 + this.followers;
  }

  /** 分身が今いる矩形。ドロップの出発点（CardDragHandlers.onDrop）とツールチップの位置決めに使う。 */
  get rect(): Rect {
    return { x: this.ghost.x, y: this.ghost.y, width: this.ghost.cardWidth, height: this.ghost.cardHeight };
  }

  /** 分身をポインタの中心へ置く。ついてくる札も一緒に動く。 */
  follow(x: number, y: number): void {
    this.ghost.setPosition(x - this.ghost.cardWidth / 2, y - this.ghost.cardHeight / 2);
    this.pile.setPosition(this.ghost.x, this.ghost.y);
  }

  /**
   * 1枚ついてくる。元の枠から指の下へ飛んできて、分身の後ろへ重なる。重ねて見せるのはFAN_MAX枚
   * までで、それを超えたぶんは着いた時点で束に溶ける——同じ場所には既に札が居るので、見た目の
   * 厚みは変わらない。
   */
  addOne(): void {
    this.followers += 1;

    const from = this.home();
    const card = new Card(this.scene, this.metrics, from.x - this.pile.x, from.y - this.pile.y, this.face);
    // 器の並び順がそのまま重なりの順。後から来た札ほど奥へ入れる。
    this.pile.addAt(card, 0);

    const merges = fanSize(this.followers) === fanSize(this.followers - 1);
    if (!merges) this.fan.unshift(card);

    const rest = -this.metrics.px(FAN_OFFSET) * fanSize(this.followers);
    this.scene.tweens.add({
      targets: card,
      x: rest,
      y: rest,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => {
        if (merges) card.destroy();
      },
    });
    this.refresh();
  }

  /**
   * 運ぶ枚数をその数まで減らす（足りていれば何もしない）。あふれた札は元の枠へ飛んで帰る。
   * 戻り値は枚数が変わったかどうか。
   */
  keepAtMost(max: number): boolean {
    const followers = Math.max(0, max - 1);
    if (followers >= this.followers) return false;

    const flights = fanSize(this.followers) - fanSize(followers);
    this.followers = followers;
    for (const card of this.fan.splice(0, flights)) this.flyHome(card);
    this.refresh();
    return true;
  }

  /**
   * 落とさずに離した。全部の札が元の枠へ飛んで帰り、着いた時点で自分ごと消える。
   * 以降このオブジェクトに用は無い（片付けは自分で済ませる）。
   */
  disband(): void {
    for (const card of this.fan.splice(0)) this.flyHome(card);
    this.followers = 0;

    const to = this.home();
    this.scene.tweens.add({
      targets: this.ghost,
      x: to.x,
      y: to.y,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => {
        this.grabbed = false;
        this.refresh();
        this.destroyObjects();
      },
    });
    this.refresh();
  }

  /**
   * その場で解散する（ドロップが成立した、または画面の作り直しで続けられない）。表示物を片付け、
   * 元の束の見え方を掴む前へ戻す。落としたぶんの本当の移動はワールドの差し替え（CardMotion）が見せる。
   */
  dissolve(): void {
    this.followers = 0;
    this.flyingHome = 0;
    this.grabbed = false;
    this.refresh();
    this.destroyObjects();
  }

  /** 手から離れた札を、静止した層へ移して元の枠へ飛ばす。着いた時点で束に溶ける。 */
  private flyHome(card: Card): void {
    this.scene.tweens.killTweensOf(card);
    const x = this.pile.x + card.x;
    const y = this.pile.y + card.y;
    this.pile.remove(card);
    this.flightLayer.add(card);
    card.setPosition(x, y);

    this.flyingHome += 1;
    const to = this.home();
    this.scene.tweens.add({
      targets: card,
      x: to.x,
      y: to.y,
      duration: FLY_MS,
      ease: FLY_EASE,
      onComplete: () => {
        this.flyingHome -= 1;
        card.destroy();
        this.refresh();
      },
    });
  }

  private destroyObjects(): void {
    this.ghost.destroy();
    this.pile.destroy();
    this.flightLayer.destroy();
  }

  /**
   * 手の中と元の束の見え方を、今の枚数に合わせる。ここ以外で表示は変えない——枚数を動かす側が
   * 表示の付け直しを覚えておかなくて済むように、変えた本人が必ずここを通る。
   */
  private refresh(): void {
    this.ghost.setContent({ ...this.face, count: this.count });

    // 画面を作り直していれば、元のカードはもう無い。
    if (this.source.scene === undefined) return;

    // 手に在る札（掴んだ1枚を含む）も帰り道の空中の札も、まだ束には居ない。全部持ち出して0に
    // なっても、そこは持ち出した札が帰ってくる枠なので印を残す（emptied）。
    const carried = (this.grabbed ? 1 : 0) + this.followers + this.flyingHome;
    this.source.setRemaining(this.sourceCount - carried, true);
  }
}

/** その枚数がついてきているとき、分身の後ろへ重ねて見せる札の数（FAN_MAXで頭打ち）。 */
function fanSize(followers: number): number {
  return Math.min(followers, FAN_MAX);
}

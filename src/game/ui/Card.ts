import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, SIZE, cssColor, durabilityColorFor } from './theme';
import { drawBox } from './shapes';
import { cardBackgroundTexture } from './backgroundArt';
import { CARD_ART_WIDTH, objectTexture } from './objectArt';
import { ProgressBar } from './ProgressBar';
import { onPressRelease } from './tap';
import { wrapByCharacter } from './textLayout';

/**
 * カードの枠の画像のテクスチャキー（実体はsrc/assets/card_frame.png、BootSceneが読む）。
 * カードの寸法（SIZE.cardWidth/cardHeight）はこの画像の比率に合わせてある。
 */
export const CARD_FRAME_TEXTURE = 'card-frame';

/** 空き枠は同じ枠の画像を薄く敷いて表す。 */
const EMPTY_FRAME_ALPHA = 0.35;

/**
 * カードの絵の中で紙そのものが占める範囲（u単位）。絵は820x1280pxで、紙は周囲に10pxの余白を空け、
 * 角の半径は64px。カードの実寸は絵と同じ比率なので、u単位へは1/4で直せる。
 * 図形で描く枠（破線の空き枠・画像が無いときの代用）を絵の輪郭に重ねるために使う。
 */
const FRAME_INSET = 2.5;
const FRAME_RADIUS = 16;

/** カード名の最大行数。これを超える分は表示しない（モックの-webkit-line-clamp: 3に対応）。 */
const NAME_MAX_LINES = 3;

/**
 * カード名を紙の縁から離す余白と、白い縁取りの太さ（u単位）。
 * 余白は角の丸み（FRAME_RADIUS）の内側へ収まる幅を取り、文字が枠の線に触れないようにする。
 * 縁取りは、絵の上に載った暗い文字の輪郭を保つためのもの。
 */
const NAME_MARGIN = 8;
const NAME_STROKE = 4;

/**
 * 押下中に紙の縁へ重ねる黒枠の太さ（u単位。ドロップ先を示す枠と揃える）。
 * 半透明にはしない——札が透けるとカードらしさが損なわれるため。
 */
const PRESSED_BORDER_WIDTH = 6;

/** 端の操作エリアの高さ（カード高さに対する比）。 */
const EDGE_RATIO = 1 / 6;

/** 押している間だけ出す、端の操作エリアのオーバーレイの濃さと矢印の大きさ（u単位）。 */
const EDGE_OVERLAY_ALPHA = 0.55;
const EDGE_ARROW_SIZE = 44;

/**
 * 端を押し続けたときの繰り返し（1枚ずつ送り続ける、addEdge参照）。
 *
 * HOLDは指を離さないまま1枚目が動くまで、REPEATは2枚目以降の間隔で、1枚送るごとにDECAYを掛けて
 * MINまで縮める。MINが最高速度で、50ミリ秒＝秒間20枚。100枚のスタックでも10秒はかからない。
 */
const EDGE_HOLD_MS = 400;
const EDGE_REPEAT_MS = 300;
const EDGE_REPEAT_MIN_MS = 50;
const EDGE_REPEAT_DECAY = 0.8;

/** スタック数を囲む丸の直径・絵の右上の角から外へはみ出させる量・中の数字の大きさ（u単位）。 */
const STACK_BADGE_SIZE = 56;
const STACK_BADGE_OVERHANG = 8;
const STACK_COUNT_SIZE = 32;

/**
 * 耐久度バーの高さ（u単位）。ステータスバー（36u）とは比べ物にならない細さにする——どの道具にも
 * 常に出ているものなので、見に行けば読めるが視界には入らない、という控えめさに留める。
 */
const DURABILITY_BAR_HEIGHT = 6;

/** 中身のバーの高さと、紙の左右から空ける余白・紙の下端から浮かせる高さ（u単位）。 */
const FILL_BAR_HEIGHT = 15;
const FILL_BAR_MARGIN = 28;
const FILL_BAR_BOTTOM = 72;

/** 移動先のレーンがカードのどちら側にあるか。 */
export type CardEdgeDirection = 'up' | 'down';

/**
 * カードの端（上下1/6）を押したときの操作。1回の呼び出しで束のうち1つが動く。
 * 押し続けている間は繰り返し呼ばれる（addEdge参照）。
 */
export interface CardEdgeAction {
  readonly direction: CardEdgeDirection;
  readonly onTap: () => void;
}

/**
 * 量として存在する中身が入っているカードが出す、中身のバーの内容
 * （ScreenLayout.md カードの状態バー節）。空の容器はバーごと持たない。
 */
export interface CardFill {
  /** 容器の容量に対する中身の割合（0〜1）。 */
  readonly ratio: number;

  /** 塗りの色。中身の液体が自分で宣言している色（`color`プロパティ）そのもの。宣言していない液体はundefined。 */
  readonly color?: number;
}

/** カード1枚の表示内容と操作。 */
export interface CardContent {
  readonly icon: string;
  readonly name: string;
  /**
   * 内容を差し替えたときに「前と同じカード」だと分かるための識別子（映しているインスタンスのID）。
   * 1枚が複数のインスタンス（スタック）を表すことがあるので集合で持ち、1つでも重なれば同じカードと
   * みなす。省略したカードは差し替えのたびに別のカードとして扱われる。
   */
  readonly identity?: readonly number[];
  /** 1枚が映しているインスタンスの数。2以上のときだけ、右上に丸で囲んだ数字として出す。 */
  readonly count?: number;
  /**
   * 絵を引くためのobject_defの識別子（objectArt参照）。その絵があれば枠の上に重ねて描き、
   * 無ければiconの絵文字で代用する。
   */
  readonly art?: string;
  /**
   * 地に敷く背景を引くための土地のobject_defの識別子（backgroundArt参照）。カードが「その土地に
   * 在るもの」だと分かるよう、絵の下に土地の景色を敷く。絵が無い土地では紙のまま。
   */
  readonly background?: string;
  /** カード全体を押したときの動作。持たないカードは押せない（押すと子ウィンドウを開くロケーションカード等）。 */
  readonly onTap?: () => void;
  /** 端だけを押したときの動作。端ではカード全体の動作より優先される。 */
  readonly edge?: CardEdgeAction;
  /** 掴んで他のカード・レーンへ落とせるカードか。ドラッグ中の扱いはCardDragController。 */
  readonly draggable?: boolean;
  /**
   * 名前を紙のどちら側へ寄せるか（既定は上）。主題が絵の上部にあるカード——顔が上端から始まる
   * キャラクタの肖像——だけが下を選ぶ。物の札の下半分は劣化度などの情報のために空けておく。
   */
  readonly namePosition?: 'top' | 'bottom';

  /** 耐久度（0〜1）。耐久度を持たないカードはundefined（バーそのものを出さない）。 */
  readonly durability?: number;

  /** 中身の割合（液体容器のカードだけが持つ）。 */
  readonly fill?: CardFill;

  /**
   * その行動の途中の値か（trueの間は状態バーの赤い帯を縮めず、合計の減少量を残す。
   * ProgressBar.setRatio参照）。
   */
  readonly midAction?: boolean;
}

/**
 * 見た目のぶんだけを取り出す（操作も識別子も引き継がない）。見せるためだけのカード——ドラッグ中の
 * 分身、探索で見つけたものの枠、スタックへ重なる1枚——を作るときに使う。
 */
export function cardFace(content: CardContent): CardContent {
  const { icon, name, art, background, namePosition, durability, fill } = content;
  return { icon, name, art, background, namePosition, durability, fill };
}

/**
 * フィールド・ハンド・ポートレイトに共通のカード。
 * 大きなアイコンを中央に敷き、名前を左上へ重ねる（ScreenLayout.md デザインメモ）。
 */
export class Card extends Phaser.GameObjects.Container {
  private _content: CardContent;
  get content(): CardContent {
    return this._content;
  }

  /** カードの実寸。ドラッグ中の分身やドロップ先の枠を同じ大きさで描くために公開する。 */
  readonly cardWidth: number;
  readonly cardHeight: number;

  /** スタック数の表示。個数は差し替えのたびに変わるので、作り直さず書き換える。 */
  private readonly stackBadge: Phaser.GameObjects.Container;
  private readonly stackCount: Phaser.GameObjects.Text;

  /**
   * カードの名前。中身を代表にしているカード（水入りの水筒）は、中身が入れ替わると名前も変わる
   * （Localization.mdのdisplay_name_with_content）ので、差し替えのたびに書き換える。
   */
  private readonly nameText: Phaser.GameObjects.Text;

  /**
   * 状態を表すバー（addStateBars参照）。その値を持たないカードには無い。値は差し替えのたびに
   * 書き換える——作り直すと、減った分を遅れて縮める動き（ProgressBar.setRatio）が途中で消える。
   *
   * 中身のバーだけは、映す中身そのものが出入りする（飲み干す・注がれる）ため、差し替えのたびに
   * 作り直しと片付けが起こりうる（updateFillBar参照）。
   */
  private readonly durabilityBar: ProgressBar | undefined;
  private fillBar: ProgressBar | undefined;

  /** バーを作り直すときに要る採寸（updateFillBar参照）。 */
  private readonly metrics: ScreenMetrics;

  /** 端を押し続けている間の繰り返し（addEdge参照）と、次の1枚までの間隔、既に送ったかどうか。 */
  private edgeRepeat: Phaser.Time.TimerEvent | undefined;
  private edgeRepeatDelay = EDGE_REPEAT_MS;
  private edgeRepeated = false;

  /** 今の押下がタップでなくなったか（cancelTap参照）。押し始めるたびに戻す。 */
  private tapCancelled = false;

  /** 押下中だけ出す黒枠（makeTappable参照）。押せないカードは持たない。 */
  private pressHighlight: Phaser.GameObjects.Graphics | undefined;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, content: CardContent) {
    super(scene, x, y);
    const { icon, name } = content;

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);
    this._content = content;
    this.cardWidth = width;
    this.cardHeight = height;
    this.metrics = metrics;

    const face = addFrame(scene, metrics, width, height, false);

    // 土地の背景は絵より先に敷く。用意されていない土地では紙がそのまま地になる。
    const backgroundTexture =
      content.background === undefined ? undefined : cardBackgroundTexture(content.background);
    const background =
      backgroundTexture !== undefined && scene.textures.exists(backgroundTexture)
        ? placeArt(scene, backgroundTexture, width, height)
        : undefined;

    // 絵があれば枠に重ねる。無いあいだは絵文字で代用する（絵は少しずつ用意されるため）。
    const artTexture = content.art === undefined ? undefined : objectTexture(content.art);
    const art =
      artTexture !== undefined && scene.textures.exists(artTexture)
        ? placeArt(scene, artTexture, width, height)
        : scene.add
            .text(width / 2, height / 2, icon, {
              fontFamily: FONT_FAMILY,
              fontSize: `${metrics.fontPx(96)}px`,
            })
            .setOrigin(0.5)
            .setAlpha(0.95);

    const paper = paperRect(metrics, width, height);
    const margin = metrics.px(NAME_MARGIN);
    const stroke = Math.max(1, metrics.px(NAME_STROKE));
    // 下寄せの名前は下端を固定して上へ伸ばす（行が増えても絵の下端との間が空かない）。
    const bottom = content.namePosition === 'bottom';
    const nameText = scene.add
      .text(paper.x + margin, bottom ? paper.y + paper.height - margin : paper.y + margin, name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
        maxLines: NAME_MAX_LINES,
      })
      .setOrigin(0, bottom ? 1 : 0)
      .setLineSpacing(metrics.px(2))
      .setStroke(cssColor(COLOR.cardFace), stroke);
    // 縁取りは文字の外側へ太さの半分だけ広がる。折り返し幅から引いて、右端の余白を左端と揃える。
    nameText.setWordWrapCallback(wrapByCharacter(paper.width - margin * 2 - stroke));
    this.nameText = nameText;

    this.add(background === undefined ? [face, art, nameText] : [face, background, art, nameText]);
    // 状態のバーは絵より後に足して上へ重ねる（絵の濃淡に埋もれないようにするため）。
    this.durabilityBar = this.addDurabilityBar(scene, metrics, width, height, content.durability);
    this.fillBar = this.addFillBar(scene, metrics, width, height, content.fill);

    if (artTexture !== undefined && !scene.textures.exists(artTexture)) {
      this.swapArtWhenLoaded(scene, artTexture, art, width, height);
    }
    if (content.onTap !== undefined || content.draggable === true) this.makeInteractive(width, height);
    if (content.onTap !== undefined) this.makeTappable(scene, metrics, width, height);
    // ドラッグはレーンの横スクロールと同じPhaserのdrag機構で受ける。重なった対象は最前面の1つだけが
    // 入力を受け取る（InputPlugin.topOnly）ため、カードを掴んでいる間レーンはスクロールしない。
    // 端の操作エリア（addEdge）はカードより手前にあってドラッグ対象ではないので、そこからは始まらない。
    if (content.draggable === true) scene.input.setDraggable(this);
    if (content.edge !== undefined) this.addEdge(scene, metrics, width, height, content.edge);

    // スタック数は端の操作エリアより後に足して、オーバーレイが出ている間も読めるようにする。
    this.stackCount = scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(STACK_COUNT_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0.5);
    this.stackBadge = this.addStackBadge(scene, metrics, width, height);
    this.add(this.stackBadge);
    this.showStackCount();

    scene.add.existing(this);
  }

  /**
   * 絵文字で代用中の絵が後から届いたら、自分で貼り替える。道のカードは行き先の土地の絵の
   * ロード完了（LocationArtLoader）を待たずに現れうるため。
   */
  private swapArtWhenLoaded(
    scene: Phaser.Scene,
    texture: string,
    placeholder: Phaser.GameObjects.GameObject,
    width: number,
    height: number,
  ): void {
    const event = Phaser.Textures.Events.ADD_KEY + texture;
    const swap = (): void => {
      const index = this.getIndex(placeholder);
      placeholder.destroy();
      this.addAt(placeArt(scene, texture, width, height), index);
    };
    scene.textures.once(event, swap);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.textures.off(event, swap));
  }

  /**
   * 同じインスタンスを映し続けるカードの表示内容を差し替える。アイコン・絵・端の向きは変わらない
   * 前提で、名前・スタック数・状態のバー・操作の実体（毎回作り直されるクロージャ）だけを新しくする。
   */
  setContent(content: CardContent): void {
    this._content = content;
    this.showStackCount();
    // 中身が入れ替われば同じインスタンスのままでも名前は変わる（「ヤシの殻」⇔「水入りのヤシの殻」）。
    if (this.nameText.text !== content.name) this.nameText.setText(content.name);

    const hold = content.midAction === true;
    if (content.durability !== undefined) this.durabilityBar?.setRatio(content.durability, hold);
    this.updateFillBar(hold);
  }

  /**
   * 中身のバーを今の内容へ合わせる。他のバーと違って、映す対象そのものが出入りする——飲み干せば
   * 中身は消え、注がれれば現れる——ので、値の書き換えだけでなく作り直しと片付けも要る。
   */
  private updateFillBar(hold: boolean): void {
    const fill = this._content.fill;
    if (fill === undefined) {
      this.fillBar?.destroy();
      this.fillBar = undefined;
      return;
    }

    if (this.fillBar === undefined) {
      this.fillBar = this.addFillBar(this.scene, this.metrics, this.cardWidth, this.cardHeight, fill);
      return;
    }
    this.fillBar.setRatio(fill.ratio, hold);
  }

  /**
   * 耐久度のバー。紙の下端の縁に接する形で、角の丸みに掛からない幅へ収める
   * （ScreenLayout.md カードの状態バー節）。
   */
  private addDurabilityBar(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
    durability: number | undefined,
  ): ProgressBar | undefined {
    if (durability === undefined) return undefined;

    const paper = paperRect(metrics, width, height);
    const barHeight = metrics.px(DURABILITY_BAR_HEIGHT);
    const inset = metrics.px(FRAME_RADIUS);
    const bar = new ProgressBar(
      scene,
      metrics,
      paper.x + inset,
      paper.y + paper.height - barHeight,
      paper.width - inset * 2,
      barHeight,
      durability,
      // 枠線は数pxの太さの大半を占めてしまうので描かない。
      { fillColor: durabilityColorFor, borderless: true },
    );
    this.add(bar);
    return bar;
  }

  /** 中身のバー。カードの主要情報なので、下端へは付けず絵の下へ置く。 */
  private addFillBar(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
    fill: CardFill | undefined,
  ): ProgressBar | undefined {
    if (fill === undefined) return undefined;

    const paper = paperRect(metrics, width, height);
    const barHeight = metrics.px(FILL_BAR_HEIGHT);
    const margin = metrics.px(FILL_BAR_MARGIN);
    const bar = new ProgressBar(
      scene,
      metrics,
      paper.x + margin,
      paper.y + paper.height - metrics.px(FILL_BAR_BOTTOM) - barHeight,
      paper.width - margin * 2,
      barHeight,
      fill.ratio,
      // 中身は入れ替わる（飲み干した水筒へ茶を注ぐ）ので、色は今の中身のものを引き直す。
      { fillColor: () => this._content.fill?.color ?? COLOR.cardFillUnknown },
    );
    this.add(bar);
    return bar;
  }

  /**
   * スタック数を囲む丸。数字はスタックが増減しても位置が動かないよう、丸の中心へ固定する。
   * 絵の右上の角からわざと少しはみ出させる（カードに載せ切るより、札束の厚みとして目に付くため）。
   */
  private addStackBadge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
  ): Phaser.GameObjects.Container {
    const paper = paperRect(metrics, width, height);
    const radius = metrics.px(STACK_BADGE_SIZE) / 2;
    const offset = radius - metrics.px(STACK_BADGE_OVERHANG);

    const circle = scene.add.graphics();
    circle.fillStyle(COLOR.cardFace, 1);
    circle.fillCircle(0, 0, radius);
    circle.lineStyle(Math.max(1, metrics.px(3)), COLOR.cardBorder, 1);
    circle.strokeCircle(0, 0, radius);

    return scene.add.container(paper.x + paper.width - offset, paper.y + offset, [circle, this.stackCount]);
  }

  private showStackCount(): void {
    const count = this._content.count ?? 1;
    this.stackBadge.setVisible(count >= 2);
    this.stackCount.setText(String(count));
  }

  /** Containerのdisplay originによるヒット領域のずれを避ける理由はButtonと同じ（サイズを設定しない）。 */
  private makeInteractive(width: number, height: number): void {
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
  }

  /** 押下中は紙の縁を黒枠でなぞる。枠は紙の輪郭（addFrameの図形と同じ矩形）に重ねる。 */
  private makeTappable(scene: Phaser.Scene, metrics: ScreenMetrics, width: number, height: number): void {
    const highlight = scene.add.graphics().setVisible(false);
    drawBox(highlight, paperRect(metrics, width, height), {
      border: COLOR.cardBorder,
      borderWidth: metrics.px(PRESSED_BORDER_WIDTH),
      radius: metrics.px(FRAME_RADIUS),
    });
    this.pressHighlight = highlight;
    this.add(highlight);

    onPressRelease(this, {
      onPress: () => {
        this.tapCancelled = false;
        highlight.setVisible(true);
      },
      onCancel: () => highlight.setVisible(false),
      onRelease: () => {
        highlight.setVisible(false);
        if (!this.tapCancelled) this._content.onTap?.();
      },
    });
  }

  /**
   * 今の押下をタップとして扱わない。掴んで動かす操作（カードのドラッグ・レーンの横スクロール）に
   * なったと分かった時点でCardDragControllerが呼ぶ。押下中の黒枠もここで引っ込める——押されている
   * ことを示す表示は、掴んだ時点で分身に役目を譲る。
   *
   * 押し始めたカードの上で指を離すと、動かしていてもタップとして成立してしまう（tap.ts）。
   * スタックの上の1枚を自分の位置へ重ねる操作（石と石の組み合わせ）や、カードを掴んだままの
   * レーンの横スクロールがこれに当たり、そのままでは操作のたびに子ウィンドウが開いてしまう。
   */
  cancelTap(): void {
    this.tapCancelled = true;
    this.pressHighlight?.setVisible(false);
  }

  /**
   * 隣のレーンへ移すための端の操作エリア。押している間だけ半透明のオーバーレイと矢印を出し、
   * どちら向きの操作なのかを示す。
   *
   * 押し続けると、指を離さないまま1枚目が動き、そのあとは間隔を詰めながら送り続ける
   * （EDGE_HOLD_MS・EDGE_REPEAT_MS）。短く押して離した場合だけ、離した時点で1枚動かす——
   * 押し続けて既に動き出しているなら、離したぶんをもう1枚足すことにはならない。
   *
   * ヒット領域はカード本体の後に足す。重なった対象のうち描画順が最前面の1つだけが入力を受け取る
   * （InputPlugin.topOnly）ため、これで端はカード全体の操作もドラッグも横取りする。透明でも描画される
   * Rectangleを使うのは、Zoneが描画リストへ載らず前後関係が決まらないため。
   */
  private addEdge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
    edge: CardEdgeAction,
  ): void {
    const up = edge.direction === 'up';
    const paper = paperRect(metrics, width, height);
    const edgeHeight = paper.height * EDGE_RATIO;
    const top = up ? paper.y : paper.y + paper.height - edgeHeight;
    const radius = metrics.px(FRAME_RADIUS);

    const overlay = scene.add.graphics();
    overlay.fillStyle(COLOR.cardEdgeOverlay, EDGE_OVERLAY_ALPHA);
    overlay.fillRoundedRect(
      paper.x,
      top,
      paper.width,
      edgeHeight,
      up ? { tl: radius, tr: radius, bl: 0, br: 0 } : { tl: 0, tr: 0, bl: radius, br: radius },
    );

    const arrow = scene.add
      .text(width / 2, top + edgeHeight / 2, up ? '▲' : '▼', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(EDGE_ARROW_SIZE)}px`,
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5);

    const feedback = scene.add.container(0, 0, [overlay, arrow]).setVisible(false);
    // 押せる範囲はカードの矩形いっぱいまで広げる。絵の余白は見た目だけのもので、そこを押しても
    // 端を押したことにしたいため。
    const hitArea = scene.add
      .rectangle(0, up ? 0 : top, width, up ? top + edgeHeight : height - top)
      .setOrigin(0, 0)
      .setInteractive();

    onPressRelease(hitArea, {
      onPress: () => {
        feedback.setVisible(true);
        this.startEdgeRepeat();
      },
      onCancel: () => {
        feedback.setVisible(false);
        this.cancelEdgeRepeat();
      },
      onRelease: () => {
        feedback.setVisible(false);
        const moved = this.edgeRepeated;
        this.cancelEdgeRepeat();
        if (!moved) this._content.edge?.onTap();
      },
    });

    // 指を離した先がこのカードの外だと端のpointerupが来ないため、シーン全体の離上でも必ず止める。
    // 送り続けるものが残っているので、止め損なうと押していないのに動き続けてしまう。
    const stop = (): void => this.cancelEdgeRepeat();
    scene.input.on(Phaser.Input.Events.POINTER_UP, stop);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.cancelEdgeRepeat();
      scene.input.off(Phaser.Input.Events.POINTER_UP, stop);
    });

    this.add([feedback, hitArea]);
  }

  /** 押し続けの繰り返しを始める。1枚目はEDGE_HOLD_MS後で、そこからは間隔を詰めていく。 */
  private startEdgeRepeat(): void {
    this.edgeRepeated = false;
    this.edgeRepeatDelay = EDGE_REPEAT_MS;
    this.scheduleEdgeRepeat(EDGE_HOLD_MS);
  }

  private scheduleEdgeRepeat(delay: number): void {
    this.edgeRepeat = this.scene.time.delayedCall(delay, () => {
      const edge = this._content.edge;
      if (edge === undefined) return;

      this.edgeRepeated = true;
      edge.onTap();
      // 送った結果このカードが空になっていれば、破棄されていてもう続けられない。
      if (this.scene === undefined) return;

      const next = this.edgeRepeatDelay;
      this.edgeRepeatDelay = Math.max(EDGE_REPEAT_MIN_MS, this.edgeRepeatDelay * EDGE_REPEAT_DECAY);
      this.scheduleEdgeRepeat(next);
    });
  }

  /** 繰り返しを止める。edgeRepeatedは離したときの判断に使うので、ここでは触らない。 */
  private cancelEdgeRepeat(): void {
    this.edgeRepeat?.remove();
    this.edgeRepeat = undefined;
  }
}

/**
 * 中身の無い固定枠を示すカード。固定枠スロット（fixed_positions、SlotSystem.md 3節）は空でも位置を
 * 保つため、枠だけを破線で描いて「ここは空いている」と分かるようにする。
 */
export class EmptyCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number) {
    super(scene, x, y);

    const face = addFrame(scene, metrics, metrics.px(SIZE.cardWidth), metrics.px(SIZE.cardHeight), true);

    this.add(face);
    scene.add.existing(this);
  }
}

/**
 * カードの枠。画像（CARD_FRAME_TEXTURE）があればそれを矩形いっぱいに貼り、無ければ図形で描く。
 * 画像を差し替えたり用意しなかったりしても画面が成り立つよう、図形の描画は残してある。
 *
 * emptyは中身の無い枠（EmptyCard）。画像なら薄く敷き、図形なら破線で描く。
 */
function addFrame(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
  empty: boolean,
): Phaser.GameObjects.GameObject {
  if (scene.textures.exists(CARD_FRAME_TEXTURE)) {
    const image = scene.add.image(0, 0, CARD_FRAME_TEXTURE).setOrigin(0, 0).setDisplaySize(width, height);
    if (!empty) return image;

    // 空き枠は紙を薄く敷いたうえに破線を重ねる。薄いだけだと明るい下地（子ウィンドウの台紙）で
    // ほとんど見えず、「枠がいくつあるか」が伝わらないため。
    image.setAlpha(EMPTY_FRAME_ALPHA);
    const outline = scene.add.graphics();
    drawBox(outline, paperRect(metrics, width, height), {
      border: COLOR.cardBorder,
      borderWidth: Math.max(1, metrics.px(2)),
      radius: metrics.px(FRAME_RADIUS),
      dashed: true,
    });
    return scene.add.container(0, 0, [image, outline]);
  }

  const face = scene.add.graphics();
  drawBox(face, paperRect(metrics, width, height), {
    fill: COLOR.cardFace,
    fillAlpha: empty ? 0.35 : 0.85,
    border: COLOR.cardBorder,
    borderWidth: Math.max(1, metrics.px(2)),
    radius: metrics.px(FRAME_RADIUS),
    dashed: empty,
  });
  return face;
}

/**
 * object_defの絵をカードの中央へ置く。
 *
 * 絵の大きさは画像そのものの寸法で決まる（CARD_ART_WIDTH参照）。小石は小さい画像、地形はカードと
 * 同じ縦横比の大きい画像で、どちらもこの一つの規則で正しい大きさになる。
 */
function placeArt(
  scene: Phaser.Scene,
  texture: string,
  width: number,
  height: number,
): Phaser.GameObjects.Image {
  const image = scene.add.image(width / 2, height / 2, texture).setOrigin(0.5);
  const scale = width / CARD_ART_WIDTH;
  return image.setDisplaySize(image.width * scale, image.height * scale);
}

/** カードの矩形の中で、絵の紙が占める範囲（FRAME_INSET参照）。 */
function paperRect(metrics: ScreenMetrics, width: number, height: number): Rect {
  const inset = metrics.px(FRAME_INSET);
  return { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };
}

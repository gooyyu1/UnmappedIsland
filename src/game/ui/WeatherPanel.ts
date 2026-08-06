import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { FlipCalendar } from './FlipCalendar';
import { addLabel } from './labels';
import { COLOR } from './theme';
import { drawBox } from './shapes';
import { weatherTexture } from './weatherArt';

/** 状況エリアのうち、空の絵を敷く範囲までの余白（紙に貼った窓に見えるよう、四辺を少し残す）。 */
const PANEL_INSET_PORTRAIT = { x: 16, y: 8 };
const PANEL_INSET_LANDSCAPE = { x: 8, y: 8 };

/** 窓の内側の余白。日時と天候名はこの内側に収める。 */
const CONTENT_PADDING_PORTRAIT = { x: 24, y: 20 };
const CONTENT_PADDING_LANDSCAPE = { x: 20, y: 16 };

/** 窓の角の丸めと縁の太さ。 */
const PANEL_RADIUS = 10;
const PANEL_BORDER = 3;

export interface WeatherPanelContent {
  /** 天気の識別子。これに対応する絵があれば敷き、無ければ単色の板になる（weatherArt参照）。 */
  readonly weather: string | undefined;
  readonly weatherLabel: string;
  readonly elapsedDays: number;
  readonly hour: number;
  readonly minute: number;
}

/**
 * 状況エリア（ScreenLayout.md）。**空を1枚の絵として見せ、その上に日時と天候名を載せる**——
 * 絵だけでは晴天どうしの区別が付かないため、名前はラベルが受け持つ。
 *
 * 載せ物は絵の主題（太陽・雲）を置く右上を必ず空ける。縦型は日時を左下・天候名を右下へ並べ、
 * 横型は幅が日時1つ分しかないので天候名を左上・日時を下端へ分ける。
 */
export class WeatherPanel extends Phaser.GameObjects.Container {
  private readonly calendar: FlipCalendar;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, area: Rect, content: WeatherPanelContent) {
    super(scene, 0, 0);

    const inset = metrics.isLandscape ? PANEL_INSET_LANDSCAPE : PANEL_INSET_PORTRAIT;
    const panel: Rect = {
      x: area.x + metrics.px(inset.x),
      y: area.y + metrics.px(inset.y),
      width: Math.max(0, area.width - metrics.px(inset.x) * 2),
      height: Math.max(0, area.height - metrics.px(inset.y) * 2),
    };

    this.addSky(scene, metrics, panel, content.weather);

    const padding = metrics.isLandscape ? CONTENT_PADDING_LANDSCAPE : CONTENT_PADDING_PORTRAIT;
    const padX = metrics.px(padding.x);
    const padY = metrics.px(padding.y);
    // 日時は窓の下端に付ける。桁の紙が絵の下側（地平線・海面）に重なるので、明るい空でも数字が沈まない。
    const calendarY = panel.y + panel.height - padY - FlipCalendar.height(metrics);
    this.calendar = new FlipCalendar(
      scene,
      metrics,
      panel.x + padX,
      calendarY,
      content.elapsedDays,
      content.hour,
      content.minute,
    );
    // 横型は日時が窓の幅をほぼ使い切るので、左右の余りを分けて中央へ寄せる。
    if (metrics.isLandscape) this.calendar.x = panel.x + (panel.width - this.calendar.contentWidth) / 2;

    const label = addLabel(scene, metrics, 0, 0, content.weatherLabel, {
      size: 38,
      bold: true,
      color: COLOR.textOnDark,
    });
    label.setShadow(0, metrics.px(2), 'rgba(0,0,0,0.7)', metrics.px(6), false, true);
    if (metrics.isLandscape) {
      // 日時が下端を占めるので、天候名は上の段へ。
      label.setOrigin(0, 0).setPosition(panel.x + padX, panel.y + padY);
    } else {
      // 縦型は日時の右。下端を日時と揃えると、絵の空いた右上がひと続きになる。
      //
      // 文字の枠ではなくベースラインを桁の紙の下端に合わせる。枠の下端で揃えると、下に伸びる字を
      // 持たない和文では枠の中のディセンダ分だけ文字が浮いて見えるため。
      const baseline = calendarY + FlipCalendar.height(metrics) - label.getTextMetrics().ascent;
      label.setOrigin(1, 0).setPosition(panel.x + panel.width - padX, baseline);
    }

    // 絵の上に載せるものは絵と同じ器へ入れる。器を後から表示リストへ足すと、外に置いたものが
    // 絵の下へ潜ってしまう。
    this.add([this.calendar, label]);
    scene.add.existing(this);
  }

  /** 表示する日時を差し替える（時間の経過を実時間で見せるため、毎フレーム呼ばれうる）。 */
  setTime(elapsedDays: number, hour: number, minute: number): void {
    this.calendar.setTime(elapsedDays, hour, minute);
  }

  /**
   * 空の絵。**右上の角を合わせて、はみ出す側（左・下）を切り落とす**——絵の主題は右上に描かれる
   * 約束なので、中央で合わせると縦横で切り出しが変わったときに主題ごと落ちてしまう。
   *
   * 絵がまだ無い天気では単色の板になる（絵は少しずつ増える前提、weatherArt参照）。
   */
  private addSky(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    panel: Rect,
    weather: string | undefined,
  ): void {
    const radius = metrics.px(PANEL_RADIUS);
    const texture = weatherTexture(weather);

    if (texture !== undefined && scene.textures.exists(texture)) {
      const image = scene.add.image(panel.x + panel.width, panel.y, texture).setOrigin(1, 0);
      const scale = Math.max(panel.width / image.width, panel.height / image.height);
      image.setDisplaySize(image.width * scale, image.height * scale);

      // 切り抜きはフィルタとしてのマスクで行う（Phaser 4のsetMaskはCanvas専用）。
      // マスクの形は表示物ではないので画面には出さない。
      const sky = scene.add.container(0, 0, [image]);
      const maskShape = scene.make.graphics({});
      maskShape.fillStyle(COLOR.cardFace, 1);
      maskShape.fillRoundedRect(panel.x, panel.y, panel.width, panel.height, radius);
      sky.enableFilters();
      sky.filters?.internal.addMask(maskShape);
      this.add(sky);
      this.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());
    } else {
      const fallback = scene.add.graphics();
      drawBox(fallback, panel, { fill: COLOR.weatherPanel, radius });
      this.add(fallback);
    }

    // 縁は絵の上に描く。紙に貼った窓に見せると同時に、キャラクターエリアとの区切りを兼ねる。
    const frame = scene.add.graphics();
    frame.lineStyle(Math.max(1, metrics.px(PANEL_BORDER)), COLOR.weatherPanelBorder, 0.45);
    frame.strokeRoundedRect(panel.x, panel.y, panel.width, panel.height, radius);
    this.add(frame);
  }
}

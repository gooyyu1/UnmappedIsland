import Phaser from 'phaser';
import type { ArtFile } from '../../art/artFiles';
import { locationArtFiles, locationCardArtFiles } from '../../art/artFiles';

/**
 * 土地の絵の遅延ロード。起動時にはロードされない土地の絵（artFiles参照）を、プレイ中に
 * シーンのローダで読み込む。
 *
 * ロード済みかどうかはTextureManager（全シーン共有）で判定するため、シーンを開き直しても
 * 読み直しは起きない。ロードに失敗した絵は「届いた」扱いにする——絵が無くても表示は絵文字・単色で
 * 成り立つ（Card・CardLane）ので、待ち続けるより先へ進む。
 */
export class LocationArtLoader {
  private readonly scene: Phaser.Scene;

  /** ロードを頼んだが、まだ完了も失敗もしていないテクスチャキー。 */
  private readonly inFlight = new Set<string>();

  /** ロードに失敗したテクスチャキー（再試行しない）。 */
  private readonly failed = new Set<string>();

  /**
   * ローダへまだ渡していない絵。ローダの実行中に追加した絵は黙って処理されないことがあるため、
   * 自前で待たせておき、手が空いたとき（pump）にまとめて渡す。
   */
  private readonly queue: ArtFile[] = [];

  private readonly waiters: { location: string; onLoaded: () => void }[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => this.onFileSettled(key));
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failed.add(file.key);
      this.onFileSettled(file.key);
    });
    scene.load.on(Phaser.Loader.Events.COMPLETE, () => this.pump());
  }

  /** その土地の絵のうち未ロードのものを読み始める（冪等）。 */
  request(location: string): void {
    this.load(locationArtFiles(location));
  }

  /**
   * その土地の土地カードの絵1枚だけを読み始める（冪等）。未発見の道の行き先用——道のカードは
   * 発見と同時に行き先の絵で現れるため、発見してからでは間に合わない。背景はまだ読まない。
   */
  requestCardArt(location: string): void {
    this.load(locationCardArtFiles(location));
  }

  private load(files: readonly ArtFile[]): void {
    for (const file of files) {
      const { key } = file;
      if (this.scene.textures.exists(key) || this.inFlight.has(key) || this.failed.has(key)) continue;
      this.inFlight.add(key);
      this.queue.push(file);
    }
    this.pump();
  }

  /** 待たせている絵をローダへ渡して読み始める。ローダの実行中なら何もしない（完了時に呼び直される）。 */
  private pump(): void {
    if (this.queue.length === 0 || this.scene.load.isLoading()) return;
    for (const { key, url } of this.queue.splice(0)) this.scene.load.image(key, url);
    this.scene.load.start();
  }

  /** その土地の絵がすべて届いているか（失敗した絵は待っても来ないので届いた扱い）。 */
  loaded(location: string): boolean {
    return locationArtFiles(location).every(
      ({ key }) => this.scene.textures.exists(key) || this.failed.has(key),
    );
  }

  /**
   * その土地の絵がすべて届いたらonLoadedを1回呼ぶ。既に届いていればその場で同期に呼ぶ——
   * 待ちが無いときの呼び出し側の流れ（場面転換）を従来どおりに保つため。
   */
  onceLoaded(location: string, onLoaded: () => void): void {
    this.request(location);
    if (this.loaded(location)) {
      onLoaded();
      return;
    }
    this.waiters.push({ location, onLoaded });
  }

  /** 1枚の完了・失敗を受けて、揃った待ちを呼ぶ。 */
  private onFileSettled(key: string): void {
    this.inFlight.delete(key);
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (!this.loaded(this.waiters[i].location)) continue;
      const [waiter] = this.waiters.splice(i, 1);
      waiter.onLoaded();
    }
  }
}

import Phaser from 'phaser';
import { locationArtFiles } from './locationArt';

/**
 * 土地の絵の遅延ロード。起動時にはロードされない土地の絵（locationArt参照）を、プレイ中に
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

  private readonly waiters: { location: string; onLoaded: () => void }[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => this.settle(key));
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failed.add(file.key);
      this.settle(file.key);
    });
  }

  /** その土地の絵のうち未ロードのものを読み始める（冪等）。 */
  request(location: string): void {
    let added = false;
    for (const { key, url } of locationArtFiles(location)) {
      if (this.scene.textures.exists(key) || this.inFlight.has(key) || this.failed.has(key)) continue;
      this.inFlight.add(key);
      this.scene.load.image(key, url);
      added = true;
    }
    if (added && !this.scene.load.isLoading()) this.scene.load.start();
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
  private settle(key: string): void {
    this.inFlight.delete(key);
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (!this.loaded(this.waiters[i].location)) continue;
      const [waiter] = this.waiters.splice(i, 1);
      waiter.onLoaded();
    }
  }
}

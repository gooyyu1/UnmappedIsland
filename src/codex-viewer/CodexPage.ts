import type { CodexView } from './CodexView';

/**
 * ビューアの1ページ（`#/<route>/<引数>…`）。
 *
 * **描き替えを跨いで生きる。** ルートごとに1つだけ作って使い回すので、開き直しても残るもの
 * （図の倍率、描いた表）はここのフィールドに置ける。
 *
 * 中身のHTMLを作るだけでなく、**描き込んだ後の配線と、名指しされた節へ送ることまで自分で持つ**。
 * ページを1つ足すときに、組み立て側（main.ts）へ手を入れずに済ませるため。
 */
export abstract class CodexPage {
  /** `#/<route>/…` のroute。既定のページ（オブジェクト一覧）は空文字。 */
  abstract readonly route: string;

  /** 中身のHTML。argsはrouteより後ろ。**その引数では出せないものを指されたらundefined**。 */
  abstract render(view: CodexView, args: readonly string[]): string | undefined;

  /** 描き込んだ後の配線。**既定は何もしない**——配線を持つページのほうが少ない。 */
  wire(): void {}

  /**
   * `#/<route>/<名前>` が名指しした節まで送る。**ハッシュはルーティングに使っている**ので、
   * ブラウザ任せのアンカー移動は使えない。
   */
  scrollToSection(name: string): void {
    const id = this.sectionId(name);
    if (id !== undefined) document.getElementById(id)?.scrollIntoView(this.scrollOptions);
  }

  /** その名前が付いた要素のid。**節へ送らないページはundefined**（1ページに全部が並ぶページだけが持つ）。 */
  protected sectionId(_name: string): string | undefined {
    return undefined;
  }

  /** 節へ寄せるやり方（既定は先頭合わせ）。 */
  protected get scrollOptions(): ScrollIntoViewOptions | undefined {
    return undefined;
  }
}

# ui-hud

## 集計

| ファイル | 宣言数 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| src/game/ui/Button.ts | 26 | 21 | 0 | 1 | 2 | 2 |
| src/game/ui/Curtain.ts | 6 | 4 | 1 | 0 | 1 | 0 |
| src/game/ui/DustPuff.ts | 19 | 18 | 1 | 0 | 0 | 0 |
| src/game/ui/FlipCalendar.ts | 18 | 16 | 0 | 2 | 0 | 0 |
| src/game/ui/GainParticles.ts | 15 | 13 | 0 | 2 | 0 | 0 |
| src/game/ui/LocationArtLoader.ts | 14 | 12 | 1 | 0 | 1 | 0 |
| src/game/ui/ProgressBar.ts | 42 | 38 | 0 | 3 | 0 | 1 |
| src/game/ui/ProgressRing.ts | 15 | 14 | 0 | 0 | 1 | 0 |
| src/game/ui/ScreenAlertFrame.ts | 7 | 5 | 0 | 2 | 0 | 0 |
| src/game/ui/ScreenHeader.ts | 6 | 5 | 1 | 0 | 0 | 0 |
| src/game/ui/ScreenSkyTint.ts | 3 | 3 | 0 | 0 | 0 | 0 |
| src/game/ui/ScrollIndicator.ts | 18 | 17 | 0 | 0 | 1 | 0 |
| src/game/ui/StatusBar.ts | 70 | 64 | 0 | 2 | 1 | 3 |
| src/game/ui/WeatherOverlay.ts | 16 | 15 | 0 | 1 | 0 | 0 |
| src/game/ui/WeatherPanel.ts | 19 | 19 | 0 | 0 | 0 | 0 |
| src/game/ui/signalLabel.ts | 6 | 5 | 0 | 1 | 0 | 0 |
| **合計** | **300** | **269** | **4** | **14** | **7** | **6** |

判定1の内訳は書かない。判定2は4件とも同型（`Phaser.GameObjects` を継承しない部品が `scene` を
自分で抱える／インスタンス状態を持たないクラス）なので、明細では1行にまとめた。

## 責務の1文

| クラス/モジュール | 責務（1文） | 1文から漏れるメンバー |
|---|---|---|
| Button | 角丸の矩形を押しボタンとして振る舞わせ、中身を載せる | `SLOT_BUTTON_PAPER_TEXTURE`, `SLOT_BUTTON_PAPER_FRAME`（クラスは一切触らない。スロットボタンの絵の話）／`tabBoxStyle`（タブの台紙の色の話） |
| Curtain | 矩形を暗転・明転させて場面の切れ目を覆う | なし |
| DustPuff | 札の中心から砂埃の粒を散らして消す | なし |
| FlipCalendar | 日時を吊り下げ式の桁として並べて出す | `IMAGE_PAPER_HEIGHT`, `IMAGE_RING_OVERHEAD`（生成スクリプトが作った画像の実寸の話） |
| GainParticles | 増えた量を、出どころからキャラクタへ吸われる粒として飛ばす | `pointOnEdge`, `arcControl`（矩形と二次ベジェの幾何の話） |
| LocationArtLoader | 土地の絵を遅延ロードし、揃ったら知らせる | クラスごと。表示物を1つも作らない |
| ProgressBar | 割合を、遅れて追いつく帯付きの横バーとして描く | `alertBorderColor`（域→色の対応表） |
| ProgressRing | 経過の割合を輪として塗る**と**、経過分を数字で出す | `elapsed`（数字は輪ではない） |
| ScreenAlertFrame | 致命的域の間、画面の内周を赤く明滅させる | なし |
| ScreenHeader | 戻るボタンと画面名を上部のバーとして並べる | なし（ただしインスタンス状態を持たず、実体は関数＋高さ計算） |
| ScreenSkyTint | 日射の翳り・輝きを画面全体へ1枚かぶせる | なし |
| ScrollIndicator | 横送りの量を半透明のつまみとして示す | なし |
| StatusBar | ステータス1件を「印＋見出し＋バー＋増減」の1行として出し、並び替えを動きで見せる | `StatusInfluence`, `StatusStage`, `StatusDetail`, `StatusContent.detail`（すべて詳細ウィンドウの内容で、この行は読まない）／`fitted`（文字を幅に収める汎用） |
| WeatherOverlay | 天気に応じて雨を敷き詰めて降らせる | `scatter`（種から決まる乱数列） |
| WeatherPanel | 空の絵の上に日時と天候名を載せた帯を出す | なし |
| signalLabel | 出来事の1語を札の上に浮かべて消す | なし |

## 明細（判定2以上）

| 現在地 | 名前 | 層 | 判定 | 根拠 | 移動先候補 | 阻害要因(判定4のみ) | 名前不一致 |
|---|---|---|---|---|---|---|---|
| src/game/ui/Button.ts | `SLOT_BUTTON_PAPER_TEXTURE`, `SLOT_BUTTON_PAPER_FRAME` | 配置 | 5 | `Button` はこの2つを一度も参照せず、読むのは BootScene（ロード）と PlayScene（スロットボタン列の紙）だけ。 | `src/art/`（絵のキーと実寸を答えるモジュール） | | |
| src/game/ui/Button.ts | `Button`（クラス） | 配置 | 4 | クラス本体が使うのは Rect・BoxStyle・drawBox・onPressRelease と `COLOR.pressedShade` だけで、ゲームの語彙も寸法も持たない。 | `src/ui/Button.ts` | 押下の覆いの色を意匠（`COLOR.pressedShade`）から直に引いており、汎用の部品は意匠を引けない（CodeStructure.md 1節）。既定値＋起動時差し替え（`ui/labels.ts` の `setLabelDefaults` 方式）にするまで出られない | |
| src/game/ui/Button.ts | `tabBoxStyle` | 所属 | 4 | 「選ばれているタブの台紙は何色か」は意匠の問いで、6ファイルがここへ色を訊きに来ている。 | `src/game/looks/theme.ts` | 文字ボタンの台紙（`textButtonBoxStyle`）と縁の色・角の丸みを必ず一致させる必要があり、その組み立てがこのファイルにあるため | |
| src/game/ui/Button.ts | `HOLD_MS` | 配置 | 3 | 同じ「長押しと見なす400ms」が `src/ui/holdRepeat.ts` にも非公開で置かれていて、一致すべき値が2箇所にある。 | `src/ui/holdRepeat.ts`（公開して共有） | | |
| src/game/ui/Curtain.ts | `Curtain`（クラス） | 配置 | 4 | 矩形を覆って暗転・明転するだけで、ゲームの語彙も寸法も持たない。 | `src/ui/Curtain.ts` | 幕の色を意匠（`COLOR.curtain`）から直に引いているため | |
| src/game/ui/ScrollIndicator.ts | `ScrollIndicator`（クラス） | 配置 | 4 | つまみの位置と長さの計算は既に `src/ui/scroll.ts` にあり、残りは半透明の矩形を2つ描いて薄れさせるだけ。 | `src/ui/ScrollIndicator.ts` | 色（`COLOR.scrollBar*`）と厚み（`SIZE.scrollBar`）を意匠トークンから直に引いているため | |
| src/game/ui/LocationArtLoader.ts | `LocationArtLoader`（クラス） | 配置 | 4 | 表示物を1つも作らず持たない——部品の定義（Phaserの表示物を作る・持ち続ける・触らせる）に当てはまらない。 | `src/game/LocationArtLoader.ts`（組み立て側） | `scene.load`・TextureManager に触る必要があり、Phaserに触れてよいのが部品と組み立てだけのため | |
| src/game/ui/ProgressRing.ts#ProgressRing | `elapsed` | 所属 | 4 | 中央の大きな数字は「輪」ではなく、輪の外径より広い別の表示物。 | (なし) | 輪と数字が同じ瞬間を指す保証を、呼び出し側の手順にしないため（`setRatio(ratio, elapsedMinutes)` が1回で両方を差し替える） | |
| src/game/ui/StatusBar.ts | `StatusInfluence`, `StatusStage`, `StatusDetail` | 配置 | 5 | 3つとも `StatusBar` は一度も読まず（`detail` は素通し）、実際の読み手は `StatusDetailWindow.ts` と映しだけ。 | `src/game/ui/StatusDetailWindow.ts` | | |
| src/game/ui/StatusBar.ts#StatusContent | `detail` | 所属 | 4 | 行を描くのに使わない値を、行の内容の1フィールドとして運んでいる。 | `StatusDetailWindow` 側の内容型（`StatusDetailContent`） | 行の内容と詳細の内容を1つの型にしておくことで、映し（PlayScreenView）が行ごとに2つの内容を組み立てずに済み、行が差し替わっても「今の詳細」が自動で付いてくる | |
| src/game/ui/StatusBar.ts | `createLabel` | 所属 | 3 | 行の見出しを作るのは行自身の仕事だが、`this` を使わないためモジュール関数として外に出ている。 | `StatusBar` の private メソッド | | |
| src/game/ui/StatusBar.ts | `fitted` | 配置 | 3 | 「文字を幅に収める」汎用処理で、同じ関心の `truncateToWidth` が既に `src/ui/textLayout.ts` にある（収め方だけが違う）。 | `src/ui/textLayout.ts` | | ○（縮めて収める、と名前からは読めない） |
| src/game/ui/ProgressBar.ts | `alertBorderColor` | 所属 | 5 | 域から色を引く対応表で、同種の `statusFillColorFor` は `looks/theme.ts` にある。 | `src/game/looks/theme.ts` | | |
| src/game/ui/ProgressBar.ts | `BLINK_DURATION_MS`, `BLINK_MIN_ALPHA` | 配置 | 3 | 同じ「警戒の明滅」の速さ・薄さが `ScreenAlertFrame.ts` にも別々の値（450/0.15 と 450/0.1）で書かれている。 | `src/game/looks/theme.ts`（明滅の意匠トークン） | | |
| src/game/ui/ScreenAlertFrame.ts | `BLINK_DURATION_MS`, `BLINK_MIN_ALPHA` | 配置 | 3 | 上と同じ1つの意匠が2箇所に分かれている。 | `src/game/looks/theme.ts`（明滅の意匠トークン） | | |
| src/game/ui/ProgressBar.ts | `TRACK_BORDER_WIDTH` | 配置 | 3 | 枠線の太さという意匠トークンで、外周を寄せる `Card.addRailBar` が部品から部品へ読みに来ている。 | `src/game/looks/theme.ts` の `SIZE` | | |
| src/game/ui/FlipCalendar.ts | `IMAGE_PAPER_HEIGHT`, `IMAGE_RING_OVERHEAD` | 配置 | 3 | 生成スクリプト（flip_card.py）と一致していなければならない画像の実寸で、絵の側の知識。 | `src/art/`（`SLOT_BUTTON_PAPER_FRAME` と同じ置き場） | | |
| src/game/ui/GainParticles.ts | `pointOnEdge`, `arcControl` | 所属 | 3 | 矩形の縁の点と二次ベジェの制御点という純粋な幾何で、粒の演出とは独立。 | `src/ui/`（矩形・曲線の幾何）または `looks/cardFlight.ts` の近く | | |
| src/game/ui/WeatherOverlay.ts | `scatter` | 配置 | 3 | 種から決まる汎用の乱数列（mulberry32）で、雨とは関係がない。 | `src/util/` | | ○（雨粒を散らす関数に見えるが、返すのは乱数列） |
| src/game/ui/signalLabel.ts | `floatSignalLabel`（戻り値） | 可視性 | 3 | 自分で片付ける演出なのに `Text` を返しており、その戻り値の唯一の用途は呼び出し側が `SCREEN_DEPTH` を与えること——`DustPuff`・`GainParticles` は自分で depth を与えている。 | 関数内で `SCREEN_DEPTH` を与え、戻り値を `void` にする | | |
| src/game/ui/{Curtain,DustPuff,LocationArtLoader}.ts | `scene`（private readonly） | 所属 | 2 | `Phaser.GameObjects` を継承しない3つが、後で tween・loader を呼ぶためだけに `scene` を自分で抱える。 | — | | |
| src/game/ui/ScreenHeader.ts | `ScreenHeader`（クラス） | 所属 | 2 | インスタンスの状態を1つも持たず、実体は「バーを組み立てる関数」と「高さを答える計算」の同居。 | — | | |

## 移動先が書けなかったもの

- `ProgressRing.elapsed`（判定4）。輪と数字は別の表示物だが、**「同じ瞬間を指す2つの表示を、1回の呼び出しで
  差し替えさせる」という概念が無い**ため、保証を得る唯一の手段としてクラスの中へ同居させている。
  この概念（1つの断面を受け取って自分の中の複数の表示物へ配る箱、あるいは映し側の「経過の断面」）があれば、
  輪と数字はそれぞれ別の部品に戻せる。

## ファイル配置（層=配置）についての所見

- CodeStructure.md の「このゲームを消しても1文字も変わらないなら `src/ui/`」を全クラスに当てると、
  **`Button`・`Curtain`・`ScrollIndicator` の3つは中身が汎用**で、ゲームに縛っているのは
  `COLOR.pressedShade` / `COLOR.curtain` / `COLOR.scrollBar*`＋`SIZE.scrollBar` という**意匠の引き込み1点ずつ**
  だけだった。CodeStructure.md は `Button` を「汎用に見えて実はゲーム固有」の例として挙げているが、その根拠に
  されているスロットボタンの紙のテクスチャキーは**クラスが一度も参照していないモジュール定数**で、
  例そのものが今の実装と食い違っている。残り13クラスは寸法・語彙・素材のどれかを実際に抱えており、
  `src/game/ui/` に居るのが妥当。
- 逆向きの越境として、`LocationArtLoader` だけが**表示物を作らない**（`src/game/ui/` は表示物の置き場）。
  Phaser の Loader を触る都合でここに居る。
- 意匠（`looks/`）へ出るべきものが部品側に散っている。域→色の対応（`alertBorderColor`）、警戒の明滅の
  速さ（2ファイルに別々の値）、タブの台紙の色（`tabBoxStyle`）、トラックの枠線幅（`TRACK_BORDER_WIDTH`）。
  一方で**単一の部品の中だけで閉じている寸法・時間の定数は妥当**（CodeStructure.md 3節の「寸法を抱えていれば
  このゲームの部品」に一致する）ので、そこは判定1にしている。
- 画像の実寸（生成スクリプトと一致すべき値）が `Button.ts` と `FlipCalendar.ts` に別々に置かれている。
  素材の寸法は `src/art/` が答える形に揃えられる。
- `StatusBar.ts` は**2つの契約が同居している**。行の契約（`StatusContent` の大半・`StatusLabel`・
  `StatusBarOptions`）と、詳細ウィンドウの契約（`StatusInfluence`・`StatusStage`・`StatusDetail`・
  `StatusContent.detail`）で、後者の読み手はこのファイルに居ない。70宣言のうち19が後者側。

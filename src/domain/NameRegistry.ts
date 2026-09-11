/**
 * YAML上の識別子（ObjectDef名・プロパティ名・スロット名など）と、実行時に扱うグローバルIDを
 * 相互変換する。「名前の空間」ごとに1つ用意する（WorldCodexが持つ名前空間ごとに別インスタンス）。
 * ロード完了後はinternを呼ばず、読み取り専用として扱う想定。
 *
 * 型引数はこの名前空間が配るIDの型（{@link GlobalId}）。**素の `number` とIDの境界はこのクラスの中
 * だけ**——名前から引く経路しか外に開いていないので、YAMLに書かれた数・生成物から読んだ数・URLの
 * 数値が、そのままIDとして通ることがない。既定の `number` は、**まだ種類を分けていない名前空間の
 * ためのつなぎ**——それらは互いのIDを渡し合えるままで、分けた順に型引数が埋まっていく。
 */
export class NameRegistry<Id extends number = number> {
  private readonly nameToId = new Map<string, Id>();
  private readonly idToName: string[] = [];

  get count(): number {
    return this.idToName.length;
  }

  /** 名前を登録し、そのグローバルIDを返す。登録済みなら既存のIDを返す（冪等）。 */
  intern(name: string): Id {
    const existing = this.nameToId.get(name);
    if (existing !== undefined) return existing;

    // 配った添字がそのままIDになる。番号を決めているのはここだけなので、印を足すのもここだけ。
    const id = this.idToName.length as Id;
    this.idToName.push(name);
    this.nameToId.set(name, id);
    return id;
  }

  tryGetId(name: string): Id | undefined {
    return this.nameToId.get(name);
  }

  getId(name: string): Id {
    const id = this.nameToId.get(name);
    if (id === undefined) throw new Error(`'${name}' はまだ登録されていません。`);
    return id;
  }

  getName(id: Id): string {
    return this.idToName[id];
  }

  /** 登録されていないIDならundefined（エラーの文面のように、名前を出せないことがありうる場所で使う）。 */
  tryGetName(id: Id): string | undefined {
    return this.idToName[id] as string | undefined;
  }
}

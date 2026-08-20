/**
 * YAML上の識別子（ObjectDef名・プロパティ名・スロット名など）と、実行時に扱うグローバルなnumberを
 * 相互変換する。「名前の空間」ごとに1つ用意する（object用・property用・slot用は別々のインスタンス）。
 * ロード完了後はinternを呼ばず、読み取り専用として扱う想定。
 */
export class NameRegistry {
  private readonly nameToId = new Map<string, number>();
  private readonly idToName: string[] = [];

  get count(): number {
    return this.idToName.length;
  }

  /** 名前を登録し、そのグローバルIDを返す。登録済みなら既存のIDを返す（冪等）。 */
  intern(name: string): number {
    const existing = this.nameToId.get(name);
    if (existing !== undefined) return existing;

    const id = this.idToName.length;
    this.idToName.push(name);
    this.nameToId.set(name, id);
    return id;
  }

  tryGetId(name: string): number | undefined {
    return this.nameToId.get(name);
  }

  getId(name: string): number {
    const id = this.nameToId.get(name);
    if (id === undefined) throw new Error(`'${name}' はまだ登録されていません。`);
    return id;
  }

  getName(id: number): string {
    return this.idToName[id];
  }

  /** 登録されていないIDならundefined（エラーの文面のように、名前を出せないことがありうる場所で使う）。 */
  tryGetName(id: number): string | undefined {
    return this.idToName[id] as string | undefined;
  }
}

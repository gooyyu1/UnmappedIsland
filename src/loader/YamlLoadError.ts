/** WorldCodexのYAMLロード中に検出した、定義データの構文・内容の誤りを表す。 */
export class YamlLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'YamlLoadError';
  }
}

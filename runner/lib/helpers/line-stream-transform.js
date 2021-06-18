import ReadlineTransform from 'readline-transform';

/* eslint-disable no-underscore-dangle,no-nested-ternary */

export default class LineStreamTransform extends ReadlineTransform {
  /**
   *
   * @param {import("./line-stream-transform.js").LineStreamTransformOptions} options
   */
  constructor(options = {}) {
    const defaultTransformOptions = { readableObjectMode: true };
    const {
      transform: _,
      prefix = '',
      lineEndings = false,
      ...readlineTransformOptions
    } = options;
    super({ ...defaultTransformOptions, ...readlineTransformOptions });
    this._prefix = prefix;
    this._suffix = lineEndings
      ? typeof lineEndings === 'string'
        ? lineEndings
        : '\n'
      : '';
  }

  /** @param {string} line */
  _writeItem(line) {
    if (line.length > 0 || !(/** @type {any} */ (this)._skipEmpty)) {
      this.push(`${this._prefix}${line}${this._suffix}`);
    }
  }
}

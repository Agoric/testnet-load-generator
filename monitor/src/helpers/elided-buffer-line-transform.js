/* global Buffer */
/* eslint-disable no-underscore-dangle */

import BufferLineTransform from './buffer-line-transform.js';

export default class ElidedBufferLineTransform extends BufferLineTransform {
  /**
   * The ElidedBufferLineTransform is a BufferLineTransform which cuts long lines
   * by eliding data at a given position
   *
   * @param {import('./elided-buffer-line-transform.js').ElidedBufferLineTransformOptions} [options]
   */
  constructor(options) {
    const {
      maxLineLength = 1152,
      elisionOffset,
      elisionJoiner = Buffer.from('...'),
      ...superOptions
    } = options || {};
    super(superOptions);

    const minLength =
      /** @type {{_breakLength: number}} */ (/** @type {unknown} */ (this))
        ._breakLength + elisionJoiner.length;
    this._maxLineLength = Math.max(minLength, maxLineLength);
    this._elisionJoiner = elisionJoiner;
    this._elisionOffset = Math.max(
      0,
      Math.min(
        this._maxLineLength - minLength,
        elisionOffset != null
          ? elisionOffset
          : Math.round((this._maxLineLength - elisionJoiner.length) / 2),
      ),
    );
  }

  /**
   * @param {Buffer} line
   */
  _writeItem(line) {
    if (line.length > this._maxLineLength) {
      line = Buffer.concat([
        line.subarray(0, this._elisionOffset),
        this._elisionJoiner,
        line.subarray(
          this._elisionOffset +
            this._elisionJoiner.length -
            this._maxLineLength,
        ),
      ]);
    }
    this.push(line);
  }
}

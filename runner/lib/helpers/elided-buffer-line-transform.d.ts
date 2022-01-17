/* eslint-disable no-undef,no-unused-vars */

import BufferLineTransform from './buffer-line-transform.js';
import type { BufferLineTransformOptions } from './buffer-line-transform.js';

export interface ElidedBufferLineTransformOptions
  extends BufferLineTransformOptions {
  /** Maximum length of a line (default: 1152) */
  maxLineLength?: number;
  /** Location in the line where to start removing data from (default: maxLineLength / 2) */
  elisionOffset?: number;
  /** The Buffer to use when stitching the line back together (default: Buffer.from('...')) */
  elisionJoiner?: Buffer;
}

export default class ElidedBufferLineTransform extends BufferLineTransform {
  constructor(options?: ElidedBufferLineTransformOptions);
}

/* eslint-disable no-undef,no-unused-vars */

/// <reference types="node" />

import { Transform, TransformOptions } from 'stream';

export interface BufferLineTransformOptions extends TransformOptions {
  /** line break matcher for Buffer.indexOf() (default: 10 ) */
  break?: Buffer | string | number;
  /** if break is a string, the encoding to use */
  breakEncoding?: BufferEncoding;
}

export default class BufferLineTransform extends Transform {
  constructor(options?: BufferLineTransformOptions);
}

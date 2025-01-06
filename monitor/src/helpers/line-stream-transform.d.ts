import type ReadlineTransform, {
  ReadlineTransformOptions,
} from 'readline-transform';

export interface LineStreamTransformOptions extends ReadlineTransformOptions {
  /** optional prefix to prepend for each line */
  prefix?: string;
  /** ending for each line. If true, a new line is added. */
  lineEndings?: boolean | string;
}

export default class LineStreamTransform extends ReadlineTransform {
  constructor(options?: LineStreamTransformOptions);
}

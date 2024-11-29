/** @typedef {number} TimeValueS */

/**
 * @param {number} [resolution] number of decimal digits
 * @param {number} [inputAdjustment] number of decimal digits the input is already shifted
 */
export const makeRounder = (resolution = 6, inputAdjustment = 0) => {
  const factor = 10 ** resolution;
  const valueFactor = 10 ** (resolution - inputAdjustment);
  /**
   * @param {number} value
   * @returns {number}
   */
  return (value) => Math.round(value * valueFactor) / factor;
};

/**
 * @param {object} param0
 * @param {Pick<Performance, 'timeOrigin' | 'now'>} param0.performance
 * @param {number} [param0.resolution] number of decimal digits
 * @param {TimeValueS} [param0.offset] origin offset to apply
 */
export const makeTimeSource = ({
  performance,
  resolution = 6,
  offset: initialOffset = 0,
}) => {
  const offsetMs = initialOffset * 1000;
  const rounder = makeRounder(resolution, 3);

  const timeOrigin = rounder(performance.timeOrigin + offsetMs);
  const getTime = () => rounder(performance.timeOrigin + performance.now());
  const now = () => rounder(performance.now() - offsetMs);
  const shift = (offset = now()) =>
    makeTimeSource({ performance, resolution, offset: offset + initialOffset });

  return { timeOrigin, getTime, now, shift };
};

/** @typedef {ReturnType<typeof makeTimeSource>} TimeSource */

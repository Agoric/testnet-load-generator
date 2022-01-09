// import { openSync, closeSync } from 'fs';

import { basename, dirname, join as joinPath } from 'path';

import { childProcessDone } from './child-process.js';

/**
 * @callback FindByPrefix
 * @param {string} prefix
 * @returns {Promise<string>}
 */

/**
 * @callback DirDiskUsage
 * @param {string} rootDir
 * @param {Object} [options]
 * @param {number} [options.minFileSize]
 * @returns {Promise<Record<string, number>>}
 */

/**
 * Make a FIFO file readable stream
 *
 * @callback MakeFIFO
 * @param {string} name
 * @returns {Promise<import("fs").ReadStream>}
 */

/**
 * @typedef FsHelper
 * @property {FindByPrefix} findByPrefix
 * @property {DirDiskUsage} dirDiskUsage
 * @property {MakeFIFO} makeFIFO
 */

/** @typedef {Pick<import("fs"), 'createReadStream' | 'createWriteStream'>} fsStream */

/**
 *
 * @param {Object} powers
 * @param {import("fs/promises")} powers.fs Node.js promisified fs object
 * @param {fsStream} powers.fsStream Node.js fs stream operations
 * @param {import("child_process").spawn} powers.spawn Node.js spawn
 * @param {string} powers.tmpDir Directory location to place temporary files in
 * @returns {FsHelper}
 *
 */
export const makeFsHelper = ({ fs, fsStream, spawn, tmpDir }) => {
  /** @type {FindByPrefix} */
  const findByPrefix = async (prefix) => {
    const parentDir = dirname(prefix);
    const prefixBase = basename(prefix);

    const name = (await fs.readdir(parentDir)).find((dir) =>
      dir.startsWith(prefixBase),
    );
    if (!name) {
      throw new Error(`Couldn't find dir entry starting with prefix`);
    }
    return joinPath(parentDir, name);
  };

  // TODO: figure out why tsc complains when using /** @type {DirDiskUsage} */
  /**
   * @param {string} rootDir
   * @param {Object} [options]
   * @param {number} [options.minFileSize]
   */
  const dirDiskUsage = async (rootDir, { minFileSize = 5 } = {}) => {
    /** @type {Record<string, number>} */
    const book = {};

    /**
     * @param {string} subpath
     */
    const processDir = async (subpath) => {
      const dirEntNames = await fs.readdir(joinPath(rootDir, subpath));
      const dirEntStats = await Promise.all(
        dirEntNames.map(
          /**
           * @param {string} name
           * @returns {Promise<[string, import('fs').Stats]>}
           * */
          async (name) => [
            joinPath(subpath, name),
            await fs.lstat(joinPath(rootDir, subpath, name)),
          ],
        ),
      );
      for (const [path, stat] of dirEntStats) {
        if (stat.isDirectory()) {
          // Await the recursion here to provide some level of order and parallelism limit
          // eslint-disable-next-line no-await-in-loop
          await processDir(path);
        } else if (stat.isFile()) {
          // A linux fs block is 512 bytes
          // https://man7.org/linux/man-pages/man2/stat.2.html
          const size = stat.blocks / 2;
          if (size >= minFileSize) {
            book[path] = stat.blocks / 2;
          }
        } else {
          console.error('Unexpected file type', joinPath(rootDir, path));
        }
      }
    };

    await processDir('');

    return book;
  };

  /** @type {MakeFIFO} */
  const makeFIFO = async (name) => {
    const fifoPath = joinPath(tmpDir, basename(name));
    await childProcessDone(spawn('mkfifo', [fifoPath], { stdio: 'inherit' }));

    const stream = fsStream.createReadStream(fifoPath, {
      emitClose: true,
      // Large buffer
      // TODO: Make configurable
      highWaterMark: 1024 * 1024,
    });

    // eslint-disable-next-line no-underscore-dangle
    const originalStreamDestroy = stream._destroy;
    // eslint-disable-next-line no-underscore-dangle
    stream._destroy = (error, callback) => {
      const internalStream = /** @type {{closed: boolean, fd: number | null}} */ (
        /** @type {unknown} */ (stream)
      );
      if (!internalStream.closed && typeof internalStream.fd !== 'number') {
        console.warn(
          'FIFO was never opened for write, self opening to unblock process.',
        );
        // Unblock node's internal read open
        (async () => (await fs.open(fifoPath, 'a')).close())();
        // closeSync(openSync(fifoPath, 'a'));
      }

      originalStreamDestroy.call(stream, error, callback);
    };

    stream.once('close', () => {
      // TODO: log errors
      fs.rm(fifoPath);
    });

    return stream;
  };

  return harden({ dirDiskUsage, findByPrefix, makeFIFO });
};

/**
 *
 * @param {import("fs").ReadStream | import("fs").WriteStream} stream
 * @returns {Promise<void>}
 */
export const fsStreamReady = (stream) =>
  new Promise((resolve, reject) => {
    if (stream.destroyed) {
      reject(new Error('Stream already destroyed'));
      return;
    }

    if (!stream.pending) {
      resolve();
      return;
    }

    stream.destroyed;

    const onReady = () => {
      cleanup(); // eslint-disable-line no-use-before-define
      resolve();
    };

    /** @param {Error} err */
    const onError = (err) => {
      cleanup(); // eslint-disable-line no-use-before-define
      reject(err);
    };

    const cleanup = () => {
      stream.off('ready', onReady);
      stream.off('error', onError);
    };

    stream.on('ready', onReady);
    stream.on('error', onError);
  });

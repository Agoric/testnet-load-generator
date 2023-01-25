import path from 'path';

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);
/** @param {string[]} paths */
export const pathResolveShim = (...paths) => path.resolve(dirname, ...paths);

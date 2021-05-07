
const zip = (xs, ys) => xs.map((x, i) => [x, ys[i]]);
const { keys, values, fromEntries } = Object;
export const allValues = async obj =>
  fromEntries(zip(keys(obj), await Promise.all(values(obj))));

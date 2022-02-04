export const deepEquals = (a, b) => {
  if (Object.is(a, b)) {
    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  const aKeys = [...Object.keys(a)].sort();
  const bKeys = [...Object.keys(b)].sort();

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every((key, i) => {
    return bKeys[i] === key && deepEquals(a[key], b[key]);
  });
};

export const debounce =
  (fn, snapFromArgs = (snap) => snap) =>
  async (...args) => {
    const snap = snapFromArgs(...args);
    const now = await snap.ref.once('value');

    if (!deepEquals(snap.val(), now.val())) {
      return null;
    }

    return fn(...args);
  };

// The main-thread VM lacks Object.hasOwn. Effect's development bundle initializes
// Schema helpers which use it; production tree shaking can hide this dependency.
if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    value: (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key),
    writable: true,
    configurable: true,
  });
}

export {};

// The Lynx test shim writes dataset keys directly into jsdom's DOMStringMap.
// Native keys such as "automation-id" must instead be set as data attributes.
const addDataset: typeof elementTree.__AddDataset = (element, key, value) => {
  element.setAttribute(`data-${key}`, value);
};
const setDataset: typeof elementTree.__SetDataset = (element, dataset) => {
  for (const [key, value] of Object.entries(dataset)) {
    addDataset(element, key, String(value));
  }
};
const methods = { __AddDataset: addDataset, __SetDataset: setDataset };
const previous = Reflect.get(globalThis, 'onInjectMainThreadGlobals');
Reflect.set(globalThis, 'onInjectMainThreadGlobals', (target: object) => {
  if (typeof previous === 'function') {
    previous(target);
  }
  Object.assign(target, methods);
});
if (typeof lynxTestingEnv !== 'undefined') {
  Object.assign(lynxTestingEnv.mainThread.globalThis, methods);
}

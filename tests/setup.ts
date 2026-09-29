// jsdom localStorage polyfill — Node.js 22+ injects its own non-standard
// localStorage that lacks clear(), removeItem(), and indexed access.
// This replaces it with a spec-compliant in-memory store.

const store = new Map<string, string>();

const polyfill: Storage = {
  get length(): number {
    return store.size;
  },
  clear(): void {
    store.clear();
  },
  getItem(key: string): string | null {
    const val = store.get(String(key));
    return val === undefined ? null : val;
  },
  key(index: number): string | null {
    const keys = Array.from(store.keys());
    return keys[index] ?? null;
  },
  removeItem(key: string): void {
    store.delete(String(key));
  },
  setItem(key: string, value: string): void {
    store.set(String(key), String(value));
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: polyfill,
  writable: true,
  configurable: true,
});

// jsdom scrollIntoView polyfill
Element.prototype.scrollIntoView = () => {};

// @testing-library/jest-dom matchers (toBeInTheDocument, toBeVisible, etc.)
import "@testing-library/jest-dom/vitest";

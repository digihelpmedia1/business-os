// Test stub: no request context outside Next.js.
export async function headers() {
  return new Headers();
}
export async function cookies() {
  const store = new Map<string, string>();
  return {
    get: (k: string) => (store.has(k) ? { name: k, value: store.get(k)! } : undefined),
    set: (k: string, v: string) => void store.set(k, v),
    delete: (k: string) => void store.delete(k),
  };
}

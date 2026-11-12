// "Try an example" pulls a random SKU from the master list, once per click.

const URL = 'data/all-skus.txt?v=__V__';
let list = null;

async function load() {
  if (!list) {
    list = fetch(URL)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => text.split('\n').map((s) => s.trim()).filter(Boolean))
      .catch(() => []);
  }
  return list;
}

/** A different random SKU each call, or null if the list cannot be read. */
export async function randomSku() {
  const skus = await load();
  if (!skus.length) return null;
  return skus[Math.floor(Math.random() * skus.length)];
}

import type { Locator } from '@playwright/test';

/** Real pointer interaction with a native horizontal range, including its ends. */
export async function clickRangeEdge(range: Locator, edge: 'min' | 'max') {
  await range.scrollIntoViewIfNeeded();
  const box = await range.boundingBox();
  if (!box) throw Error('Range is not visible');
  await range.click({ position: { x: edge === 'min' ? 1 : box.width - 1, y: box.height / 2 } });
}

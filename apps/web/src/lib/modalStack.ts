/**
 * Open modals, bottom → top. Every <Modal> listens for keys on `window`; only the one on top of
 * this stack may react (Esc closes one dialog at a time, Tab is trapped in the top one).
 */
const stack: symbol[] = [];

/** Registers a modal as the top-most one; returns its id. */
export function pushModal(): symbol {
  const id = Symbol("modal");
  stack.push(id);
  return id;
}

export function popModal(id: symbol): void {
  const at = stack.lastIndexOf(id);
  if (at >= 0) stack.splice(at, 1);
}

export function isTopModal(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

export function openModalCount(): number {
  return stack.length;
}

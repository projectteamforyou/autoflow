/**
 * IME composition (Korean, Japanese, Chinese…): the Enter that confirms a composition must never be
 * read as "commit this field". During composition browsers report `isComposing`; Safari fires the
 * confirming keydown *after* compositionend, where only the legacy `keyCode === 229` gives it away.
 */
interface KeyLike {
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  preventDefault?: () => void;
}

/** True for a keydown that belongs to an IME composition. Accepts React and DOM keyboard events. */
export function isImeKey(e: KeyLike): boolean {
  return e.nativeEvent?.isComposing === true || e.isComposing === true || e.keyCode === 229 || e.nativeEvent?.keyCode === 229;
}

/**
 * `onKeyDown` for a <form> (or one of its fields): stops the composition-confirming Enter from
 * submitting the form. Every other key — including a normal Enter — is left alone.
 */
export function blockImeSubmit(e: KeyLike): void {
  if (e.key === "Enter" && isImeKey(e)) e.preventDefault?.();
}

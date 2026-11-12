/** Text entry keeps native editing; game shortcuts own the remaining keyboard. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('textarea,[contenteditable="true"],input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=color]):not([type=hidden]):not([type=image])');
}

/** Also covers dynamically mounted dialogs, native controls and SVG handles. */
export function installInputOnlyFocus(root: HTMLElement): () => void {
  const selector = 'button,a[href],select,summary,input,textarea,[contenteditable],[tabindex]';
  const update = (element: Element) => {
    if (element.matches(selector) && !isTextEntry(element) && element.getAttribute('tabindex') !== '-1') element.setAttribute('tabindex', '-1');
  };
  const scan = (element: Element) => { update(element); element.querySelectorAll(selector).forEach(update); };
  scan(root);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') update(record.target as Element);
      else for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', 'type', 'href', 'contenteditable'] });
  const blurControl = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof Element && !isTextEntry(target) && 'blur' in target) (target as HTMLElement).blur();
  };
  root.addEventListener('focusin', blurControl);
  return () => { observer.disconnect(); root.removeEventListener('focusin', blurControl); };
}

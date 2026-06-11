const clipboardGuardKey = '__puzzleTowerClipboardGuardCleanup';
const editableSelector = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]';

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest(editableSelector));
}

function shouldAllowClipboard(event) {
  return event.defaultPrevented || isEditableTarget(event.target);
}

export function blockPaste() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  if (window[clipboardGuardKey]) {
    return window[clipboardGuardKey];
  }

  const handlePaste = (event) => {
    if (shouldAllowClipboard(event)) {
      return;
    }
    event.preventDefault();
  };

  const handleKeyDown = (event) => {
    const key = String(event.key || '').toLowerCase();
    const isClipboardShortcut = (event.ctrlKey || event.metaKey) && (key === 'c' || key === 'v');

    if (!isClipboardShortcut || shouldAllowClipboard(event)) {
      return;
    }
    event.preventDefault();
  };

  document.addEventListener('paste', handlePaste, true);
  document.addEventListener('keydown', handleKeyDown, true);

  const cleanup = () => {
    document.removeEventListener('paste', handlePaste, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    window[clipboardGuardKey] = null;
  };

  window[clipboardGuardKey] = cleanup;
  return cleanup;
}

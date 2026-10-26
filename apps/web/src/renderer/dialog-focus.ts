// The window redraws its markup. Keep modal focus by control selector, not by detached DOM node.
const CONTROLS = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export class DialogFocus {
  private frames: { key: string; returnTo: string | null }[] = [];
  private background: HTMLElement[] = [];
  current: HTMLElement | null = null;

  sync(root: HTMLElement, previousFocus: string | null): void {
    for (const el of this.background) el.inert = false;
    this.background = [];
    const dialogs = [...root.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
      .filter((el) => !el.closest('.leave'));
    const key = (el: HTMLElement): string => el.closest<HTMLElement>('[data-leave]')?.dataset.leave ?? el.getAttribute('aria-label') ?? '';
    const keys = dialogs.map(key);
    let restore = previousFocus;
    while (this.frames.length && !keys.includes(this.frames[this.frames.length - 1]!.key)) {
      restore = this.frames.pop()!.returnTo;
    }
    const dialog = dialogs.at(-1) ?? null;
    this.current = dialog;
    if (dialog && this.frames.at(-1)?.key !== key(dialog)) this.frames.push({ key: key(dialog), returnTo: restore });

    // Inert every sibling along the path, including the page behind a sheet inside <main>.
    if (dialog) {
      dialog.tabIndex = -1;
      let child: HTMLElement = dialog;
      while (child !== root && child.parentElement) {
        for (const sibling of child.parentElement.children) {
          if (sibling instanceof HTMLElement && sibling !== child && !sibling.inert) {
            sibling.inert = true;
            this.background.push(sibling);
          }
        }
        child = child.parentElement;
      }
    }
    // The same selector can name several elements: a journal row and its title both open the save point, Jump to has a
    // button in the rail and one in the phone toolbar, and a sheet's trigger can repeat on the page behind a phone dialog.
    // Focus goes to the first one that can take focus, is on screen and is inside the open dialog, if there is one.
    const usable = (el: HTMLElement): boolean => (el.tabIndex >= 0 || el.hasAttribute('tabindex')) && el.getClientRects().length > 0 && !el.closest('[inert]') && (!dialog || dialog.contains(el));
    const target = restore ? [...root.querySelectorAll<HTMLElement>(restore)].find(usable) ?? null : null;
    if (target && !target.matches(':disabled')) {
      target.focus({ preventScroll: true });
    } else if (dialog && !dialog.contains(document.activeElement)) {
      // A dialog can name the control that matters most (the Rewind's dial, a finished check's main
      // action). Otherwise the first control gets focus.
      const controls = this.controls(dialog);
      const named = dialog.querySelector<HTMLElement>('[data-autofocus]');
      (named && controls.includes(named) ? named : controls[0] ?? dialog).focus({ preventScroll: true });
    }
  }

  trapTab(e: KeyboardEvent): boolean {
    const dialog = this.current;
    if (!dialog || e.key !== 'Tab') return false;
    const controls = this.controls(dialog);
    const first = controls[0] ?? dialog;
    const last = controls.at(-1) ?? dialog;
    if (!dialog.contains(document.activeElement) || document.activeElement === dialog ||
        (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
    return true;
  }

  private controls(dialog: HTMLElement): HTMLElement[] {
    return [...dialog.querySelectorAll<HTMLElement>(CONTROLS)]
      .filter((el) => !el.closest('[inert]') && el.tabIndex >= 0 && el.getClientRects().length > 0);
  }
}

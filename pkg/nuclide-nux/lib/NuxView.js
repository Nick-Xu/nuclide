'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import {CompositeDisposable, Disposable} from 'atom';
import debounce from '../../commons-node/debounce';
import {maybeToString} from '../../commons-node/string';
import {track} from '../../nuclide-analytics';
import {getLogger} from '../../nuclide-logging';

const VALID_NUX_POSITIONS = new Set(['top', 'bottom', 'left', 'right', 'auto']);
// The maximum number of times the NuxView will attempt to attach to the DOM.
const ATTACHMENT_ATTEMPT_THRESHOLD = 5;
const ATTACHMENT_RETRY_TIMEOUT = 500; // milliseconds
const RESIZE_EVENT_DEBOUNCE_DURATION = 100; // milliseconds
// The frequency with which to poll the element that the NUX is bound to.
const POLL_ELEMENT_TIMEOUT = 100; // milliseconds

const logger = getLogger();

function validatePlacement(position: string) : boolean {
  return VALID_NUX_POSITIONS.has(position);
}

export class NuxView {
  _selector : (() => ?HTMLElement);
  _position: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  _content: string;
  _customContent: boolean;
  _disposables : CompositeDisposable;
  _callback: ?((success: boolean) => void);
  _tooltipDisposable: IDisposable;
  _completePredicate: (() => boolean);
  _tooltipDiv: HTMLElement;
  _tourId: number;
  _index: number;

  /**
   * Constructor for the NuxView.
   *
   * @param {number} tourId - The ID of the associated NuxTour
   * @param {?string} selectorString - The query selector to use to find an element
    on the DOM to attach to. If null, will use `selectorFunction` instead.
   * @param {?Function} selectorFunction - The function to execute to query an item
    on the DOM to attach to. If this is null, will use `selectorString` inside
    a call to `document.querySelector`.
   * @param {string} position - The position relative to the DOM element that the
    NUX should show.
   * @param {string} content - The content to show in the NUX.
   * @param {boolean} customContent - True iff `content` is a valid HTML String.
   * @param {?(() => boolean)} completePredicate - Will be used when determining whether
   * the NUX has been completed/viewed. The NUX will only be completed if this returns true.
   * If null, the predicate used will always return true.
   * @param {number} indexInTour - The index of the NuxView in the associated NuxTour
   *
   * @throws Errors if both `selectorString` and `selectorFunction` are null.
   */
  constructor(
    tourId: number,
    selectorString: ?string,
    selectorFunction : ?Function,
    position: 'top' | 'bottom' | 'left' | 'right' | 'auto',
    content: string,
    customContent: boolean = false,
    completePredicate: ?(() => boolean) = null,
    indexInTour: number,
  ) : void {
    this._tourId = tourId;
    if (selectorFunction != null) {
      this._selector = selectorFunction;
    } else if (selectorString != null) {
      this._selector = () => document.querySelector(selectorString);
    } else {
      throw new Error('Either the selector or selectorFunction must be non-null!');
    }
    this._content = content;
    this._position = validatePlacement(position) ? position : 'auto';
    this._customContent = customContent;
    this._completePredicate = completePredicate || (() => true);
    this._index = indexInTour;

    this._disposables = new CompositeDisposable();
  }

  _createNux(creationAttempt: number = 1): void {
    if (creationAttempt > ATTACHMENT_ATTEMPT_THRESHOLD) {
      this._onNuxComplete(false);
      // An error is logged and tracked instead of simply throwing an error since this function
      // will execute outside of the parent scope's execution and cannot be caught.
      const error = `NuxView #${this._index} for NUX#"${this._tourId}" `
                      + 'failed to succesfully attach to the DOM.';
      logger.error(`ERROR: ${error}`);
      this._track(
       error,
       error,
      );
      return;
    }
    const elem: ?HTMLElement = this._selector();
    if (elem == null) {
      const attachmentTimeout =
        setTimeout(this._createNux.bind(this, creationAttempt + 1), ATTACHMENT_RETRY_TIMEOUT);
      this._disposables.add(new Disposable(() => {
        if (attachmentTimeout !== null) {
          clearTimeout(attachmentTimeout);
        }
      }));
      return;
    }

    this._tooltipDiv = document.createElement('div');
    this._tooltipDiv.className = 'nuclide-nux-tooltip-helper';
    elem.classList.add('nuclide-nux-tooltip-helper-parent');
    elem.appendChild(this._tooltipDiv);

    this._createDisposableTooltip();

    const debouncedWindowResizeListener =
      debounce(this._handleWindowResize.bind(this), RESIZE_EVENT_DEBOUNCE_DURATION, false);
    window.addEventListener('resize', debouncedWindowResizeListener);

    // Destroy the NUX if the element it is bound to is no longer visible.
    const tryDismissTooltip = element => {
      // ヽ༼ຈل͜ຈ༽/ Yay for documentation! ᕕ( ᐛ )ᕗ
      // According to https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/offsetParent,
      // `offsetParent` returns `null` if the parent or element is hidden.
      // However, it also returns null if the `position` CSS of the element is
      // `fixed`. This case requires a much slower operation `getComputedStyle`,
      // so try and avoid it if possible.
      let isHidden;
      if (element.style.position !== 'fixed') {
        isHidden = element.offsetParent === null;
      } else {
        isHidden = window.getComputedStyle(element).display === 'none';
      }
      if (isHidden) {
        // Consider the NUX to be dismissed and mark it as completed.
        this._onNuxComplete(false);
      }
    };
    // The element is polled every `POLL_ELEMENT_TIMEOUT` milliseconds instead
    // of using a MutationObserver. When an element such as a panel is closed,
    // it may not mutate but simply be removed from the DOM - a change which
    // would not be captured by the MutationObserver.
    const pollElementTimeout = setInterval(
      tryDismissTooltip.bind(this, elem),
      POLL_ELEMENT_TIMEOUT,
    );
    this._disposables.add(new Disposable(() => {
      if (pollElementTimeout !== null) {
        clearTimeout(pollElementTimeout);
      }
    }));

    const tooltip = document.querySelector('.nuclide-nux-tooltip');
    const boundClickListener = this._handleDisposableClick.bind(
      this,
      this._tooltipDisposable,
      elem,
    );
    elem.addEventListener('click', boundClickListener);
    tooltip.addEventListener('click', boundClickListener);
    this._disposables.add(new Disposable(() => {
      elem.removeEventListener('click', boundClickListener);
      tooltip.removeEventListener('click', boundClickListener);
      window.removeEventListener('resize', debouncedWindowResizeListener);
    }));
  }

  _handleWindowResize() : void {
    this._tooltipDisposable.dispose();
    this._createDisposableTooltip();
  }

  _createDisposableTooltip() : void {
    if (!this._customContent) {
      // Can turn it into custom content (add DISMISS button).
      this._content = `<div class="nuclide-nux-text-content">
                        <a class="nuclide-nux-dismiss-link">
                          <span class="icon-x pull-right"></span>
                        </a>
                        <span>${this._content}</span>
                      </div>`;
      this._customContent = true;
    }
    this._tooltipDisposable = atom.tooltips.add(
      this._tooltipDiv,
      {
        title: this._content,
        trigger: 'manual',
        placement: this._position,
        html: this._customContent,
        template: `<div class="tooltip nuclide-nux-tooltip">
                    <div class="tooltip-arrow"></div>
                    <div class="tooltip-inner"></div>
                  </div>`,
      },
    );
    this._disposables.add(this._tooltipDisposable);

    const dismissElemClickListener = this._onNuxComplete.bind(this, false);
    const dismissElement = document.querySelector('.nuclide-nux-dismiss-link');
    dismissElement.addEventListener('click', dismissElemClickListener);
    this._disposables.add(new Disposable(() =>
      dismissElement.removeEventListener('click', dismissElemClickListener),
    ));
  }

  _handleDisposableClick(
    disposable: IDisposable,
    addedElement: HTMLElement,
  ): void {
    // Only consider the NUX as complete if the completion condition has been met.
    if (!this._completePredicate()) {
      return;
    }

    // Cleanup changes made to the DOM.
    addedElement.classList.remove('nuclide-nux-tooltip-helper-parent');
    disposable.dispose();
    this._tooltipDiv.remove();

    this._onNuxComplete(true);
  }

  showNux() : void {
    this._createNux();
  }

  setNuxCompleteCallback(callback: ((success: boolean) => void)): void {
    this._callback = callback;
  }

  _onNuxComplete(
    success: boolean = true,
  ): boolean {
    if (this._callback) {
      this._callback(success);
       // Avoid the callback being invoked again.
      this._callback = null;
    }
    this.dispose();
    return success;
  }

  dispose() : void {
    this._disposables.dispose();
  }

  _track(
    message: string,
    error: ?string,
  ): void {
    track(
      'nux-view-action',
      {
        tourId: this._tourId,
        message: `${message}`,
        error: maybeToString(error),
      },
    );
  }
}

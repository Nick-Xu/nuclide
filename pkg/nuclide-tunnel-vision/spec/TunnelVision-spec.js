'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import {TunnelVision} from '../lib/TunnelVision';

describe('TunnelVision', () => {
  let tunnelVision: TunnelVision = (null: any);
  let provider1: FakeProvider = (null: any);
  let provider2: FakeProvider = (null: any);

  beforeEach(() => {
    tunnelVision = new TunnelVision(undefined);
    provider1 = new FakeProvider('provider1');
    provider2 = new FakeProvider('provider2');
  });

  describe('during a Nuclide session', () => {
    beforeEach(() => {
      tunnelVision.consumeTunnelVisionProvider(provider1);
      tunnelVision.consumeTunnelVisionProvider(provider2);
    });

    it('should hide the providers', () => {
      tunnelVision.toggleTunnelVision();
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();
    });

    it('should show the providers again', () => {
      tunnelVision.toggleTunnelVision();
      tunnelVision.toggleTunnelVision();
      expect(provider1.isVisible()).toBeTruthy();
      expect(provider2.isVisible()).toBeTruthy();
    });

    it('should only restore the providers that were visible', () => {
      provider1.toggle();
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeTruthy();

      tunnelVision.toggleTunnelVision();

      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();

      tunnelVision.toggleTunnelVision();
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeTruthy();
    });

    it('should re-enter tunnel vision if a provider is manually opened', () => {
      provider1.toggle();
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeTruthy();

      // Enter tunnel vision
      tunnelVision.toggleTunnelVision();

      // User manually opens something
      provider1.toggle();

      // Since something is open, the intent is probably to get back into the tunnel vision state.
      // So, the provider should be hidden.
      tunnelVision.toggleTunnelVision();
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();

      // Now they are leaving tunnel vision. We should restore all the providers that we have
      // previously hidden. So we shoudl restore provider2 (hidden on first entry) and provider1
      // (hidden on second entry)
      tunnelVision.toggleTunnelVision();
      expect(provider1.isVisible()).toBeTruthy();
      expect(provider2.isVisible()).toBeTruthy();
    });

    it('should serialize properly when not in tunnel-vision mode', () => {
      expect(tunnelVision.serialize()).toEqual({
        restoreState: null,
      });
    });

    it('should serialize properly when in tunnel-vision mode', () => {
      provider1.toggle();
      tunnelVision.toggleTunnelVision();
      expect(tunnelVision.serialize()).toEqual({
        restoreState: ['provider2'],
      });
    });
  });

  describe('deserialization', () => {
    it('should properly deserialize from a non-tunnel-vision state', () => {
      tunnelVision = new TunnelVision({ restoreState: null });
      tunnelVision.consumeTunnelVisionProvider(provider1);
      tunnelVision.consumeTunnelVisionProvider(provider2);

      tunnelVision.toggleTunnelVision();

      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();
    });

    it('should properly deserialize from a tunnel-vision state', () => {
      // Simulate the providers serializing their own state -- they would start out hidden if we
      // exited Nuclide in tunnel-vision.
      provider1.toggle();
      provider2.toggle();
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();

      tunnelVision = new TunnelVision({
        restoreState: ['provider1', 'provider2'],
      });
      tunnelVision.consumeTunnelVisionProvider(provider1);
      tunnelVision.consumeTunnelVisionProvider(provider2);

      tunnelVision.toggleTunnelVision();
      expect(provider1.isVisible()).toBeTruthy();
      expect(provider2.isVisible()).toBeTruthy();
    });

    it('should discard serialized state once it receives a toggle command', () => {
      provider1.toggle();
      provider2.toggle();
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();

      tunnelVision = new TunnelVision({
        restoreState: ['provider1', 'provider2'],
      });
      tunnelVision.consumeTunnelVisionProvider(provider1);

      tunnelVision.toggleTunnelVision();

      expect(provider1.isVisible()).toBeTruthy();
      expect(provider2.isVisible()).toBeFalsy();

      // Now it would be weird if this somehow bumped us back into a tunnel vision state. This
      // shouldn't happen very often, though, since usually all providers will get registered at
      // startup.
      tunnelVision.consumeTunnelVisionProvider(provider2);

      expect(provider1.isVisible()).toBeTruthy();
      expect(provider2.isVisible()).toBeFalsy();

      tunnelVision.toggleTunnelVision();

      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();
    });

    it("should behave sanely if a provider doesn't serialize its toggled state", () => {
      provider1.toggle();
      // Don't toggle provider2 -- so it starts open.
      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeTruthy();

      // Exited in tunnel vision mode -- it had hidden both providers
      tunnelVision = new TunnelVision({
        restoreState: ['provider1', 'provider2'],
      });
      tunnelVision.consumeTunnelVisionProvider(provider1);
      tunnelVision.consumeTunnelVisionProvider(provider2);

      tunnelVision.toggleTunnelVision();

      // It should hide provider2 and enter a tunnel vision state where it will restore both

      expect(provider1.isVisible()).toBeFalsy();
      expect(provider2.isVisible()).toBeFalsy();

      tunnelVision.toggleTunnelVision();

      expect(provider1.isVisible()).toBeTruthy();
      expect(provider2.isVisible()).toBeTruthy();
    });
  });
});

class FakeProvider {
  _isVisible: boolean;
  name: string;

  constructor(name: string) {
    this._isVisible = true;
    this.name = name;
  }

  isVisible(): boolean {
    return this._isVisible;
  }

  toggle(): void {
    this._isVisible = !this._isVisible;
  }
}

// Landing is deliberately deferred to M6. This module reserves the host-owned boundary only.
export class LandingNotImplemented extends Error {
  constructor() {
    super("landing is unavailable until the owner-TTY workflow exists");
    this.name = "LandingNotImplemented";
  }
}

export function land(): never {
  throw new LandingNotImplemented();
}

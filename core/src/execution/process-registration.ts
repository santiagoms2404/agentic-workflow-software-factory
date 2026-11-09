import type { BrokerProcessRegistration } from "../adapters/interface.ts";

/**
 * The reservation a launch is accounted against, whichever class it is.
 *
 * A correction names it `originReservationId` rather than `reservationId`
 * because the two are in different STATES — a task-edge or agent-phase launch
 * holds its reservation and spends it on GO, while a correction's was spent by
 * the phase's first turn and is only being cited. One field name for both would
 * make "reserve before launch, never after" unreadable at the call site. This
 * function is for the callers that legitimately need either.
 */
export function reservationIdOf(registration: BrokerProcessRegistration): string {
  return registration.kind === "phase-correction" || registration.kind === "turn-reconnect"
    ? registration.originReservationId
    : registration.reservationId;
}

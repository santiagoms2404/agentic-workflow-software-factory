import type { DoctorRow } from "../contracts/doctor-readout.ts";
import type { QuotaProbeResult } from "../quota/probe.ts";
import type { ProjectQuotaRoute } from "../quota/routes.ts";

/** quota-axi's Codex auth source is not pi's auth store; never infer pi login. */
export function providersRow(routes: readonly ProjectQuotaRoute[], result: QuotaProbeResult | null): DoctorRow {
  let loggedOut = false;
  let unmeasured = false;
  const detail = routes.map(route => {
    const provider = route.providers.length === 1 ? route.providers[0]! : null;
    const status = result?.readout.providers.find(value => value.provider === provider)?.stateStatus;
    const readable = result !== null && result.parsed.faults.length === 0 && (result.failure === null || ["semantics-unresolved", "stale", "nonzero-exit"].includes(result.failure.reasonCode));
    let login = "not measured";
    if (route.adapterKind !== "pi-codex" && readable && provider !== null) {
      if (status === "auth_required") { login = "logged out"; loggedOut = true; }
      else if (status === "fresh") login = "logged in";
    }
    if (login === "not measured") unmeasured = true;
    return `${route.adapterId}: provider=${provider ?? "not measurable"}; login=${login}${route.adapterKind === "pi-codex" ? " (quota-axi reads Codex auth, not pi auth)" : ""}`;
  });
  return { status: loggedOut ? "finding" : unmeasured || routes.length === 0 ? "warn" : "ok", detail: detail.length ? detail : ["not measured: no configured providers"] };
}

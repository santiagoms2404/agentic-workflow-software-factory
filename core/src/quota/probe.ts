export const QUOTA_AXI_EXECUTABLE = "quota-axi";

/** Pure argv builder shared by the live fixture probe and the runtime probe. */
export function buildQuotaAxiArgv(providerCsv: string): readonly string[] {
  return ["--provider", providerCsv, "--json"];
}

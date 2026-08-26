import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("./client", () => ({
  apiClient: () => ({ get: clientMocks.get }),
  pluginPath: (suffix: string) => `/v0/management/plugins/cpa-keyer${suffix}`,
}));

import { fetchUsageAnalysis, fetchUsageEvents, fetchUsageOverview } from "./usage";

beforeEach(() => clientMocks.get.mockReset());

describe("usage reporting API", () => {
  it("sends overview filters without empty query values", async () => {
    clientMocks.get.mockResolvedValue({ data: { totals: {} } });
    await fetchUsageOverview({ range: "7d", key_id: "", provider: undefined });
    expect(clientMocks.get).toHaveBeenCalledWith(
      "/v0/management/plugins/cpa-keyer/usage/overview",
      { params: { range: "7d" } },
    );
  });

  it("uses dedicated analysis and event routes", async () => {
    clientMocks.get.mockResolvedValue({ data: {} });
    await fetchUsageAnalysis({ range: "30d", key_id: "team-a" });
    await fetchUsageEvents({ range: "24h", result: "failed", page: 2, page_size: 50 });
    expect(clientMocks.get).toHaveBeenNthCalledWith(1,
      "/v0/management/plugins/cpa-keyer/usage/analysis",
      { params: { range: "30d", key_id: "team-a" } },
    );
    expect(clientMocks.get).toHaveBeenNthCalledWith(2,
      "/v0/management/plugins/cpa-keyer/usage/events",
      { params: { range: "24h", result: "failed", page: 2, page_size: 50 } },
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NOT_REPLICATED,
  isFromLocalNode,
  resolveLocalNodeId,
  stableNodeId,
} from "../analyticsOrigin.js";

function hostnameTable(rows) {
  return {
    async *search() {
      yield* rows;
    },
  };
}

describe("resolveLocalNodeId", () => {
  it("skips attribution when hdb_analytics doesn't replicate", async () => {
    const system = {
      hdb_analytics: { replicate: false },
      hdb_analytics_hostname: hostnameTable([{ id: 7, hostname: "a" }]),
    };
    assert.equal(await resolveLocalNodeId(system, "a"), NOT_REPLICATED);
  });

  it("returns the id Harper recorded for this hostname", async () => {
    const system = {
      hdb_analytics: {},
      hdb_analytics_hostname: hostnameTable([
        { id: 123, hostname: "harper1" },
        { id: 456, hostname: "harper2" },
      ]),
    };
    assert.equal(await resolveLocalNodeId(system, "harper2"), 456);
  });

  it("falls back to Harper's hash when this hostname isn't recorded", async () => {
    const system = {
      hdb_analytics: {},
      hdb_analytics_hostname: hostnameTable([{ id: 123, hostname: "harper1" }]),
    };
    assert.equal(await resolveLocalNodeId(system, "harper2"), 1085375910);
    assert.equal(
      await resolveLocalNodeId({ hdb_analytics: {} }, "harper2"),
      1085375910,
    );
  });
});

describe("stableNodeId", () => {
  // expected values from Harper 5.2.0's stableNodeId; harper1-3 also match the ids a 4.7.42 cluster stored
  const vectors = {
    harper1: 1411397553,
    harper2: 1085375910,
    harper3: 845006596,
    HARPER1: 1411397553,
    "node-a.example.com": -1222910596,
    "2001:db8::1428:57ab": -17704337,
    "::ffff:127.0.0.1": -567104173,
    "10.0.0.5": -631713404,
  };
  for (const [hostname, expected] of Object.entries(vectors)) {
    it(`matches Harper for ${hostname}`, () => {
      assert.equal(stableNodeId(hostname), expected);
    });
  }
});

describe("isFromLocalNode", () => {
  it("keeps only rows written by the local node", () => {
    assert.equal(isFromLocalNode([1700000000000, 42], 42), true);
    assert.equal(isFromLocalNode([1700000000000, 43], 42), false);
  });

  it("keeps every row when analytics don't replicate", () => {
    assert.equal(isFromLocalNode([1700000000000, 43], NOT_REPLICATED), true);
    assert.equal(isFromLocalNode(1700000000000, 42), true);
  });
});

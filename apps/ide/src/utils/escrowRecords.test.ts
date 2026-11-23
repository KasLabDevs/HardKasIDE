import { describe, expect, it } from "vitest";
import created from "@/__fixtures__/escrow/escrowfull-created.json";
import funded from "@/__fixtures__/escrow/escrowfull-funded-broadcast.json";
import released from "@/__fixtures__/escrow/escrowfull-released.json";
import { ESCROW_RECORD_SCHEMA, escrowFromAnswer, escrowNextStep, escrowSchemaProblems, newestEscrowsFirst, parseEscrowRecord, readEscrowRecordText } from "./escrowRecords";

/**
 * The fixtures are the three states of one real escrow (a77fd0c4) written by HardKas 0.13.0-rc.3 in the demo
 * workspace, driven from the IDE on the local node: created, funded (the funding broadcast, before a block), and
 * released (funding and release confirmed by `escrow reconcile`).
 */
const raw = (o: unknown) => o as Record<string, unknown>;
const ID = "a77fd0c4-14b2-422a-a3de-e8979dd0c273";
const FUNDING_TX = "2c9ac725a6e057f03b0e33f18c1dcfdddd08379860839045a79491c3aa92c08b";
const RELEASE_TX = "58fa6ac201f49d8574999baa94535bffb498100b20c3ec4ebbcae6cfb411098d";

describe("escrowSchemaProblems", () => {
  it("accepts the record schema the CLI writes and names every other case", () => {
    expect(ESCROW_RECORD_SCHEMA).toBe("hardkas.escrow.record.v1");
    expect(raw(created).schema).toBe(ESCROW_RECORD_SCHEMA);
    expect(escrowSchemaProblems(raw(created))).toEqual([]);
    expect(escrowSchemaProblems({ schema: "hardkas.escrow.record.v2" })[0]).toMatch(/newer than this IDE understands \(v1\)/);
    expect(escrowSchemaProblems({ schema: "hardkas.silverDeploy.v1" })[0]).toMatch(/not an escrow record/);
    expect(escrowSchemaProblems({})[0]).toMatch(/no schema field/);
  });
});

describe("parseEscrowRecord", () => {
  it("reads a created EscrowFull: its parties, principal, address, and a funding of none", () => {
    const { record, problems } = parseEscrowRecord(".hardkas/escrows/x.json", raw(created));
    expect(problems).toEqual([]);
    expect(record).toMatchObject({
      recordPath: ".hardkas/escrows/x.json",
      id: ID,
      state: "CREATED",
      contract: "EscrowFull",
      mode: "full",
      address: "kaspasim:ppdw2536rn7srhfs5t9pg9zms4a7ka5uxr97m0f3ls7cpej8kdl3vvmql7mq3",
      networkId: "simnet",
      principalSompi: "100000000",
      funding: { status: "none" },
      signatures: []
    });
    expect(record?.parties).toEqual({
      buyer: "3e1b1470f13a8d64128fd6b101a762190808ff3a4df0b7a8adfc23287290cffb",
      seller: "c9254478bbe741e3d6fa788a1c581cf982eb40fc9c810791da7e041b9a728324",
      arbiter: "268b164634ed7c183d3b9530d31367e8cf5b2f998e5456ec4651b1b6bd77c8b8"
    });
    // Not in the record: not invented.
    expect(record?.buyerAmountSompi).toBeUndefined();
    expect(record?.feeBudgetSompi).toBeUndefined();
    expect(record?.preparedRelease).toBeUndefined();
    expect(record?.release).toBeUndefined();
    expect(record?.hardkasVersion).toBeUndefined(); // provenance.hardkasVersion is empty in rc.3's record
    expect(record?.createdAt).toBe("2026-11-22T22:52:43.773Z");
  });

  it("reads the funding once it is broadcast: its transaction, output, amount (principal + fee budget) and fee", () => {
    const { record, problems } = parseEscrowRecord(undefined, raw(funded));
    expect(problems).toEqual([]);
    expect(record?.state).toBe("FUNDED");
    expect(record?.funding).toEqual({ status: "broadcast", transactionId: FUNDING_TX, outputIndex: 0, amountSompi: "102000000", feeSompi: "316500" });
    expect(record?.recordPath).toBeUndefined();
  });

  it("reads a released escrow: the prepared branch, who signed, and the confirmed release", () => {
    const { record, problems } = parseEscrowRecord(undefined, raw(released));
    expect(problems).toEqual([]);
    expect(record?.state).toBe("RELEASED");
    expect(record?.funding.status).toBe("confirmed");
    expect(record?.preparedRelease).toEqual({ branch: "mutualRelease", mutualSplit: undefined });
    expect(record?.signatures).toEqual(["buyer", "seller"]);
    expect(record?.release).toEqual({ transactionId: RELEASE_TX, status: "confirmed", feeSompi: "2000000" });
    expect(record?.updatedAt).toBe("2026-11-22T23:07:44.819Z");
  });

  it("gives no record without the fields every step needs, and says which", () => {
    const { id: _id, ...noId } = raw(created);
    expect(parseEscrowRecord(undefined, noId)).toEqual({ record: null, problems: ["missing id"] });
    const { funding: _f, p2shState: _p, ...bare } = raw(created);
    expect(parseEscrowRecord(undefined, bare).problems).toEqual(["missing p2shState.address, funding.status"]);
    expect(parseEscrowRecord(undefined, { ...raw(created), id: "not-a-uuid" }).problems).toEqual(["missing id"]);
  });

  it("keeps going with problems when the record is newer or odd", () => {
    const newer = parseEscrowRecord(undefined, { ...raw(released), schema: "hardkas.escrow.record.v2", state: "SETTLED" });
    expect(newer.record?.state).toBe("SETTLED");
    expect(newer.problems).toEqual([expect.stringMatching(/newer than this IDE understands/), "state SETTLED is not one this IDE knows"]);

    const journal = parseEscrowRecord(undefined, { ...raw(created), schema: undefined });
    expect(journal.record?.id).toBe(ID);
    expect(journal.problems[0]).toMatch(/no schema field/);

    const noKey = parseEscrowRecord(undefined, { ...raw(created), config: { ...(raw(created).config as object), arbiter: {} } });
    expect(noKey.record?.parties.arbiter).toBeUndefined();
    expect(noKey.problems).toEqual(["missing config.arbiter.publicKeyHex"]);

    const oddMode = parseEscrowRecord(undefined, { ...raw(created), config: { ...(raw(created).config as object), mode: "half" } });
    expect(oddMode.record?.mode).toBeUndefined();
    expect(oddMode.problems).toEqual(["config.mode half is neither full nor split"]);
  });

  it("infers the mode from the amounts when a record says none, and reads a split's allocations", () => {
    const config = raw(created).config as Record<string, unknown>;
    const { mode: _m, principal: _p, ...rest } = config;
    const split = parseEscrowRecord(undefined, { ...raw(created), config: { ...rest, buyerAmount: "60000000", sellerAmount: "40000000", feeBudgetSompi: "2000000" } });
    expect(split.problems).toEqual([]);
    expect(split.record).toMatchObject({ mode: "split", buyerAmountSompi: "60000000", sellerAmountSompi: "40000000", feeBudgetSompi: "2000000", principalSompi: undefined });
  });
});

describe("escrowFromAnswer and readEscrowRecordText", () => {
  it("reads the escrow object the commands print with --json (the record without its artifact)", () => {
    const { artifact: _a, ...shown } = raw(released);
    const parsed = escrowFromAnswer({ ok: true, id: ID, state: "RELEASED", escrow: shown });
    expect(parsed?.record?.release?.transactionId).toBe(RELEASE_TX);
    expect(parsed?.problems).toEqual([]);
    expect(escrowFromAnswer({ ok: false, code: "ESCROW_NOT_FOUND", message: "x" })).toBeNull();
    expect(escrowFromAnswer(null)).toBeNull();
  });

  it("reads a record file's text, or says why it could not", () => {
    expect(readEscrowRecordText("a.json", JSON.stringify(funded)).record?.id).toBe(ID);
    expect(readEscrowRecordText("a.json", "{oops")).toEqual({ record: null, problems: [expect.stringMatching(/invalid JSON/)] });
    expect(readEscrowRecordText("a.json", "[]").problems).toEqual(["not a JSON object"]);
  });
});

describe("escrowNextStep", () => {
  const view = (o: unknown) => parseEscrowRecord(undefined, raw(o)).record!;
  it("follows the CLI's own Next hints through the lifecycle", () => {
    expect(escrowNextStep(view(created))).toMatch(/^Fund it from the buyer's account/);
    expect(escrowNextStep(view(funded))).toMatch(/mine a burst, then reconcile/);
    expect(escrowNextStep({ ...view(funded), funding: { ...view(funded).funding, status: "confirmed" } })).toBe("Prepare the release of one branch.");
    expect(escrowNextStep({ ...view(funded), state: "PARTIALLY_SIGNED", preparedRelease: { branch: "mutualRelease" } })).toMatch(/each required role signs/);
    expect(escrowNextStep({ ...view(funded), state: "PARTIALLY_SIGNED", preparedRelease: { branch: "mutualRelease" }, signatures: ["buyer"] })).toMatch(/Signed by buyer/);
    expect(escrowNextStep({ ...view(released), state: "READY_TO_RELEASE", release: undefined })).toMatch(/release it/);
    expect(escrowNextStep({ ...view(released), state: "READY_TO_RELEASE", release: { transactionId: RELEASE_TX, status: "broadcast" } })).toMatch(/mine a burst, then reconcile/);
    expect(escrowNextStep(view(released))).toMatch(/^Released: a chain block accepted/);
    expect(escrowNextStep({ ...view(released), state: "SETTLED" })).toBe("");
  });
});

describe("newestEscrowsFirst", () => {
  it("orders by createdAt, newest first, undated last", () => {
    const a = { ...parseEscrowRecord(undefined, raw(created)).record!, createdAt: "2026-01-01T00:00:00Z" };
    const b = { ...a, createdAt: "2026-02-01T00:00:00Z" };
    const c = { ...a, createdAt: undefined };
    expect(newestEscrowsFirst([c, a, b]).map((r) => r.createdAt)).toEqual(["2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z", undefined]);
  });
});

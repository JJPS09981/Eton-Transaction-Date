import { describe, expect, it } from "vitest";
import { parseCommand, stableStringify } from "./contracts";

const commandId = "75a585b7-cf24-4d08-b740-bcc861118c53";

describe("API command validation", () => {
  it("accepts guided setup with named fixed expenses and a separate first-cycle budget", () => {
    const command = parseCommand({
      type: "Initialize",
      commandId,
      cycleStartDay: 10,
      recurringIncome: "30000",
      fixedExpenses: [
        { name: "水電費", amount: "1200" },
        { name: "Netflix", amount: "390" },
      ],
      firstCycleBudget: "8000",
    });
    expect(command).toMatchObject({
      recurringIncome: 30000n,
      firstCycleBudget: 8000n,
      accumulatedSavings: 0n,
    });
    expect(command.type === "Initialize" && command.fixedExpenses).toEqual([
      { name: "水電費", amount: 1200n, frequency: "monthly" },
      { name: "Netflix", amount: 390n, frequency: "monthly" },
    ]);
  });

  it("accepts optional starting savings and fixed income edits while rejecting invalid balances", () => {
    const setup = { type: "Initialize", commandId, cycleStartDay: 10, recurringIncome: "30000", firstCycleBudget: "8000", fixedExpenses: [] };
    expect(parseCommand({ ...setup, accumulatedSavings: "12500" })).toMatchObject({ accumulatedSavings: 12500n });
    for (const amount of ["-1", "1.5", "", "9223372036854775808"]) {
      expect(() => parseCommand({ ...setup, accumulatedSavings: amount })).toThrow();
      expect(() => parseCommand({ type: "SaveFixedIncome", commandId, itemId: commandId, amount })).toThrow();
    }
    expect(parseCommand({ type: "SaveFixedIncome", commandId, itemId: commandId, amount: "0" })).toMatchObject({ amount: 0n, apply: "next_cycle" });
    expect(parseCommand({ type: "SaveFixedIncome", commandId, itemId: commandId, amount: "35000", apply: "current_cycle" })).toMatchObject({ amount: 35000n });
  });

  it("accepts annual billing for any fixed expense and requires its month", () => {
    const baseSetup = {
      type: "Initialize",
      commandId,
      cycleStartDay: 10,
      recurringIncome: "30000",
      firstCycleBudget: "8000",
    };
    const annual = {
      name: "iCloud+",
      category: "數位服務",
      amount: "1200",
      frequency: "annual",
      dueMonth: 12,
    };
    const command = parseCommand({ ...baseSetup, fixedExpenses: [annual] });
    expect(command.type === "Initialize" && command.fixedExpenses[0]).toEqual({
      ...annual,
      amount: 1200n,
    });
    expect(() =>
      parseCommand({
        ...baseSetup,
        fixedExpenses: [{ ...annual, dueMonth: undefined }],
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        ...baseSetup,
        fixedExpenses: [{ ...annual, dueMonth: 13 }],
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        ...baseSetup,
        fixedExpenses: [{ ...annual, frequency: "monthly" }],
      }),
    ).toThrow();
  });

  it("rejects invalid fixed expense amounts and totals during setup", () => {
    const baseSetup = {
      type: "Initialize",
      commandId,
      cycleStartDay: 10,
      recurringIncome: "30000",
      firstCycleBudget: "8000",
    };
    expect(() =>
      parseCommand({
        ...baseSetup,
        fixedExpenses: [{ name: "保險費", amount: "0" }],
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        ...baseSetup,
        fixedExpenses: [{ name: " ", amount: "500" }],
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        ...baseSetup,
        fixedExpenses: [
          { name: "支出甲", amount: "9223372036854775807" },
          { name: "支出乙", amount: "1" },
        ],
      }),
    ).toThrow();
  });

  it("rejects a frontend supplied user identity", () => {
    expect(() =>
      parseCommand({
        type: "RecordExpense",
        commandId,
        amount: "500",
        source: "lifestyle",
        transactionDate: "2026-10-06",
        user_id: "someone-else",
      }),
    ).toThrow();
  });

  it("rejects negative, fractional and oversized database amounts", () => {
    for (const amount of [
      "-1",
      "1.5",
      "9223372036854775808",
      "999999999999999999999999",
    ]) {
      expect(() =>
        parseCommand({
          type: "RecordExpense",
          commandId,
          amount,
          source: "lifestyle",
          transactionDate: "2026-10-06",
        }),
      ).toThrow();
    }
  });

  it("normalizes object key order for idempotency hashing", () => {
    expect(stableStringify({ type: "AdvanceToToday", commandId })).toBe(
      stableStringify({ commandId, type: "AdvanceToToday" }),
    );
  });
  it("validates correction revisions, expense bounds, income destinations and deletion options", () => {
    const edit = { type: "UpdateTransaction", commandId, transactionId: commandId, expectedRevision: 0, kind: "expense", amount: "9999999999", source: "lifestyle", transactionDate: "2026-10-08" };
    expect(parseCommand(edit)).toMatchObject({ amount: 9_999_999_999n });
    for (const changes of [{ amount: "10000000000" }, { amount: "0" }, { expectedRevision: -1 }, { source: undefined }, { kind: "income" }, { subcategoryId: commandId }])
      expect(() => parseCommand({ ...edit, ...changes })).toThrow();
    expect(parseCommand({ type: "DeleteTransaction", commandId, transactionId: commandId, expectedRevision: 1 })).toMatchObject({ cancelPendingInstallments: false });
    expect(parseCommand({ type: "UpdateTransaction", commandId, transactionId: commandId, expectedRevision: 0, kind: "income", amount: "10000000000", incomeDestination: "pool", transactionDate: "2026-10-08" })).toMatchObject({ amount: 10_000_000_000n });
  });
  it("accepts ten-digit expenses and rejects eleven-digit expenses for all payment sources", () => {
    const base = {
      type: "RecordExpense",
      commandId,
      transactionDate: "2026-10-08",
    };
    for (const payment of [
      { source: "lifestyle" },
      { source: "savings" },
      { source: "lifestyle", paymentType: "installment", installmentCount: 3 },
    ]) {
      expect(parseCommand({ ...base, ...payment, amount: "9999999999" })).toMatchObject({
        amount: 9_999_999_999n,
      });
      expect(() => parseCommand({ ...base, ...payment, amount: "10000000000" })).toThrow(
        "支出金額最多 10 位數",
      );
    }
    expect(parseCommand({
      type: "AddIncome", commandId, amount: "10000000000", destination: "pool",
    })).toMatchObject({ amount: 10_000_000_000n });
  });
  it("validates payment type, installment counts and zero amount before touching budgets", () => {
    const base = {
      type: "RecordExpense",
      commandId,
      amount: "10000",
      source: "lifestyle",
      transactionDate: "2026-10-08",
      paymentType: "installment",
      installmentCount: 3,
    };
    expect(parseCommand(base)).toMatchObject({
      amount: 10000n,
      paymentType: "installment",
      installmentCount: 3,
    });
    for (const changes of [
      { amount: "0" },
      { source: "savings" },
      { installmentCount: 1 },
      { installmentCount: 61 },
      { amount: "2" },
      { paymentType: "immediate" },
    ])
      expect(() => parseCommand({ ...base, ...changes })).toThrow();
  });
  it("requires a parent for a subcategory and keeps merchant and note independent", () => {
    const base = {
      type: "RecordExpense",
      commandId,
      amount: "150",
      source: "lifestyle",
      transactionDate: "2026-10-08",
      description: " 全家 ",
      note: " 飯糰 ",
      subcategoryId: commandId,
    };
    expect(() => parseCommand(base)).toThrow();
    expect(parseCommand({ ...base, categoryId: commandId })).toMatchObject({
      description: "全家",
      note: "飯糰",
    });
  });
});

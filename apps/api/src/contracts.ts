import { z } from "zod";

const MAX_DB_MONEY = 9_223_372_036_854_775_807n;
const money = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_DB_MONEY, "金額超出可用範圍");
const positiveMoney = money.refine((value) => value > 0n, "金額必須大於 0");
const expenseMoney = positiveMoney.refine(value => value <= 9_999_999_999n, "支出金額最多 10 位數");
const date = z.iso.date();
const base = z.object({ commandId: z.uuid() });
const fixedExpense = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: positiveMoney,
    category: z.string().trim().min(1).max(80).optional(),
    frequency: z.enum(["monthly", "annual"]).default("monthly"),
    dueMonth: z.number().int().min(1).max(12).optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.frequency === "annual" && item.dueMonth === undefined) {
      context.addIssue({
        code: "custom",
        message: "年繳項目必須選擇繳費月份",
        path: ["dueMonth"],
      });
    }
    if (item.frequency === "monthly" && item.dueMonth !== undefined) {
      context.addIssue({
        code: "custom",
        message: "月繳項目不應設定繳費月份",
        path: ["dueMonth"],
      });
    }
  });

export const commandSchema = z.discriminatedUnion("type", [
  base
    .extend({
      type: z.literal("Initialize"),
      cycleStartDay: z.number().int().min(1).max(31),
      recurringIncome: money,
      fixedExpenses: z
        .array(fixedExpense)
        .max(60)
        .refine(
          (items) =>
            items.reduce((sum, item) => sum + item.amount, 0n) <= MAX_DB_MONEY,
          "固定支出總額超出可用範圍",
        ),
      firstCycleBudget: money,
      accumulatedSavings: money.default(0n),
    })
    .strict(),
  base
    .extend({
      type: z.literal("RecordExpense"),
      amount: expenseMoney,
      source: z.enum(["lifestyle", "savings"]),
      transactionDate: date,
      category: z.string().trim().min(1).max(80).optional(),
      categoryId: z.uuid().optional(),
      subcategoryId: z.uuid().optional(),
      description: z.string().trim().max(200).optional(),
      paymentType: z.enum(["immediate", "installment"]).default("immediate"),
      installmentCount: z.number().int().min(2).max(60).optional(),
      note: z.string().trim().max(500).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.paymentType === "installment" &&
        (value.source !== "lifestyle" ||
          value.installmentCount === undefined ||
          BigInt(value.installmentCount) > value.amount)
      )
        context.addIssue({
          code: "custom",
          message: "分期需使用生活預算，且期數不可超過總金額",
          path: ["installmentCount"],
        });
      if (
        value.paymentType === "immediate" &&
        value.installmentCount !== undefined
      )
        context.addIssue({
          code: "custom",
          message: "立即付款不需分期期數",
          path: ["installmentCount"],
        });
      if (value.subcategoryId && !value.categoryId)
        context.addIssue({
          code: "custom",
          message: "請先選擇分類",
          path: ["categoryId"],
        });
    }),
  base
    .extend({
      type: z.literal("AddIncome"),
      amount: positiveMoney,
      destination: z.enum(["pool", "lifestyle"]),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  base.extend({ type: z.literal("AdvanceToToday") }).strict(),
  base.extend({
    type: z.literal("UpdateTransaction"),
    transactionId: z.uuid(), expectedRevision: z.number().int().min(0),
    kind: z.enum(["expense", "income"]), amount: positiveMoney, transactionDate: date,
    source: z.enum(["lifestyle", "savings"]).optional(),
    incomeDestination: z.enum(["pool", "lifestyle"]).optional(),
    categoryId: z.uuid().nullable().optional(), subcategoryId: z.uuid().nullable().optional(),
    description: z.string().trim().max(200).optional(), note: z.string().trim().max(500).optional(),
  }).strict().superRefine((value, context) => {
    if (value.kind === "expense") {
      if (value.amount > 9_999_999_999n) context.addIssue({ code: "custom", message: "支出金額最多 10 位數", path: ["amount"] });
      if (!value.source || value.incomeDestination !== undefined) context.addIssue({ code: "custom", message: "請選擇支出資金來源", path: ["source"] });
      if (value.subcategoryId && !value.categoryId) context.addIssue({ code: "custom", message: "請先選擇分類", path: ["categoryId"] });
    } else if (!value.incomeDestination || value.source !== undefined || value.categoryId || value.subcategoryId || value.description)
      context.addIssue({ code: "custom", message: "收入需選擇入帳位置，不使用支出分類", path: ["incomeDestination"] });
  }),
  base.extend({
    type: z.literal("DeleteTransaction"), transactionId: z.uuid(),
    expectedRevision: z.number().int().min(0), cancelPendingInstallments: z.boolean().default(false),
  }).strict(),
  base
    .extend({
      type: z.literal("AdjustSavings"),
      target: money,
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  base
    .extend({
      type: z.literal("SaveFixedIncome"),
      itemId: z.uuid(),
      amount: money,
      apply: z.enum(["next_cycle", "current_cycle"]).default("next_cycle"),
    })
    .strict(),
  base.extend({
    type: z.literal("AdjustCycleBudget"), cycleId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    target: money, note: z.string().trim().max(500).optional(),
  }).strict(),
  base
    .extend({
      type: z.literal("SaveFixedExpense"),
      itemId: z.uuid().optional(),
      name: z.string().trim().min(1).max(80),
      amount: positiveMoney,
      category: z.string().trim().min(1).max(80).optional(),
      frequency: z.enum(["monthly", "annual"]).default("monthly"),
      dueMonth: z.number().int().min(1).max(12).optional(),
      active: z.boolean().default(true),
      apply: z.enum(["next_cycle", "current_cycle"]).default("next_cycle"),
    })
    .strict()
    .superRefine((item, context) => {
      if (item.frequency === "annual" && item.dueMonth === undefined)
        context.addIssue({
          code: "custom",
          message: "年繳項目必須選擇繳費月份",
          path: ["dueMonth"],
        });
      if (item.frequency === "monthly" && item.dueMonth !== undefined)
        context.addIssue({
          code: "custom",
          message: "月繳項目不應設定繳費月份",
          path: ["dueMonth"],
        });
    }),
  base
    .extend({
      type: z.literal("SaveCategory"),
      categoryId: z.uuid().optional(),
      scope: z.enum(["daily", "fixed"]).default("daily"),
      name: z.string().trim().min(1).max(80),
      hidden: z.boolean().default(false),
    })
    .strict(),
  base
    .extend({
      type: z.literal("ReorderCategories"),
      scope: z.enum(["daily", "fixed"]).default("daily"),
      categoryIds: z
        .array(z.uuid())
        .min(1)
        .max(200)
        .refine((ids) => new Set(ids).size === ids.length, "分類不可重複"),
    })
    .strict(),
  base
    .extend({
      type: z.literal("SaveSubcategory"),
      categoryId: z.uuid(),
      subcategoryId: z.uuid().optional(),
      name: z.string().trim().min(1).max(80),
      hidden: z.boolean().default(false),
    })
    .strict(),
  base
    .extend({
      type: z.literal("ReorderSubcategories"),
      categoryId: z.uuid(),
      subcategoryIds: z
        .array(z.uuid())
        .min(1)
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length, "細項不可重複"),
    })
    .strict(),
]);

export type Command = z.infer<typeof commandSchema>;

export function parseCommand(raw: unknown): Command {
  return commandSchema.parse(raw);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

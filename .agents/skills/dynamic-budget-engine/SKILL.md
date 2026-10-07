---
name: dynamic-budget-engine
description: Use in this project when changing income cycles, budgets, expenses, backdating, corrections, fixed expenses, fixed savings, savings pools, installments, settlements, or money events. Skip unrelated UI styling and copy changes.
---

# Dynamic Budget Engine

Before changing money behavior, read the relevant sections of [Technical Design](../../../TECHNICAL_DESIGN.md) and [Development Plan](../../../DEVELOPMENT_PLAN.md). Keep these files as the maintained references; do not copy their full content into this skill.

- Keep the Engine as pure TypeScript domain logic, independent of React, Cloudflare Worker runtime, and Supabase CRUD. Never duplicate Engine calculations in React components for UI convenience.
- Preserve `A >= 0`, every `F[d] >= 0`, `P >= 0`, and `S >= 0`. Record the full nominal transaction separately from actual bucket deductions. Insufficient funds never make a bucket negative.
- Preserve cycle opening priority: fixed expenses, then actual fixed savings, then lifestyle budget. Keep fixed savings targets separate from each cycle's actual transferred amount.
- Apply ordinary expenses through `A → P → F → S`, with deductions capped by available funds. A purchase funded from accumulated savings affects only `S`, not the daily lifestyle budget.
- Keep transaction date separate from budget application time. Backdating and corrections apply budget effects now; do not replay past daily budgets or closed cycles.
- Make day closing, cycle opening and closing, and installment posting idempotent. Keep a traceable money event for each actual bucket change.
- When Engine behavior changes, add or update meaningful unit tests for the changed rule and its boundary cases.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecordsMonthPicker } from "./RecordsMonthPicker";

const renderPicker = (month: string) => renderToStaticMarkup(
  <RecordsMonthPicker month={month} today="2026-10-08" onClose={() => {}} onSelect={() => {}} />,
);

describe("record month lookup", () => {
  it("shows the selected month and prevents selecting future months", () => {
    const html = renderPicker("2026-10");
    const selected = html.match(/<button[^>]+aria-label="2026 年 10 月"[^>]*>/)?.[0];
    expect(selected).toContain('aria-pressed="true"');
    expect(selected).not.toContain("disabled");
    expect(html).toMatch(/<button[^>]+aria-label="2026 年 11 月"[^>]+disabled=""/);
    expect(html).toMatch(/<button[^>]+aria-label="2026 年 12 月"[^>]+disabled=""/);
    expect(html).not.toContain('value="2027"');
  });

  it("supports the earliest year and only offers year and month selection", () => {
    const html = renderPicker("1900-01");
    expect(html).toContain('<option value="1900" selected="">1900 年</option>');
    expect(html).not.toContain('value="1899"');
    expect(html.match(/aria-label="1900 年 \d+ 月"/g)).toHaveLength(12);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("calendar-day");
  });
});

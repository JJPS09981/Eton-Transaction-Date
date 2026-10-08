import { useState } from "react";
import { Sheet } from "./Sheet";

export function RecordsMonthPicker({ month, today, onSelect, onClose }: {
  month: string;
  today: string;
  onSelect: (month: string) => void;
  onClose: () => void;
}) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = today.slice(0, 7);

  return <Sheet title="選擇年月" className="records-month-picker" onClose={onClose}>
    <p className="sheet-description">選擇年份，再點月份切換月曆。</p>
    <label className="field"><span>年份</span>
      <select aria-label="年份" value={year} onChange={(event) => setYear(Number(event.target.value))}>
        {Array.from({ length: currentYear - 1900 + 1 }, (_, index) => currentYear - index).map((value) => <option key={value} value={value}>{value} 年</option>)}
      </select>
    </label>
    <div className="month-picker-grid" aria-label={`${year} 年的月份`}>
      {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => {
        const choice = `${year}-${String(value).padStart(2, "0")}`;
        return <button type="button" key={value} className={choice === month ? "month-picker-choice selected" : "month-picker-choice"}
          aria-label={`${year} 年 ${value} 月`} aria-pressed={choice === month} disabled={choice > currentMonth} onClick={() => onSelect(choice)}>{value} 月</button>;
      })}
    </div>
    <button className="secondary-button month-picker-current" type="button" onClick={() => onSelect(currentMonth)}>回到本月</button>
  </Sheet>;
}

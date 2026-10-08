export interface FixedExpenseInput {
  id: string;
  name: string;
  amount: string;
  category: string;
  frequency: "monthly" | "annual";
  dueMonth: string;
  custom: boolean;
}

const presetGroups = [
  { title: "住居", items: [
    { id: "housing", name: "房租／房貸", detail: "租金或每月房貸" },
    { id: "building", name: "管理費", detail: "社區或大樓管理費" },
    { id: "parking-rent", name: "停車位租金", detail: "固定租用的車位" },
  ] },
  { title: "水電瓦斯", items: [
    { id: "water", name: "水費", detail: "自來水帳單" },
    { id: "electricity", name: "電費", detail: "用電帳單" },
    { id: "gas", name: "瓦斯費", detail: "天然氣或桶裝瓦斯" },
  ] },
  { title: "通訊網路", items: [
    { id: "mobile", name: "手機費", detail: "電信月租" },
    { id: "internet", name: "家用網路費", detail: "寬頻網路" },
  ] },
  { title: "影音與音樂", items: [
    { id: "netflix", name: "Netflix", detail: "影音訂閱" },
    { id: "youtube", name: "YouTube Premium", detail: "影音訂閱" },
    { id: "disney", name: "Disney+", detail: "影音訂閱" },
    { id: "spotify", name: "Spotify", detail: "音樂訂閱" },
    { id: "apple-music", name: "Apple Music", detail: "音樂訂閱" },
    { id: "kkbox", name: "KKBOX", detail: "音樂訂閱" },
  ] },
  { title: "數位服務", items: [
    { id: "cloud-storage", name: "雲端空間", detail: "檔案與照片儲存" },
    { id: "icloud", name: "iCloud+", detail: "Apple 雲端服務" },
    { id: "google-one", name: "Google One", detail: "Google 雲端服務" },
    { id: "software", name: "軟體訂閱", detail: "工作或生活工具" },
    { id: "gaming", name: "遊戲會員", detail: "遊戲訂閱服務" },
  ] },
  { title: "AI 服務", items: [
    { id: "chatgpt", name: "ChatGPT", detail: "AI 訂閱" },
    { id: "claude", name: "Claude", detail: "AI 訂閱" },
    { id: "gemini", name: "Gemini", detail: "AI 訂閱" },
  ] },
  { title: "保險", items: [
    { id: "life-insurance", name: "壽險", detail: "定期壽險保費" },
    { id: "medical-insurance", name: "醫療險", detail: "醫療保險保費" },
    { id: "accident-insurance", name: "意外險", detail: "意外保險保費" },
    { id: "car-insurance", name: "車險", detail: "汽機車保險保費" },
  ] },
  { title: "交通", items: [
    { id: "transit-pass", name: "交通月票", detail: "公車或捷運定期票" },
    { id: "commute-parking", name: "通勤停車費", detail: "固定停車支出" },
  ] },
  { title: "家庭與健康", items: [
    { id: "family-support", name: "孝親費", detail: "每月家庭支援" },
    { id: "childcare", name: "托育費", detail: "托嬰或托育費" },
    { id: "gym", name: "健身房", detail: "運動會費" },
    { id: "care", name: "定期照護費", detail: "固定照護安排" },
  ] },
  { title: "貸款與其他", items: [
    { id: "personal-loan", name: "信貸還款", detail: "每月信貸支出" },
    { id: "student-loan", name: "學貸還款", detail: "每月學貸支出" },
  ] },
] as const;

const emptyExpenses: FixedExpenseInput[] = [];

export function FixedExpensePicker({ expenses = emptyExpenses, disabled = false, maxItems = Infinity, onSelect }: {
  expenses?: FixedExpenseInput[];
  disabled?: boolean;
  maxItems?: number;
  onSelect: (item: FixedExpenseInput, opener: HTMLButtonElement) => void;
}) {
  const limitReached = expenses.length >= maxItems;
  const summary = (item: FixedExpenseInput) => `${item.frequency === "annual" ? `每年 ${item.dueMonth} 月` : "每月"} · NT$${Number(item.amount).toLocaleString("zh-TW")}`;
  return <div className="preset-groups">{presetGroups.map((group) => <div className="preset-group" key={group.title}>
    <h3>{group.title}</h3>
    <div className="preset-grid">{group.items.map((preset) => {
      const selected = expenses.find((item) => item.id === preset.id);
      return <button className={`preset-option${selected ? " selected" : ""}`} type="button" aria-pressed={Boolean(selected)} disabled={disabled || (!selected && limitReached)} key={preset.id}
        onClick={(event) => onSelect(selected ?? { id: preset.id, name: preset.name, amount: "", category: group.title, frequency: "monthly", dueMonth: "", custom: false }, event.currentTarget)}>
        <span className="preset-check" aria-hidden="true">{selected ? "✓" : "+"}</span>
        <span><strong>{preset.name}</strong><small>{selected ? summary(selected) : preset.detail}</small></span>
      </button>;
    })}{expenses.filter((item) => item.custom && item.category === group.title).map((item) => <button className="preset-option selected" type="button" aria-pressed="true" disabled={disabled} key={item.id}
      onClick={(event) => onSelect(item, event.currentTarget)}>
      <span className="preset-check" aria-hidden="true">✓</span><span><strong>{item.name}</strong><small>{summary(item)}</small></span>
    </button>)}<button className="preset-option preset-add-option" type="button" disabled={disabled || limitReached}
      aria-label={`在${group.title}新增固定支出`} onClick={(event) => onSelect({ id: crypto.randomUUID(), name: "", amount: "", category: group.title, frequency: "monthly", dueMonth: "", custom: true }, event.currentTarget)}>
      <span className="preset-check" aria-hidden="true">＋</span><span><strong>新增其他項目</strong><small>自行填寫名稱與金額</small></span>
    </button></div>
  </div>)}</div>;
}

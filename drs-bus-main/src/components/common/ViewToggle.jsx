import { LayoutGrid, Table2 } from "lucide-react";

// Table / Cards switch (the choice is remembered by useViewPreference).
export default function ViewToggle({ value, onChange }) {
  const options = [
    { value: "cards", label: "Cards", icon: LayoutGrid },
    { value: "table", label: "Table", icon: Table2 },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-white p-0.5" role="group" aria-label="View">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`inline-flex items-center gap-1.5 px-3 min-h-10 md:min-h-9 text-sm font-medium rounded-md ${value === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          <Icon className="w-4 h-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

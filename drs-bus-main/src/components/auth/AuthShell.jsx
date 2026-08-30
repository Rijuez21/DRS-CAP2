import sunLogo from "../../assets/logo-sun.svg";

export default function AuthShell({ roleLabel, roleTag, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <img src={sunLogo} alt="D' Rising Sun logo" className="w-60 h-60 -mb-19" />
          <h1 className="font-display text-3xl font-bold text-brand-forest-900 mt-3">
            D&apos; Rising Sun
          </h1>
          {roleLabel && (
            <span className="mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-brand-forest-900/10 text-brand-forest-900">
              {roleLabel}
            </span>
          )}
        </div>

        <div className="rounded-3xl bg-brand-green-600/10 border border-brand-green-600/15 p-6 shadow-sm">
          {children}
        </div>

        {roleTag && (
          <p className="text-center text-xs text-ink-600 mt-4">{roleTag}</p>
        )}
      </div>
    </div>
  );
}

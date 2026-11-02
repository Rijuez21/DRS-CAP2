// One picture slot on the landing / About pages: the picture when `src` is
// set, otherwise a striped placeholder that says what belongs there.
const stripes = {
  background: "repeating-linear-gradient(135deg, #e9ede4 0px, #e9ede4 10px, #dfe5d8 10px, #dfe5d8 20px)",
};

export default function Shot({ src, alt, aspect = "aspect-4/3", className = "", note, rounded = "rounded-2xl" }) {
  if (src) {
    return (
      <div className={`${aspect} ${rounded} ${className} overflow-hidden border border-brand-forest-900/10 bg-white`}>
        <img src={src} alt={alt} loading="lazy" className="w-full h-full object-cover object-top" />
      </div>
    );
  }
  return (
    <div style={stripes} className={`${aspect} ${rounded} ${className} border border-brand-forest-900/10 flex items-center justify-center p-4 text-xs text-center text-ink-600`}>
      {note}
    </div>
  );
}

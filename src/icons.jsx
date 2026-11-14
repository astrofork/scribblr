// Lucide icons (ISC), the same set Herdr's mods use. Colored with currentColor.
const files = import.meta.glob("./icons/*.svg", { query: "?raw", import: "default", eager: true });
const svgs = Object.fromEntries(Object.entries(files).map(([p, s]) => [p.slice(8, -4), s]));

export function Icon({ name, size = 14, className = "", style }) {
  return (
    <span
      className={`icon ${className}`}
      style={{ width: size, height: size, ...style }}
      dangerouslySetInnerHTML={{ __html: svgs[name] ?? "" }}
    />
  );
}

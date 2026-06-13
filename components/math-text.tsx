import katex from "katex";
import { splitMath } from "@/lib/math";

/**
 * Renders a plain string, typesetting any `$...$` / `$$...$$` segments with
 * KaTeX. `renderToString` is pure and synchronous, so this needs no effects and
 * stays screenshot/print-ready. Invalid LaTeX renders in red (throwOnError off)
 * rather than crashing the slide.
 */
export function MathText({ children }: { children: string }) {
  const segments = splitMath(children);

  // Fast path: no math, no extra DOM. Use the segment value, not children, so
  // an escaped "\$" in plain prose still normalizes to "$".
  if (segments.length === 1 && segments[0].type === "text") {
    return <>{segments[0].value}</>;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.value}</span>;
        const html = katex.renderToString(seg.value, {
          displayMode: seg.type === "display",
          throwOnError: false,
        });
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </>
  );
}

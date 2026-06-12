import type { Takeaway } from "@/lib/db";

export function Takeaways({ takeaways }: { takeaways: Takeaway[] }) {
  return (
    <ol className="fade space-y-0">
      {takeaways.map((takeaway, i) => (
        <li
          key={i}
          className="rise flex gap-5 border-t border-line-soft py-6 first:border-t-0 first:pt-0"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <span className="font-mono text-sm text-accent pt-1">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <h3 className="font-display text-xl font-medium leading-snug">
              {takeaway.point}
            </h3>
            {takeaway.detail && (
              <p className="mt-1.5 text-ink-soft leading-relaxed max-w-xl">
                {takeaway.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

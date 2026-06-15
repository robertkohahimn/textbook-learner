import { describe, expect, it } from "vitest";
import {
  buildDeckPrompt,
  buildRevisePrompt,
  deckSpec,
  normalizeSlide,
  parseDeckOptions,
  validateDeck,
  validateSlide,
  type Slide,
} from "@/lib/deck";

const deck: Slide[] = [
  {
    layout: "title",
    title: "The Strange Logic of Spin",
    subtitle: "Why one experiment broke classical physics",
    notes: "Welcome — today we look at spin.",
    pages: [12],
  },
  {
    layout: "bullets",
    title: "What is spin?",
    bullets: ["A quantum property", "Binary outcomes"],
    notes: "Spin is not literal rotation.",
    pages: [12, 13],
  },
  {
    layout: "big-fact",
    title: "Always two answers",
    fact: { value: "2", label: "possible outcomes for every spin measurement" },
    notes: "No matter the orientation, two outcomes.",
    pages: [14],
  },
  {
    layout: "recap",
    title: "Remember this",
    bullets: ["Spin is quantized", "Measurement disturbs"],
    notes: "Recap before the quiz.",
    pages: [12, 14],
  },
];

describe("validateSlide", () => {
  it("accepts every layout", () => {
    expect(validateSlide(deck[0]).layout).toBe("title");
    expect(
      validateSlide({
        layout: "section",
        title: "Part two",
        notes: "",
      }).layout
    ).toBe("section");
    expect(
      validateSlide({
        layout: "two-column",
        title: "Classical vs quantum",
        columns: [
          { heading: "Classical", bullets: ["Any angle"] },
          { heading: "Quantum", bullets: ["Two outcomes"] },
        ],
        notes: "n",
      }).columns
    ).toHaveLength(2);
    expect(
      validateSlide({
        layout: "quote",
        title: "In the author's words",
        quote: { text: "God does not play dice.", attribution: "Einstein" },
        notes: "n",
      }).quote?.attribution
    ).toBe("Einstein");
    expect(
      validateSlide({
        layout: "process",
        title: "The measurement",
        steps: [
          { label: "Prepare", detail: "Set the apparatus" },
          { label: "Measure", detail: "" },
        ],
        notes: "n",
      }).steps
    ).toHaveLength(2);
  });

  it("rejects unknown layouts", () => {
    expect(() => validateSlide({ layout: "hero", title: "T", notes: "" })).toThrow(
      /layout/
    );
  });

  it("rejects missing layout-specific content", () => {
    expect(() => validateSlide({ layout: "bullets", title: "T", notes: "" })).toThrow();
    expect(() =>
      validateSlide({ layout: "two-column", title: "T", columns: [], notes: "" })
    ).toThrow();
    expect(() => validateSlide({ layout: "quote", title: "T", notes: "" })).toThrow();
    expect(() =>
      validateSlide({ layout: "big-fact", title: "T", fact: { value: "2" }, notes: "" })
    ).toThrow();
    expect(() =>
      validateSlide({ layout: "process", title: "T", steps: [{ label: "x" }], notes: "" })
    ).toThrow();
  });

  it("cleans pages to sorted unique positive integers", () => {
    const s = validateSlide({
      layout: "section",
      title: "T",
      notes: "",
      pages: [13, 12, 12, -1, 2.6],
    });
    expect(s.pages).toEqual([3, 12, 13]);
  });

  it("defaults notes to empty string", () => {
    const s = validateSlide({ layout: "section", title: "T" });
    expect(s.notes).toBe("");
  });
});

describe("validateDeck", () => {
  it("accepts a deck under {slides} or as a bare array", () => {
    expect(validateDeck({ slides: deck })).toHaveLength(4);
    expect(validateDeck(deck)).toHaveLength(4);
  });

  it("rejects decks with too few slides", () => {
    expect(() => validateDeck({ slides: deck.slice(0, 2) })).toThrow();
  });

  it("names the offending slide in errors", () => {
    const bad = [...deck.slice(0, 3), { layout: "bullets", title: "", notes: "" }];
    expect(() => validateDeck({ slides: bad })).toThrow(/slide 4/);
  });
});

describe("normalizeSlide", () => {
  it("upgrades legacy {title, bullets} slides", () => {
    const s = normalizeSlide({ title: "Old slide", bullets: ["a", "b"] });
    expect(s).toEqual({
      layout: "bullets",
      title: "Old slide",
      bullets: ["a", "b"],
      notes: "",
    });
  });

  it("passes through modern slides intact", () => {
    expect(normalizeSlide(deck[2])).toEqual(deck[2]);
  });

  it("never throws on garbage", () => {
    expect(normalizeSlide(null).layout).toBe("bullets");
    expect(normalizeSlide({ layout: "quote", title: "broken" }).layout).toBe("bullets");
  });
});

describe("parseDeckOptions", () => {
  it("applies defaults", () => {
    expect(parseDeckOptions({})).toEqual({ format: "detailed", length: "long" });
    expect(parseDeckOptions(null)).toEqual({ format: "detailed", length: "long" });
  });

  it("accepts valid options and trims focus", () => {
    expect(
      parseDeckOptions({ format: "detailed", length: "long", focus: "  for kids " })
    ).toEqual({ format: "detailed", length: "long", focus: "for kids" });
  });

  it("ignores invalid values", () => {
    expect(parseDeckOptions({ format: "fancy", length: "huge" })).toEqual({
      format: "detailed",
      length: "long",
    });
  });
});

describe("prompts", () => {
  const lesson = { title: "Spin", summary: "The first quantum surprise" };

  it("deckSpec varies by format, length, and focus", () => {
    const presenter = deckSpec({ format: "presenter", length: "short" });
    expect(presenter).toContain("6 to 8");
    expect(presenter).toContain("presenter slides");
    // The learner level is applied to every deck, even without a focus.
    expect(presenter).toContain("first-year university student");
    const detailed = deckSpec({
      format: "detailed",
      length: "long",
      focus: "Audience: high schoolers",
    });
    expect(detailed).toContain("15 to 20");
    expect(detailed).toContain("detailed deck");
    expect(detailed).toContain("Audience: high schoolers");
  });

  it("buildDeckPrompt includes source, citations rule, and schema", () => {
    const p = buildDeckPrompt(lesson, "[p.12] Spin is measured...", {
      format: "presenter",
      length: "default",
    });
    expect(p).toContain("[p.12] Spin is measured");
    expect(p).toContain('"pages"');
    expect(p).toContain("speaker notes");
    expect(p).toContain('{ "slides":');
  });

  it("buildRevisePrompt marks the target slide and carries the instruction", () => {
    const p = buildRevisePrompt(lesson, "[p.12] text", deck, 1, "Make it a quote slide");
    expect(p).toContain("← REVISE THIS ONE");
    expect(p).toContain("Make it a quote slide");
    expect(p).toContain('"What is spin?"');
  });
});

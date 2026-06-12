import { formatPageRefs, type Slide } from "./deck";

/**
 * Client-side PPTX export. Produces editable text boxes (not images) plus
 * speaker notes, mirroring the in-app deck design. pptxgenjs is loaded
 * on demand so it never weighs down the initial bundle.
 */

const INK = "231D12";
const INK_SOFT = "6B6051";
const INK_FAINT = "998D7A";
const PAPER = "FBF7EC";
const DISPLAY_FONT = "Georgia";
const BODY_FONT = "Helvetica Neue";

// LAYOUT_WIDE is 13.33 x 7.5 inches.
const W = 13.33;
const H = 7.5;
const MARGIN = 0.9;
const CONTENT_W = W - MARGIN * 2;

export interface PptxDeckInfo {
  lessonTitle: string;
  bookTitle?: string;
  /** Book accent as a hex color like "#36436e". */
  accent?: string;
}

export async function exportDeckPptx(slides: Slide[], info: PptxDeckInfo) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = info.lessonTitle;
  const accent = (info.accent ?? "#36436e").replace("#", "").toUpperCase();

  slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    s.background = { color: PAPER };

    // Accent rule along the top, echoing the in-app stage.
    s.addShape("rect", {
      x: MARGIN,
      y: 0,
      w: CONTENT_W,
      h: 0.05,
      fill: { color: accent },
      line: { type: "none" },
    });

    renderBody(s, slide, accent, i);

    if (slide.pages?.length) {
      s.addText(formatPageRefs(slide.pages), {
        x: MARGIN,
        y: H - 0.55,
        w: 3,
        h: 0.35,
        fontSize: 10,
        fontFace: BODY_FONT,
        color: INK_FAINT,
      });
    }
    s.addText(`${i + 1} / ${slides.length}`, {
      x: W - MARGIN - 1.5,
      y: H - 0.55,
      w: 1.5,
      h: 0.35,
      align: "right",
      fontSize: 10,
      fontFace: BODY_FONT,
      color: INK_FAINT,
    });
    if (slide.notes) s.addNotes(slide.notes);
  });

  const fileName = `${info.lessonTitle.replace(/[^\w\d -]+/g, "").trim() || "deck"}.pptx`;
  await pptx.writeFile({ fileName });
}

type PptxSlide = ReturnType<InstanceType<typeof import("pptxgenjs").default>["addSlide"]>;

function renderBody(s: PptxSlide, slide: Slide, accent: string, index: number) {
  switch (slide.layout) {
    case "title":
    case "section": {
      const centered = slide.layout === "title";
      s.addText(slide.title, {
        x: MARGIN,
        y: 2.5,
        w: CONTENT_W,
        h: 1.6,
        align: centered ? "center" : "left",
        fontSize: 44,
        fontFace: DISPLAY_FONT,
        color: INK,
      });
      if (slide.subtitle) {
        s.addText(slide.subtitle, {
          x: MARGIN,
          y: 4.15,
          w: CONTENT_W,
          h: 0.9,
          align: centered ? "center" : "left",
          fontSize: 20,
          fontFace: BODY_FONT,
          color: INK_SOFT,
        });
      }
      break;
    }
    case "bullets":
    case "recap": {
      addTitle(s, slide.title);
      s.addText(
        (slide.bullets ?? []).map((b) => ({
          text: b,
          options: { bullet: { code: "2022", indent: 18 }, breakLine: true },
        })),
        {
          x: MARGIN,
          y: 2.3,
          w: CONTENT_W,
          h: 4.2,
          fontSize: 20,
          fontFace: BODY_FONT,
          color: INK,
          paraSpaceAfter: 14,
          valign: "top",
        }
      );
      break;
    }
    case "two-column": {
      addTitle(s, slide.title);
      const cols = slide.columns ?? [];
      const colW = (CONTENT_W - 0.5 * (cols.length - 1)) / cols.length;
      cols.forEach((col, ci) => {
        const x = MARGIN + ci * (colW + 0.5);
        s.addText(col.heading, {
          x,
          y: 2.3,
          w: colW,
          h: 0.5,
          fontSize: 18,
          bold: true,
          fontFace: BODY_FONT,
          color: accent,
        });
        s.addText(
          col.bullets.map((b) => ({
            text: b,
            options: { bullet: { code: "2022", indent: 14 }, breakLine: true },
          })),
          {
            x,
            y: 2.9,
            w: colW,
            h: 3.6,
            fontSize: 16,
            fontFace: BODY_FONT,
            color: INK,
            paraSpaceAfter: 10,
            valign: "top",
          }
        );
      });
      break;
    }
    case "quote": {
      addTitle(s, slide.title);
      s.addText(`“${slide.quote?.text ?? ""}”`, {
        x: MARGIN + 0.6,
        y: 2.6,
        w: CONTENT_W - 1.2,
        h: 2.6,
        align: "center",
        italic: true,
        fontSize: 28,
        fontFace: DISPLAY_FONT,
        color: INK,
      });
      if (slide.quote?.attribution) {
        s.addText(`— ${slide.quote.attribution}`, {
          x: MARGIN,
          y: 5.3,
          w: CONTENT_W,
          h: 0.5,
          align: "center",
          fontSize: 16,
          fontFace: BODY_FONT,
          color: INK_SOFT,
        });
      }
      break;
    }
    case "big-fact": {
      addTitle(s, slide.title);
      s.addText(slide.fact?.value ?? "", {
        x: MARGIN,
        y: 2.4,
        w: CONTENT_W,
        h: 2.2,
        align: "center",
        fontSize: 88,
        fontFace: DISPLAY_FONT,
        color: accent,
      });
      s.addText(slide.fact?.label ?? "", {
        x: MARGIN + 1,
        y: 4.8,
        w: CONTENT_W - 2,
        h: 1,
        align: "center",
        fontSize: 20,
        fontFace: BODY_FONT,
        color: INK_SOFT,
      });
      break;
    }
    case "process": {
      addTitle(s, slide.title);
      const steps = slide.steps ?? [];
      steps.forEach((step, si) => {
        const y = 2.3 + si * (4.3 / Math.max(steps.length, 3));
        s.addText(String(si + 1).padStart(2, "0"), {
          x: MARGIN,
          y,
          w: 0.7,
          h: 0.5,
          fontSize: 16,
          fontFace: "Courier New",
          color: accent,
        });
        s.addText(
          [
            { text: step.label, options: { bold: true } },
            ...(step.detail ? [{ text: `  —  ${step.detail}` }] : []),
          ],
          {
            x: MARGIN + 0.8,
            y,
            w: CONTENT_W - 0.8,
            h: 0.9,
            fontSize: 17,
            fontFace: BODY_FONT,
            color: INK,
            valign: "top",
          }
        );
      });
      break;
    }
  }
  void index;
}

function addTitle(s: PptxSlide, title: string) {
  s.addText(title, {
    x: MARGIN,
    y: 0.75,
    w: CONTENT_W,
    h: 1.2,
    fontSize: 30,
    fontFace: DISPLAY_FONT,
    color: INK,
    valign: "top",
  });
}

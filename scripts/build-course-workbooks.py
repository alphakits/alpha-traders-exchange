#!/usr/bin/env python3
"""Regenerate the checked-in English Academy PDFs from canonical lesson data.

Development use: python3 -m pip install reportlab; python3 scripts/build-course-workbooks.py
The website serves the generated files directly; Python is not a runtime dependency.
"""

import json
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfdoc, pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/files/course/pdfs"
INK = colors.HexColor("#17191C")
MUTED = colors.HexColor("#62666D")
GOLD = colors.HexColor("#C9A227")
WIDTH, HEIGHT, MARGIN = 612, 792, 48
FONT_DIRECTORY = Path(reportlab.__file__).resolve().parent / "fonts"
pdfmetrics.registerFont(TTFont("Workbook", str(FONT_DIRECTORY / "Vera.ttf")))
pdfmetrics.registerFont(TTFont("Workbook-Bold", str(FONT_DIRECTORY / "VeraBd.ttf")))


def paragraph(pdf, text, x, y, width, *, size=11, color=INK, bold=False, leading=17):
    style = ParagraphStyle(
        "workbook", fontName="Workbook-Bold" if bold else "Workbook",
        fontSize=size, leading=leading, textColor=color, spaceAfter=0,
    )
    block = Paragraph(escape(text), style)
    _, height = block.wrap(width, HEIGHT)
    block.drawOn(pdf, x, y - height)
    return y - height


def heading(pdf, label, y):
    return paragraph(pdf, label, MARGIN, y, WIDTH - 2 * MARGIN,
                     size=12, bold=True, leading=16) - 12


def bullets(pdf, items, y):
    for text in items:
        pdf.setFillColor(GOLD)
        pdf.circle(MARGIN + 3, y - 7, 2.2, stroke=0, fill=1)
        y = paragraph(pdf, text, MARGIN + 16, y, WIDTH - 2 * MARGIN - 16) - 10
    return y


def render(lesson):
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(WIDTH, HEIGHT), pageCompression=0, invariant=1)
    # Embed the bundled Vera fonts so device-specific font substitution cannot
    # change spacing. ASCII85 wraps compressed streams without losing PDF data.
    pdf._doc.defaultStreamFilters = [pdfdoc.PDFBase85Encode, pdfdoc.PDFZCompress]
    pdf.setTitle(f"{lesson['title']} - Workbook")
    pdf.setAuthor("Alpha Traders")
    pdf.setSubject(lesson["module"])
    pdf.setCreator("Alpha Traders Academy")

    pdf.setFillColor(INK)
    pdf.rect(0, 684, WIDTH, HEIGHT - 684, stroke=0, fill=1)
    pdf.setFillColor(GOLD)
    pdf.rect(0, 680, WIDTH, 4, stroke=0, fill=1)
    paragraph(pdf, "ALPHA TRADERS  /  ACADEMY WORKBOOK", MARGIN, 756,
              WIDTH - 2 * MARGIN, size=9, color=GOLD, bold=True, leading=12)
    title_bottom = paragraph(pdf, lesson["title"], MARGIN, 730,
                             WIDTH - 2 * MARGIN, size=22, color=colors.white,
                             bold=True, leading=26)
    if title_bottom < 686:
        raise ValueError(f"Title exceeds header: {lesson['slug']}")

    count = len(lesson["quiz"])
    question_label = "question" if count == 1 else "questions"
    details = f"{lesson['module']}  |  {lesson['durationMinutes']} minutes  |  Quiz: {count} {question_label}"
    paragraph(pdf, details, MARGIN, 656, WIDTH - 2 * MARGIN, size=9, color=MUTED, leading=14)

    y = heading(pdf, "Lesson summary", 612)
    y = paragraph(pdf, lesson["summary"], MARGIN, y, WIDTH - 2 * MARGIN) - 28
    y = heading(pdf, "Key takeaways", y)
    y = bullets(pdf, lesson["takeaways"], y) - 15
    y = heading(pdf, "Learning objectives", y)
    y = bullets(pdf, lesson["objectives"], y)
    if y < 218:
        raise ValueError(f"Content exceeds one-page layout: {lesson['slug']}")

    heading(pdf, "Your notes", 200)
    pdf.setStrokeColor(colors.HexColor("#D9DCE0"))
    pdf.setLineWidth(0.6)
    for line_y in (160, 137, 114, 91):
        pdf.line(MARGIN, line_y, WIDTH - MARGIN, line_y)
    pdf.line(MARGIN, 61, WIDTH - MARGIN, 61)
    paragraph(pdf, "Alpha Traders Academy", MARGIN, 47, 240, size=8, color=MUTED, leading=10)
    pdf.setFillColor(MUTED)
    pdf.setFont("Workbook", 8)
    pdf.drawRightString(WIDTH - MARGIN, 38, "alphatraders.co.il  |  1 / 1")
    pdf.showPage()
    pdf.save()

    # These PDFs use ASCII streams and embedded, subset fonts.
    # Replace ReportLab's optional binary-comment marker with an equal-length
    # ASCII comment; byte offsets and cross-reference positions remain intact.
    first, comment, rest = output.getvalue().split(b"\n", 2)
    if not first.startswith(b"%PDF-") or not comment.startswith(b"%"):
        raise ValueError("Unexpected PDF header")
    data = b"\n".join((first, b"%" + b"A" * (len(comment) - 1), rest))
    data.decode("ascii")
    return data


def main():
    lessons = json.loads((ROOT / "src/data/lessons-provided.json").read_text())
    for lesson in lessons:
        path = OUTPUT / f"{lesson['slug']}.pdf"
        if not path.is_file():
            raise ValueError(f"Missing existing workbook: {path.name}")
        path.write_bytes(render(lesson))
        print(f"Updated {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

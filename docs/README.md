# SmartDock — Report and Presentation (LaTeX)

| File | What it is |
|---|---|
| `meta.tex` | **Your details** (name, register number, guide, programme, department, college, academic year). Edit this first. |
| `report/report.tex` | Project report (chapters in `report/chapters/`, code appendix pulls real source files) |
| `slides/slides.tex` | Beamer presentation (16:9) following the 20-point outline |
| `diagrams/` | TikZ diagrams shared by the report and the slides (architecture, DFD, use case, ER, state machine, reservation flow) |
| `figures/` | Screenshots of the app and generated charts |
| `analysis/make_figures.py` | Regenerates the charts, live API timings and the before/after simulation (`results.json`) |

## Build the PDFs

Requires a LaTeX distribution (MiKTeX or TeX Live). Run each command twice so the table of contents and references are filled in.

```bash
cd docs/report && pdflatex report.tex && pdflatex report.tex
cd docs/slides && pdflatex slides.tex && pdflatex slides.tex
```

Output: `docs/report/report.pdf` and `docs/slides/slides.pdf`.

## Regenerate charts and measurements (optional)

```bash
cd docs/analysis && python make_figures.py https://smartdock.onrender.com
```

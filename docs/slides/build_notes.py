"""
Builds SPEAKER_NOTES.pdf from SPEAKER_NOTES.md (the subset of Markdown used there:
headings, paragraphs, bold/italic/code, blockquotes, bullet and numbered lists, rules, URLs).

Usage:  python build_notes.py      (then it runs pdflatex twice)
"""
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
src = (HERE / "SPEAKER_NOTES.md").read_text(encoding="utf-8")

SPECIALS = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
            "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}


def esc(text: str) -> str:
    return "".join(SPECIALS.get(c, c) for c in text)


def inline(text: str) -> str:
    """Escape LaTeX and convert **bold**, *italic*, `code` and bare URLs."""
    out = []
    # split into code spans and URLs (kept verbatim-ish) and plain text
    for part in re.split(r"(`[^`]+`|https?://[^\s)]+)", text):
        if not part:
            continue
        if part.startswith("`") and part.endswith("`"):
            out.append(r"\texttt{" + esc(part[1:-1]) + "}")
        elif part.startswith("http"):
            url = part.rstrip(".,;")
            out.append(r"\url{" + url + "}" + esc(part[len(url):]))
        else:
            t = esc(part)
            t = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", t)
            t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\\emph{\1}", t)
            t = t.replace('"', "''")  # straight double quotes -> closing quotes look odd; use ``..'' below
            out.append(t)
    s = "".join(out)
    # pretty double quotes: ''text'' -> ``text''
    s = re.sub(r"''(.+?)''", r"``\1''", s)
    # a quote that opens on this line but closes on a later one
    if s.startswith("''"):
        s = "``" + s[2:]
    # opening single quotes: 'word -> `word
    s = re.sub(r"(^|[\s(])'(?=\w)", r"\1`", s)
    s = s.replace("Dr. ", "Dr.~")
    return s


body = []
list_stack = []  # 'itemize' / 'enumerate'
in_quote = False


def close_lists():
    while list_stack:
        body.append(r"\end{" + list_stack.pop() + "}")


def set_quote(on: bool):
    global in_quote
    if on and not in_quote:
        close_lists()
        body.append(r"\begin{spoken}")
        in_quote = True
    elif not on and in_quote:
        close_lists()
        body.append(r"\end{spoken}")
        in_quote = False


lines = src.split("\n")
first_h1 = True
for raw in lines:
    line = raw.rstrip()
    quoted = line.startswith(">")
    if quoted:
        line = line[1:].lstrip()
    set_quote(quoted)

    if not line:
        close_lists()
        body.append("")
        continue
    if line == "---":
        close_lists()
        body.append(r"\medskip\noindent{\color{brand!40}\rule{\linewidth}{0.6pt}}\medskip")
        continue
    m = re.match(r"^(#{1,3}) (.*)$", line)
    if m:
        close_lists()
        level, text = len(m.group(1)), inline(m.group(2))
        if level == 1:
            if first_h1:
                body.append(r"\begin{center}{\LARGE\bfseries\color{brand} " + text + r"}\end{center}")
                first_h1 = False
            else:
                body.append(r"\clearpage\section*{" + text + "}\n\\addcontentsline{toc}{section}{" + text + "}")
        else:
            body.append(r"\subsection*{" + text + "}\n\\addcontentsline{toc}{subsection}{" + text + "}")
        continue
    m = re.match(r"^(\s*)([-*]|\d+\.) (.*)$", line)
    if m:
        kind = "enumerate" if m.group(2)[0].isdigit() else "itemize"
        if not list_stack or list_stack[-1] != kind:
            close_lists()
            body.append(r"\begin{" + kind + "}")
            list_stack.append(kind)
        body.append(r"\item " + inline(m.group(3)))
        continue
    close_lists()
    body.append(inline(line) + r"\par")

set_quote(False)
close_lists()

tex = r"""\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=2cm]{geometry}
\usepackage{xcolor}
\usepackage{framed}
\usepackage{enumitem}
\usepackage{parskip}
\usepackage{fancyhdr}
\usepackage{newunicodechar}
\usepackage[hidelinks]{hyperref}
\usepackage{titlesec}
\definecolor{brand}{HTML}{6D28D9}
\definecolor{ink}{HTML}{1F2937}
\definecolor{spokenbg}{HTML}{F5F3FF}
\newunicodechar{→}{\ensuremath{\rightarrow}}
\newunicodechar{≥}{\ensuremath{\geq}}
\newunicodechar{≈}{\ensuremath{\approx}}
\newunicodechar{÷}{\ensuremath{\div}}
\newunicodechar{×}{\ensuremath{\times}}
\newunicodechar{·}{\ensuremath{\cdot}}
\newunicodechar{…}{\ldots}
\newunicodechar{–}{--}
\newunicodechar{—}{---}
\newunicodechar{’}{'}
\titleformat{\section}{\Large\bfseries\color{brand}}{}{0pt}{}
\titleformat{\subsection}{\large\bfseries\color{ink}}{}{0pt}{}
\titlespacing*{\subsection}{0pt}{14pt}{4pt}
\setlist{itemsep=1pt,topsep=2pt}
% spoken text: shaded box with a purple bar
\newenvironment{spoken}{%
  \def\FrameCommand{{\color{brand}\vrule width 2.5pt}\colorbox{spokenbg}}%
  \MakeFramed{\advance\hsize-\width\FrameRestore}\vspace{2pt}}%
  {\vspace{2pt}\endMakeFramed}
\pagestyle{fancy}\fancyhf{}
\fancyhead[L]{\small\color{gray}SmartDock --- Speaker Script}
\fancyhead[R]{\small\color{gray}Ramaguru S}
\fancyfoot[C]{\thepage}
\renewcommand{\headrulewidth}{0.3pt}
\begin{document}
""" + "\n".join(body) + r"""
\end{document}
"""
(HERE / "SPEAKER_NOTES.tex").write_text(tex, encoding="utf-8")
for _ in range(2):
    subprocess.run(["pdflatex", "-interaction=nonstopmode", "SPEAKER_NOTES.tex"], cwd=HERE,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("built", HERE / "SPEAKER_NOTES.pdf")

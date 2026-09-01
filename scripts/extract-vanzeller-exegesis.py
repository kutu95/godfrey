"""One-shot: extract scholarly (non-novel) text from the van Zeller thesis PDF."""
import re
import zlib
from pathlib import Path

PDF = Path(r"D:\Godfrey\docs\228543_VanZeller 2015.pdf")
OUT = Path(r"D:\Godfrey\docs\_notes\vanzeller-exegesis-extract.txt")


def pdf_strings(raw: bytes) -> str:
    parts = []
    i = 0
    while True:
        a = raw.find(b"(", i)
        if a < 0:
            break
        j = a + 1
        out = bytearray()
        while j < len(raw):
            c = raw[j]
            if c == 92 and j + 1 < len(raw):
                out.append(raw[j + 1])
                j += 2
                continue
            if c == 41:
                break
            out.append(c)
            j += 1
        parts.append(out.decode("latin-1", "ignore"))
        i = j + 1
    return "".join(parts)


def main() -> None:
    data = PDF.read_bytes()
    streams = re.findall(rb"stream\r?\n(.+?)\r?\nendstream", data, re.S)
    chunks = []
    for s in streams:
        try:
            d = zlib.decompress(s)
        except Exception:
            continue
        t = pdf_strings(d)
        if t.strip():
            chunks.append(t)
    full = "\n".join(chunks)
    for a, b in (("\x91", "'"), ("\x92", "'"), ("\x93", '"'), ("\x94", '"'), ("\x96", "-"), ("\x97", "-")):
        full = full.replace(a, b)

    exo = full.find("EXEGESIS")
    dedic = full.lower().find("the eight souls")
    abstract = full.find("Abstract")
    parts = []
    parts.append("===== TITLE / FRONT (trimmed) =====\n")
    parts.append(full[1800:4500])
    if dedic >= 0:
        parts.append("\n\n===== DEDICATION / EIGHT SOULS =====\n")
        parts.append(full[max(0, dedic - 200) : dedic + 1800])
    if abstract >= 0:
        parts.append("\n\n===== ABSTRACT =====\n")
        parts.append(full[abstract : abstract + 3500])
    if exo >= 0:
        parts.append("\n\n===== EXEGESIS TO END =====\n")
        parts.append(full[exo:])
    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} chars={OUT.stat().st_size} exo={exo}")


if __name__ == "__main__":
    main()

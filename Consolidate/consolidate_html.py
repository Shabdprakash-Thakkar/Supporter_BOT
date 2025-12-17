from pathlib import Path


# Folder that contains original HTML files
# Resolve relative to this script's location (Consolidate/ -> ../Flask_Frontend_Consolidated/HTML)
BASE_DIR = Path(__file__).parent.parent
HTML_ROOT = BASE_DIR / "Flask_Frontend_Consolidated" / "HTML"

# Output merged reference HTML file
OUTPUT_FILE = BASE_DIR / "Flask_Frontend_Consolidated" / "app_hcj.html"


def collect_html_files():
    """
    Collect all .html files inside HTML_ROOT (including nested folders).
    """
    files = sorted(HTML_ROOT.rglob("*.html"), key=lambda p: str(p.relative_to(HTML_ROOT)))
    return files


def merge_html():
    files = collect_html_files()

    print("Merging HTML files:")
    for f in files:
        print("  -", f.relative_to(HTML_ROOT))

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_FILE.open("w", encoding="utf-8") as out:
        out.write("<!-- AUTO-GENERATED MERGED HTML FILE (REFERENCE ONLY) -->\n\n")

        for f in files:
            rel = f.relative_to(HTML_ROOT)
            out.write(f"<!-- ===== {rel} ===== -->\n")
            out.write(f.read_text(encoding="utf-8"))
            out.write("\n\n")

    print("\nDone! Merged HTML written to:", OUTPUT_FILE)


if __name__ == "__main__":
    merge_html()

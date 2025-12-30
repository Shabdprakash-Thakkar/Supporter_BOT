# v4.0.0
from pathlib import Path


# Folder that contains all original CSS files
# Resolve relative to this script's location (Consolidate/ -> ../Flask_Frontend_Consolidated/CSS)
BASE_DIR = Path(__file__).parent.parent
CSS_ROOT = BASE_DIR / "Flask_Frontend_Consolidated" / "CSS"

# Output merged file
OUTPUT_FILE = BASE_DIR / "Flask_Frontend_Consolidated" / "app_hcj.css"


def collect_css_files():
    """
    Collect all .css files inside CSS_ROOT (including partials, Tabs, SubTabs).
    Return them in stable alphabetical order.
    """
    files = []

    # Top-level CSS files
    files.extend(sorted(CSS_ROOT.glob("*.css"), key=lambda p: p.name))

    # Nested folders (partials, Tabs, SubTabsAnalytics, SubTabsLevel)
    for path in sorted(CSS_ROOT.rglob("*.css"), key=lambda p: str(p.relative_to(CSS_ROOT))):
        if path not in files:   # avoid duplicates
            files.append(path)

    return files


def merge_css():
    files = collect_css_files()

    print("Merging CSS files:")
    all_imports = []
    all_content = []

    for f in files:
        rel = f.relative_to(CSS_ROOT)
        print("  -", rel)
        
        content = f.read_text(encoding="utf-8")
        lines = content.splitlines()
        
        file_content_lines = []
        for line in lines:
            if line.strip().startswith("@import"):
                # Only keep external imports (e.g. fonts), remove local ones
                if "http://" in line or "https://" in line:
                    all_imports.append(line)
            else:
                file_content_lines.append(line)
        
        all_content.append((rel, "\n".join(file_content_lines)))

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_FILE.open("w", encoding="utf-8") as out:
        out.write("/* AUTO-GENERATED MERGED CSS FILE */\n\n")
        
        # Deduplicate imports
        unique_imports = sorted(list(set(all_imports)))
        
        if unique_imports:
            out.write("/* ===== IMPORTS ===== */\n")
            for imp in unique_imports:
                out.write(imp + "\n")
            out.write("\n")

        for rel, content in all_content:
            out.write(f"/* ===== {rel} ===== */\n")
            out.write(content)
            out.write("\n\n")

    print("\nDone! Merged CSS written to:", OUTPUT_FILE)


if __name__ == "__main__":
    merge_css()

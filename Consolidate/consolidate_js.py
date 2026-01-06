# v5.0.0
# v4.0.0
from pathlib import Path


# Folder that contains the individual JS files
# Resolve relative to this script's location (Consolidate/ -> ../Flask_Frontend_Consolidated/JS)
BASE_DIR = Path(__file__).parent.parent
JS_ROOT = BASE_DIR / "Flask_Frontend_Consolidated" / "JS"

# Output file
OUTPUT_FILE = BASE_DIR / "Flask_Frontend_Consolidated" / "app_hcj.js"

def collect_js_files():
    """
    Collect all .js files inside JS_ROOT (including Utils and Tabs),
    in a stable, predictable order.
    """
    files = []

    # 1. Utils (dependencies) first
    utils_dir = JS_ROOT / "Utils"
    if utils_dir.exists():
        files.extend(sorted(utils_dir.glob("*.js"), key=lambda p: p.name))
        
    # 1.5. Partials (shared components like navbar)
    partial_dir = JS_ROOT / "partial"
    if partial_dir.exists():
        files.extend(sorted(partial_dir.glob("*.js"), key=lambda p: p.name))

    # 2. top-level JS files (command.js, contact.js, etc.)
    files.extend(sorted(JS_ROOT.glob("*.js"), key=lambda p: p.name))

    # 3. then Tabs/ and its subfolders, alphabetically
    tabs_dir = JS_ROOT / "Tabs"
    if tabs_dir.exists():
        for path in sorted(tabs_dir.rglob("*.js"), key=lambda p: str(p.relative_to(JS_ROOT))):
            files.append(path)

    return files

def merge_js():
    files = collect_js_files()

    print("Merging JS files:")
    for f in files:
        print("  -", f.relative_to(JS_ROOT))

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_FILE.open("w", encoding="utf-8") as out:
        out.write("// AUTO-GENERATED MERGED FILE\n\n")

        for f in files:
            rel = f.relative_to(JS_ROOT)
            out.write(f"// ===== {rel} =====\n")
            out.write(f.read_text(encoding="utf-8"))
            out.write("\n\n")   # blank line between files

    print("\nDone! Merged JS written to:", OUTPUT_FILE)

if __name__ == "__main__":
    merge_js()

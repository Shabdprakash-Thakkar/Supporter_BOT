import os
from pathlib import Path

# Configuration
VERSION_COMMENT = "v5.0.0"  # Change this version for future updates

# Define the root of the project relative to this script
# Assuming this script is in Python_Files/, the root is one level up.
ROOT_DIR = Path(__file__).parent.parent

# File extension to comment mapping
FILE_TYPES = {
    ".py": f"# {VERSION_COMMENT}",
    ".js": f"// {VERSION_COMMENT}",
    ".css": f"/* {VERSION_COMMENT} */",
    ".html": f"<!-- {VERSION_COMMENT} -->",
    ".md": f"<!-- {VERSION_COMMENT} -->",
    ".sql": f"-- {VERSION_COMMENT}",
    ".txt": f"-- {VERSION_COMMENT}",
    ".env": f"# {VERSION_COMMENT}",
}

# Files and directories to ignore
IGNORED_FILES = {".gitignore", "app_version_comment.py", ".DS_Store", "full_tree.txt"}
IGNORED_DIRS = {".git", ".gemini", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode"}

def get_comment_for_file(filename):
    _, ext = os.path.splitext(filename)
    return FILE_TYPES.get(ext.lower())

def process_file(filepath):
    filename = filepath.name
    if filename in IGNORED_FILES:
        return

    comment = get_comment_for_file(filename)
    if not comment:
        return

    try:
        content = filepath.read_text(encoding='utf-8')
    except Exception as e:
        print(f"Skipping {filepath.relative_to(ROOT_DIR)}: {e}")
        return

    lines = content.splitlines(keepends=True)
    
# Avoid adding the same comment again at the top
    # We check if the version tag is already present in a robust way
    search_lines = lines[:2] if lines and lines[0].startswith("#!") else lines[:1]
    is_tagged = any(comment.strip() in (L.strip() for L in search_lines if L.strip()) for L in search_lines)
    
    if is_tagged:
        print(f"Skipping {filepath.relative_to(ROOT_DIR)}: Already tagged with {VERSION_COMMENT}.")
        return

    new_content = ""
    # Handle Shebang
    if lines and lines[0].startswith("#!"):
        new_content = lines[0] + comment + "\n" + "".join(lines[1:])
    else:
        new_content = comment + "\n" + "".join(lines)

    try:
        filepath.write_text(new_content, encoding='utf-8')
        print(f"Updated: {filepath.relative_to(ROOT_DIR)}")
    except Exception as e:
        print(f"Error writing {filepath.name}: {e}")

def main():
    print(f"Applying version '{VERSION_COMMENT}' to files in {ROOT_DIR}...")
    
    for root, dirs, files in os.walk(ROOT_DIR):
        # Skip ignored directories
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        
        for file in files:
            file_path = Path(root) / file
            process_file(file_path)
            
    print("Done.")

if __name__ == "__main__":
    main()

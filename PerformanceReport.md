<!-- v4.0.0 -->
# Performance Report

## Overview

This project supports two execution modes for the frontend: **Separate Run** and **Consolidated Run**. This report details the differences, benefits, and performance implications of each.

## 1. Separate Run (Development Mode)

**Entry Point**: `Runner_Files/run_localhost.py`
**Source**: `Flask_Frontend/`

### Characteristics

- **Structure**: HTML templates allow including multiple individual CSS and JS files.
- **Loading**: The browser makes separate HTTP requests for every `.css` and `.js` file included in a page.

### Build/Run

- **No Build Step**: Changes in `Flask_Frontend/` are immediately visible upon browser refresh.

### Pros & Cons

| Pros                                                                                     | Cons                                                                                |
| :--------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **Easier Debugging**: Errors point to specific small files rather than one massive file. | **High Latency**: Multiple HTTP round-trips delay page rendering.                   |
| **Rapid Iteration**: No need to re-run consolidation scripts after every edit.           | **No Caching Benefits**: Harder to cache effectively compared to versioned bundles. |

---

## 2. Consolidated Run (Production Mode)

**Entry Point**: `Runner_Files/run_production_consolidated.py`
**Source**: `Flask_Frontend_Consolidated/`

### Characteristics

- **Structure**: All styles are merged into `app_hcj.css`, and all scripts into `app_hcj.js`.
- **Loading**: The browser loads the entire application's asset payload in just 2 requests (1 CSS, 1 JS).

### Build/Run

- **Build Step Required**: You must run the scripts in `Consolidate/` to update the consolidated files whenever source files change.

### Pros & Cons

| Pros                                                                                                           | Cons                                                                                   |
| :------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| **Faster Load Times**: Drastically reduces HTTP requests.                                                      | **Harder Debugging**: Line numbers in errors refer to the giant generated file.        |
| **Better Caching**: Browser caches the single large file; subsequent page navigations are instant.             | **Extra Step**: Must remember to consolidate before deploying or testing in this mode. |
| **Smoother UX**: Eliminates "flash of unstyled content" (FOUC) risks often caused by loading many small files. |                                                                                        |

## Summary Recommendation

- Use **Separate Run** while writing code, fixing bugs, or designing new features.
- Use **Consolidated Run** for the final deployment or when testing the "real-world" user experience.

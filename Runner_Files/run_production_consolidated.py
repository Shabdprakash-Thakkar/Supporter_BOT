"""
Runner to start the Flask frontend (CONSOLIDATED VERSION) and Discord bot within a single process.

This script:
- Starts the Flask application using app_hcj (consolidated assets) in a background daemon thread.
- Starts the Discord bot in the main thread (so it can receive signals).
- Uses structured logging and performs basic graceful shutdown attempts.

DIFFERENCE FROM run_production.py:
- Imports from 'app_hcj' instead of 'app' to use consolidated CSS/JS files
- Reduces HTTP requests from 5-22 per page to just 3 per page
"""

import sys
import os
import threading
import time
import asyncio
import importlib
import logging
from pathlib import Path
from typing import Optional, Callable, Any

# ---------------------------------------------------------
# 1. SETUP PATHS
# ---------------------------------------------------------
BASE_DIR = Path(__file__).parent.resolve().parents[0]
PYTHON_FILES_DIR = BASE_DIR / "Python_Files"
FLASK_DIR = BASE_DIR / "Flask_Frontend_Consolidated"

sys.path.insert(0, str(PYTHON_FILES_DIR))
sys.path.insert(0, str(FLASK_DIR))

# ---------------------------------------------------------
# 2. CONFIGURATION
# ---------------------------------------------------------
SERVER_PORT = os.getenv("FLASK_PORT", "5000")

# Configure logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("run_production_consolidated")


# ---------------------------------------------------------
# 3. THREAD FUNCTIONS
# ---------------------------------------------------------


def start_flask_thread() -> None:
    """
    Start the Flask frontend using CONSOLIDATED assets (app_hcj).
    
    Imports the Flask module dynamically to rely on modified sys.path set earlier.
    Expects a callable `run_flask_app()` in the `app_hcj` module that starts the Flask server.
    """
    logger.info("Starting Flask server (CONSOLIDATED MODE - port %s).", SERVER_PORT)
    logger.info("📦 Using consolidated assets: app_hcj.css, app_hcj.js")
    try:
        app_module = importlib.import_module("app_hcj") 
    except Exception:
        logger.exception("Failed to import Flask app module 'app_hcj'.")
        return

    run_flask: Optional[Callable[[], Any]] = getattr(app_module, "run_flask_app", None)
    if not callable(run_flask):
        logger.error("app_hcj.run_flask_app() not found or not callable.")
        return

    try:
        run_flask()
    except Exception:
        logger.exception("Error while running Flask frontend.")


def start_discord_bot() -> None:
    """
    Start the Discord bot. Imports the supporter module dynamically and
    calls its `run_bot()` function. Expects that function to block until
    bot shutdown or raise exceptions on errors.
    """
    logger.info("Starting Discord bot.")
    try:
        supporter_module = importlib.import_module("supporter")
    except Exception:
        logger.exception("Failed to import Discord bot module 'supporter'.")
        return

    run_bot: Optional[Callable[[], Any]] = getattr(supporter_module, "run_bot", None)
    if not callable(run_bot):
        logger.error("supporter.run_bot() not found or not callable.")
        return

    try:
        run_bot()
    except Exception:
        logger.exception("Error while running Discord bot.")


def _attempt_module_shutdown(
    module_name: str, candidates: tuple = ("shutdown", "close", "stop")
) -> None:
    """
    Attempt to call a shutdown-style function on a module if present.
    If the function is a coroutine, run it with asyncio.run.
    """
    try:
        mod = importlib.import_module(module_name)
    except Exception:
        logger.debug("Module %s not importable for shutdown attempt.", module_name)
        return

    for name in candidates:
        func = getattr(mod, name, None)
        if callable(func):
            try:
                logger.info("Calling %s.%s() for graceful shutdown.", module_name, name)
                result = func()
                if asyncio.iscoroutine(result):
                    asyncio.run(result)
            except Exception:
                logger.exception("Error while calling %s.%s()", module_name, name)
            finally:
                return


# ---------------------------------------------------------
# 4. MAIN EXECUTION
# ---------------------------------------------------------

if __name__ == "__main__":
    logger.info("Supporter Bot - CONSOLIDATED threaded runner starting.")
    logger.info("🚀 Performance Mode: Using consolidated assets (3 files per page)")

    # On Windows, use the Selector event loop policy to avoid certain aiohttp issues.
    if sys.platform == "win32" and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
            logger.debug("WindowsSelectorEventLoopPolicy set.")
        except Exception:
            logger.exception("Failed to set WindowsSelectorEventLoopPolicy.")

    # Verify directories exist before starting
    if not PYTHON_FILES_DIR.exists():
        logger.error("Required directory not found: %s", PYTHON_FILES_DIR)
        sys.exit(1)
    if not FLASK_DIR.exists():
        logger.error("Required directory not found: %s", FLASK_DIR)
        sys.exit(1)

    flask_thread = threading.Thread(
        target=start_flask_thread, name="Flask-Thread", daemon=True
    )
    flask_thread.start()

    # Short delay to allow the Flask thread to initialize
    time.sleep(2)

    try:
        start_discord_bot()
    except KeyboardInterrupt:
        logger.info("Stop signal received. Initiating graceful shutdown procedures.")
        # Attempt to perform graceful shutdown on common modules
        _attempt_module_shutdown("supporter")
        _attempt_module_shutdown("app_hcj")  # ← Changed from "app"
    except Exception:
        logger.exception("Unhandled error in main execution.")
    finally:
        logger.info("Waiting for Flask thread to finish (timeout 5s).")
        try:
            flask_thread.join(timeout=5)
        except Exception:
            logger.exception("Error while waiting for Flask thread to join.")
        logger.info("Runner exiting.")

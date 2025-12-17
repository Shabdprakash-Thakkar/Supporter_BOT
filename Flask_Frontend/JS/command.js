/**
 * @file Command Page Script
 * @description
 * Enhances the commands reference page with:
 *  - Copy-to-clipboard for commands (buttons + card click)
 *  - Search with live filtering and result list
 *  - Scroll-in animations for categories
 *  - Keyboard shortcuts for search focus
 *  - Smooth anchor scrolling
 *  - Tooltips and hover effects on command cards
 *  - Analytics hooks for command copies (optional)
 */

document.addEventListener("DOMContentLoaded", function () {
  initCopyButtons();
  initSearch();
  initScrollAnimations();
  initKeyboardShortcuts();
});

// ==================== COPY TO CLIPBOARD ====================

/**
 * Initialize copy-to-clipboard behavior for command cards and their buttons.
 * Uses a global toast (#copyToast) for feedback.
 */
function initCopyButtons() {
  const copyButtons = document.querySelectorAll(".copy-btn");
  const toast = document.getElementById("copyToast");

  copyButtons.forEach((button) => {
    button.addEventListener("click", function (e) {
      e.stopPropagation();

      const commandCard = this.closest(".command-card");
      const command = commandCard.getAttribute("data-command");

      copyToClipboard(command)
        .then(() => {
          showCopyFeedback(this, toast, command);
        })
        .catch((err) => {
          console.error("Failed to copy:", err);
          showErrorFeedback(this);
        });
    });
  });

  const commandCards = document.querySelectorAll(".command-card");
  commandCards.forEach((card) => {
    card.addEventListener("click", function (e) {
      if (e.target.closest(".copy-btn")) return;

      const command = this.getAttribute("data-command");
      const copyBtn = this.querySelector(".copy-btn");

      copyToClipboard(command)
        .then(() => {
          showCopyFeedback(copyBtn, toast, command);
        })
        .catch((err) => {
          console.error("Failed to copy:", err);
        });
    });
  });
}

/**
 * Copy text to clipboard using the modern Clipboard API with a fallback.
 *
 * @param {string} text - Command text to copy
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  } else {
    return new Promise((resolve, reject) => {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand("copy");
        textArea.remove();
        resolve();
      } catch (err) {
        textArea.remove();
        reject(err);
      }
    });
  }
}

/**
 * Visual feedback for successful copy:
 *  - Temporarily swap button icon and add "copied" style
 *  - Show toast notification
 *
 * @param {HTMLElement} button - The copy button element
 * @param {HTMLElement} toast - Toast element (#copyToast)
 * @param {string} command - Command that was copied
 */
function showCopyFeedback(button, toast, command) {
  const originalIcon = button.innerHTML;
  button.innerHTML = '<i class="fas fa-check"></i>';
  button.classList.add("copied");

  setTimeout(() => {
    button.innerHTML = originalIcon;
    button.classList.remove("copied");
  }, 2000);

  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);

  console.log(`Copied command: ${command}`);
}

/**
 * Error feedback for failed copy attempts.
 *
 * @param {HTMLElement} button - The copy button element
 */
function showErrorFeedback(button) {
  button.innerHTML = '<i class="fas fa-times"></i>';
  button.style.background = "#ef4444";
  button.style.borderColor = "#ef4444";

  setTimeout(() => {
    button.innerHTML = '<i class="fas fa-copy"></i>';
    button.style.background = "";
    button.style.borderColor = "";
  }, 2000);
}

// ==================== SEARCH & FILTERING ====================

/**
 * Initialize command search:
 *  - Builds an in-memory search index from command cards
 *  - Handles debounced input, clearing, Escape key, and result click behavior
 */
function initSearch() {
  const searchInput = document.getElementById("commandSearch");
  const searchResults = document.getElementById("searchResults");
  const commandCards = document.querySelectorAll(".command-card");

  const searchIndex = Array.from(commandCards).map((card) => ({
    element: card,
    command: card.getAttribute("data-command"),
    description: card.querySelector(".command-desc").textContent,
    category: card.closest(".command-category").querySelector(".category-title")
      .textContent,
  }));

  let searchTimeout;

  searchInput.addEventListener("input", function (e) {
    clearTimeout(searchTimeout);

    const query = e.target.value.trim().toLowerCase();

    if (query.length === 0) {
      searchResults.classList.add("hidden");
      searchResults.innerHTML = "";
      showAllCommands();
      return;
    }

    searchTimeout = setTimeout(() => {
      performSearch(query, searchIndex, searchResults);
    }, 200);
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-container")) {
      searchResults.classList.add("hidden");
    }
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      this.value = "";
      searchResults.classList.add("hidden");
      searchResults.innerHTML = "";
      showAllCommands();
    }
  });
}

/**
 * Run the search over the index and render the result list,
 * while also filtering visible commands on the page.
 *
 * @param {string} query - Lowercased search query
 * @param {Array} searchIndex - Array of index objects
 * @param {HTMLElement} resultsContainer - Results container element
 */
function performSearch(query, searchIndex, resultsContainer) {
  const results = searchIndex.filter((item) => {
    return (
      item.command.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    );
  });

  if (results.length === 0) {
    resultsContainer.innerHTML =
      '<div class="search-result-item"><p class="text-slate-400 text-center">No commands found</p></div>';
    resultsContainer.classList.remove("hidden");
    hideAllCommands();
    return;
  }

  resultsContainer.innerHTML = results
    .slice(0, 10)
    .map(
      (result) => `
    <div class="search-result-item" data-command="${result.command}">
      <div class="search-result-command">${result.command}</div>
      <div class="search-result-desc">${result.description}</div>
    </div>
  `
    )
    .join("");

  resultsContainer.classList.remove("hidden");

  resultsContainer.querySelectorAll(".search-result-item").forEach((item) => {
    item.addEventListener("click", function () {
      const command = this.getAttribute("data-command");
      copyToClipboard(command).then(() => {
        const toast = document.getElementById("copyToast");
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
      });
    });
  });

  filterCommands(query, searchIndex);
}

/**
 * Filter visible command cards and categories based on the query.
 *
 * @param {string} query - Lowercased search query
 * @param {Array} searchIndex - Array of index objects
 */
function filterCommands(query, searchIndex) {
  searchIndex.forEach((item) => {
    const matches =
      item.command.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query);

    if (matches) {
      item.element.style.display = "";
      item.element.style.opacity = "1";
    } else {
      item.element.style.display = "none";
      item.element.style.opacity = "0";
    }
  });

  document.querySelectorAll(".command-category").forEach((category) => {
    const visibleCards = category.querySelectorAll(
      '.command-card[style*="display: none"]'
    );
    const totalCards = category.querySelectorAll(".command-card");

    if (visibleCards.length === totalCards.length) {
      category.style.display = "none";
    } else {
      category.style.display = "";
    }
  });
}

/**
 * Restore visibility of all commands and categories.
 */
function showAllCommands() {
  document.querySelectorAll(".command-card").forEach((card) => {
    card.style.display = "";
    card.style.opacity = "1";
  });

  document.querySelectorAll(".command-category").forEach((category) => {
    category.style.display = "";
  });
}

/**
 * Hide all command cards (used when no search results).
 */
function hideAllCommands() {
  document.querySelectorAll(".command-card").forEach((card) => {
    card.style.display = "none";
  });
}

// ==================== SCROLL ANIMATIONS ====================

/**
 * Initialize scroll-triggered reveal animations for command categories.
 */
function initScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll(".command-category").forEach((category) => {
    observer.observe(category);
  });
}

// ==================== KEYBOARD SHORTCUTS ====================

/**
 * Keyboard shortcuts:
 *  - Ctrl/Cmd + K or Ctrl/Cmd + / to focus the command search input.
 */
function initKeyboardShortcuts() {
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      const searchInput = document.getElementById("commandSearch");
      searchInput.focus();
      searchInput.select();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      const searchInput = document.getElementById("commandSearch");
      searchInput.focus();
      searchInput.select();
    }
  });
}

// ==================== SMOOTH ANCHOR SCROLL ====================

/**
 * Smooth scroll behavior for on-page anchor links.
 */
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute("href"));
    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  });
});

// ==================== ANALYTICS HOOKS ====================

/**
 * Track command copy interactions (analytics hook).
 *
 * @param {string} command - Command string that was copied
 */
function trackCommandCopy(command) {
  console.log(`Command copied: ${command}`);
}

// ==================== HOVER EFFECTS ====================

/**
 * Apply subtle hover transition to command cards.
 */
document.querySelectorAll(".command-card").forEach((card) => {
  card.addEventListener("mouseenter", function () {
    this.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
  });
});

// ==================== TOOLTIP INITIALIZATION ====================

/**
 * Initialize basic "Click to copy" tooltips for copy buttons.
 */
function initTooltips() {
  const copyButtons = document.querySelectorAll(".copy-btn");

  copyButtons.forEach((button) => {
    button.addEventListener("mouseenter", function () {
      const tooltip = document.createElement("div");
      tooltip.className = "copy-tooltip";
      tooltip.textContent = "Click to copy";
      tooltip.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        white-space: nowrap;
        pointer-events: none;
        margin-bottom: 0.5rem;
      `;

      this.style.position = "relative";
      this.appendChild(tooltip);
    });

    button.addEventListener("mouseleave", function () {
      const tooltip = this.querySelector(".copy-tooltip");
      if (tooltip) {
        tooltip.remove();
      }
    });
  });
}

initTooltips();

// ==================== DIAGNOSTICS ====================

console.log("Command page loaded successfully");

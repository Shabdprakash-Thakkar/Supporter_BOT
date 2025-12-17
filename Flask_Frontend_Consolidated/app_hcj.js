// AUTO-GENERATED MERGED FILE

// ===== Utils\populateChannelDropdownWithCategories.js =====
/**
 * @file Channel Dropdown Population Utility
 * @description
 * Utility function to populate Discord channel dropdowns with category grouping.
 * Displays channels as "#channel -> Category Name" sorted by category.
 * 
 * Features:
 * - Filters by channel type
 * - Enriches channels with Category name
 * - Sorts by Category then Channel name
 * - Formats text as "#channel -> Category"
 * - Compatible with Select2 dropdowns
 */

/**
 * Populate a select element with Discord channels including category info.
 * 
 * @param {HTMLSelectElement} selectElement - The select element to populate
 * @param {Array} channels - Array of channel objects from Discord API
 * @param {Object} options - Configuration options
 * @param {Array<number>} options.channelTypes - Discord channel types to include (default: [0, 5] for text/announcement)
 * @param {string} options.placeholder - Placeholder text (default: "Select a channel...")
 * @param {boolean} options.includeHash - Whether to prefix channel names with # (default: true)
 * @param {boolean} options.showCategory - Whether to append category name (default: true)
 * @param {string} options.categorySeparator - Separator between channel and category (default: " -> ")
 * @param {boolean} options.sortCategories - Whether to sort categories alphabetically (default: true)
 * @param {boolean} options.sortChannels - Whether to sort channels within modifiers (default: true)
 */
function populateChannelDropdownWithCategories(selectElement, channels, options = {}) {
    // Default options
    const config = {
        channelTypes: options.channelTypes || [0, 5], // 0 = text, 5 = announcement
        placeholder: options.placeholder || "Select a channel...",
        includeHash: options.includeHash !== undefined ? options.includeHash : true,
        showCategory: options.showCategory !== undefined ? options.showCategory : true,
        categorySeparator: options.categorySeparator || " -> ",
        sortCategories: options.sortCategories !== undefined ? options.sortCategories : true,
        sortChannels: options.sortChannels !== undefined ? options.sortChannels : true,
    };

    // Clear existing options
    selectElement.innerHTML = "";

    // Add placeholder
    if (config.placeholder) {
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        placeholderOption.textContent = config.placeholder;
        selectElement.appendChild(placeholderOption);
    }

    // 1. Map all channels by ID for easy lookup (to find category names)
    const channelMap = new Map();
    channels.forEach(ch => channelMap.set(ch.id, ch));

    // 2. Filter target channels
    const targetChannels = channels.filter((ch) =>
        config.channelTypes.includes(ch.type)
    );

    console.log(`[PopulateDropdown] Total channels: ${channels.length}, Target channels: ${targetChannels.length}`);


    if (targetChannels.length === 0) {
        const noChannelsOption = document.createElement("option");
        noChannelsOption.disabled = true;
        noChannelsOption.textContent = "No channels available";
        selectElement.appendChild(noChannelsOption);
        return;
    }

    // 3. Enrich with category info and handle missing categories
    const enrichedChannels = targetChannels.map(ch => {
        let categoryName = "No Category"; // Default literal for sorting
        let hasCategory = false;

        if (ch.parent_id && channelMap.has(ch.parent_id)) {
            categoryName = channelMap.get(ch.parent_id).name;
            hasCategory = true;
        } else if (ch.parent_id) {
            console.warn(`[PopulateDropdown] Channel ${ch.name} has parent_id ${ch.parent_id} but parent not found in map.`);
        }

        return {
            ...ch,
            categoryName,
            hasCategory
        };
    });

    // 4. Sort channels
    enrichedChannels.sort((a, b) => {
        // Primary sort: Category
        if (config.sortCategories) {
            // "No Category" should often come last or first? 
            // Alphabetical sort usually puts it in middle. 
            // Let's standard alphabetical.
            const catCompare = a.categoryName.localeCompare(b.categoryName);
            if (catCompare !== 0) return catCompare;
        }

        // Secondary sort: Channel Name
        if (config.sortChannels) {
            return a.name.localeCompare(b.name);
        }
        return 0;
    });

    // 5. Render
    enrichedChannels.forEach(ch => {
        const opt = document.createElement("option");
        opt.value = ch.id;

        // Prefix (# or 🔊 etc - caller might handle icon via emoji in name, but includeHash handles text hash)
        // If includeHash is true and it's a text/announcement channel, add #.
        // For voice, we might want speaker icon if it's not already there?
        // The previous usage in config_time.js handled icons manually? 
        // No, current implementation of this function uses `includeHash`.
        // config_time calls it with `includeHash: false`.
        // So we stick to config.includeHash.

        const prefix = config.includeHash ? "# " : "";

        let label = `${prefix}${ch.name}`;

        if (config.showCategory && ch.hasCategory) {
            label += `${config.categorySeparator}${ch.categoryName}`;
        }

        opt.textContent = label;
        selectElement.appendChild(opt);
    });
}

// Export for use in other modules
if (typeof window !== "undefined") {
    window.populateChannelDropdownWithCategories = populateChannelDropdownWithCategories;
}


// ===== command.js =====
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

(function () {
  if (document.body.id !== 'page-commands') return;

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
})();


// ===== contact.js =====
/**
 * @file Contact Page Script
 * @description
 * Handles contact form submission and basic form UX:
 *  - AJAX submission to /api/contact with JSON payload
 *  - Loading state and success/error feedback messages
 *  - Auto-hide status message after a short delay
 *  - Focus/blur styling for form groups
 */

(function () {
  if (document.body.id !== 'page-contact') return;

  document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("contactForm");
    const statusMessage = document.getElementById("statusMessage");
    const submitBtn = document.getElementById("submitBtn");

    // ==================== FORM SUBMISSION HANDLING ====================

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();

        // Set loading state on submit button
        submitBtn.disabled = true;
        submitBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin mr-2"></i>Sending...';

        const formData = {
          name: form.querySelector('[name="name"]').value,
          email: form.querySelector('[name="email"]').value,
          subject: form.querySelector('[name="subject"]').value,
          message: form.querySelector('[name="message"]').value,
        };

        fetch("/api/contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        })
          .then((response) => response.json())
          .then((data) => {
            if (data.success) {
              statusMessage.classList.remove(
                "hidden",
                "bg-red-500/20",
                "text-red-400"
              );
              statusMessage.classList.add("bg-green-500/20", "text-green-400");
              statusMessage.textContent =
                "Message sent successfully! We'll get back to you soon.";
              form.reset();
            } else {
              throw new Error(data.error || "Failed to send message");
            }
          })
          .catch((error) => {
            console.error("Contact form error:", error);
            statusMessage.classList.remove(
              "hidden",
              "bg-green-500/20",
              "text-green-400"
            );
            statusMessage.classList.add("bg-red-500/20", "text-red-400");
            statusMessage.textContent =
              "Failed to send message. Please try again later.";
          })
          .finally(() => {
            // Restore button state and schedule status message hide
            submitBtn.disabled = false;
            submitBtn.innerHTML =
              '<span>Send Message</span><i class="fas fa-paper-plane"></i>';

            setTimeout(() => {
              statusMessage.classList.add("hidden");
            }, 5000);
          });
      });
    }

    // ==================== FORM FIELD FOCUS STATES ====================

    document
      .querySelectorAll(
        ".form-group input, .form-group select, .form-group textarea"
      )
      .forEach((input) => {
        input.addEventListener("focus", function () {
          this.parentElement.classList.add("focused");
        });

        input.addEventListener("blur", function () {
          this.parentElement.classList.remove("focused");
        });
      });
  });
})();


// ===== dashboard.js =====
/**
 * @file Server List UI Script
 * @description
 * Enhances the server list page with:
 *  - Mobile navigation toggle
 *  - Live server search with animated filter results
 *  - Theme toggle icon sync
 *  - Navbar shadow on scroll
 *  - Staggered fade-in animation for server cards
 *  - Global fade-in-up keyframe definition
 */

(function () {
  if (document.body.id !== 'page-dashboard-select') return;

  document.addEventListener("DOMContentLoaded", function () {
    // ==================== MOBILE NAVIGATION ====================

    const mobileMenuBtn = document.getElementById("mobile-menu-btn");
    const mobileMenu = document.getElementById("mobile-menu");

    if (mobileMenuBtn && mobileMenu) {
      mobileMenuBtn.addEventListener("click", function () {
        mobileMenu.classList.toggle("hidden");
      });
    }

    // ==================== SERVER SEARCH & FILTER ====================

    const searchInput = document.getElementById("serverSearch");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        const query = e.target.value.toLowerCase();

        document.querySelectorAll(".server-card").forEach((card) => {
          const name = card.getAttribute("data-name").toLowerCase();
          if (name.includes(query)) {
            card.style.display = "";
            card.style.animation = "none";
            // Force reflow to restart animation
            card.offsetHeight;
            card.style.animation = "fade-in-up 0.3s ease-out forwards";
          } else {
            card.style.display = "none";
          }
        });
      });
    }

    // ==================== THEME TOGGLE ICON SYNC ====================

    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) {
      const icon = themeToggle.querySelector("i");
      if (document.documentElement.classList.contains("dark")) {
        icon.classList.remove("fa-sun");
        icon.classList.add("fa-moon");
      } else {
        icon.classList.remove("fa-moon");
        icon.classList.add("fa-sun");
      }
    }

    // ==================== NAVBAR SCROLL EFFECT ====================

    const navbar = document.getElementById("navbar");
    if (navbar) {
      window.addEventListener("scroll", function () {
        if (window.scrollY > 50) {
          navbar.classList.add("shadow-lg");
        } else {
          navbar.classList.remove("shadow-lg");
        }
      });
    }

    // ==================== INITIAL CARD ANIMATION ====================

    document.querySelectorAll(".server-card").forEach((card, index) => {
      card.style.opacity = "0";
      card.style.animation = `fade-in-up 0.5s ease-out ${index * 0.1}s forwards`;
    });
  });

  // ==================== GLOBAL ANIMATION KEYFRAME ====================

  const style = document.createElement("style");
  style.textContent = `
  @keyframes fade-in-up {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
  document.head.appendChild(style);
})();


// ===== dashboard_landing.js =====
/**
 * @file Dashboard Landing Page Script
 * @description
 * Orchestrates all interactive behavior on the dashboard landing page:
 *  - Scroll-based reveal and parallax animations
 *  - Interactive dashboard preview (tilt, sidebar, chart bars)
 *  - Smooth anchor scrolling
 *  - Button and card hover/click effects (ripple, bounce, etc.)
 *  - Stat counters and live stats preview (with periodic refresh)
 *  - Basic analytics event hooks and keyboard shortcuts
 *  - Scroll progress logging and cleanup handlers
 */

(function () {
  if (document.body.id !== 'page-dashboard-landing') return;

  document.addEventListener("DOMContentLoaded", function () {
    initScrollAnimations();
    initDashboardPreview();
    initSmoothScroll();
    initParallaxEffect();
  });

  // ==================== SCROLL-BASED ANIMATIONS ====================

  /**
   * Initialize intersection-based fade-in / slide-up animations
   * for key content elements on the landing page.
   */
  function initScrollAnimations() {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
        }
      });
    }, observerOptions);

    const animatedElements = document.querySelectorAll(
      ".animate-fade-in-up, .feature-card, .capability-item, .step-card"
    );
    animatedElements.forEach((element, index) => {
      element.style.opacity = "0";
      element.style.transform = "translateY(30px)";
      element.style.transition = `opacity 0.6s ease ${index * 0.1
        }s, transform 0.6s ease ${index * 0.1}s`;

      observer.observe(element);
    });
  }

  // ==================== DASHBOARD PREVIEW INTERACTIONS ====================

  /**
   * Initialize dashboard preview interactions:
   *  - 3D tilt on mouse move
   *  - Sidebar item active state with ripple effect
   *  - Chart bar grow animation when in view
   */
  function initDashboardPreview() {
    const preview = document.querySelector(".preview-card");
    if (!preview) return;

    preview.addEventListener("mousemove", (e) => {
      const rect = preview.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = (y - centerY) / 40;
      const rotateY = (centerX - x) / 40;

      preview.style.transform = `perspective(1500px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });

    preview.addEventListener("mouseleave", () => {
      preview.style.transform =
        "perspective(1500px) rotateX(5deg) rotateY(-2deg)";
    });

    const sidebarItems = document.querySelectorAll(".sidebar-item");
    sidebarItems.forEach((item, index) => {
      item.addEventListener("click", function () {
        sidebarItems.forEach((i) => i.classList.remove("active"));
        this.classList.add("active");

        const ripple = document.createElement("div");
        ripple.style.cssText = `
        position: absolute;
        border-radius: 50%;
        background: rgba(99, 102, 241, 0.3);
        width: 100px;
        height: 100px;
        margin-left: -50px;
        margin-top: -50px;
        animation: ripple 0.6s;
        pointer-events: none;
      `;
        this.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });

    const chartBars = document.querySelectorAll(".chart-bar");
    const chartObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            chartBars.forEach((bar, index) => {
              setTimeout(() => {
                bar.style.animation = `chart-grow 1s ease forwards`;
              }, index * 100);
            });
            chartObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    const chartPlaceholder = document.querySelector(".chart-placeholder");
    if (chartPlaceholder) {
      chartObserver.observe(chartPlaceholder);
    }
  }

  // ==================== SMOOTH ANCHOR SCROLLING ====================

  /**
   * Enable smooth scrolling for in-page anchor links,
   * accounting for fixed navbar height.
   */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute("href"));
        if (target) {
          const offsetTop = target.offsetTop - 100;
          window.scrollTo({
            top: offsetTop,
            behavior: "smooth",
          });
        }
      });
    });
  }

  // ==================== PARALLAX EFFECTS ====================

  /**
   * Initialize simple vertical parallax effect
   * for decorative blob elements while scrolling.
   */
  function initParallaxEffect() {
    const blobs = document.querySelectorAll(".blob");

    window.addEventListener("scroll", () => {
      const scrolled = window.pageYOffset;

      blobs.forEach((blob, index) => {
        const speed = 0.5 + index * 0.2;
        const yPos = -(scrolled * speed);
        blob.style.transform = `translateY(${yPos}px)`;
      });
    });
  }

  // ==================== HOVER EFFECTS ====================

  /**
   * Enhance feature cards with hover transitions.
   */
  const featureCards = document.querySelectorAll(".feature-card");
  featureCards.forEach((card) => {
    card.addEventListener("mouseenter", function () {
      this.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
    });
  });

  /**
   * Enhance capability items with hover transitions.
   */
  const capabilityItems = document.querySelectorAll(".capability-item");
  capabilityItems.forEach((item) => {
    item.addEventListener("mouseenter", function () {
      this.style.transition = "all 0.3s ease";
    });
  });

  // ==================== CTA BUTTON RIPPLE EFFECT ====================

  /**
   * Attach ripple click animation to primary CTA-style buttons.
   */
  const ctaButtons = document.querySelectorAll(
    ".btn-primary, .btn-secondary, .btn-cta"
  );
  ctaButtons.forEach((button) => {
    button.addEventListener("click", function (e) {
      const ripple = document.createElement("span");
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      ripple.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      left: ${x}px;
      top: ${y}px;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 50%;
      transform: scale(0);
      animation: ripple-effect 0.6s ease-out;
      pointer-events: none;
    `;

      this.style.position = "relative";
      this.style.overflow = "hidden";
      this.appendChild(ripple);

      setTimeout(() => ripple.remove(), 600);
    });
  });

  // ==================== GLOBAL ANIMATION KEYFRAMES ====================

  const style = document.createElement("style");
  style.textContent = `
  @keyframes ripple {
    from {
      transform: scale(0);
      opacity: 1;
    }
    to {
      transform: scale(4);
      opacity: 0;
    }
  }
  
  @keyframes ripple-effect {
    to {
      transform: scale(4);
      opacity: 0;
    }
  }
`;
  document.head.appendChild(style);

  // ==================== STAT COUNTERS ====================

  /**
   * Animate a numeric value within an element from start to end.
   *
   * @param {HTMLElement} element - Target element
   * @param {number} start - Starting value
   * @param {number} end - Ending value
   * @param {number} duration - Duration in ms
   */
  function animateValue(element, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const value = Math.floor(progress * (end - start) + start);
      element.textContent = value.toLocaleString();
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }

  const statValues = document.querySelectorAll(".stat-value");
  const statsObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const text = entry.target.textContent;
          const number = parseInt(text.replace(/[^0-9]/g, ""));
          if (!isNaN(number)) {
            entry.target.textContent = "0";
            setTimeout(() => {
              animateValue(entry.target, 0, number, 2000);
            }, 300);
          }
          statsObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  statValues.forEach((stat) => {
    statsObserver.observe(stat);
  });

  // ==================== STEP CARD ANIMATIONS ====================

  /**
   * Sequentially reveal step cards as they enter the viewport.
   */
  const stepCards = document.querySelectorAll(".step-card");
  const stepObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateX(0)";
          }, index * 200);
          stepObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );

  stepCards.forEach((card) => {
    card.style.opacity = "0";
    card.style.transform = "translateX(-30px)";
    card.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    stepObserver.observe(card);
  });

  /**
   * Apply continuous gentle bounce animation to step arrows.
   */
  const stepArrows = document.querySelectorAll(".step-arrow");
  stepArrows.forEach((arrow) => {
    arrow.style.animation = "bounce-gentle 2s ease-in-out infinite";
  });

  // ==================== ANALYTICS HOOKS ====================

  /**
   * Generic interaction tracking hook.
   *
   * @param {string} action - Interaction type, e.g. "cta_click"
   * @param {string} label - Descriptive label, e.g. "dashboard_login"
   */
  function trackInteraction(action, label) {
    console.log(`User interaction: ${action} - ${label}`);
  }

  document.querySelectorAll('a[href="/dashboard/login"]').forEach((link) => {
    link.addEventListener("click", () => {
      trackInteraction("cta_click", "dashboard_login");
    });
  });

  featureCards.forEach((card) => {
    card.addEventListener("click", function () {
      const title = this.querySelector(".feature-title").textContent;
      trackInteraction("feature_view", title);
    });
  });

  // ==================== KEYBOARD SHORTCUTS ====================

  /**
   * Keyboard navigation:
   *  - Press "L" to navigate to the dashboard login (when not typing in inputs).
   */
  document.addEventListener("keydown", (e) => {
    if (e.key === "l" || e.key === "L") {
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement.tagName !== "INPUT"
      ) {
        window.location.href = "/dashboard/login";
      }
    }
  });

  // ==================== SCROLL PROGRESS LOGGING ====================

  /**
   * Log scroll progress percentage (0–100) to the console.
   */
  function updateScrollProgress() {
    const winScroll =
      document.body.scrollTop || document.documentElement.scrollTop;
    const height =
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight;
    const scrolled = (winScroll / height) * 100;

    console.log(`Scroll progress: ${scrolled.toFixed(2)}%`);
  }

  window.addEventListener("scroll", updateScrollProgress);

  // ==================== LIVE STATS PREVIEW ====================

  /**
   * Live stats refresh interval ID (for cleanup on unload).
   * @type {number | null}
   */
  let statsUpdateInterval = null;

  /**
   * Fetch live bot stats and update dashboard preview cards.
   * Runs on load and on a fixed interval.
   */
  async function fetchAndUpdateStats() {
    try {
      const response = await fetch("/api/stats");
      if (!response.ok) throw new Error("Failed to fetch stats");

      const data = await response.json();

      const statCards = document.querySelectorAll(".stat-card");
      if (statCards.length >= 3) {
        const membersValue = statCards[0].querySelector(".stat-value");
        if (membersValue) {
          const newMembers = data.total_members || 0;
          animateValue(
            membersValue,
            parseInt(membersValue.textContent.replace(/,/g, "")) || 0,
            newMembers,
            1000
          );
        }

        const growthValue = statCards[1].querySelector(".stat-value");
        if (growthValue) {
          const growth = data.growth_percentage || "+12%";
          growthValue.textContent = growth;
        }

        const messagesValue = statCards[2].querySelector(".stat-value");
        if (messagesValue) {
          const totalMessages = data.total_messages || 0;
          const formatted =
            totalMessages >= 1000
              ? (totalMessages / 1000).toFixed(1) + "K"
              : totalMessages.toString();
          messagesValue.textContent = formatted;
        }
      }

      updateLastRefreshTime();

      console.log("Dashboard preview stats updated:", data);
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  }

  /**
   * Log the last stats refresh time to the console.
   */
  function updateLastRefreshTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    console.log(`Stats refreshed at ${timeString}`);
  }

  // ==================== STATS INITIALIZATION & CLEANUP ====================

  document.addEventListener("DOMContentLoaded", function () {
    fetchAndUpdateStats();

    statsUpdateInterval = setInterval(fetchAndUpdateStats, 300000);

    const refreshButton = document.querySelector(".preview-actions .fa-sync-alt");
    if (refreshButton) {
      refreshButton.style.cursor = "pointer";
      refreshButton.style.transition = "transform 0.3s ease";

      refreshButton.addEventListener("click", function (e) {
        e.stopPropagation();

        this.style.transform = "rotate(360deg)";
        setTimeout(() => {
          this.style.transform = "rotate(0deg)";
        }, 600);

        fetchAndUpdateStats();
      });

      refreshButton.addEventListener("mouseenter", function () {
        this.style.transform = "rotate(45deg)";
      });

      refreshButton.addEventListener("mouseleave", function () {
        this.style.transform = "rotate(0deg)";
      });
    }
  });

  window.addEventListener("beforeunload", function () {
    if (statsUpdateInterval) {
      clearInterval(statsUpdateInterval);
    }
  });

  // ==================== DIAGNOSTICS ====================

  console.log("Dashboard landing page loaded successfully with live stats");
})();


// ===== feature.js =====
/**
 * @file Feature Page Script
 * @description
 * Client-side logic for the Features page:
 *  - Scroll-based reveal animations for feature cards
 *  - Interactive hover/tilt effects and highlight clicks
 *  - Theme change detection and smooth transitions
 *  - Smooth anchor scrolling
 *  - Image loading fade-in
 *  - Lazy-start CSS animations via IntersectionObserver
 *  - Keyboard shortcut for theme toggle
 *  - Feature interaction tracking hooks for analytics
 */

// ==================== PAGE INITIALIZATION ====================

(function () {
  if (document.body.id !== 'page-feature') return;

  document.addEventListener("DOMContentLoaded", function () {
    initScrollAnimations();
    initInteractiveCards();
    initThemeSupport();
  });

  // ==================== SCROLL ANIMATIONS ====================

  /**
   * Initialize scroll-based animations for detailed feature cards.
   * Uses IntersectionObserver to fade and slide cards into view.
   */
  function initScrollAnimations() {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
        }
      });
    }, observerOptions);

    const featureCards = document.querySelectorAll(".feature-detailed-card");
    featureCards.forEach((card, index) => {
      card.style.opacity = "0";
      card.style.transform = "translateY(30px)";
      card.style.transition = `opacity 0.6s ease ${index * 0.1
        }s, transform 0.6s ease ${index * 0.1}s`;

      observer.observe(card);
    });
  }

  // ==================== INTERACTIVE CARD EFFECTS ====================

  /**
   * Initialize interactive behaviors for feature cards:
   *  - 3D tilt on mouse move
   *  - Click "press" animation for highlight items
   */
  function initInteractiveCards() {
    const cards = document.querySelectorAll(".feature-detailed-card");

    cards.forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = (y - centerY) / 30;
        const rotateY = (centerX - x) / 30;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
      });

      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });

    const highlightItems = document.querySelectorAll(".highlight-item");
    highlightItems.forEach((item) => {
      item.addEventListener("click", function () {
        this.style.transform = "scale(0.95)";
        setTimeout(() => {
          this.style.transform = "";
        }, 150);
      });
    });
  }

  // ==================== THEME SUPPORT ====================

  /**
   * Initialize theme support and listen for class changes
   * on the root element to detect light/dark theme toggles.
   */
  function initThemeSupport() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          handleThemeChange();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
    });
  }

  /**
   * Handle transitions when theme changes occur.
   * Applies smooth background/text color transitions.
   */
  function handleThemeChange() {
    const isDark = document.documentElement.classList.contains("dark");

    document.body.style.transition =
      "background-color 0.3s ease, color 0.3s ease";

    console.log(`Theme changed to: ${isDark ? "dark" : "light"}`);
  }

  // ==================== SMOOTH ANCHOR SCROLLING ====================

  /**
   * Enable smooth scrolling behavior for in-page anchor links.
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

  // ==================== IMAGE LOAD ANIMATION ====================

  /**
   * Apply a fade-in transition to images once they have fully loaded.
   */
  const images = document.querySelectorAll("img");
  images.forEach((img) => {
    img.addEventListener("load", function () {
      this.style.opacity = "1";
    });

    img.style.opacity = "0";
    img.style.transition = "opacity 0.3s ease";
  });

  // ==================== LAZY-START CSS ANIMATIONS ====================

  /**
   * Pause CSS animations initially and start them only when elements
   * enter the viewport, improving performance on large pages.
   */
  if ("IntersectionObserver" in window) {
    const lazyAnimations = document.querySelectorAll('[class*="animate-"]');

    const animationObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.animationPlayState = "running";
          animationObserver.unobserve(entry.target);
        }
      });
    });

    lazyAnimations.forEach((element) => {
      element.style.animationPlayState = "paused";
      animationObserver.observe(element);
    });
  }

  // ==================== KEYBOARD ACCESSIBILITY ====================

  /**
   * Global keyboard shortcuts for the features page.
   * - Press "T" to trigger theme toggle button (if present).
   */
  document.addEventListener("keydown", (e) => {
    if (e.key === "t" || e.key === "T") {
      const themeToggle = document.querySelector("[data-theme-toggle]");
      if (themeToggle) {
        themeToggle.click();
      }
    }
  });

  // ==================== ANALYTICS / INTERACTION TRACKING ====================

  /**
   * Track user interactions with feature cards for analytics.
   *
   * @param {string} featureName - Name or title of the feature interacted with
   */
  function trackFeatureInteraction(featureName) {
    console.log(`User interacted with feature: ${featureName}`);
    // Hook for analytics platform integration (e.g., gtag, Segment, etc.)
  }

  /**
   * Attach click tracking to all detailed feature cards based on
   * the inner text of `.feature-detailed-title`.
   */
  document.querySelectorAll(".feature-detailed-card").forEach((card) => {
    card.addEventListener("click", function () {
      const featureTitle = this.querySelector(".feature-detailed-title");
      if (featureTitle) {
        trackFeatureInteraction(featureTitle.textContent);
      }
    });
  });
})();


// ===== home.js =====
/**
 * @file Landing Stats & Navbar Interactions
 * @description
 * Handles core UI behaviors for the stats section and navbar:
 *  - Mobile navigation toggle
 *  - Navbar shadow on scroll
 *  - Animated stat counters driven by live API data
 *  - Fallback stats animation when API is unavailable
 */

(function () {
  if (document.body.id !== 'page-home') return;

  document.addEventListener("DOMContentLoaded", function () {
    // ==================== MOBILE NAVIGATION ====================

    const mobileMenuBtn = document.getElementById("mobile-menu-btn");
    const mobileMenu = document.getElementById("mobile-menu");

    if (mobileMenuBtn && mobileMenu) {
      mobileMenuBtn.addEventListener("click", function () {
        mobileMenu.classList.toggle("hidden");
      });
    }

    // ==================== NAVBAR SCROLL EFFECT ====================

    const navbar = document.getElementById("navbar");
    if (navbar) {
      window.addEventListener("scroll", function () {
        if (window.scrollY > 50) {
          navbar.classList.add("shadow-lg");
        } else {
          navbar.classList.remove("shadow-lg");
        }
      });
    }

    // ==================== COUNTER ANIMATION ====================

    /**
     * Animate a numerical value from start to end over a given duration.
     * Automatically formats large numbers with K/M suffixes.
     *
     * @param {HTMLElement} element - Target element whose textContent is updated
     * @param {number} start - Starting value
     * @param {number} end - Final value
     * @param {number} duration - Animation duration in milliseconds
     * @param {string} [suffix=""] - Optional suffix (e.g. "+", "%")
     */
    function animateValue(element, start, end, duration, suffix = "") {
      let startTimestamp = null;
      const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const value = Math.floor(progress * (end - start) + start);

        if (end >= 1000000) {
          element.textContent = (value / 1000000).toFixed(1) + "M+";
        } else if (end >= 1000) {
          element.textContent = (value / 1000).toFixed(1) + "K+";
        } else {
          element.textContent = value + suffix;
        }

        if (progress < 1) {
          window.requestAnimationFrame(step);
        }
      };
      window.requestAnimationFrame(step);
    }

    // ==================== STATS LOADING & OBSERVER ====================

    /**
     * Load live statistics from the backend and attach intersection observers
     * so that counters animate when they come into view.
     * Falls back to preset demo values if the API request fails.
     */
    async function loadStats() {
      try {
        const response = await fetch("/api/stats");
        const data = await response.json();

        const observerCallback = (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const target = entry.target;
              if (target.id === "stat-servers") {
                animateValue(target, 0, data.total_servers || 0, 2000);
              } else if (target.id === "stat-users") {
                animateValue(target, 0, data.total_users || 0, 2000);
              } else if (target.id === "stat-commands") {
                animateValue(target, 0, data.commands_used || 0, 2000);
              }
            }
          });
        };

        const observer = new IntersectionObserver(observerCallback, {
          threshold: 0.5,
        });

        ["stat-servers", "stat-users", "stat-commands"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) observer.observe(el);
        });
      } catch (error) {
        console.error("Failed to load stats:", error);

        const observerCallback = (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const target = entry.target;
              if (target.id === "stat-servers") {
                animateValue(target, 0, 1250, 2000);
              } else if (target.id === "stat-users") {
                animateValue(target, 0, 85000, 2000);
              } else if (target.id === "stat-commands") {
                animateValue(target, 0, 2500000, 2000);
              }
            }
          });
        };

        const observer = new IntersectionObserver(observerCallback, {
          threshold: 0.5,
        });

        ["stat-servers", "stat-users", "stat-commands"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) observer.observe(el);
        });
      }
    }

    // ==================== INITIALIZE STATS ====================

    loadStats();
  });
})();


// ===== index.js =====
/**
 * @file Landing Page Interactions
 * @description
 * Handles all interactive behavior for the public landing page:
 *  - Mobile navigation toggle & icon swap
 *  - Sticky navbar shadow on scroll
 *  - Animated numerical counters (stats)
 *  - Scroll-in reveal animations for feature/grid cards
 *  - Smooth scrolling for in-page anchor links
 */

// ==================== INITIALIZATION ====================

(function () {
  if (document.body.id !== 'page-index') return;

  document.addEventListener("DOMContentLoaded", function () {
    // ==================== MOBILE NAVIGATION TOGGLE ====================

    const mobileMenuBtn = document.getElementById("mobile-menu-btn");
    const mobileMenu = document.getElementById("mobile-menu");

    if (mobileMenuBtn && mobileMenu) {
      /**
       * Toggle mobile menu visibility and update the icon between
       * burger (fa-bars) and close (fa-times).
       */
      mobileMenuBtn.addEventListener("click", function () {
        mobileMenu.classList.toggle("hidden");
        const icon = mobileMenuBtn.querySelector("i");
        if (mobileMenu.classList.contains("hidden")) {
          icon.classList.remove("fa-times");
          icon.classList.add("fa-bars");
        } else {
          icon.classList.remove("fa-bars");
          icon.classList.add("fa-times");
        }
      });
    }

    // ==================== NAVBAR SCROLL EFFECT ====================

    const navbar = document.getElementById("navbar");
    if (navbar) {
      /**
       * Add shadow and slight background opacity when the page is scrolled,
       * giving the navbar a "sticky" elevated look.
       */
      window.addEventListener("scroll", function () {
        if (window.scrollY > 50) {
          navbar.classList.add("shadow-lg", "bg-opacity-95");
        } else {
          navbar.classList.remove("shadow-lg", "bg-opacity-95");
        }
      });
    }

    // ==================== STAT COUNTER ANIMATION ====================

    /**
     * Animate a numerical counter from 0 up to `target`, using a short
     * easing-like progression and formatting large numbers with K/M suffixes.
     *
     * @param {HTMLElement} element - DOM node whose textContent will be updated
     * @param {number} target - Final value to display
     */
    function animateCounter(element, target) {
      let current = 0;
      const increment = target / 60;
      const duration = 2000;
      const stepTime = duration / 60;

      function update() {
        current += increment;
        if (current < target) {
          if (target >= 1000000) {
            element.textContent = (current / 1000000).toFixed(1) + "M+";
          } else if (target >= 1000) {
            element.textContent = Math.floor(current / 1000) + "K+";
          } else {
            element.textContent = Math.floor(current);
          }
          requestAnimationFrame(update);
        } else {
          if (target >= 1000000) {
            element.textContent = (target / 1000000).toFixed(1) + "M+";
          } else if (target >= 1000) {
            element.textContent = (target / 1000).toFixed(1) + "K+";
          } else {
            element.textContent = target;
          }
        }
      }
      update();
    }

    /**
     * Fetch live stats from the backend and animate the counters.
     * Falls back to predefined demo values if the API call fails.
     */
    fetch("/api/stats")
      .then((response) => response.json())
      .then((data) => {
        const serversEl = document.getElementById("stat-servers");
        const usersEl = document.getElementById("stat-users");
        const commandsEl = document.getElementById("stat-commands");

        if (serversEl) animateCounter(serversEl, data.servers);
        if (usersEl) animateCounter(usersEl, data.users);
        if (commandsEl) animateCounter(commandsEl, data.commands);
      })
      .catch((error) => {
        console.log("Using fallback stats");
        const serversEl = document.getElementById("stat-servers");
        const usersEl = document.getElementById("stat-users");
        const commandsEl = document.getElementById("stat-commands");

        if (serversEl) animateCounter(serversEl, 1250);
        if (usersEl) animateCounter(usersEl, 85000);
        if (commandsEl) animateCounter(commandsEl, 2500000);
      });

    // ==================== SCROLL-IN ANIMATIONS ====================

    /**
     * IntersectionObserver configuration for triggering reveal animations
     * when elements enter the viewport.
     */
    const observerOptions = {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    };

    /**
     * Apply fade-in-up animation to feature/grid cards when they become visible.
     */
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("animate-fade-in-up");
          entry.target.style.opacity = "1";
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    document.querySelectorAll(".feature-card, .grid-card").forEach((card) => {
      card.style.opacity = "0";
      observer.observe(card);
    });

    // ==================== SMOOTH IN-PAGE SCROLLING ====================

    /**
     * Smooth scroll behavior for in-page anchor links (href starting with "#").
     * Adjusts scroll position to account for navbar height and closes
     * the mobile menu after navigation.
     */
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute("href"));
        if (target) {
          const navHeight = navbar ? navbar.offsetHeight : 80;
          const targetPosition =
            target.getBoundingClientRect().top + window.pageYOffset - navHeight;
          window.scrollTo({
            top: targetPosition,
            behavior: "smooth",
          });
          if (mobileMenu && !mobileMenu.classList.contains("hidden")) {
            mobileMenu.classList.add("hidden");
          }
        }
      });
    });
  });
})();


// ===== profile.js =====
/**
 * @file Owner Dashboard Client Script
 * @description
 * Frontend interactions for the Supporter Bot owner dashboard:
 *  - Layout: mobile navigation, server search
 *  - Refresh: server table and full dashboard data (XHR-based partial reloads)
 *  - Owner actions: leave, ban, unban servers (table + manual controls)
 *  - UX: notification toasts and row transition animations
 */

// ==================== INITIALIZATION & UI BINDINGS ====================

(function () {
  if (document.body.id !== 'page-profile') return;

  document.addEventListener("DOMContentLoaded", function () {
    const mobileMenuBtn = document.getElementById("mobile-menu-btn");
    const mobileMenu = document.getElementById("mobile-menu");

    /**
     * Toggle mobile navigation menu visibility.
     */
    if (mobileMenuBtn && mobileMenu) {
      mobileMenuBtn.addEventListener("click", function () {
        mobileMenu.classList.toggle("hidden");
      });
    }

    /**
     * Live filter for server cards on the dashboard.
     * Filters elements with `.server-card` by their `data-name` attribute.
     */
    const searchInput = document.getElementById("serverSearch");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        const query = e.target.value.toLowerCase();

        document.querySelectorAll(".server-card").forEach((card) => {
          const name = card.getAttribute("data-name").toLowerCase();
          if (name.includes(query)) {
            card.style.display = "";
          } else {
            card.style.display = "none";
          }
        });
      });
    }
  });

  // ==================== SERVER LIST REFRESH ====================

  /**
   * Refresh server table data for the current page without a full reload.
   * Uses XHR to fetch updated HTML and replaces:
   *  - #serverTableContainer content
   *  - server count in stat card (if present)
   */
  function refreshServerData() {
    const refreshBtn = document.getElementById("refreshBtn");
    const refreshIcon = document.getElementById("refreshIcon");
    const serverCount = document.getElementById("serverCount");

    refreshBtn.disabled = true;
    refreshIcon.classList.add("fa-spin");

    fetch(window.location.href, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    })
      .then((response) => response.text())
      .then((html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const newTableContainer = doc.getElementById("serverTableContainer");
        const currentTableContainer = document.getElementById(
          "serverTableContainer"
        );

        if (newTableContainer && currentTableContainer) {
          currentTableContainer.innerHTML = newTableContainer.innerHTML;

          const newCount = doc.getElementById("serverCount");
          if (newCount) {
            const statsCard = document.querySelector(
              ".stat-card .text-indigo-400"
            );
            if (statsCard) {
              statsCard.textContent = newCount.textContent.split(" ")[0];
            }
          }

          showNotification("Server list refreshed successfully", "success");
        } else {
          showNotification("Failed to refresh server list", "error");
        }
      })
      .catch((error) => {
        console.error("Refresh error:", error);
        showNotification("Error refreshing server list", "error");
      })
      .finally(() => {
        refreshBtn.disabled = false;
        refreshIcon.classList.remove("fa-spin");
      });
  }

  // ==================== FULL DASHBOARD REFRESH ====================

  /**
   * Refresh all major dashboard sections on the current page via XHR:
   *  - Owner controls panel
   *  - Active server list
   *  - Invite list
   */
  function refreshAllData() {
    const refreshBtn = document.getElementById("refreshAllBtn");
    const refreshIcon = document.getElementById("refreshAllIcon");

    refreshBtn.disabled = true;
    refreshIcon.classList.add("fa-spin");

    fetch(window.location.href, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    })
      .then((response) => response.text())
      .then((html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const newOwnerPanel = doc.querySelector(".owner-panel");
        const currentOwnerPanel = document.querySelector(".owner-panel");
        if (newOwnerPanel && currentOwnerPanel) {
          currentOwnerPanel.innerHTML = newOwnerPanel.innerHTML;
        }

        const newActiveList = doc.getElementById("activeList");
        const currentActiveList = document.getElementById("activeList");
        if (newActiveList && currentActiveList) {
          currentActiveList.innerHTML = newActiveList.innerHTML;
        }

        const newInviteList = doc.getElementById("inviteList");
        const currentInviteList = document.getElementById("inviteList");
        if (newInviteList && currentInviteList) {
          currentInviteList.innerHTML = newInviteList.innerHTML;
        }

        showNotification("All data refreshed successfully", "success");
      })
      .catch((error) => {
        console.error("Refresh error:", error);
        showNotification("Error refreshing data", "error");
      })
      .finally(() => {
        refreshBtn.disabled = false;
        refreshIcon.classList.remove("fa-spin");
      });
  }

  // ==================== OWNER ACTIONS: LEAVE / BAN / UNBAN ====================

  /**
   * Perform owner-level action from the manual Guild ID input panel.
   * Currently supports:
   *  - action === "leave": force bot to leave a guild.
   *
   * @param {"leave"} action - type of owner action to execute
   */
  function ownerAction(action) {
    const guildId = document.getElementById("targetGuildId").value;
    const msgEl = document.getElementById("ownerMsg");

    if (!guildId) {
      msgEl.textContent = "Please enter a Guild ID";
      msgEl.className = "mt-2 text-sm font-bold text-red-400";
      return;
    }

    if (action === "leave") {
      if (confirm(`Are you sure you want to force leave guild ${guildId}?`)) {
        msgEl.textContent = "Processing...";
        msgEl.className = "mt-2 text-sm font-bold text-yellow-400";

        fetch("/api/owner/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guild_id: guildId }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              msgEl.textContent = data.message || "Successfully left guild";
              msgEl.className = "mt-2 text-sm font-bold text-green-400";
              setTimeout(() => location.reload(), 1500);
            } else {
              msgEl.textContent = data.error || "Failed to leave guild";
              msgEl.className = "mt-2 text-sm font-bold text-red-400";
            }
          })
          .catch((err) => {
            msgEl.textContent = "Error: " + err.message;
            msgEl.className = "mt-2 text-sm font-bold text-red-400";
          });
      }
    }
  }

  /**
   * Leave a specific server from the management table.
   * Provides optimistic UI feedback by dimming/removing the row and updating
   * the displayed server count.
   *
   * @param {string} guildId - Target guild ID
   * @param {string} serverName - Server name for confirmation UI
   */
  function ownerLeaveServer(guildId, serverName) {
    if (
      confirm(
        `⚠️ Are you sure you want to leave "${serverName}"?\n\nGuild ID: ${guildId}\n\nThis will remove all bot data for this server.`
      )
    ) {
      const row = document.querySelector(`tr[data-guild-id="${guildId}"]`);
      if (row) {
        row.style.opacity = "0.5";
        row.style.pointerEvents = "none";
      }

      fetch("/api/owner/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild_id: guildId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            if (row) {
              row.style.transition = "all 0.3s ease";
              row.style.transform = "translateX(-100%)";
              row.style.opacity = "0";
              setTimeout(() => {
                row.remove();
                const countSpan = document.querySelector(
                  ".bg-brand-card\\/50 .text-slate-400"
                );
                if (countSpan) {
                  const currentCount = parseInt(countSpan.textContent);
                  countSpan.textContent = `${currentCount - 1} servers`;
                }
              }, 300);
            }
            showNotification("Successfully left " + serverName, "success");
          } else {
            if (row) {
              row.style.opacity = "1";
              row.style.pointerEvents = "auto";
            }
            showNotification(data.error || "Failed to leave server", "error");
          }
        })
        .catch((err) => {
          if (row) {
            row.style.opacity = "1";
            row.style.pointerEvents = "auto";
          }
          showNotification("Error: " + err.message, "error");
        });
    }
  }

  /**
   * Ban a server directly from the server list.
   * This will:
   *  - Remove the bot from the server
   *  - Delete all stored server data
   *  - Prevent the server from re-adding the bot
   *
   * @param {string} guildId - Target guild ID
   * @param {string} guildName - Server name for confirmation UI
   * @param {number} memberCount - Member count (informational in prompt)
   */
  function ownerBanServer(guildId, guildName, memberCount) {
    if (
      confirm(
        `⚠️ Are you sure you want to BAN "${guildName}"?\n\nGuild ID: ${guildId}\nMembers: ${memberCount}\n\nThis will:\n- Remove the bot from the server\n- Delete all server data\n- Prevent the server from re-adding the bot`
      )
    ) {
      const row = document.querySelector(`tr[data-guild-id="${guildId}"]`);
      if (row) {
        row.style.opacity = "0.5";
        row.style.pointerEvents = "none";
      }

      fetch("/api/owner/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guild_id: guildId,
          guild_name: guildName,
          member_count: memberCount,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            if (row) {
              row.style.transition = "all 0.3s ease";
              row.style.transform = "translateX(-100%)";
              row.style.opacity = "0";
              setTimeout(() => row.remove(), 300);
            }
            showNotification("Server banned successfully", "success");
            setTimeout(() => location.reload(), 1500);
          } else {
            if (row) {
              row.style.opacity = "1";
              row.style.pointerEvents = "auto";
            }
            showNotification(data.error || "Failed to ban server", "error");
          }
        })
        .catch((err) => {
          if (row) {
            row.style.opacity = "1";
            row.style.pointerEvents = "auto";
          }
          showNotification("Error: " + err.message, "error");
        });
    }
  }

  /**
   * Unban a server from the banned guilds table.
   *
   * @param {string} guildId - Banned guild ID
   * @param {string} serverName - Server name for confirmation UI
   */
  function ownerUnbanServer(guildId, serverName) {
    if (
      confirm(
        `Are you sure you want to UNBAN "${serverName}"?\n\nGuild ID: ${guildId}\n\nThe server will be able to re-add the bot.`
      )
    ) {
      const row = document.querySelector(`tr[data-banned-guild-id="${guildId}"]`);
      if (row) {
        row.style.opacity = "0.5";
        row.style.pointerEvents = "none";
      }

      fetch("/api/owner/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild_id: guildId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            if (row) {
              row.style.transition = "all 0.3s ease";
              row.style.transform = "translateX(100%)";
              row.style.opacity = "0";
              setTimeout(() => row.remove(), 300);
            }
            showNotification(data.message, "success");
          } else {
            if (row) {
              row.style.opacity = "1";
              row.style.pointerEvents = "auto";
            }
            showNotification(data.error || "Failed to unban server", "error");
          }
        })
        .catch((err) => {
          if (row) {
            row.style.opacity = "1";
            row.style.pointerEvents = "auto";
          }
          showNotification("Error: " + err.message, "error");
        });
    }
  }

  /**
   * Unban a server using a manually entered Guild ID from the input panel.
   * Also removes the corresponding row from the banned table if present.
   */
  function ownerUnbanById() {
    const input = document.getElementById("unbanGuildId");
    const msgEl = document.getElementById("unbanMsg");
    const guildId = input.value.trim();

    if (!guildId) {
      msgEl.textContent = "Please enter a Guild ID";
      msgEl.className = "mt-2 text-sm font-bold text-red-400";
      return;
    }

    if (confirm(`Are you sure you want to unban Guild ID: ${guildId}?`)) {
      msgEl.textContent = "Processing...";
      msgEl.className = "mt-2 text-sm font-bold text-yellow-400";

      fetch("/api/owner/unban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild_id: guildId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            msgEl.textContent = data.message;
            msgEl.className = "mt-2 text-sm font-bold text-green-400";
            input.value = "";
            showNotification(data.message, "success");

            const row = document.querySelector(
              `tr[data-banned-guild-id="${guildId}"]`
            );
            if (row) {
              row.style.transition = "all 0.3s ease";
              row.style.transform = "translateX(100%)";
              row.style.opacity = "0";
              setTimeout(() => row.remove(), 300);
            }
          } else {
            msgEl.textContent = data.error || "Failed to unban server";
            msgEl.className = "mt-2 text-sm font-bold text-red-400";
            showNotification(data.error || "Failed to unban server", "error");
          }
        })
        .catch((err) => {
          msgEl.textContent = "Error: " + err.message;
          msgEl.className = "mt-2 text-sm font-bold text-red-400";
          showNotification("Error: " + err.message, "error");
        });
    }
  }

  // ==================== NOTIFICATION TOASTS ====================

  /**
   * Show a transient toast notification in the bottom-right corner.
   *
   * @param {string} message - Text content to display in the toast
   * @param {"info" | "success" | "error"} [type="info"] - Visual style/intent
   */
  function showNotification(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg font-bold text-white shadow-lg z-50 animate-slide-in-right ${type === "success"
      ? "bg-green-500"
      : type === "error"
        ? "bg-red-500"
        : "bg-indigo-500"
      }`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = "all 0.3s ease";
      toast.style.transform = "translateX(400px)";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
  // ==================== GLOBAL EXPORTS ====================
  window.refreshServerData = refreshServerData;
  window.refreshAllData = refreshAllData;
  window.ownerAction = ownerAction;
  window.ownerLeaveServer = ownerLeaveServer;
  window.ownerBanServer = ownerBanServer;
  window.ownerUnbanServer = ownerUnbanServer;
  window.ownerUnbanById = ownerUnbanById;
})();


// ===== server_config.js =====
/**
 * @file Server Configuration Manager
 * @description
 * Handles all server configuration features for the Supporter Bot dashboard.
 * Centralizes:
 *  - Tab navigation and data loading
 *  - Guild-level settings (XP, cooldowns)
 *  - Level rewards & Discord metadata
 *  - Leaderboard rendering
 *  - YouTube notification configurations
 *  - Channel restrictions (delete hooks)
 *  - Reminder management (list/toggle/delete)
 *  - Timezone clocks
 *  - Global refresh of server analytics & settings
 */

/**
 * @file Server Configuration Manager
 * @description
 * Handles all server configuration features for the Supporter Bot dashboard.
 * Centralizes:
 *  - Tab navigation and data loading
 *  - Guild-level settings (XP, cooldowns)
 *  - Level rewards & Discord metadata
 *  - Leaderboard rendering
 *  - YouTube notification configurations
 *  - Channel restrictions (delete hooks)
 *  - Reminder management (list/toggle/delete)
 *  - Timezone clocks
 *  - Global refresh of server analytics & settings
 */

/**
 * Extract guild/server ID from the current URL.
 * Supports routes like `/server/{guildId}` or fallback to last path segment.
 * @returns {string | undefined} guildId
 */
function getGuildIdFromUrl() {
  const match = window.location.href.match(/\/server\/(\d+)/);
  return match ? match[1] : window.location.pathname.split("/").pop();
}

// Resolved guild ID for all subsequent API calls
const guildId = getGuildIdFromUrl();

// ==================== TAB NAVIGATION ====================

/**
 * Global switchTab function for sidebar / mobile navigation.
 * Used by inline onclick handlers in templates.
 *
 * @param {string} tabName - Logical tab key (e.g., "general", "leveling")
 * @param {HTMLElement} [buttonElement] - The clicked nav button, if any
 */
window.switchTab = function (tabName, buttonElement) {
  // Hide all tab contents by prefix id="tab-"
  const allTabs = document.querySelectorAll('[id^="tab-"]');
  allTabs.forEach((tab) => tab.classList.add("hidden"));

  // Show the selected tab section
  const selectedTab = document.getElementById(`tab-${tabName}`);
  if (selectedTab) {
    selectedTab.classList.remove("hidden");
  }

  // Update button states using "active" class
  const allButtons = document.querySelectorAll(".nav-item");
  allButtons.forEach((btn) => btn.classList.remove("active"));

  if (buttonElement) {
    buttonElement.classList.add("active");
  }

  // Mobile: close sidebar after selecting a tab
  const mobileMenu = document.getElementById("sidebarNav");
  if (mobileMenu && window.innerWidth < 768) {
    mobileMenu.classList.add("hidden");
  }

  // Load data for the selected tab
  loadTabData(tabName);
};

// ==================== UTILITY HELPERS ====================

/**
 * Render a floating notification toast.
 *
 * @param {string} message - Notification message
 * @param {"success" | "error"} [type="success"] - Visual style/intent
 */
function showNotification(message, type = "success") {
  const notification = document.createElement("div");
  notification.className = `fixed top-4 right-4 px-6 py-4 rounded-lg shadow-lg z-50 ${type === "success"
    ? "bg-green-500/20 text-green-400 border border-green-500/30"
    : "bg-red-500/20 text-red-400 border border-red-500/30"
    }`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 5000);
}

/**
 * Wrapper around fetch for JSON APIs with unified error handling.
 *
 * @param {string} endpoint - URL to call
 * @param {RequestInit} [options={}] - fetch options (method, headers, body)
 * @returns {Promise<any>} parsed JSON data
 * @throws Error when response is not ok or network fails
 */
async function fetchAPI(endpoint, options = {}) {
  try {
    const response = await fetch(endpoint, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  } catch (error) {
    console.error("API Error:", error);
    showNotification(error.message || "An error occurred", "error");
    throw error;
  }
}

// ==================== TAB DATA ROUTER ====================

/**
 * Load data for a given top-level tab.
 *
 * @param {string} tabName - Tab identifier (e.g., "general", "leaderboard")
 * @param {boolean} [force=false] - Optional force reload flag for some tabs
 */
function loadTabData(tabName, force = false) {
  const guildId = getGuildIdFromUrl();

  switch (tabName) {
    case "general":
    case "settings":
      loadSettings();
      break;

    case "leveling":
    case "rewards": {
      // Determine active sub-tab or default to "rewards"
      const activeSubTab = document.querySelector(".sub-tab-btn.active");
      if (activeSubTab) {
        const subTabName = activeSubTab
          .getAttribute("onclick")
          .match(/switchLevelSubTab\('([^']*)'/)[1];

        if (subTabName === "rewards") {
          loadLevelRewards();
          loadDiscordData();
        } else if (subTabName === "leaderboard") {
          loadLeaderboard();
        } else if (subTabName === "settings") {
          // Sub-tab specific settings can be handled here when needed
        }
      } else {
        // Default for leveling tab when no sub-tab is active
        loadLevelRewards();
        loadDiscordData();
      }
      break;
    }

    case "leaderboard":
      loadLeaderboard();
      break;

    case "youtube":
      if (typeof initYoutubeTab === "function") {
        initYoutubeTab(force);
      }
      break;

    case "restrictions":
      if (typeof initRestrictionTab === "function") {
        initRestrictionTab(force);
      }
      break;

    case "reminders":
      if (typeof initReminderTab === "function") {
        initReminderTab();
      } else if (typeof loadReminderData === "function") {
        loadReminderData(guildId);
      }
      break;

    case "time":
    case "clocks":
      if (typeof loadClocks === "function") {
        loadClocks(guildId);
      }
      if (typeof loadTimezones === "function") {
        loadTimezones();
      }
      break;

    case "analytics":
      if (typeof loadAnalyticsDashboard === "function") {
        loadAnalyticsDashboard();
      }
      break;
  }
}

// ==================== GENERAL SETTINGS ====================

/**
 * Load XP and voice activity settings for the current guild.
 */
async function loadSettings() {
  try {
    const data = await fetchAPI(`/api/server/${guildId}/settings`);

    if (document.getElementById("xpPerMessage")) document.getElementById("xpPerMessage").value = data.xp_per_message || 5;
    if (document.getElementById("xpPerImage")) document.getElementById("xpPerImage").value = data.xp_per_image || 10;
    if (document.getElementById("xpPerVoice")) document.getElementById("xpPerVoice").value = data.xp_per_minute_in_voice || 15;
    if (document.getElementById("voiceXpLimit")) document.getElementById("voiceXpLimit").value = data.voice_xp_limit || 1500;

    const cooldownSelect = document.getElementById("xpCooldown");
    if (cooldownSelect) {
      cooldownSelect.value = data.xp_cooldown || 60;
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
}

// ==================== LEVEL REWARDS & DISCORD DATA ====================

/**
 * Placeholder loader for level rewards UI.
 * Actual rendering may be handled by a dedicated module or server-rendered HTML.
 */
async function loadLevelRewards() {
  try {
    const response = await fetch(`/api/server/${guildId}/discord-data`);
    const data = await response.json();

    const rewardsList = document.getElementById("rewards-list");
    if (!rewardsList) return;

    // Intentionally not overriding innerHTML:
    // rewards content is expected to be managed by another script/template.
    void data;
  } catch (error) {
    console.error("Failed to load level rewards:", error);
  }
}

/**
 * Load Discord metadata (roles & channels) for dropdowns used by rewards,
 * reminders, clocks, etc.
 */
async function loadDiscordData() {
  try {
    const data = await fetchAPI(`/api/server/${guildId}/discord-data`);

    // Populate role dropdowns
    const roleSelect = document.getElementById("reward-role");
    if (roleSelect && data.roles) {
      roleSelect.innerHTML = '<option value="">Select a role...</option>';
      data.roles.forEach((role) => {
        const option = document.createElement("option");
        option.value = role.id;
        option.textContent = role.name;
        roleSelect.appendChild(option);
      });
    }

    // Populate text channel dropdowns (type === 0)
    const channelSelects = document.querySelectorAll(".channel-select");
    if (data.channels) {
      channelSelects.forEach((select) => {
        select.innerHTML = '<option value="">Select a channel...</option>';
        data.channels
          .filter((ch) => ch.type === 0)
          .forEach((channel) => {
            const option = document.createElement("option");
            option.value = channel.id;
            option.textContent = `# ${channel.name}`;
            select.appendChild(option);
          });
      });
    }
  } catch (error) {
    console.error("Failed to load Discord data:", error);
  }
}

// ==================== LEADERBOARD ====================

/**
 * Load and render the server XP leaderboard.
 */
async function loadLeaderboard() {
  try {
    const data = await fetchAPI(`/api/server/${guildId}/leaderboard`);

    const leaderboardList = document.getElementById("leaderboard-list");
    if (!leaderboardList) return;

    if (!data.leaderboard || data.leaderboard.length === 0) {
      leaderboardList.innerHTML =
        '<p class="text-slate-400 text-center py-8">No users have earned XP yet!</p>';
      return;
    }

    leaderboardList.innerHTML = data.leaderboard
      .map(
        (user, index) => `
      <div class="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 hover:border-indigo-500/30 transition-all">
        <div class="flex items-center gap-4">
          <span class="text-2xl font-bold ${index < 3 ? "text-yellow-400" : "text-slate-500"
          }">#${index + 1}</span>
          <div>
            <p class="font-bold text-white">${user.username || "Unknown User"
          }</p>
            <p class="text-sm text-slate-400">Level ${user.level}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="font-bold text-indigo-400">${user.xp.toLocaleString()} XP</p>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Failed to load leaderboard:", error);
  }
}

// ==================== YOUTUBE NOTIFICATIONS ====================

/**
 * Load configured YouTube notification channels for this guild.
 * Note: This may be overridden or unused if config_youtube.js is loaded.
 */
async function loadYouTubeConfigs() {
  try {
    const data = await fetchAPI(`/api/server/${guildId}/youtube`);

    const configsList = document.getElementById("youtube-configs-list");
    if (!configsList) return;

    if (!data.configs || data.configs.length === 0) {
      configsList.innerHTML =
        '<p class="text-slate-400 text-center py-8">No YouTube notifications configured</p>';
      return;
    }

    configsList.innerHTML = data.configs
      .map(
        (config) => `
      <div class="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-bold text-white">${config.name || "Unknown Channel"
          }</p>
            <p class="text-sm text-slate-400">ID: ${config.yt_id}</p>
          </div>
          <button onclick="deleteYouTubeConfig('${config.yt_id
          }')" class="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-all">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Failed to load YouTube configs:", error);
  }
}

/**
 * Delete a single YouTube notification configuration.
 * Exposed globally for inline onclick handlers.
 *
 * @param {string} ytId - YouTube channel or feed ID
 */
window.deleteYouTubeConfig = async function (ytId) {
  if (!confirm("Are you sure you want to remove this YouTube notification?"))
    return;

  try {
    await fetchAPI(`/api/server/${guildId}/youtube?yt_id=${ytId}`, {
      method: "DELETE",
    });

    showNotification("YouTube notification removed!");
    loadYouTubeConfigs();
  } catch (error) {
    console.error("Failed to delete YouTube config:", error);
  }
};

// ==================== CHANNEL RESTRICTIONS ====================

/**
 * Placeholder for channel restriction loader.
 * Actual logic is delegated to initRestrictionTab / loadRestrictions.
 */
async function loadChannelRestrictions() { }

/**
 * Placeholder edit handler for channel restrictions.
 * In future, can be wired to an edit modal or inline editor.
 *
 * @param {string | number} id - Restriction identifier
 */
window.editRestriction = function (id) {
  showNotification("Edit functionality coming soon!", "error");
  console.log("Edit restriction:", id);
};

/**
 * Delete a channel restriction rule.
 *
 * @param {string | number} id - Restriction identifier
 */
window.deleteRestriction = async function (id) {
  if (!confirm("Are you sure you want to remove this restriction?")) return;

  try {
    await fetchAPI(
      `/api/server/${guildId}/channel-restrictions-v2?id=${id}`,
      {
        method: "DELETE",
      }
    );

    showNotification("Restriction removed!");
    if (typeof loadRestrictions === "function")
      loadRestrictions(getGuildIdFromUrl());
  } catch (error) {
    console.error("Failed to delete restriction:", error);
  }
};

// ==================== REMINDERS ====================
// Logic moved to JS/Tabs/config_reminder.js

// ==================== TIMEZONE CLOCKS ====================
// Logic moved to JS/Tabs/config_time.js

// ==================== GLOBAL REFRESH ====================

/**
 * Refresh server analytics and settings from Discord / backend.
 * Also reloads the currently active tab data.
 */
if (!window.location.pathname.includes("/profile")) {
  window.refreshAllData = async function () {
    const refreshBtn = document.getElementById("refreshBtn");
    const refreshIcon = refreshBtn.querySelector("i");

    // Add spinning animation
    refreshIcon.classList.add("fa-spin");
    refreshBtn.disabled = true;

    try {
      const data = await fetchAPI(`/api/server/${guildId}/refresh`);

      // Update stat cards
      document.getElementById("totalMembers").textContent =
        data.total_members.toLocaleString();
      document.getElementById("newMembers").textContent =
        data.guild_stats.new_members_this_week;
      document.getElementById("messagesCount").textContent =
        data.guild_stats.messages_this_week;

      // Update settings if settings fields are present
      const xpPerMessage = document.getElementById("xpPerMessage");
      if (xpPerMessage) {
        xpPerMessage.value = data.settings.xp_per_message;
        document.getElementById("xpPerImage").value =
          data.settings.xp_per_image;
        document.getElementById("xpPerVoice").value =
          data.settings.xp_per_minute_in_voice;
        document.getElementById("voiceXpLimit").value =
          data.settings.voice_xp_limit;
        document.getElementById("xpCooldown").value = data.settings.xp_cooldown;
      }

      showNotification("✅ Data refreshed successfully!", "success");

      // Reload current active nav tab, if identifiable
      const activeNavItem = document.querySelector(
        ".nav-item.bg-indigo-600\\/20"
      );
      if (activeNavItem) {
        const tabName = activeNavItem.getAttribute("data-tab");
        if (tabName) {
          loadTabData(tabName, true);
        }
      }
    } catch (error) {
      console.error("Failed to refresh data:", error);
      showNotification("Failed to refresh data", "error");
    } finally {
      // Remove spinning animation
      refreshIcon.classList.remove("fa-spin");
      refreshBtn.disabled = false;
    }
  };
}


// ==================== EVENT BINDINGS (DOM READY) ====================

document.addEventListener("DOMContentLoaded", function () {
  const mobileMenuBtn = document.getElementById("mobileNavToggle");
  const mobileMenu = document.getElementById("sidebarNav");

  /**
   * Mobile navigation toggle
   */
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener("click", function () {
      mobileMenu.classList.toggle("hidden");
    });
  }

  // Handle settings form submission (XP / voice XP configuration).
  const settingsForm = document.getElementById("settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = {
        xp_per_message: parseInt(document.getElementById("xpPerMessage").value),
        xp_per_image: parseInt(document.getElementById("xpPerImage").value),
        xp_per_minute_in_voice: parseInt(
          document.getElementById("xpPerVoice").value
        ),
        voice_xp_limit: parseInt(document.getElementById("voiceXpLimit").value),
      };

      try {
        await fetchAPI(`/api/server/${guildId}/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        showNotification("Settings saved successfully!");
      } catch (error) {
        console.error("Failed to save settings:", error);
      }
    });
  }

  const rewardForm = document.getElementById("reward-form");
  if (rewardForm) {
    rewardForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const level = parseInt(document.getElementById("reward-level").value);
      const roleId = document.getElementById("reward-role").value;
      const roleName = document.getElementById("reward-role").selectedOptions[0].text;

      try {
        await fetchAPI(`/api/server/${guildId}/level-reward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level, role_id: roleId, role_name: roleName }),
        });

        showNotification(`Reward added for Level ${level}!`);
        rewardForm.reset();
        loadLevelRewards();
      } catch (error) {
        console.error("Failed to add reward:", error);
      }
    });
  }

  // Primary tab click handling (desktop/top-level navigation).
  const tabs = document.querySelectorAll("[data-tab]");
  const tabContents = document.querySelectorAll("[data-tab-content]");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;

      // Update active tab styles
      tabs.forEach((t) =>
        t.classList.remove("active", "border-indigo-500", "text-indigo-400")
      );
      tab.classList.add("active", "border-indigo-500", "text-indigo-400");

      // Show corresponding content
      tabContents.forEach((content) => {
        if (content.dataset.tabContent === tabName) {
          content.classList.remove("hidden");
        } else {
          content.classList.add("hidden");
        }
      });

      // Load data for the tab
      loadTabData(tabName);
    });
  });

  /**
  * Initialize first active tab on page load.
  */
  const activeTab = document.querySelector("[data-tab].active");
  if (activeTab) {
    loadTabData(activeTab.dataset.tab);
  }
});


// ===== Tabs\SubTabsAnalytics\config_analytics_history.js =====
/**
 * @file Analytics History JavaScript
 * @description
 * Handles:
 *  - Fetching historical analytics snapshots for a guild
 *  - Rendering a timeline-style list of weekly reports
 *  - Navigating to detailed snapshot reports
 *  - Basic empty/error state handling
 */




(function () {
  if (document.body.id !== 'page-analytics-history') return;

  // ===================== INITIALIZATION =====================

  document.addEventListener("DOMContentLoaded", () => {
    loadAnalyticsHistory();
  });

  // ===================== DATA LOADING =====================

  /**
   * Load analytics history for the current guild and render the timeline.
   * Relies on a global `guildId` variable provided by the template.
   */
  async function loadAnalyticsHistory() {
    try {
      const response = await fetch(`/api/analytics/${guildId}/history`);

      if (!response.ok) {
        throw new Error("Failed to fetch analytics history");
      }

      const data = await response.json();

      if (!data.snapshots || data.snapshots.length === 0) {
        showEmptyState();
        return;
      }

      renderTimeline(data.snapshots);
    } catch (error) {
      console.error("Error loading analytics history:", error);
      showError();
    }
  }

  // ===================== RENDERING =====================

  /**
   * Render the list of snapshot cards into the timeline container.
   *
   * @param {Array<Object>} snapshots - Array of snapshot metadata objects.
   */
  function renderTimeline(snapshots) {
    const timeline = document.getElementById("timeline");

    timeline.innerHTML = snapshots
      .map((snapshot) => {
        const healthClass = getHealthClass(snapshot.health_score);
        const trendEmoji = getTrendEmoji(snapshot.message_trend);
        const memberTrendEmoji = getTrendEmoji(snapshot.member_trend);

        return `
            <div class="snapshot-card">
                <div class="snapshot-header">
                    <div>
                        <div class="snapshot-title">Week ${snapshot.week_number
          }, ${snapshot.year}</div>
                        <div class="snapshot-date">${formatDate(
            snapshot.snapshot_date
          )}</div>
                    </div>
                    <div class="health-badge ${healthClass}">
                        ${snapshot.health_score}/100
                    </div>
                </div>
                
                <div class="snapshot-summary">
                    <div class="stat-item">
                        <div class="stat-icon">💬</div>
                        <div class="stat-value">${formatNumber(
            snapshot.messages_count
          )}</div>
                        <div class="stat-label">Messages</div>
                        <div class="trend-indicator ${snapshot.message_trend}">
                            ${trendEmoji} ${snapshot.message_trend}
                        </div>
                    </div>
                    
                    <div class="stat-item">
                        <div class="stat-icon">👥</div>
                        <div class="stat-value">+${snapshot.new_members_count
          }</div>
                        <div class="stat-label">New Members</div>
                        <div class="trend-indicator ${snapshot.member_trend}">
                            ${memberTrendEmoji} ${snapshot.member_trend}
                        </div>
                    </div>
                    
                    <div class="stat-item">
                        <div class="stat-icon">📈</div>
                        <div class="stat-value">${formatNumber(
            snapshot.active_members
          )}</div>
                        <div class="stat-label">Active Members</div>
                        <div class="stat-label">${formatNumber(
            snapshot.total_members
          )} total</div>
                    </div>
                </div>
                
                <button class="view-details-btn" onclick="viewSnapshot(${snapshot.id
          })">
                    <i class="fas fa-chart-bar"></i> View Full Report
                </button>
            </div>
        `;
      })
      .join("");
  }

  /**
   * Navigate to the full analytics report for a single snapshot.
   *
   * @param {number|string} snapshotId - Snapshot identifier.
   */
  function viewSnapshot(snapshotId) {
    window.location.href = `/analytics/snapshot/${guildId}/${snapshotId}`;
  }

  /**
   * Show the "empty history" state when there are no snapshots.
   */
  function showEmptyState() {
    document.getElementById("timeline").style.display = "none";
    document.getElementById("emptyState").style.display = "block";
  }

  /**
   * Show an error message and retry UI inside the timeline container.
   */
  function showError() {
    const timeline = document.getElementById("timeline");
    timeline.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-exclamation-triangle"></i>
            <h3>Failed to Load History</h3>
            <p>There was an error loading your analytics history.</p>
            <button class="btn-primary" onclick="loadAnalyticsHistory()">
                <i class="fas fa-redo"></i> Try Again
            </button>
        </div>
    `;
  }

  /**
   * Navigate back to the main dashboard for the current guild.
   */
  function goToDashboard() {
    window.location.href = `/dashboard/server/${guildId}`;
  }

  // ===================== UTILITY HELPERS =====================

  /**
   * Get semantic class for health badge based on score.
   *
   * @param {number} score - Health score from 0–100.
   * @returns {string} CSS class name.
   */
  function getHealthClass(score) {
    if (score >= 70) return "excellent";
    if (score >= 40) return "good";
    return "fair";
  }

  /**
   * Get an emoji representing the trend direction.
   *
   * @param {string} trend - "up" | "down" | "stable" | other.
   * @returns {string} Emoji representing trend.
   */
  function getTrendEmoji(trend) {
    switch (trend) {
      case "up":
        return "📈";
      case "down":
        return "📉";
      case "stable":
        return "➡️";
      default:
        return "➡️";
    }
  }

  /**
   * Format a date string into a human-readable label.
   *
   * @param {string} dateString - ISO date string from API.
   * @returns {string} Localized date label (e.g. "January 1, 2025").
   */
  function formatDate(dateString) {
    const date = new Date(dateString);
    const options = {
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    return date.toLocaleDateString("en-US", options);
  }

  /**
   * Format large numbers with K/M suffixes.
   *
   * @param {number} num - Number to format.
   * @returns {string} Human-readable numeric string.
   */
  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  // Export global functions
  window.loadAnalyticsHistory = loadAnalyticsHistory;
  window.viewSnapshot = viewSnapshot;
  window.goToDashboard = goToDashboard;

})();




// ===== Tabs\SubTabsAnalytics\config_analytics_settings.js =====
/**
 * @file Analytics Settings JavaScript
 * @description
 * Handles:
 *  - Initialization of analytics settings for a guild
 *  - Loading existing analytics settings from the backend
 *  - Saving updated analytics settings to the backend
 *  - Wiring basic UI events for timezone-related controls
 */


(function () {
  // Assuming 'page-analytics-settings' based on pattern, or fallback if unused
  if (document.body.id !== 'page-analytics-settings' && !document.getElementById('view-analytics-settings')) return;

  let currentGuildIdForAnalytics = null;

  // ===================== INITIALIZATION =====================

  /**
   * Initialize analytics settings for a specific guild.
   *
   * @param {string} guildId - Discord guild (server) ID.
   */
  function initAnalyticsSettings(guildId) {
    currentGuildIdForAnalytics = guildId;
    loadAnalyticsSettings();
  }

  // ===================== LOAD SETTINGS =====================

  /**
   * Load analytics settings from the API and populate the form.
   *
   * Uses the guild_id parsed from the current URL.
   */
  async function loadAnalyticsSettings() {
    try {
      const guildId = window.location.pathname.split("/").pop();

      if (!guildId || guildId === "null") {
        console.error("Invalid guild_id for loading settings:", guildId);
        return;
      }

      const response = await fetch(`/api/analytics/${guildId}/settings`);

      if (!response.ok) {
        throw new Error("Failed to load analytics settings");
      }

      const settings = await response.json();

      document.getElementById("weeklyReportEnabled").checked =
        settings.weekly_report_enabled;
      document.getElementById("analyticsTimezone").value =
        settings.analytics_timezone;
      document.getElementById("resetTimezone").value =
        settings.weekly_reset_timezone;
    } catch (error) {
      console.error("Error loading analytics settings:", error);
    }
  }

  // ===================== SAVE SETTINGS =====================

  /**
   * Save analytics settings to the API.
   *
   * Reads form values and posts them to the backend for the
   * current guild, with basic success/error notification.
   */
  async function saveAnalyticsSettings() {
    try {
      const guildId = window.location.pathname.split("/").pop();

      if (!guildId || guildId === "null") {
        console.error("Invalid guild_id:", guildId);
        showNotification("Invalid server ID", "error");
        return;
      }

      const settings = {
        weekly_report_enabled: document.getElementById("weeklyReportEnabled")
          .checked,
        analytics_timezone: document.getElementById("analyticsTimezone").value,
        weekly_reset_timezone: document.getElementById("resetTimezone").value,
        weekly_report_day: 0, // Monday
        weekly_report_hour: 9, // 9 AM
      };

      const response = await fetch(`/api/analytics/${guildId}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Failed to save analytics settings");
      }

      const result = await response.json();

      if (result.success) {
        showNotification("Analytics settings saved successfully!", "success");
        updateNextResetTime(settings.weekly_reset_timezone);
      } else {
        throw new Error("Save failed");
      }
    } catch (error) {
      console.error("Error saving analytics settings:", error);
      showNotification("Failed to save analytics settings", "error");
    }
  }

  // ===================== EVENT BINDINGS =====================

  document.addEventListener("DOMContentLoaded", () => {
    const resetTimezoneSelect = document.getElementById("resetTimezone");
    if (resetTimezoneSelect) {
      resetTimezoneSelect.addEventListener("change", (e) => {
        // Hook for future next-reset-time updates when timezone changes.
        // updateNextResetTime(e.target.value);
      });
    }
  });

  window.saveAnalyticsSettings = saveAnalyticsSettings;
  window.initAnalyticsSettings = initAnalyticsSettings;

})();


// ===== Tabs\SubTabsAnalytics\config_analytics_snapshot.js =====
/**
 * @file Analytics Snapshot Detail JavaScript
 * @description
 * Handles:
 *  - Fetching a stored analytics snapshot for a guild
 *  - Rendering snapshot metrics, trends, and insights
 *  - Showing basic error and loading states
 */




(function () {
  if (document.body.id !== 'page-analytics-snapshot') return;

  // ===================== INITIALIZATION =====================

  document.addEventListener("DOMContentLoaded", () => {
    loadSnapshot();
  });

  // ===================== DATA LOADING =====================

  /**
   * Fetch the analytics snapshot from the backend and render it.
   * Relies on global variables:
   *  - guildId:   current Discord server ID
   *  - snapshotId: target snapshot identifier
   */
  async function loadSnapshot() {
    try {
      const response = await fetch(
        `/api/analytics/${guildId}/snapshot/${snapshotId}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch snapshot");
      }

      const snapshot = await response.json();
      renderSnapshot(snapshot);
    } catch (error) {
      console.error("Error loading snapshot:", error);
      showError();
    }
  }

  // ===================== RENDERING =====================

  /**
   * Render all snapshot sections into the page.
   *
   * @param {Object} snapshot - Full snapshot payload from the API.
   */
  function renderSnapshot(snapshot) {
    // Hide loading, show content
    document.getElementById("loadingState").style.display = "none";
    document.getElementById("reportContent").style.display = "block";

    // Report title
    document.getElementById(
      "reportTitle"
    ).textContent = `Week ${snapshot.week_number}, ${snapshot.year} Analytics Report`;

    // Health score
    updateHealthScore(snapshot.health_score);

    // Key Metrics
    document.getElementById("messagesCount").textContent = formatNumber(
      snapshot.messages_count
    );
    document.getElementById("newMembersCount").textContent = formatNumber(
      snapshot.new_members_count
    );
    document.getElementById("activeMembers").textContent = formatNumber(
      snapshot.active_members
    );
    document.getElementById("totalMembers").textContent = `of ${formatNumber(
      snapshot.total_members
    )} total`;
    document.getElementById("totalXP").textContent = formatNumber(
      snapshot.leveling.total_xp_earned
    );
    document.getElementById(
      "avgLevel"
    ).textContent = `Avg: ${snapshot.leveling.avg_level.toFixed(1)}`;

    // Trends
    updateTrend("messageTrend", snapshot.message_trend);
    updateTrend("memberTrend", snapshot.member_trend);

    // Engagement tiers
    document.getElementById("eliteCount").textContent = formatNumber(
      snapshot.engagement_tiers.elite.count
    );
    document.getElementById("activeCount").textContent = formatNumber(
      snapshot.engagement_tiers.active.count
    );
    document.getElementById("casualCount").textContent = formatNumber(
      snapshot.engagement_tiers.casual.count
    );
    document.getElementById("inactiveCount").textContent = formatNumber(
      snapshot.engagement_tiers.inactive.count
    );

    // Leveling insights
    document.getElementById("levelingTotalXP").textContent = formatNumber(
      snapshot.leveling.total_xp_earned
    );
    document.getElementById("levelingAvgLevel").textContent =
      snapshot.leveling.avg_level.toFixed(1);
    document.getElementById("levelingMaxLevel").textContent =
      snapshot.leveling.max_level;

    // Top contributors & insights
    renderContributors(snapshot.top_contributors);
    renderInsights(snapshot.insights);
  }

  /**
   * Update the health score visual:
   *  - numeric value
   *  - circular indicator
   *  - status label + color
   *
   * @param {number} score - Health score from 0–100.
   */
  function updateHealthScore(score) {
    const valueElement = document.getElementById("healthValue");
    const statusElement = document.getElementById("healthStatus");
    const circleElement = document.getElementById("healthCircle");

    valueElement.textContent = score;
    circleElement.style.setProperty("--health-score", score);

    let status, color;
    if (score >= 80) {
      status = "🟢 Excellent Health";
      color = "var(--success-color)";
    } else if (score >= 60) {
      status = "🟡 Good Health";
      color = "var(--warning-color)";
    } else if (score >= 40) {
      status = "🟠 Needs Attention";
      color = "var(--warning-color)";
    } else {
      status = "🔴 Low Health";
      color = "var(--error-color)";
    }

    statusElement.textContent = status;
    statusElement.style.color = color;
  }

  /**
   * Update a single metric trend indicator.
   *
   * @param {string} elementId - Target element ID.
   * @param {string} trend - Trend value ("up" | "down" | "stable" | other).
   */
  function updateTrend(elementId, trend) {
    const element = document.getElementById(elementId);
    const emoji = getTrendEmoji(trend);

    element.textContent = `${emoji} ${trend}`;
    element.className = `metric-trend ${trend}`;
  }

  /**
   * Render the "Top Contributors" list.
   *
   * @param {Array<Object>} contributors - Array of contributor objects.
   */
  function renderContributors(contributors) {
    const listElement = document.getElementById("contributorsList");

    if (!contributors || contributors.length === 0) {
      listElement.innerHTML =
        '<p class="loading-text">No contributors data available</p>';
      return;
    }

    listElement.innerHTML = contributors
      .map((contributor, index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `top-${rank}` : "";

        return `
            <div class="contributor-item">
                <div class="contributor-rank ${rankClass}">#${rank}</div>
                <div class="contributor-info">
                    <div class="contributor-name">${escapeHtml(
          contributor.username
        )}</div>
                    <div class="contributor-stats">Level ${contributor.level
          }</div>
                </div>
                <div class="contributor-xp">${formatNumber(
            contributor.xp
          )} XP</div>
            </div>
        `;
      })
      .join("");
  }

  /**
   * Render the list of textual insights.
   *
   * @param {string[]} insights - Array of insight strings.
   */
  function renderInsights(insights) {
    const listElement = document.getElementById("insightsList");

    if (!insights || insights.length === 0) {
      listElement.innerHTML = '<p class="loading-text">No insights available</p>';
      return;
    }

    listElement.innerHTML = insights
      .map((insight) => `<div class="insight-item">${escapeHtml(insight)}</div>`)
      .join("");
  }

  /**
   * Show a generic error state in the loading container.
   */
  function showError() {
    document.getElementById("loadingState").innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load analytics report</p>
        <button class="btn-primary" onclick="loadSnapshot()">
            <i class="fas fa-redo"></i> Try Again
        </button>
    `;
  }

  // ===================== UTILITY HELPERS =====================

  /**
   * Get an emoji representing the trend direction.
   *
   * @param {string} trend - "up" | "down" | "stable" | other.
   * @returns {string} Emoji representing trend.
   */
  function getTrendEmoji(trend) {
    switch (trend) {
      case "up":
        return "📈";
      case "down":
        return "📉";
      case "stable":
        return "➡️";
      default:
        return "➡️";
    }
  }

  /**
   * Format large numbers with K/M suffixes.
   *
   * @param {number} num - Number to format.
   * @returns {string} Human-readable formatted number.
   */
  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  /**
   * Escape HTML in a string to prevent injection.
   *
   * @param {string} text - Raw text to escape.
   * @returns {string} Escaped HTML string.
   */
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  window.loadSnapshot = loadSnapshot;

})();


// ===== Tabs\SubTabsLevel\config_level_leaderboard.js =====
/**
 * @file Leaderboard Tab Logic
 * @description
 * Handles loading, refreshing, and rendering of the server leaderboard.
 *
 * NOTE:
 * - There are two `loadLeaderboard` functions defined.
 * - The second definition overrides the first in JavaScript's function hoisting,
 *   but the first is kept for backwards compatibility with any legacy usage.
 */


(function () {
  if (!document.getElementById('view-level-leaderboard')) return;



  // ==================== LEGACY LEADERBOARD LOADER (BACKWARDS COMPAT) ====================

  /**
   * Legacy leaderboard loader using `#leaderboardTable tbody`.
   * Kept for compatibility with older markup; overridden by the newer implementation below.
   *
   * @returns {Promise<void>}
   */
  async function loadLeaderboard() {
    const guildId = window.location.pathname.split("/").pop();
    const tableBody = document.querySelector("#leaderboardTable tbody");

    if (!tableBody) return;

    try {
      const res = await fetch(`/api/server/${guildId}/leaderboard`);
      if (!res.ok) throw new Error("Leaderboard API error");
      const data = await res.json();

      tableBody.innerHTML = "";

      if (!data.leaderboard || data.leaderboard.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-slate-500 p-6">No data available.</td></tr>`;
        return;
      }

      data.leaderboard.forEach((entry, idx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="truncate">${entry.username || entry.user_id}</td>
        <td>${entry.level ?? 0}</td>
        <td>${entry.xp ?? 0}</td>
      `;
        tableBody.appendChild(tr);
      });
    } catch (e) {
      console.error("Failed loading leaderboard", e);
      tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-red-500 p-6">Failed to load leaderboard.</td></tr>`;
    }
  }

  // ==================== EVENT WIRING (REFRESH & AUTO-LOAD) ====================

  /**
   * Binds the refresh button and auto-loads the leaderboard when the DOM is ready.
   */
  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("refreshLeaderboardBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        // Show loading state in the leaderboard body before refreshing data
        document.querySelector("#leaderboardBody").innerHTML =
          '<tr><td colspan="4" class="text-center py-8 text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</td></tr>';
        loadLeaderboard();
      });
    }

    // Initial load of leaderboard data
    loadLeaderboard();
  });

  // ==================== PRIMARY LEADERBOARD LOADER (CURRENT IMPLEMENTATION) ====================

  /**
   * Primary leaderboard loader using `#leaderboardBody`.
   * This implementation:
   *  - Adds a cache-busting query parameter to the request
   *  - Renders rank badges and user avatars
   *  - Provides a friendly empty-state message
   *
   * @returns {Promise<void>}
   */
  async function loadLeaderboard() {
    const guildId = window.location.pathname.split("/").pop();
    const tbody = document.getElementById("leaderboardBody");

    try {
      const response = await fetch(
        `/api/server/${guildId}/leaderboard?t=${Date.now()}`
      );
      const data = await response.json();

      if (!data.leaderboard || data.leaderboard.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="4" class="text-center py-8 text-slate-500">No leaderboard data yet. Start chatting to earn XP!</td></tr>';
        return;
      }

      tbody.innerHTML = data.leaderboard
        .map((user, index) => {
          const rank = index + 1;
          let rankBadge;

          if (rank === 1) {
            rankBadge = `<span class="rank-badge gold">${rank}</span>`;
          } else if (rank === 2) {
            rankBadge = `<span class="rank-badge silver">${rank}</span>`;
          } else if (rank === 3) {
            rankBadge = `<span class="rank-badge bronze">${rank}</span>`;
          } else {
            rankBadge = `<span class="text-slate-500 font-bold">${rank}</span>`;
          }

          const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.user_id}/${user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${rank % 5}.png`;

          return `
      <tr>
        <td class="text-center">${rankBadge}</td>
        <td>
          <div class="flex items-center gap-3">
            <img src="${avatarUrl}" class="w-8 h-8 rounded-full" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
            <span class="font-bold ${rank <= 3 ? "" : "text-slate-300"}">${user.username || "Unknown User"
            }</span>
          </div>
        </td>
        <td class="text-center font-bold text-indigo-400">${user.level || 0
            }</td>
        <td class="text-center text-slate-400">${(
              user.xp || 0
            ).toLocaleString()} XP</td>
      </tr>
    `;
        })
        .join("");
    } catch (error) {
      console.error("Failed to load leaderboard:", error);
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-center py-8 text-red-400">Failed to load leaderboard</td></tr>';
    }
  }

  window.loadLeaderboard = loadLeaderboard;

})();




// ===== Tabs\SubTabsLevel\config_level_leaderboard_full.js =====
/**
 * @file Full Leaderboard Page Logic
 * @description
 * Handles:
 *  - Loading the full server leaderboard (all members with XP)
 *  - Debounced search over leaderboard entries
 *  - Manual refresh of leaderboard data
 *  - Safe HTML rendering of usernames
 */

/** Debounce handle for search input. */
let searchTimeout;


(function () {
  if (document.body.id !== 'page-leaderboard-full') return;

  // ==================== INITIALIZATION ====================

  document.addEventListener("DOMContentLoaded", () => {
    // Initial load with no search query
    loadFullLeaderboard();

    // Attach search listener with debounce
    const searchInput = document.getElementById("leaderboardSearch");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value;

        // Debounce search requests to avoid spamming the API
        searchTimeout = setTimeout(() => {
          loadFullLeaderboard(query);
        }, 500);
      });
    }

    // Attach refresh button listener
    const refreshBtn = document.getElementById("refreshFullLeaderboardBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        const query = searchInput ? searchInput.value : "";
        loadFullLeaderboard(query);
      });
    }
  });

  // ==================== DATA LOADING & RENDERING ====================

  /**
   * Load the full leaderboard from the backend and render the table.
   *
   * @param {string} [searchQuery=""] - Optional search query to filter members.
   * @returns {Promise<void>}
   */
  async function loadFullLeaderboard(searchQuery = "") {
    // URL structure: /dashboard/server/{GUILD_ID}/view-leaderboard
    const guildId = window.location.pathname.split("/")[3];
    const tbody = document.getElementById("fullLeaderboardBody");

    const loadingRow = `
        <tr>
            <td colspan="4" class="text-center py-12">
                <div class="inline-flex flex-col items-center justify-center text-slate-500">
                    <i class="fas fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
                    <p>Loading leaderboard data...</p>
                </div>
            </td>
        </tr>`;

    tbody.innerHTML = loadingRow;

    try {
      let url = `/api/server/${guildId}/leaderboard?limit=all&t=${Date.now()}`;
      if (searchQuery) {
        url += `&search=${encodeURIComponent(searchQuery)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (!data.leaderboard || data.leaderboard.length === 0) {
        tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-12 text-slate-500">
                        <i class="fas fa-search text-2xl mb-2 opacity-50"></i>
                        <p>No members found${searchQuery ? ` matching "${searchQuery}"` : ""
          }.</p>
                    </td>
                </tr>`;
        return;
      }

      tbody.innerHTML = data.leaderboard
        .map((user, index) => {
          const rank = index + 1;
          let rankClass = "rank-normal";
          let rankContent = rank;

          if (rank === 1) {
            rankClass = "rank-gold";
          } else if (rank === 2) {
            rankClass = "rank-silver";
          } else if (rank === 3) {
            rankClass = "rank-bronze";
          }

          const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.user_id}/${user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${rank % 5}.png`;

          return `
                <tr class="transition-colors hover:bg-slate-800/30">
                    <td class="text-center">
                        <span class="rank-badge-full ${rankClass}">${rankContent}</span>
                    </td>
                    <td>
                        <div class="user-cell">
                            <img src="${avatarUrl}" class="user-avatar-lg" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                            <span class="user-name-lg ${rank <= 3 ? "text-white" : "text-slate-300"
            }">${escapeHtml(
              user.username || "Unknown User"
            )}</span>
                        </div>
                    </td>
                    <td>
                        <span class="level-badge">Lvl ${user.level || 0}</span>
                    </td>
                    <td>
                        <span class="xp-text">${(
              user.xp || 0
            ).toLocaleString()} XP</span>
                    </td>
                </tr>
            `;
        })
        .join("");
    } catch (e) {
      console.error("Leaderboard load failed:", e);
      tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-12 text-red-400">
                    <i class="fas fa-exclamation-triangle mb-2"></i>
                    <p>Failed to load leaderboard data.</p>
                </td>
            </tr>`;
    }
  }

  // ==================== UTILITIES ====================

  /**
   * Escape potentially unsafe HTML in usernames and other user-provided fields.
   *
   * @param {string} text - Raw text to escape.
   * @returns {string} Safe HTML-escaped string.
   */
  function escapeHtml(text) {
    if (!text) return text;
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

})();


// ===== Tabs\SubTabsLevel\config_level_reward.js =====
/**
 * @file Level Rewards Management
 * @description
 * Handles the level → role reward configuration UI, including:
 *  - Lazy-loading guild roles into the reward modal
 *  - Creating new level rewards via the backend API
 *  - Rendering reward cards in sorted order
 *  - Deleting existing rewards and managing the empty state
 */


(function () {
  if (!document.getElementById('view-level-reward')) return;

  /** Tracks whether guild roles have already been loaded into the role selector. */
  let rolesLoaded = false;



  /** Cached reference to the level reward modal element. */
  const modal = document.getElementById("rewardModal");

  // ==================== MODAL OPEN / CLOSE ====================

  /**
   * Open the level reward modal and lazily fetch roles from the backend.
   * Initializes Select2 for the role dropdown on first load.
   *
   * @returns {Promise<void>}
   */
  async function openRewardModal() {
    modal.classList.remove("hidden");

    if (!rolesLoaded) {
      const roleSelect = document.getElementById("newRewardRole");
      const guildId = window.location.pathname.split("/").pop();

      try {
        const response = await fetch(`/api/server/${guildId}/discord-data`);
        const data = await response.json();

        if (data.roles && data.roles.length > 0) {
          roleSelect.innerHTML =
            '<option value="" disabled selected>Select a Role</option>';

          // Sort roles by position (highest first)
          data.roles.sort((a, b) => b.position - a.position);

          data.roles.forEach((role) => {
            const opt = document.createElement("option");
            opt.value = role.id;
            opt.text = role.name;
            opt.dataset.color = role.color.toString(16);
            roleSelect.appendChild(opt);
          });
          rolesLoaded = true;

          $("#newRewardRole").select2({
            dropdownParent: $("#rewardModal"),
            width: "100%",
            placeholder: "Select a Role",
            allowClear: true,
          });
        } else {
          roleSelect.innerHTML = "<option disabled>Failed to load roles</option>";
        }
      } catch (e) {
        console.error("Failed to fetch roles", e);
        roleSelect.innerHTML = "<option disabled>Error loading roles</option>";
      }
    }
  }

  /**
   * Close the level reward modal.
   */
  function closeRewardModal() {
    modal.classList.add("hidden");
  }

  // ==================== CREATE / UPDATE REWARD ====================

  /**
   * Persist a new level reward via the API and update the UI optimistically.
   *
   * @returns {Promise<void>}
   */
  async function saveLevelReward() {
    const levelInput = document.getElementById("newRewardLevel");
    const roleSelect = document.getElementById("newRewardRole");
    const btn = document.getElementById("btnSaveReward");

    const level = levelInput.value;
    const roleId = roleSelect.value;
    const roleName = roleSelect.options[roleSelect.selectedIndex]?.text;

    if (!level || !roleId) {
      alert("Please select a level and a role.");
      return;
    }

    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/server/${guildId}/level-reward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: level,
          role_id: roleId,
          role_name: roleName,
        }),
      });

      if (response.ok) {
        closeRewardModal();

        const rewardList = document.getElementById("rewardList");

        const placeholder = rewardList.querySelector(".text-center.py-12");
        if (placeholder) {
          placeholder.remove();
        }

        const newCard = document.createElement("div");
        newCard.className = "reward-card animate-popIn";
        newCard.id = `reward-card-${level}`;
        newCard.innerHTML = `
        <div class="reward-level">
          <span class="text-2xl font-black text-indigo-400">${level}</span>
          <span class="text-xs text-slate-500 uppercase">Level</span>
        </div>
        <div class="reward-arrow text-slate-600">
          <i class="fas fa-arrow-right"></i>
        </div>
        <div class="reward-role flex items-center gap-3">
          <div class="w-4 h-4 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"></div>
          <div>
            <span class="font-bold">${roleName}</span>
            <span class="text-xs text-slate-500 block">Role Reward</span>
          </div>
        </div>
        <button class="reward-delete-btn" onclick="deleteLevelReward(${level})" title="Delete reward">
          <i class="fas fa-times"></i>
        </button>
      `;

        const existingCards = Array.from(
          rewardList.querySelectorAll(".reward-card")
        );
        let inserted = false;

        for (let i = 0; i < existingCards.length; i++) {
          const cardLevel = parseInt(
            existingCards[i].querySelector(".reward-level .text-2xl").textContent
          );
          if (parseInt(level) < cardLevel) {
            rewardList.insertBefore(newCard, existingCards[i]);
            inserted = true;
            break;
          }
        }

        if (!inserted) {
          rewardList.appendChild(newCard);
        }

        levelInput.value = "";
        roleSelect.selectedIndex = 0;
      } else {
        alert("Failed to save reward.");
      }
    } catch (e) {
      console.error(e);
      alert("Error saving reward.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  // ==================== DELETE REWARD ====================

  /**
   * Delete a level reward by level and update the reward list UI.
   *
   * @param {number|string} level - The level whose reward should be removed.
   * @returns {Promise<void>}
   */
  async function deleteLevelReward(level) {
    if (!confirm(`Are you sure you want to remove the Level ${level} reward?`))
      return;

    const guildId = window.location.pathname.split("/").pop();
    const card = document.getElementById(`reward-card-${level}`);

    try {
      const response = await fetch(
        `/api/server/${guildId}/level-reward?level=${level}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        card.remove();

        const rewardList = document.getElementById("rewardList");
        const remainingCards = rewardList.querySelectorAll(".reward-card");

        if (remainingCards.length === 0) {
          const placeholder = document.createElement("div");
          placeholder.className = "text-center py-12 text-slate-500";
          placeholder.innerHTML = `
          <i class="fas fa-gift text-4xl mb-3 opacity-30"></i>
          <p>No role rewards configured yet.</p>
          <p class="text-sm">Click "Add Reward" to create your first level reward!</p>
        `;
          rewardList.appendChild(placeholder);
        }
      } else {
        alert("Failed to delete reward.");
      }
    } catch (e) {
      console.error(e);
      alert("Error deleting reward.");
    }
  }

  window.openRewardModal = openRewardModal;
  window.closeRewardModal = closeRewardModal;
  window.saveLevelReward = saveLevelReward;
  window.deleteLevelReward = deleteLevelReward;

})();




// ===== Tabs\SubTabsLevel\config_level_setting.js =====
/**
 * @file Level Settings Management
 * @description
 * Handles loading, displaying, and saving level-related configuration
 * for a Discord guild, including:
 *  - Level-up notification channel and message styles
 *  - Custom level-up messages (with/without role rewards)
 *  - Role reward stacking and announcement toggles
 *  - Auto-reset XP settings (with optional role removal)
 */

/**
 * Load level settings for the current guild and populate the UI controls.
 */
window.loadLevelSettings = async function () {
  const guildId = window.location.pathname.split("/").pop();
  const notifySelect = document.getElementById("levelNotifyChannel");
  const messageStyleSelect = document.getElementById("levelMessageStyle");
  const customMessageTextarea = document.getElementById("levelCustomMessage");
  const customMessageRoleTextarea = document.getElementById(
    "levelCustomMessageRole"
  );
  const stackRolesCheckbox = document.getElementById("stackRoleRewards");
  const announceRolesCheckbox = document.getElementById("announceRoleRewards");
  const autoResetDaysInput = document.getElementById("autoResetDays");
  const autoResetEnabledCheckbox = document.getElementById("autoResetEnabled");
  const autoResetRemoveRolesDaysInput = document.getElementById(
    "autoResetRemoveRolesDays"
  );
  const autoResetRemoveRolesEnabledCheckbox = document.getElementById(
    "autoResetRemoveRolesEnabled"
  );

  if (!notifySelect) return;

  try {
    // Load Discord channels for notification options
    const resp = await fetch(`/api/server/${guildId}/discord-data`);
    const data = await resp.json();

    const channels = data.channels || [];
    // Populate channel dropdown with category support
    if (typeof window.populateChannelDropdownWithCategories === "function") {
      window.populateChannelDropdownWithCategories(notifySelect, channels, {
        channelTypes: [0, 5],
        placeholder: "Disable notifications",
        includeHash: true,
      });
    } else {
      // Fallback: Simple population
      notifySelect.innerHTML = '<option value="">Disable notifications</option>';
      channels
        .filter((c) => c.type === 0 || c.type === 5)
        .forEach((ch) => {
          const opt = document.createElement("option");
          opt.value = ch.id;
          opt.text = `# ${ch.name}`;
          notifySelect.appendChild(opt);
        });
    }

    $("#levelNotifyChannel").select2({
      width: "100%",
      placeholder: "Disable notifications",
      allowClear: true,
    });

    // Load persisted level settings
    const settingsResp = await fetch(
      `/api/server/${guildId}/level-settings-get`
    );
    if (settingsResp.ok) {
      const settings = await settingsResp.json();

      // Notification channel
      if (settings.notify_channel_id && notifySelect) {
        $(notifySelect).val(settings.notify_channel_id).trigger("change");
      }

      // Message style
      if (settings.message_style && messageStyleSelect) {
        messageStyleSelect.value = settings.message_style;
      }

      // Custom messages
      if (settings.custom_message && customMessageTextarea) {
        customMessageTextarea.value = settings.custom_message;
      }
      if (settings.custom_message_role_reward && customMessageRoleTextarea) {
        customMessageRoleTextarea.value = settings.custom_message_role_reward;
      }

      // Role reward behavior
      if (stackRolesCheckbox) {
        stackRolesCheckbox.checked = settings.stack_role_rewards !== false;
      }
      if (announceRolesCheckbox) {
        announceRolesCheckbox.checked =
          settings.announce_role_rewards !== false;
      }

      // Auto-reset configuration
      if (settings.auto_reset) {
        const statusDiv = document.getElementById("autoResetStatus");
        const modeSpan = document.getElementById("autoResetMode");
        const createdOnSpan = document.getElementById("autoResetCreatedOn");
        const nextResetSpan = document.getElementById("autoResetNextReset");

        if (settings.auto_reset.remove_roles) {
          if (autoResetRemoveRolesDaysInput) {
            autoResetRemoveRolesDaysInput.value = settings.auto_reset.days;
          }
          if (autoResetRemoveRolesEnabledCheckbox) {
            autoResetRemoveRolesEnabledCheckbox.checked = true;
          }
          if (modeSpan) {
            modeSpan.textContent = `Resets every ${settings.auto_reset.days} day(s) and removes role rewards`;
          }
        } else {
          if (autoResetDaysInput) {
            autoResetDaysInput.value = settings.auto_reset.days;
          }
          if (autoResetEnabledCheckbox) {
            autoResetEnabledCheckbox.checked = true;
          }
          if (modeSpan) {
            modeSpan.textContent = `Resets every ${settings.auto_reset.days} day(s) and keeps role rewards`;
          }
        }

        if (statusDiv) {
          statusDiv.classList.remove("hidden");
        }

        if (settings.auto_reset.last_reset && createdOnSpan) {
          const createdDate = new Date(settings.auto_reset.last_reset);
          createdOnSpan.textContent =
            createdDate.toLocaleDateString() +
            " " +
            createdDate.toLocaleTimeString();
        }

        if (settings.auto_reset.last_reset && nextResetSpan) {
          const lastReset = new Date(settings.auto_reset.last_reset);
          const nextReset = new Date(lastReset);
          nextReset.setDate(nextReset.getDate() + settings.auto_reset.days);
          nextResetSpan.textContent =
            nextReset.toLocaleDateString() +
            " " +
            nextReset.toLocaleTimeString();
        }
      }
    }
  } catch (e) {
    console.error("Failed to load level settings", e);
  }
}

/**
 * Persist current level settings to the backend for the active guild.
 * Handles multi-button save state and reloads settings on success.
 */
async function saveLevelSettings() {
  console.log("[SAVE] Function called");

  const guildId = window.location.pathname.split("/").pop();
  const notifySelect = document.getElementById("levelNotifyChannel");
  const messageStyleSelect = document.getElementById("levelMessageStyle");
  const customMessageTextarea = document.getElementById("levelCustomMessage");
  const customMessageRoleTextarea = document.getElementById(
    "levelCustomMessageRole"
  );
  const stackRolesCheckbox = document.getElementById("stackRoleRewards");
  const announceRolesCheckbox = document.getElementById("announceRoleRewards");
  const autoResetDaysInput = document.getElementById("autoResetDays");
  const autoResetEnabledCheckbox = document.getElementById("autoResetEnabled");
  const autoResetRemoveRolesDaysInput = document.getElementById(
    "autoResetRemoveRolesDays"
  );
  const autoResetRemoveRolesEnabledCheckbox = document.getElementById(
    "autoResetRemoveRolesEnabled"
  );

  const buttons = document.querySelectorAll(".save-level-btn");
  if (buttons.length === 0) {
    console.error("[SAVE] No save buttons found!");
    return;
  }

  /**
   * Internal helper to synchronize UI state across all save buttons.
   *
   * @param {"loading"|"success"|"error"|"reset"} state - Desired visual state.
   * @param {string|null} [customHtml=null] - Optional custom innerHTML (unused).
   */
  const updateButtons = (state, customHtml = null) => {
    buttons.forEach((btn) => {
      if (state === "loading") {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.classList.add("saving");
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
      } else if (state === "success") {
        btn.classList.remove("saving");
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
      } else if (state === "error") {
        btn.classList.remove("saving");
        btn.innerHTML = '<i class="fas fa-times mr-2"></i>Error';
      } else if (state === "reset") {
        btn.disabled = false;
        if (btn.dataset.originalHtml) {
          btn.innerHTML = btn.dataset.originalHtml;
        }
      }
    });
  };

  updateButtons("loading");

  try {
    const settings = {
      notify_channel_id: notifySelect?.value || null,
      message_style: messageStyleSelect?.value || "embed",
      custom_message: customMessageTextarea?.value || "",
      custom_message_role_reward: customMessageRoleTextarea?.value || "",
      stack_roles: stackRolesCheckbox?.checked || false,
      announce_roles: announceRolesCheckbox?.checked || false,
      auto_reset_days: parseInt(autoResetDaysInput?.value || "0"),
      auto_reset_enabled: autoResetEnabledCheckbox?.checked || false,
      auto_reset_remove_roles_days: parseInt(
        autoResetRemoveRolesDaysInput?.value || "0"
      ),
      auto_reset_remove_roles_enabled:
        autoResetRemoveRolesEnabledCheckbox?.checked || false,
    };

    console.log("[SAVE] Payload:", settings);
    console.log("[SAVE] URL:", `/api/server/${guildId}/level-settings`);

    const res = await fetch(`/api/server/${guildId}/level-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    console.log("[SAVE] Response status:", res.status);

    if (res.ok) {
      console.log("[SAVE] Save successful!");
      updateButtons("success");

      setTimeout(() => {
        loadLevelSettings();
      }, 500);

      setTimeout(() => {
        updateButtons("reset");
      }, 2000);
    } else {
      const errorText = await res.text();
      console.error("[SAVE] Error response:", errorText);
      throw new Error(`Server error: ${res.status} - ${errorText}`);
    }
  } catch (e) {
    console.error("[SAVE] Exception:", e);
    updateButtons("error");
    alert(`Failed to save: ${e.message}\nCheck browser console for details.`);
    setTimeout(() => {
      updateButtons("reset");
    }, 2000);
  }
}

/**
 * DOMContentLoaded hook:
 *  - Loads initial level settings
 *  - Binds save buttons
 *  - Binds XP reset buttons (with/without role removal)
 */
document.addEventListener("DOMContentLoaded", () => {
  // Only run on pages with the level settings UI
  if (!document.getElementById("levelNotifyChannel")) return;

  loadLevelSettings();

  const saveButtons = document.querySelectorAll(".save-level-btn");
  saveButtons.forEach((btn) => {
    btn.addEventListener("click", saveLevelSettings);
  });

  const btnResetAll = document.getElementById("btnResetAll");
  const btnResetXpOnly = document.getElementById("btnResetXpOnly");

  if (btnResetAll) {
    btnResetAll.addEventListener("click", () => confirmReset(false));
  }
  if (btnResetXpOnly) {
    btnResetXpOnly.addEventListener("click", () => confirmReset(true));
  }
});

/**
 * Confirm and execute XP reset for the guild.
 *
 * @param {boolean} keepRoles - When true, only XP is reset (roles kept);
 *                              when false, XP and role rewards are removed.
 */
async function confirmReset(keepRoles) {
  const action = keepRoles
    ? "Reset XP Only (Keep Roles)"
    : "Reset Everything (Remove Roles)";
  if (
    !confirm(
      `Are you sure you want to ${action}? This action cannot be undone.`
    )
  ) {
    return;
  }

  const guildId = window.location.pathname.split("/").pop();
  const btn = keepRoles
    ? document.getElementById("btnResetXpOnly")
    : document.getElementById("btnResetAll");

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Resetting...`;

  try {
    const res = await fetch(`/api/server/${guildId}/reset-xp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep_roles: keepRoles }),
    });

    const data = await res.json();

    if (res.ok) {
      btn.innerHTML = `<i class="fas fa-check mr-2"></i>Done!`;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }, 2000);
      alert("Reset successful!\n" + (data.roles_removed + " Roles Removed."));
    } else {
      throw new Error(data.error || "Unknown Error");
    }
  } catch (e) {
    console.error("Reset failed:", e);
    btn.innerHTML = `<i class="fas fa-times mr-2"></i>Failed`;
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }, 3000);
    alert(`Reset Failed: ${e.message}`);
  }
}


// ===== Tabs\config_analytics.js =====
/**
 * @file Analytics Dashboard JavaScript
 * @description
 * Client-side logic for the server analytics dashboard:
 *  - Initializes the dashboard for a given guild
 *  - Fetches and displays current analytics metrics
 *  - Calculates and renders a composite "health score"
 *  - Renders engagement tiers and top contributors
 *  - Provides snapshot guidance and periodic auto-refresh
 */


(function () {
  if (!document.getElementById('view-config-analytics')) return;

  let currentGuildId = null;

  // ==================== INITIALIZATION ====================

  /**
   * Initialize the analytics dashboard for a specific guild.
   *
   * @param {string} guildId - The current Discord guild ID.
   */
  function initAnalytics(guildId) {
    currentGuildId = guildId;
    loadCurrentAnalytics();
  }

  // ==================== DATA LOADING ====================

  /**
   * Fetch current analytics data for the active guild and update the dashboard.
   */
  async function loadCurrentAnalytics() {
    try {
      const response = await fetch(`/api/analytics/${currentGuildId}/current`);

      if (!response.ok) {
        throw new Error("Failed to fetch analytics");
      }

      const data = await response.json();
      updateDashboard(data);
    } catch (error) {
      console.error("Error loading analytics:", error);
      showError("Failed to load analytics data");
    }
  }

  // ==================== DASHBOARD RENDERING ====================

  /**
   * Populate all dashboard sections with analytics data.
   *
   * @param {Object} data - Analytics payload from the backend.
   */
  function updateDashboard(data) {
    const healthScore = calculateHealthScore(data);
    updateHealthScore(healthScore);

    document.getElementById("messagesThisWeek").textContent = formatNumber(
      data.messages_this_week
    );
    document.getElementById("analyticsNewMembers").textContent = formatNumber(
      data.new_members_this_week
    );
    document.getElementById("activeMembers").textContent = formatNumber(
      data.active_members
    );
    document.getElementById("analyticsTotalMembers").textContent = formatNumber(
      data.total_members
    );
    document.getElementById("totalWeeklyXP").textContent = formatNumber(
      data.total_xp_weekly
    );
    document.getElementById("totalLifetimeXP").textContent = formatNumber(
      data.lifetime_xp
    );
    document.getElementById("avgLevel").textContent = data.avg_level.toFixed(1);

    updateEngagementTiers(data);
    updateTopContributors(data.top_contributors);
  }

  /**
   * Compute a composite health score from multiple engagement metrics.
   *
   * @param {Object} data - Analytics payload.
   * @returns {number} Calculated health score (0–100).
   */
  function calculateHealthScore(data) {
    const totalMembers = data.total_members || 1;
    const activeMembers = data.active_members || 0;
    const messages = data.messages_this_week || 0;

    const messagesPerMember = messages / totalMembers;
    const activityScore = Math.min(40, (messagesPerMember / 10) * 40);

    const engagementRate = (activeMembers / totalMembers) * 100;
    const engagementScore = Math.min(30, (engagementRate / 100) * 30);

    const growthScore = Math.min(
      20,
      (data.new_members_this_week / totalMembers) * 400
    );

    const featureCount = data.feature_count || 0;
    const featureScore = Math.min(10, (featureCount / 4) * 10);

    return Math.round(
      activityScore + engagementScore + growthScore + featureScore
    );
  }

  /**
   * Update health score visual elements (value, status text, and circle styling).
   *
   * @param {number} score - Calculated health score.
   */
  function updateHealthScore(score) {
    const scoreElement = document.getElementById("healthScoreValue");
    const statusElement = document.getElementById("healthStatus");
    const circleElement = document.getElementById("healthScoreCircle");

    animateValue(scoreElement, 0, score, 1000);
    circleElement.style.setProperty("--health-score", score);

    let status, color;
    if (score >= 80) {
      status = "🟢 Excellent Health";
      color = "var(--success-color)";
    } else if (score >= 60) {
      status = "🟡 Good Health";
      color = "var(--warning-color)";
    } else if (score >= 40) {
      status = "🟠 Needs Attention";
      color = "var(--warning-color)";
    } else {
      status = "🔴 Low Health";
      color = "var(--error-color)";
    }

    statusElement.textContent = status;
    statusElement.style.color = color;
  }

  /**
   * Update engagement tier counts and visual bars based on activity.
   *
   * @param {Object} data - Analytics payload.
   */
  function updateEngagementTiers(data) {
    const totalMembers = data.total_members || 1;
    const activeMembers = data.active_members || 0;

    const eliteCount = Math.round(activeMembers * 0.05);
    const activeCount = Math.round(activeMembers * 0.2);
    const casualCount = Math.round(activeMembers * 0.5);
    const inactiveCount = totalMembers - activeMembers;

    document.getElementById("eliteCount").textContent = formatNumber(eliteCount);
    document.getElementById("activeCount").textContent =
      formatNumber(activeCount);
    document.getElementById("casualCount").textContent =
      formatNumber(casualCount);
    document.getElementById("inactiveCount").textContent =
      formatNumber(inactiveCount);

    const elitePercent = (eliteCount / totalMembers) * 100;
    const activePercent = (activeCount / totalMembers) * 100;
    const casualPercent = (casualCount / totalMembers) * 100;
    const inactivePercent = (inactiveCount / totalMembers) * 100;

    setTimeout(() => {
      document.getElementById("eliteBar").style.width = `${elitePercent}%`;
      document.getElementById("activeBar").style.width = `${activePercent}%`;
      document.getElementById("casualBar").style.width = `${casualPercent}%`;
      document.getElementById("inactiveBar").style.width = `${inactivePercent}%`;
    }, 100);
  }

  /**
   * Render the list of top contributors with rank badges and XP values.
   *
   * @param {Array<Object>} contributors - Array of contributor objects.
   */
  function updateTopContributors(contributors) {
    const listElement = document.getElementById("contributorsList");

    if (!contributors || contributors.length === 0) {
      listElement.innerHTML =
        '<p class="insight-placeholder">No contributors data available</p>';
      return;
    }

    listElement.innerHTML = contributors
      .map((contributor, index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `top-${rank}` : "";

        return `
            <div class="contributor-item">
                <div class="contributor-rank ${rankClass}">#${rank}</div>
                <div class="contributor-info">
                    <div class="contributor-name">${escapeHtml(
          contributor.username
        )}</div>
                    <div class="contributor-stats">Level ${contributor.level
          }</div>
                </div>
                <div class="contributor-xp">${formatNumber(
            contributor.xp
          )} XP</div>
            </div>
        `;
      })
      .join("");
  }

  /**
   * Entry helper for templates: initializes the analytics dashboard
   * based on the current URL guild ID.
   */
  function loadAnalyticsDashboard() {
    const guildId = window.location.pathname.split("/").pop();
    initAnalytics(guildId);
  }

  // ==================== USER ACTIONS ====================

  /**
   * Open the analytics guide for the current guild in a new window.
   */
  function openAnalyticsGuide() {
    if (currentGuildId) {
      window.open(
        `/analytics/guide/${currentGuildId}`,
        "_blank",
        "width=1000,height=900"
      );
    }
  }

  /**
   * Display snapshot instructions and temporarily show a loading state
   * on the snapshot generation button.
   */
  async function generateSnapshot() {
    try {
      const button = event.target.closest("button");
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

      showSuccess(
        "To generate a snapshot, use the /a3-generate-snapshot command in your Discord server. The report will be sent to your DMs!"
      );

      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-camera"></i> Generate Snapshot';
      }, 3000);
    } catch (error) {
      console.error("Error generating snapshot:", error);
      showError("Failed to generate snapshot");
    }
  }

  // ==================== UTILITIES ====================

  /**
   * Format large numbers into compact notation (e.g., 1.2K, 3.4M).
   *
   * @param {number} num - Raw number.
   * @returns {string} Formatted number string.
   */
  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  /**
   * Animate a numeric value from `start` to `end` inside an element.
   *
   * @param {HTMLElement} element - Target element.
   * @param {number} start - Starting value.
   * @param {number} end - Ending value.
   * @param {number} duration - Animation duration in milliseconds.
   */
  function animateValue(element, start, end, duration) {
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const current = Math.floor(start + (end - start) * easeOutQuad(progress));
      element.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  /**
   * Easing function (ease-out quadratic) for smoother animations.
   *
   * @param {number} t - Progress value between 0 and 1.
   * @returns {number} Eased progress value.
   */
  function easeOutQuad(t) {
    return t * (2 - t);
  }

  /**
   * Escape HTML entities in a string to handle unsafe user content.
   *
   * @param {string} text - Raw text to escape.
   * @returns {string} Escaped HTML text.
   */
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show a success notification using the global notification system
   * when available, otherwise fall back to `alert`.
   *
   * @param {string} message - Success message text.
   */
  function showSuccess(message) {
    if (typeof showNotification === "function") {
      showNotification(message, "success");
    } else {
      alert(message);
    }
  }

  /**
   * Show an error notification using the global notification system
   * when available, otherwise fall back to `alert`.
   *
   * @param {string} message - Error message text.
   */
  function showError(message) {
    if (typeof showNotification === "function") {
      showNotification(message, "error");
    } else {
      alert(message);
    }
  }

  // ==================== AUTO REFRESH ====================

  /**
   * Periodically refresh analytics data every 5 minutes
   * while a guild is active in the dashboard.
   */
  setInterval(() => {
    if (currentGuildId) {
      loadCurrentAnalytics();
    }
  }, 5 * 60 * 1000);

  // Export global functions used in HTML
  window.initAnalytics = initAnalytics;
  window.loadAnalyticsDashboard = loadAnalyticsDashboard;
  window.openAnalyticsGuide = openAnalyticsGuide;
  window.generateSnapshot = generateSnapshot;

})();


// ===== Tabs\config_general.js =====
/**
 * @file Server Settings & Analytics Script
 * @description
 * Handles:
 *  - Saving general leveling settings (XP values, cooldowns) per guild
 *  - Saving and loading analytics settings (weekly report + timezones)
 *  - UI feedback for save operations (loading, success, error states)
 */

/**
 * Save general leveling settings for the current guild.
 * Reads values from the General Settings form and syncs them via API.
 */

(function () {
  if (!document.getElementById('view-config-general')) return;

  async function saveGeneralSettings() {
    const btn = document.getElementById("saveGeneralBtn");
    const originalContent = btn.innerHTML;

    // Collect form field references
    const xpMsg = document.getElementById("xpPerMessage");
    const xpImg = document.getElementById("xpPerImage");
    const xpVoice = document.getElementById("xpPerVoice");
    const xpLimit = document.getElementById("voiceXpLimit");
    const xpCooldown = document.getElementById("xpCooldown");

    // Basic numeric validation for required XP-related fields
    let isValid = true;
    [xpMsg, xpImg, xpVoice, xpLimit].forEach((input) => {
      if (input.value < 0 || input.value === "") {
        input.classList.add("input-error");
        isValid = false;
        setTimeout(() => input.classList.remove("input-error"), 500);
      }
    });

    if (!isValid) return;

    // Enter loading state
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';

    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/server/${guildId}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          xp_per_message: parseInt(xpMsg.value),
          xp_per_image: parseInt(xpImg.value),
          xp_per_minute_in_voice: parseInt(xpVoice.value),
          voice_xp_limit: parseInt(xpLimit.value),
          xp_cooldown: parseInt(xpCooldown.value),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success state styling and reset
        btn.innerHTML = '<i class="fas fa-check mr-2"></i> Saved!';
        btn.style.background = "linear-gradient(135deg, #10b981, #059669)";

        setTimeout(() => {
          btn.innerHTML = originalContent;
          btn.style.background = "";
          btn.disabled = false;
        }, 2000);
      } else {
        throw new Error(data.error || "Failed to save");
      }
    } catch (error) {
      console.error("Save Error:", error);
      btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i> Error';
      btn.style.background = "linear-gradient(135deg, #ef4444, #dc2626)";

      setTimeout(() => {
        btn.innerHTML = originalContent;
        btn.style.background = "";
        btn.disabled = false;
      }, 2000);
    }
  }

  /**
   * Save analytics configuration (weekly report and timezones) for the current guild.
   * Uses the analytics settings form and posts to the analytics API endpoint.
   */
  async function saveAnalyticsSettings() {
    const btn = document.querySelector(
      'button[onclick="saveAnalyticsSettings()"]'
    );
    const originalHtml = btn.innerHTML;

    // Read analytics settings values
    const weeklyReportEnabled = document.getElementById(
      "weeklyReportEnabled"
    ).checked;
    const analyticsTimezone = document.getElementById("analyticsTimezone").value;
    const resetTimezone = document.getElementById("resetTimezone").value;

    // Enter loading state
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';

    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/analytics/${guildId}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          weekly_report_enabled: weeklyReportEnabled,
          analytics_timezone: analyticsTimezone,
          weekly_reset_timezone: resetTimezone,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success state styling and reset
        btn.innerHTML = '<i class="fas fa-check mr-2"></i> Saved!';
        btn.classList.remove("btn-primary");
        btn.classList.add("bg-green-600", "hover:bg-green-500", "text-white");

        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove(
            "bg-green-600",
            "hover:bg-green-500",
            "text-white"
          );
          btn.classList.add("btn-primary");
          btn.disabled = false;
        }, 2000);
      } else {
        throw new Error(data.error || "Failed to save settings");
      }
    } catch (error) {
      console.error("Save Error:", error);
      btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i> Error';
      btn.classList.add("bg-red-600", "text-white");

      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.classList.remove("bg-red-600", "text-white");
        btn.disabled = false;
      }, 2000);
    }
  }

  /**
   * Load analytics settings for the current guild and populate the UI form.
   * Called once when the page is ready.
   */
  async function loadAnalyticsSettings() {
    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/analytics/${guildId}/settings`);
      const data = await response.json();

      if (response.ok) {
        const analyticsTimezoneSelect =
          document.getElementById("analyticsTimezone");
        const resetTimezoneSelect = document.getElementById("resetTimezone");
        const weeklyReportCheckbox = document.getElementById(
          "weeklyReportEnabled"
        );

        if (analyticsTimezoneSelect && data.analytics_timezone) {
          analyticsTimezoneSelect.value = data.analytics_timezone;
        }

        if (resetTimezoneSelect && data.weekly_reset_timezone) {
          resetTimezoneSelect.value = data.weekly_reset_timezone;
        }

        if (weeklyReportCheckbox && data.weekly_report_enabled !== undefined) {
          weeklyReportCheckbox.checked = data.weekly_report_enabled;
        }

        console.log("✅ Analytics settings loaded successfully");
      }
    } catch (error) {
      console.error("Error loading analytics settings:", error);
    }
  }

  /**
   * Auto-load analytics settings when the document is ready.
   */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAnalyticsSettings);
  } else {
    loadAnalyticsSettings();
  }

  // Export global functions
  window.saveGeneralSettings = saveGeneralSettings;
  window.saveAnalyticsSettings = saveAnalyticsSettings;

})();


// ===== Tabs\config_level.js =====
/**
 * @file Leveling Sub-Tab Switcher
 * @description
 * Handles switching between leveling sub-tabs (Rewards, Leaderboard, Settings)
 * in the server configuration UI by:
 *  - Hiding all sub-tab content containers
 *  - Showing the selected sub-tab content
 *  - Updating active state on sub-tab buttons
 */

/**
 * Switch between leveling sub-tabs (Rewards, Leaderboard, Settings).
 *
 * @param {string} tabName - Sub-tab identifier suffix (e.g. "rewards", "leaderboard", "settings").
 * @param {HTMLElement} btn - The button element that triggered the switch.
 */
(function () {
  if (!document.getElementById('view-config-level')) return;

  function switchLevelSubTab(tabName, btn) {
    // Hide all sub-tab content containers
    const contents = document.querySelectorAll(".level-sub-content");
    contents.forEach((content) => {
      content.classList.add("hidden");
    });

    // Remove active state from all sub-tab buttons
    const buttons = document.querySelectorAll(".sub-tab-btn");
    buttons.forEach((b) => {
      b.classList.remove("active");
    });

    // Show the selected sub-tab content
    document.getElementById(`level-sub-${tabName}`).classList.remove("hidden");

    btn.classList.add("active");
  }

  window.switchLevelSubTab = switchLevelSubTab;

})();


// ===== Tabs\config_reminder.js =====
/**
 * @file Smart Reminders Tab Script
 * @description
 * Manages the Smart Reminders configuration UI for a guild:
 *  - Initializes Select2 dropdowns (timezone, channel, role)
 *  - Loads and renders existing reminders from the backend
 *  - Creates, updates, pauses/resumes, and deletes reminders
 *  - Supports custom intervals and date-only vs datetime scheduling
 */

let reminderInit = false;
let currentReminders = [];
let currentEditingId = null;
let flatpickrInstance = null;

// ==================== TAB INITIALIZATION ====================

/**
 * Initialize the Reminder tab:
 *  - Configures Select2 widgets
 *  - Loads timezones, Discord metadata, and existing reminders
 */
async function initReminderTab() {
  if (reminderInit) return;

  $("#reminderTimezone").select2({
    width: "100%",
    placeholder: "Select Timezone",
  });

  $("#reminderChannel").select2({
    width: "100%",
    placeholder: "Select Channel",
  });

  $("#reminderRole").select2({
    width: "100%",
    placeholder: "Select Role (Optional)",
    allowClear: true,
  });

  const guildId = getGuildIdFromUrl();
  await Promise.all([
    loadReminderTimezones(),
    loadReminderData(guildId),
    loadReminderDiscordData(guildId),
  ]);
  reminderInit = true;
}

// ==================== FORM TOGGLES ====================

/**
 * Initialize Flatpickr on the datetime input.
 */
function initFlatpickr() {
  if (flatpickrInstance) return;

  flatpickrInstance = flatpickr("#reminderDateTime", {
    enableTime: true,
    dateFormat: "Y-m-d\\TH:i",
    altInput: true,
    altFormat: "F j, Y at h:i K",
    time_24hr: false,
    static: true,
    onReady: function (selectedDates, dateStr, instance) {
      // Add "OK" button to the calendar
      const btn = document.createElement("button");
      btn.className = "flatpickr-ok-btn w-full bg-indigo-600 text-white py-2 text-sm font-bold mt-2 hover:bg-indigo-500 transition-colors";
      btn.innerHTML = '<i class="fas fa-check mr-1"></i> DONE';
      btn.type = "button";
      btn.onclick = function () {
        instance.close();
      };
      instance.calendarContainer.appendChild(btn);
    },
  });
}

// ==================== FORM TOGGLES ====================

/**
 * Toggle between `date` and `datetime-local` input types
 * based on the "date only" checkbox.
 */
function toggleDateInputType() {
  const isDateOnly = document.getElementById("reminderDateOnly").checked;

  if (flatpickrInstance) {
    flatpickrInstance.set("enableTime", !isDateOnly);
    flatpickrInstance.set("dateFormat", isDateOnly ? "Y-m-d\\T00:00" : "Y-m-d\\TH:i");
    flatpickrInstance.set("altFormat", isDateOnly ? "F j, Y" : "F j, Y at h:i K");
  }
}

/**
 * Toggle custom interval input visibility when "Custom" is selected.
 */
function toggleCustomIntervalInput() {
  const interval = document.getElementById("reminderInterval").value;
  const customGroup = document.getElementById("customIntervalGroup");
  if (interval === "custom") {
    customGroup.classList.remove("hidden");
  } else {
    customGroup.classList.add("hidden");
  }
}

// ==================== DATA LOADERS ====================

/**
 * Load available timezones from the API and populate the timezone select.
 */
async function loadReminderTimezones() {
  try {
    const res = await fetch("/api/timezones");
    const data = await res.json();
    const sel = document.getElementById("reminderTimezone");

    sel.innerHTML =
      '<option value="" disabled selected>Select timezone...</option>';

    data.timezones.forEach((tz) => {
      const opt = document.createElement("option");
      opt.value = tz;
      opt.text = tz;
      if (tz === "UTC") opt.selected = true;
      sel.appendChild(opt);
    });

    $("#reminderTimezone").trigger("change");
  } catch (e) {
    console.error("Error loading timezones:", e);
  }
}

/**
 * Load Discord channels and roles for the given guild.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadReminderDiscordData(guildId) {
  try {
    const res = await fetch(`/api/server/${guildId}/discord-data`);
    const data = await res.json();

    const channelSel = document.getElementById("reminderChannel");
    // Use category-grouped dropdown
    if (typeof window.populateChannelDropdownWithCategories === "function") {
      window.populateChannelDropdownWithCategories(channelSel, data.channels, {
        channelTypes: [0, 5], // Text and announcement channels
        placeholder: "Select channel...",
        includeHash: true,
      });
    } else {
      console.error("Critical: populateChannelDropdownWithCategories utility not found!");
    }

    const roleSel = document.getElementById("reminderRole");
    roleSel.innerHTML = '<option value="">No role mention</option>';

    data.roles.forEach((role) => {
      const opt = document.createElement("option");
      opt.value = role.id;
      opt.text = `@ ${role.name}`;
      roleSel.appendChild(opt);
    });

    $("#reminderChannel").trigger("change");
    $("#reminderRole").trigger("change");
  } catch (e) {
    console.error("Error loading Discord data:", e);
  }
}

/**
 * Load all reminders for the guild and render them into the list.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadReminderData(guildId) {
  const container = document.getElementById("reminderList");
  try {
    const res = await fetch(`/api/server/${guildId}/reminders`);
    const data = await res.json();

    currentReminders = data.reminders || [];
    container.innerHTML = "";

    if (currentReminders.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-slate-500">
          <i class="fas fa-bell-slash text-4xl mb-3 opacity-30"></i>
          <p>No reminders configured yet.</p>
          <p class="text-sm">Click "New Reminder" to create your first reminder!</p>
        </div>
      `;
      return;
    }

    currentReminders.forEach((reminder, index) => {
      const div = document.createElement("div");
      div.className = "rem-card";

      const nextRun = new Date(reminder.next_run);
      const timeString = nextRun.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

      const statusClass = reminder.status === "active" ? "active" : "paused";
      const statusText =
        reminder.status.charAt(0).toUpperCase() + reminder.status.slice(1);

      const intervalMap = {
        once: "One-time",
        "1d": "Daily",
        "7d": "Weekly",
        "30d": "Monthly",
        "1h": "Hourly",
        "6h": "Every 6h",
        "12h": "Every 12h",
      };

      let intervalDisplay = intervalMap[reminder.interval];
      if (!intervalDisplay) {
        if (reminder.interval.match(/^\d+[yMwdhm]$/)) {
          intervalDisplay = `Every ${reminder.interval}`;
        } else {
          intervalDisplay = reminder.interval;
        }
      }

      div.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="rem-icon">
            <i class="fas fa-bell"></i>
          </div>
          <div class="flex-grow min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h4 class="font-bold truncate" title="${escapeHtml(
        reminder.message
      )}">${escapeHtml(reminder.message.substring(0, 50))}${reminder.message.length > 50 ? "..." : ""
        }</h4>
              <span class="rem-status ${statusClass}">${statusText}</span>
            </div>
            <p class="text-xs text-slate-500 truncate">Next: ${timeString}</p>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-400">${reminder.timezone}</div>
            <span class="rem-interval">${intervalDisplay}</span>
          </div>
          <div class="flex gap-2 ml-2">
            <button class="text-slate-500 hover:text-blue-400 transition-colors" 
                    title="Edit"
                    onclick="editReminder(${index})">
              <i class="fas fa-edit"></i>
            </button>
            <button class="text-slate-500 hover:text-yellow-400 transition-colors" 
                    title="${reminder.status === "active" ? "Pause" : "Resume"}"
                    onclick="toggleReminderStatus('${reminder.reminder_id}')">
              <i class="fas fa-${reminder.status === "active" ? "pause" : "play"
        }"></i>
            </button>
            <button class="text-slate-500 hover:text-red-400 transition-colors" 
                    title="Delete"
                    onclick="deleteReminder('${reminder.reminder_id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
      container.appendChild(div);
    });
  } catch (e) {
    console.error("Error loading reminders:", e);
    container.innerHTML = `
      <div class="text-center py-8 text-red-400">
        <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
        <p>Error loading reminders. Please try again.</p>
      </div>
    `;
  }
}

/**
 * Open edit mode for a reminder by index.
 *
 * @param {number} index - Index in `currentReminders`
 */
function editReminder(index) {
  openReminderModal(index);
}

// ==================== CREATE / UPDATE REMINDERS ====================

/**
 * Create or update a reminder using the current form values.
 * Automatically handles custom interval parsing and date-only logic.
 */
async function saveReminder() {
  const message = document.getElementById("reminderMessage").value.trim();
  const channelId = document.getElementById("reminderChannel").value;
  const roleId = document.getElementById("reminderRole").value || null;
  const timezone = $("#reminderTimezone").val();
  let startTime = document.getElementById("reminderDateTime").value; // Flatpickr updates this hidden input
  let interval = document.getElementById("reminderInterval").value;

  const isDateOnly = document.getElementById("reminderDateOnly").checked;
  // With Flatpickr's dateFormat, this explicit check might be redundant if dateFormat is set correctly,
  // but keeping it for robustness if the date-only format doesn't include time.
  if (isDateOnly && startTime && !startTime.includes("T")) {
    startTime += "T00:00";
  }

  if (interval === "custom") {
    const customVal = document
      .getElementById("reminderCustomInterval")
      .value.trim();
    if (!customVal) {
      alert("Please enter a custom interval (e.g. 45m, 3d)");
      return;
    }
    const validPattern = /^(\s*\d+[yMwdhm]\s*)+$/;
    if (!validPattern.test(customVal)) {
      alert(
        "Invalid custom interval format. Use numbers followed by unit (y, M, w, d, h, m). Example: '1w 2d' or '30m'. Note: M=Month, m=Minute."
      );
      return;
    }
    interval = customVal;
  }

  if (!message || !channelId || !timezone || !startTime) {
    alert(
      "Please fill in all required fields (Message, Channel, Timezone, Date/Time)"
    );
    return;
  }

  const payload = {
    reminder_id: currentEditingId,
    message: message,
    channel_id: channelId,
    role_id: roleId,
    timezone: timezone,
    start_time: startTime,
    interval: interval,
  };

  const guildId = getGuildIdFromUrl();

  try {
    const saveBtn = document.getElementById("btnSaveReminder");
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    saveBtn.disabled = true;

    const res = await fetch(`/api/server/${guildId}/reminders/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      closeReminderModal();
      await loadReminderData(guildId);
      showNotification(
        data.action === "updated" ? "Reminder updated!" : "Reminder created!",
        "success"
      );
    } else {
      const error = await res.json();
      alert(`Failed to save reminder: ${error.error || "Unknown error"}`);
    }

    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  } catch (e) {
    console.error("Error saving reminder:", e);
    alert("Failed to save reminder. Please try again.");
    document.getElementById("btnSaveReminder").innerHTML =
      '<i class="fas fa-save mr-2"></i>Save Reminder';
    document.getElementById("btnSaveReminder").disabled = false;
  }
}

// ==================== STATUS & DELETE ACTIONS ====================

/**
 * Toggle the active/paused status of a reminder.
 *
 * @param {string} reminderId - Reminder identifier
 */
async function toggleReminderStatus(reminderId) {
  const guildId = getGuildIdFromUrl();

  try {
    const res = await fetch(
      `/api/server/${guildId}/reminders/${reminderId}/toggle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (res.ok) {
      await loadReminderData(guildId);
      showNotification("Reminder status updated", "success");
    } else {
      alert("Failed to update reminder status");
    }
  } catch (e) {
    console.error("Error toggling reminder:", e);
    alert("Failed to update reminder status");
  }
}

/**
 * Delete a reminder after user confirmation.
 *
 * @param {string} reminderId - Reminder identifier
 */
async function deleteReminder(reminderId) {
  if (!confirm("Are you sure you want to delete this reminder?")) {
    return;
  }

  const guildId = getGuildIdFromUrl();

  try {
    const res = await fetch(`/api/server/${guildId}/reminders/${reminderId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await loadReminderData(guildId);
      showNotification("Reminder deleted successfully", "success");
    } else {
      alert("Failed to delete reminder");
    }
  } catch (e) {
    console.error("Error deleting reminder:", e);
    alert("Failed to delete reminder");
  }
}

// ==================== MODAL HANDLING ====================

/**
 * Open the reminder modal in either create or edit mode.
 *
 * @param {?number} reminderIdx - Index in `currentReminders` (null for new)
 */
function openReminderModal(reminderIdx = null) {
  if (!flatpickrInstance) initFlatpickr();

  const isEdit = reminderIdx !== null && typeof reminderIdx === "number";

  const modal = document.getElementById("reminderModal");
  const titleEl = document.getElementById("reminderModalTitle");
  const saveBtn = document.getElementById("btnSaveReminder");

  currentEditingId = null;
  document.getElementById("reminderMessage").value = "";
  $("#reminderChannel").val("").trigger("change");
  $("#reminderRole").val("").trigger("change");

  // Default to +1 hour
  const now = new Date();
  now.setHours(now.getHours() + 1);
  now.setMinutes(0);
  flatpickrInstance.setDate(now);

  document.getElementById("reminderDateOnly").checked = false;
  toggleDateInputType();

  document.getElementById("reminderInterval").value = "once";
  toggleCustomIntervalInput();
  document.getElementById("reminderCustomInterval").value = "";


  if (isEdit) {
    if (titleEl) titleEl.innerText = "Edit Reminder";
    if (saveBtn)
      saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Update Reminder';

    const r = currentReminders[reminderIdx];
    currentEditingId = r.reminder_id;

    document.getElementById("reminderMessage").value = r.message;
    $("#reminderTimezone").val(r.timezone).trigger("change");
    $("#reminderChannel").val(r.channel_id).trigger("change");
    if (r.role_id) $("#reminderRole").val(r.role_id).trigger("change");

    if (r.next_run) {
      flatpickrInstance.setDate(r.next_run);
    }

    const stdIntervals = ["once", "1d", "7d", "30d", "1h", "6h", "12h"];
    if (stdIntervals.includes(r.interval)) {
      $("#reminderInterval").val(r.interval).trigger("change");
    } else {
      $("#reminderInterval").val("custom").trigger("change");
      document.getElementById("reminderCustomInterval").value = r.interval;
      toggleCustomIntervalInput();
    }
  } else {
    if (titleEl) titleEl.innerText = "New Reminder";
    if (saveBtn)
      saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Reminder';

    $("#reminderTimezone").val("UTC").trigger("change");
  }

  modal.classList.remove("hidden");

  if (!reminderInit) initReminderTab();
}

/**
 * Close the reminder modal.
 */
function closeReminderModal() {
  document.getElementById("reminderModal").classList.add("hidden");
}

// ==================== UTILITIES ====================

/**
 * Escape HTML entities in a string to prevent injection in titles and content.
 *
 * @param {string} text - Raw text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Show a notification using the global toast system if available,
 * otherwise log to the console as a fallback.
 *
 * @param {string} message - Notification message
 * @param {string} [type="info"] - Notification type (e.g., "success", "error")
 */
function showNotification(message, type = "info") {
  if (typeof window.showToast === "function") {
    window.showToast(message, type);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

// ==================== EVENT BINDINGS ====================

/**
 * Wire tab and button listeners when the DOM is ready.
 */
document.addEventListener("DOMContentLoaded", function () {
  const reminderTabBtn = document.getElementById("btn-tab-reminder");
  if (reminderTabBtn) {
    reminderTabBtn.addEventListener("click", initReminderTab);
  }

  const addReminderBtn = document.getElementById("addReminderBtn");
  if (addReminderBtn) {
    addReminderBtn.addEventListener("click", openReminderModal);
  }
});


// ===== Tabs\config_restriction.js =====
/**
 * @file Channel Restrictions Configuration Script
 * @description
 * Manages per-channel content restriction rules:
 *  - Initializes restriction tab, Select2 dropdowns, and mutual exclusivity logic
 *  - Loads, renders, and updates channel restriction cards
 *  - Supports legacy (preset-based) and granular (bitwise flags) modes
 *  - Handles create/edit/delete of restrictions via backend API
 *  - Provides advanced settings toggle for power users
 */

let resInit = false;

/**
 * Extract the guild ID from the current URL.
 * Supports `/server/{guildId}` or falls back to the last path segment.
 */
function getGuildIdFromUrl() {
  const match = window.location.href.match(/\/server\/(\d+)/);
  return match ? match[1] : window.location.pathname.split("/").pop();
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the restriction tab.
 * Sets up Select2, mutual exclusivity, button handlers, and loads initial data.
 *
 * @param {boolean} [force=false] - Force re-initialization and data reload
 */
/**
 * Initialize the restriction tab.
 * Sets up Select2, mutual exclusivity, button handlers, and loads initial data.
 *
 * @param {boolean} [force=false] - Force re-initialization and data reload
 */
window.initRestrictionTab = async function (force = false) {
  if (resInit && !force) return;
  const guildId = getGuildIdFromUrl();

  if (!resInit) {
    $("#resImmuneRoles").select2({
      dropdownParent: $("#resModal"),
      width: "100%",
      placeholder: "Select roles...",
      theme: "default",
      templateResult: function (role) {
        if (!role.id) {
          return role.text;
        }
        const $result = $(
          '<span style="color: #e2e8f0;">' + role.text + "</span>"
        );
        return $result;
      },
      templateSelection: function (role) {
        return $('<span style="color: #e2e8f0;">' + role.text + "</span>");
      },
    });

    setupMutualExclusivity();

    const addBtn = document.getElementById("addRestrictionBtn");
    if (addBtn) {
      addBtn.removeEventListener("click", openResModal);
      addBtn.addEventListener("click", openResModal);
    }

    resInit = true;
  }

  await Promise.all([loadRestrictions(guildId), loadResDiscordData(guildId)]);
};

// ==================== DATA FETCHING & RENDERING ====================

/**
 * Load all restrictions for the current guild and render cards.
 *
 * @param {string} guildId - Current guild ID
 */
window.loadRestrictions = async function (guildId) {
  const container = document.getElementById("restrictionsList");
  if (!container) {
    console.warn("restrictionsList container not found - potentially on wrong tab");
    return;
  }
  try {
    const res = await fetch(
      `/api/server/${guildId}/channel-restrictions-v2/data`
    );
    const data = await res.json();

    container.innerHTML = "";
    if (data.restrictions.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">No active restrictions.</div>`;
      return;
    }

    data.restrictions.forEach((r) => {
      let badgeClass = "badge-block";
      let icon = "fas fa-ban";
      if (r.restriction_type === "media_only") {
        badgeClass = "badge-media";
        icon = "fas fa-image";
      }
      if (r.restriction_type === "text_only") {
        badgeClass = "badge-text";
        icon = "fas fa-comment-alt";
      }

      const div = document.createElement("div");
      div.className = "res-card";
      div.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg text-slate-500">
                        <i class="${icon}"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-bold text-lg">#${r.channel_name
        }</h4>
                            <span class="res-badge ${badgeClass}">${r.restriction_type.replace(
          /_/g,
          " "
        )}</span>
                        </div>
                        <div class="text-xs text-slate-500 mt-1">
                            ${r.redirect_channel_name
          ? `Redirects to: <span class="font-bold">#${r.redirect_channel_name}</span>`
          : "No Redirect"
        }
                            <span class="mx-1">•</span>
                            ${r.immune_roles.length} Immune Roles
                        </div>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="editRes('${r.id
        }')" class="px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-indigo-500 hover:text-white transition-colors text-sm font-bold">Edit</button>
                    <button onclick="deleteRes('${r.id
        }')" class="px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-red-500 hover:text-white transition-colors text-sm"><i class="fas fa-trash"></i></button>
                </div>
            `;
      div.dataset.json = JSON.stringify(r);
      container.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="text-red-500">Error loading restrictions.</div>`;
  }
};

/**
 * Load Discord channels and roles for restriction configuration.
 *
 * @param {string} guildId - Current guild ID
 */
window.loadResDiscordData = async function (guildId) {
  const res = await fetch(`/api/server/${guildId}/discord-data`);
  const data = await res.json();

  const chSelect = document.getElementById("resTargetChannel");
  const redSelect = document.getElementById("resRedirectChannel");

  // Use category-grouped dropdown
  if (typeof window.populateChannelDropdownWithCategories === "function") {
    window.populateChannelDropdownWithCategories(chSelect, data.channels, {
      channelTypes: [0, 5], // Text and announcement channels
      placeholder: "Select Channel",
      includeHash: true,
    });

    // For redirect channel, we need to add "None" option first
    redSelect.innerHTML = '<option value="" selected>None</option>';
    const tempDiv = document.createElement("div");
    window.populateChannelDropdownWithCategories(tempDiv, data.channels, {
      channelTypes: [0, 5],
      placeholder: "Select Channel",
      includeHash: true,
    });
    // Copy all options except the placeholder
    Array.from(tempDiv.querySelectorAll("option")).forEach((opt, idx) => {
      if (idx > 0) {
        // Skip placeholder
        redSelect.appendChild(opt.cloneNode(true));
      }
    });
  } else {
    console.error("Critical: populateChannelDropdownWithCategories utility not found!");
    // Fallback logic removed to enforce fix
  }

  $("#resTargetChannel").select2({
    dropdownParent: $("#resModal"),
    width: "100%",
    placeholder: "Select Channel",
  });

  $("#resRedirectChannel").select2({
    dropdownParent: $("#resModal"),
    width: "100%",
    placeholder: "None",
    allowClear: true,
  });

  const roleSelect = document.getElementById("resImmuneRoles");
  roleSelect.innerHTML = "";
  data.roles.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.text = r.name;
    roleSelect.appendChild(opt);
  });
}

// ==================== FLAG DEFINITIONS & MODES ====================

/**
 * Bitmask flags for granular content control.
 */
const FLAGS = {
  TEXT: 1,
  DISCORD: 2,
  MEDIA_LINK: 4,
  ALL_LINKS: 8,
  MEDIA_FILES: 16,
  FILE: 32,
  EMBED: 64,
  SOCIAL_MEDIA: 128,
};

/**
 * Switch between legacy (preset) and granular (bitwise) modes.
 * Updates visibility and initializes defaults for granular mode.
 */
window.switchRestrictionMode = function switchRestrictionMode() {
  const mode = document.getElementById("resModeSelect").value;
  const legacyOptions = document.getElementById("legacyModeOptions");
  const granularOptions = document.getElementById("granularModeOptions");

  if (mode === "legacy") {
    legacyOptions.classList.remove("hidden");
    granularOptions.classList.add("hidden");
    applyResPreset();
  } else {
    legacyOptions.classList.add("hidden");
    granularOptions.classList.remove("hidden");
    const ALL_FLAGS =
      FLAGS.TEXT +
      FLAGS.DISCORD +
      FLAGS.MEDIA_LINK +
      FLAGS.ALL_LINKS +
      FLAGS.MEDIA_FILES +
      FLAGS.FILE +
      FLAGS.EMBED +
      FLAGS.SOCIAL_MEDIA;

    document.querySelectorAll(".allow-flag").forEach((cb) => {
      const bit = parseInt(cb.dataset.bit);
      const shouldAllow = (ALL_FLAGS & bit) === bit;
      cb.checked = shouldAllow;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = !shouldAllow;
    });
  }
};

/**
 * Apply legacy mode preset logic to content flags,
 * matching backend behavior and enforcing mutual exclusivity.
 */
window.applyResPreset = function applyResPreset() {
  const type = document.getElementById("resTypeSelect").value;
  let allowed = 0;
  let blocked = 0;

  const ALL_FLAGS =
    FLAGS.TEXT +
    FLAGS.DISCORD +
    FLAGS.MEDIA_LINK +
    FLAGS.ALL_LINKS +
    FLAGS.MEDIA_FILES +
    FLAGS.FILE +
    FLAGS.EMBED +
    FLAGS.SOCIAL_MEDIA;

  if (type === "block_invites") {
    allowed = ALL_FLAGS - FLAGS.DISCORD;
    blocked = FLAGS.DISCORD;
  } else if (type === "block_all_links") {
    allowed = FLAGS.TEXT + FLAGS.MEDIA_FILES + FLAGS.FILE + FLAGS.EMBED;
    blocked =
      FLAGS.DISCORD + FLAGS.MEDIA_LINK + FLAGS.ALL_LINKS + FLAGS.SOCIAL_MEDIA;
  } else if (type === "media_only") {
    allowed = ALL_FLAGS - FLAGS.TEXT;
    blocked = FLAGS.TEXT;
  } else if (type === "text_only") {
    allowed = FLAGS.TEXT + FLAGS.ALL_LINKS;
    blocked = ALL_FLAGS - (FLAGS.TEXT + FLAGS.ALL_LINKS);
  } else {
    allowed = ALL_FLAGS;
    blocked = 0;
  }

  document.querySelectorAll(".allow-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const isAllowed = (allowed & bit) === bit;
    const isBlocked = (blocked & bit) === bit;

    if (isAllowed) {
      cb.checked = true;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = false;
    } else if (isBlocked) {
      cb.checked = false;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = true;
    } else {
      cb.checked = true;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = false;
    }
  });

  document.querySelectorAll(".block-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const allowCb = document.querySelector(`.allow-flag[data-bit="${bit}"]`);
    if (allowCb && allowCb.checked) {
      cb.checked = false;
    } else if (!cb.checked && (!allowCb || !allowCb.checked)) {
      if (allowCb) allowCb.checked = true;
      cb.checked = false;
    }
  });
};

/**
 * Ensure mutual exclusivity between "allow" and "block" checkboxes per flag.
 * Guarantees exactly one checked state per content type.
 */
function setupMutualExclusivity() {
  document.querySelectorAll(".allow-flag").forEach((cb) => {
    cb.addEventListener("change", function () {
      const bit = parseInt(this.dataset.bit);
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);

      if (this.checked) {
        if (blockCb) {
          blockCb.checked = false;
        }
      } else {
        if (blockCb && !blockCb.checked) {
          blockCb.checked = true;
        }
      }
    });
  });

  document.querySelectorAll(".block-flag").forEach((cb) => {
    cb.addEventListener("change", function () {
      const bit = parseInt(this.dataset.bit);
      const allowCb = document.querySelector(`.allow-flag[data-bit="${bit}"]`);

      if (this.checked) {
        if (allowCb) {
          allowCb.checked = false;
        }
      } else {
        if (allowCb && !allowCb.checked) {
          allowCb.checked = true;
        }
      }
    });
  });
}

// ==================== SAVE / UPDATE LOGIC ====================

/**
 * Persist a restriction rule (create or update) to the backend.
 * Uses legacy presets or granular flags based on current mode.
 */
window.saveRestriction = async function () {
  const btn = document.getElementById("btnSaveRes");
  const id = document.getElementById("editResId").value;
  const channelId = document.getElementById("resTargetChannel").value;
  const channelName = document
    .getElementById("resTargetChannel")
    .options[
    document.getElementById("resTargetChannel").selectedIndex
  ]?.text.replace("# ", "");
  const mode = document.getElementById("resModeSelect").value;
  const resType =
    mode === "legacy"
      ? document.getElementById("resTypeSelect").value
      : "custom";
  const redirectId = document.getElementById("resRedirectChannel").value;
  const redirectName = document
    .getElementById("resRedirectChannel")
    .options[
    document.getElementById("resRedirectChannel").selectedIndex
  ]?.text.replace("# ", "");
  const immuneRoles = $("#resImmuneRoles").val();

  let allowed = 0;
  let blocked = 0;

  if (mode === "granular") {
    document
      .querySelectorAll(".allow-flag:checked")
      .forEach((cb) => (allowed += parseInt(cb.dataset.bit)));
    document
      .querySelectorAll(".block-flag:checked")
      .forEach((cb) => (blocked += parseInt(cb.dataset.bit)));
  } else {
    const type = document.getElementById("resTypeSelect").value;
    const ALL_FLAGS =
      FLAGS.TEXT +
      FLAGS.DISCORD +
      FLAGS.MEDIA_LINK +
      FLAGS.ALL_LINKS +
      FLAGS.MEDIA_FILES +
      FLAGS.FILE +
      FLAGS.EMBED +
      FLAGS.SOCIAL_MEDIA;

    if (type === "block_invites") {
      allowed = ALL_FLAGS - FLAGS.DISCORD;
      blocked = FLAGS.DISCORD;
    } else if (type === "block_all_links") {
      allowed = FLAGS.TEXT + FLAGS.MEDIA_FILES + FLAGS.FILE + FLAGS.EMBED;
      blocked =
        FLAGS.DISCORD + FLAGS.MEDIA_LINK + FLAGS.ALL_LINKS + FLAGS.SOCIAL_MEDIA;
    } else if (type === "media_only") {
      allowed = ALL_FLAGS - FLAGS.TEXT;
      blocked = FLAGS.TEXT;
    } else if (type === "text_only") {
      allowed = FLAGS.TEXT + FLAGS.ALL_LINKS;
      blocked = ALL_FLAGS - (FLAGS.TEXT + FLAGS.ALL_LINKS);
    }
  }

  if (!channelId) {
    alert("Please select a target channel.");
    return;
  }

  btn.innerText = "Saving...";
  btn.disabled = true;

  const guildId = getGuildIdFromUrl();
  const method = id ? "PUT" : "POST";

  try {
    const res = await fetch(`/api/server/${guildId}/channel-restrictions-v2`, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: id,
        channel_id: channelId,
        channel_name: channelName,
        restriction_type: mode === "legacy" ? resType : "custom",
        restriction_mode: mode,
        allowed_content_types: allowed,
        blocked_content_types: blocked,
        redirect_channel_id: redirectId,
        redirect_channel_name: redirectId ? redirectName : null,
        immune_roles: immuneRoles,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      closeResModal();
      loadRestrictions(guildId);
    } else {
      alert(data.error || "Failed to save.");
    }
  } catch (e) {
    console.error(e);
    alert("Error saving.");
  } finally {
    btn.innerText = "Save Rule";
    btn.disabled = false;
  }
};

// ==================== MODAL ACTIONS ====================

/**
 * Open the restriction modal in add mode, initializing defaults if needed.
 */
window.openResModal = async function () {
  if (!resInit) {
    await initRestrictionTab();
  }

  document.getElementById("resModal").classList.remove("hidden");
  const editId = document.getElementById("editResId").value;

  if (!editId) {
    document.getElementById("editResId").value = "";
    document.getElementById("resModalTitle").innerText = "Add Restriction";
    document.getElementById("resTargetChannel").disabled = false;

    document.getElementById("resModeSelect").value = "legacy";
    switchRestrictionMode();
    $("#resTargetChannel").val("").trigger("change");
    $("#resRedirectChannel").val("").trigger("change");
  }

  $("#resImmuneRoles").val(null).trigger("change");
};

/**
 * Close the restriction modal.
 */
window.closeResModal = function () {
  document.getElementById("resModal").classList.add("hidden");
};

/**
 * Load an existing restriction into the modal for editing.
 *
 * @param {string|number} id - Restriction ID to edit
 */
window.editRes = async function (id) {
  const card = Array.from(document.querySelectorAll(".res-card")).find(
    (d) => JSON.parse(d.dataset.json).id == id
  );
  if (!card) return;
  const data = JSON.parse(card.dataset.json);

  await openResModal();
  document.getElementById("editResId").value = data.id;
  document.getElementById("resModalTitle").innerText = "Edit Restriction";

  $("#resTargetChannel").val(data.channel_id).trigger("change");
  document.getElementById("resTargetChannel").disabled = true;
  $("#resRedirectChannel")
    .val(data.redirect_channel_id || "")
    .trigger("change");

  const legacyTypes = [
    "block_invites",
    "block_all_links",
    "media_only",
    "text_only",
  ];
  const isLegacy = legacyTypes.includes(data.restriction_type);

  document.getElementById("resModeSelect").value = isLegacy
    ? "legacy"
    : "granular";
  switchRestrictionMode();

  if (isLegacy) {
    document.getElementById("resTypeSelect").value = data.restriction_type;
    applyResPreset();
  }

  $("#resImmuneRoles").val(data.immune_roles).trigger("change");

  const allowed = data.allowed_content_types || 0;
  const blocked = data.blocked_content_types || 0;

  document.querySelectorAll(".allow-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const isAllowed = (allowed & bit) === bit;
    const isBlocked = (blocked & bit) === bit;
    const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);

    if (isAllowed) {
      cb.checked = true;
      if (blockCb) blockCb.checked = false;
    } else if (isBlocked) {
      cb.checked = false;
      if (blockCb) blockCb.checked = true;
    } else {
      cb.checked = true;
      if (blockCb) blockCb.checked = false;
    }
  });

  document.querySelectorAll(".block-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const allowCb = document.querySelector(`.allow-flag[data-bit="${bit}"]`);
    if (allowCb && allowCb.checked) {
      cb.checked = false;
    } else if (!cb.checked && (!allowCb || !allowCb.checked)) {
      if (allowCb) allowCb.checked = true;
      cb.checked = false;
    }
  });
};

/**
 * Delete a restriction rule by ID.
 *
 * @param {string|number} id - Restriction ID to delete
 */
window.deleteRes = async function (id) {
  if (!confirm("Delete this restriction?")) return;
  const guildId = getGuildIdFromUrl();
  await fetch(`/api/server/${guildId}/channel-restrictions-v2?id=${id}`, {
    method: "DELETE",
  });
  loadRestrictions(guildId);
};

/**
 * Toggle display of advanced restriction configuration section.
 */
window.toggleAdvancedRes = function () {
  document.getElementById("advResContent").classList.toggle("hidden");
  document.getElementById("advResChevron").classList.toggle("rotate-180");
};

// ==================== EVENT BINDINGS ====================

/**
 * Attach Add Restriction button listener on DOM ready.
 */
function attachButtonListener() {
  const addBtn = document.getElementById("addRestrictionBtn");
  if (addBtn) {
    addBtn.removeEventListener("click", openResModal);
    addBtn.addEventListener("click", openResModal);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachButtonListener);
} else {
  attachButtonListener();
}

const restrictionTab = document.getElementById("tab-restriction");
if (restrictionTab) {
  restrictionTab.addEventListener("click", initRestrictionTab);
}


// ===== Tabs\config_time.js =====
/**
 * @file Timezone Clocks Configuration Script
 * @description
 * Manages server timezone clocks with a vanilla JS searchable dropdown:
 *  - Loads and filters timezones without external UI libraries
 *  - Loads Discord voice channels for time/date clock mapping
 *  - Creates, edits, and deletes server clocks via API
 *  - Handles modal open/close and keyboard navigation in the dropdown
 */

let isTimeInit = false;
let allTimezones = [];
let filteredTimezones = [];
let highlightedIndex = -1;
let editingClockId = null; // Database ID of the clock currently being edited

// ==================== UTILITIES ====================

// (getGuildIdFromUrl is provided globally by server_config.js)


// ==================== TAB INITIALIZATION ====================

/**
 * Initialize the Time tab once:
 *  - Load timezones
 *  - Load configured clocks
 *  - Load Discord channels
 *  - Wire timezone dropdown UI
 */
async function initTimeTab() {
  if (isTimeInit) return;

  const guildId = getGuildIdFromUrl();
  await Promise.all([
    loadTimezones(),
    loadClocks(guildId),
    loadDiscordChannels(guildId),
  ]);

  wireTimezoneUI();

  const addBtn = document.getElementById("addClockBtn");
  if (addBtn) {
    addBtn.removeEventListener("click", openTimeModal);
    addBtn.addEventListener("click", () => openTimeModal(null));
  }

  isTimeInit = true;
}

// ==================== TIMEZONE DROPDOWN ====================

/**
 * Fetch the full timezone list from the backend and render the initial dropdown.
 */
async function loadTimezones() {
  try {
    const res = await fetch("/api/timezones");
    const data = await res.json();
    allTimezones = Array.isArray(data.timezones) ? data.timezones.slice() : [];
    buildDropdownList(allTimezones);
  } catch (e) {
    console.error("Failed to load timezones", e);
    allTimezones = [];
    buildDropdownList([]);
  }
}

/**
 * Render the timezone dropdown items with a capped initial list for performance.
 *
 * @param {string[]} list - Timezone list to render
 */
function buildDropdownList(list) {
  const dropdown = document.getElementById("timezoneDropdown");
  if (!dropdown) return;
  dropdown.innerHTML = "";

  if (!list || list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timezone-empty";
    empty.textContent = "No timezones available.";
    dropdown.appendChild(empty);
    return;
  }

  const MAX_RENDER = 500;
  const sliceList = list.slice(0, MAX_RENDER);

  sliceList.forEach((tz) => {
    const item = document.createElement("div");
    item.className = "timezone-item";
    item.setAttribute("role", "option");
    item.dataset.value = tz;
    item.textContent = tz;
    item.addEventListener("click", () => {
      selectTimezone(tz);
      closeTimezoneDropdown();
    });
    dropdown.appendChild(item);
  });

  if (list.length > MAX_RENDER) {
    const more = document.createElement("div");
    more.className = "timezone-empty";
    more.textContent = `...and ${list.length - MAX_RENDER
      } more — refine your search`;
    dropdown.appendChild(more);
  }
}

/**
 * Wire UI events for the custom timezone dropdown:
 *  - Focus/input events
 *  - Keyboard navigation
 *  - Click-outside to close
 *  - Wrapper click to open
 */
function wireTimezoneUI() {
  const search = document.getElementById("timezoneSearch");
  const dropdown = document.getElementById("timezoneDropdown");
  const hidden = document.getElementById("timezoneValue");

  if (!search || !dropdown || !hidden) return;

  search.addEventListener("focus", () => {
    openTimezoneDropdown();
    filterTimezoneList(search.value || "");
  });

  search.addEventListener("input", (e) => {
    filterTimezoneList(e.target.value || "");
  });

  search.addEventListener("keydown", (e) => {
    const items = dropdown.querySelectorAll(".timezone-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateHighlight(items);
      scrollIntoViewIfNeeded(items[highlightedIndex]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight(items);
      scrollIntoViewIfNeeded(items[highlightedIndex]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && items[highlightedIndex]) {
        const tz = items[highlightedIndex].dataset.value;
        selectTimezone(tz);
        closeTimezoneDropdown();
      } else if (items.length === 1) {
        const tz = items[0].dataset.value;
        selectTimezone(tz);
        closeTimezoneDropdown();
      }
    } else if (e.key === "Escape") {
      closeTimezoneDropdown();
      search.blur();
    }
  });

  document.addEventListener("click", (ev) => {
    const within =
      ev.target.closest &&
      (ev.target.closest(".timezone-select-wrapper") ||
        ev.target.closest("#timezoneDropdown"));
    if (!within) {
      closeTimezoneDropdown();
    }
  });

  const wrapper = document.querySelector(".timezone-select-wrapper");
  if (wrapper) {
    wrapper.addEventListener("click", (e) => {
      if (e.target === wrapper || e.target === search) {
        openTimezoneDropdown();
        search.focus();
      }
    });
  }

  if (hidden.value) {
    search.value = hidden.value;
  }
}

/**
 * Open the timezone dropdown and reset highlight state.
 */
function openTimezoneDropdown() {
  const dropdown = document.getElementById("timezoneDropdown");
  if (!dropdown) return;
  dropdown.classList.remove("hidden");
  highlightedIndex = -1;
}

/**
 * Close the timezone dropdown and clear highlights.
 */
function closeTimezoneDropdown() {
  const dropdown = document.getElementById("timezoneDropdown");
  if (!dropdown) return;
  dropdown.classList.add("hidden");
  highlightedIndex = -1;
  const items = dropdown.querySelectorAll(".timezone-item");
  items.forEach((it) => it.classList.remove("highlighted"));
}

/**
 * Filter the timezone list based on a search term and rebuild the dropdown.
 *
 * @param {string} term - Search term
 */
function filterTimezoneList(term) {
  const dropdown = document.getElementById("timezoneDropdown");
  const search = document.getElementById("timezoneSearch");
  if (!dropdown || !search) return;

  const q = (term || "").toLowerCase().trim();

  if (!q) {
    filteredTimezones = allTimezones.slice();
  } else {
    filteredTimezones = allTimezones.filter(
      (tz) => tz.toLowerCase().indexOf(q) !== -1
    );
  }

  dropdown.innerHTML = "";

  if (!filteredTimezones || filteredTimezones.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timezone-empty";
    empty.textContent = "No matching timezones — try a different query.";
    dropdown.appendChild(empty);
    highlightedIndex = -1;
    return;
  }

  const MAX = 500;
  const toDisplay = filteredTimezones.slice(0, MAX);

  toDisplay.forEach((tz, i) => {
    const item = document.createElement("div");
    item.className = "timezone-item";
    item.dataset.value = tz;
    item.textContent = tz;
    item.addEventListener("click", () => {
      selectTimezone(tz);
      closeTimezoneDropdown();
    });
    dropdown.appendChild(item);
  });

  if (filteredTimezones.length > MAX) {
    const more = document.createElement("div");
    more.className = "timezone-empty";
    more.textContent = `Showing ${MAX} of ${filteredTimezones.length} matches — refine search to narrow further.`;
    dropdown.appendChild(more);
  }

  highlightedIndex = -1;
}

/**
 * Apply the highlighted class to the currently selected item.
 *
 * @param {NodeListOf<HTMLElement>} items - Dropdown items
 */
function updateHighlight(items) {
  items.forEach((it, idx) => {
    it.classList.toggle("highlighted", idx === highlightedIndex);
  });
}

/**
 * Ensure the highlighted item is visible inside the scrollable dropdown.
 *
 * @param {HTMLElement} el - Highlighted item element
 */
function scrollIntoViewIfNeeded(el) {
  if (!el) return;
  const parent = el.parentElement;
  const parentRect = parent.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (elRect.top < parentRect.top) {
    parent.scrollTop -= parentRect.top - elRect.top + 8;
  } else if (elRect.bottom > parentRect.bottom) {
    parent.scrollTop += elRect.bottom - parentRect.bottom + 8;
  }
}

/**
 * Set the selected timezone into the hidden form field and visible input.
 *
 * @param {string} tz - Selected timezone string
 */
function selectTimezone(tz) {
  const hidden = document.getElementById("timezoneValue");
  const search = document.getElementById("timezoneSearch");
  if (hidden) hidden.value = tz;
  if (search) search.value = tz;
}

// ==================== DISCORD CHANNELS & CLOCK LIST ====================

/**
 * Load Discord voice channels and populate the time/date channel selects.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadDiscordChannels(guildId) {
  try {
    const res = await fetch(`/api/server/${guildId}/discord-data`);
    const data = await res.json();
    const timeSelect = document.getElementById("timeChannelSelect");
    const dateSelect = document.getElementById("dateChannelSelect");
    if (!timeSelect || !dateSelect) return;

    // Use category-grouped dropdown for voice channels
    if (typeof window.populateChannelDropdownWithCategories === "function") {
      window.populateChannelDropdownWithCategories(timeSelect, data.channels, {
        channelTypes: [2], // Voice channels only
        placeholder: "-- Select Time Channel --",
        includeHash: false,
        categoryPrefix: "📁 ",
        channelIndent: "  🔊 ",
      });

      window.populateChannelDropdownWithCategories(dateSelect, data.channels, {
        channelTypes: [2], // Voice channels only
        placeholder: "-- None --",
        includeHash: false,
        categoryPrefix: "📁 ",
        channelIndent: "  🔊 ",
      });
    } else {
      // Fallback to simple population
      timeSelect.innerHTML =
        "<option value=''>-- Select Time Channel --</option>";
      dateSelect.innerHTML = "<option value=''>-- None --</option>";

      const voiceChannels = (data.channels || []).filter((c) => c.type === 2);

      voiceChannels.forEach((c) => {
        const optT = document.createElement("option");
        optT.value = c.id;
        optT.text = `🔊 ${c.name}`;
        timeSelect.appendChild(optT);

        const optD = document.createElement("option");
        optD.value = c.id;
        optD.text = `🔊 ${c.name}`;
        dateSelect.appendChild(optD);
      });
    }

    $("#timeChannelSelect").select2({
      dropdownParent: $("#timeModal"),
      width: "100%",
      placeholder: "Select Time Channel",
    });

    $("#dateChannelSelect").select2({
      dropdownParent: $("#timeModal"),
      width: "100%",
      placeholder: "None",
      allowClear: true,
    });
  } catch (e) {
    console.error("Failed to load discord channels:", e);
  }
}

/**
 * Load all configured clocks for the guild and render them as cards.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadClocks(guildId) {
  const safeContainer =
    document.getElementById("clockList") ||
    document.getElementById("clock-list");
  if (!safeContainer) return;

  try {
    const res = await fetch(`/api/server/${guildId}/clocks`);
    const data = await res.json();

    safeContainer.innerHTML = "";
    if (!data.clocks || data.clocks.length === 0) {
      safeContainer.innerHTML = `<div class="col-span-full text-center text-slate-500 py-8 border-2 border-dashed border-slate-700 rounded-xl">No clocks configured.</div>`;
      return;
    }

    data.clocks.forEach((clock) => {
      const div = document.createElement("div");
      div.className = "clock-card";

      let dateInfo = "";
      if (clock.date_channel_id) {
        dateInfo = `<div class="text-xs text-slate-400 mt-1"><i class="fas fa-calendar-day mr-1"></i>Date Channel Set</div>`;
      }

      div.innerHTML = `
                <div>
                    <div class="font-bold text-lg flex items-center gap-2">
                        <i class="fas fa-globe-americas text-blue-400"></i> ${clock.timezone
        }
                    </div>
                    <div class="text-sm text-slate-500 font-mono bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded w-fit mt-1">
                        Time Channel ID: ${clock.channel_id || clock.time_channel_id
        }
                    </div>
                    ${dateInfo}
                </div>
                <div class="flex gap-2">
                    <button class="edit-clock-btn w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors" title="Edit Clock">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="delete-clock-btn w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors" title="Delete Clock">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;

      const editBtn = div.querySelector(".edit-clock-btn");
      const deleteBtn = div.querySelector(".delete-clock-btn");

      if (editBtn) {
        editBtn.addEventListener("click", () => {
          editClock(
            clock.id,
            clock.channel_id || clock.time_channel_id,
            clock.timezone,
            clock.date_channel_id || ""
          );
        });
      }

      if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
          deleteClock(clock.channel_id || clock.time_channel_id);
        });
      }

      safeContainer.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    safeContainer.innerHTML = `<div class="text-red-500">Error loading clocks.</div>`;
  }
}

// ==================== MODAL OPEN/CLOSE & SAVE ====================

/**
 * Open the clock modal in either "add" or "edit" mode.
 *
 * @param {?number} dbId - Clock database ID (null for add mode)
 * @param {?string} channelId - Time channel ID
 * @param {?string} timezone - Timezone string
 * @param {?string} dateChannelId - Date channel ID
 */
window.openTimeModal = function (
  dbId = null,
  channelId = null,
  timezone = null,
  dateChannelId = null
) {
  const modal = document.getElementById("timeModal");
  if (!modal) return;

  const modalTitle = modal.querySelector("h3");
  if (modalTitle) {
    if (dbId !== null) {
      modalTitle.innerHTML =
        '<i class="fas fa-edit mr-2 text-blue-400"></i> Edit Clock';
      editingClockId = dbId;
    } else {
      modalTitle.innerHTML =
        '<i class="fas fa-clock mr-2 text-blue-400"></i> Add New Clock';
      editingClockId = null;
    }
  }

  const search = document.getElementById("timezoneSearch");
  const hidden = document.getElementById("timezoneValue");
  const timeChannelSelect = document.getElementById("timeChannelSelect");
  const dateChannelSelect = document.getElementById("dateChannelSelect");

  if (dbId !== null && timezone) {
    if (search) search.value = timezone;
    if (hidden) hidden.value = timezone;
    if (timeChannelSelect)
      $(timeChannelSelect).val(channelId).trigger("change");
    if (dateChannelSelect)
      $(dateChannelSelect)
        .val(dateChannelId || "")
        .trigger("change");
  } else {
    if (search) search.value = "";
    if (hidden) hidden.value = "";
    if (timeChannelSelect) $(timeChannelSelect).val("").trigger("change");
    if (dateChannelSelect) $(dateChannelSelect).val("").trigger("change");
  }

  modal.classList.remove("hidden");
  setTimeout(() => {
    const s = document.getElementById("timezoneSearch");
    if (s) s.focus();
  }, 120);
};

/**
 * Close the clock modal and reset edit mode.
 */
window.closeTimeModal = function () {
  const modal = document.getElementById("timeModal");
  if (modal) modal.classList.add("hidden");
  editingClockId = null;
};

/**
 * Save (create or update) a clock configuration via API.
 * Uses PUT when editing and POST for new clocks.
 */
window.saveClock = async function () {
  const channelId = document.getElementById("timeChannelSelect").value;
  const dateChannelId = document.getElementById("dateChannelSelect").value;
  const timezone =
    document.getElementById("timezoneValue").value ||
    document.getElementById("timezoneSearch").value;
  const btn = document.getElementById("btnSaveClock");

  if (!channelId || !timezone) {
    alert("Please select a Time Channel and Timezone");
    return;
  }

  btn.innerText = "Saving...";
  btn.disabled = true;

  const guildId = getGuildIdFromUrl();
  const isEditing = editingClockId !== null;

  try {
    const url = isEditing
      ? `/api/server/${guildId}/clocks/${editingClockId}`
      : `/api/server/${guildId}/clocks`;

    const method = isEditing ? "PUT" : "POST";

    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: channelId,
        date_channel_id: dateChannelId,
        timezone: timezone,
      }),
    });

    if (res.ok) {
      closeTimeModal();
      loadClocks(guildId);
    } else {
      const d = await res.json();
      alert("Failed to save clock: " + (d.error || "Unknown"));
    }
  } catch (e) {
    console.error(e);
    alert("Error saving");
  } finally {
    btn.innerText = "Save Clock";
    btn.disabled = false;
  }
};

/**
 * Wrapper to open the modal pre-filled for editing an existing clock.
 */
window.editClock = function (dbId, channelId, timezone, dateChannelId) {
  openTimeModal(dbId, channelId, timezone, dateChannelId);
};

/**
 * Delete a clock configuration for the given channel ID.
 *
 * @param {string} channelId - Time channel ID to delete clock for
 */
async function deleteClock(channelId) {
  if (!confirm("Stop updating this clock?")) return;
  const guildId = getGuildIdFromUrl();

  await fetch(`/api/server/${guildId}/clocks?channel_id=${channelId}`, {
    method: "DELETE",
  });
  loadClocks(guildId);
}

// ==================== AUTO-INIT HOOKS ====================

const timeTab = document.getElementById("tab-time");
if (timeTab) {
  timeTab.addEventListener("click", initTimeTab);
}
// Only init if we are on a page with the time tab
if (document.getElementById("tab-time")) {
  initTimeTab();
}


// ===== Tabs\config_youtube.js =====
/**
 * @file YouTube Notifications Configuration Script
 * @description
 * Manages YouTube notification integrations per guild:
 *  - Initialization of the YouTube tab with guild data
 *  - Fetching and rendering configured channels
 *  - Searching channels via backend API and previewing metadata
 *  - Creating, updating, and deleting notification configurations
 *  - Discord channel/role population with Select2 integration
 *  - Optimistic UI updates and toast-based user feedback
 */

let ytInit = false;
let channelsMap = {};
let currentEditingYtId = null;

/**
 * Extract the guild ID from the current URL.
 * Supports routes like `/server/{guildId}` or falls back to the last path segment.
 */
function getGuildIdFromUrl() {
  const match = window.location.href.match(/\/server\/(\d+)/);
  return match ? match[1] : window.location.pathname.split("/").pop();
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the YouTube configuration tab.
 * Avoids re-initialization unless `force` is true.
 *
 * @param {boolean} [force=false] - Force reload of data
 */
window.initYoutubeTab = async function (force = false) {
  if (ytInit && !force) return;
  const guildId = getGuildIdFromUrl();
  await Promise.all([loadYTData(guildId), loadYTDiscordData(guildId)]);
  ytInit = true;
}

// ==================== DATA FETCHING & POPULATION ====================

/**
 * Load existing YouTube configurations for this guild and render them as cards.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadYTData(guildId) {
  const container = document.getElementById("youtubeList");
  try {
    const res = await fetch(`/api/server/${guildId}/youtube`);
    const data = await res.json();

    container.innerHTML = "";
    if (data.configs.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">No channels configured.</div>`;
      return;
    }

    data.configs.forEach((cfg) => {
      const div = document.createElement("div");
      div.className = "yt-card";
      div.setAttribute("data-yt-id", cfg.yt_id);
      div.innerHTML = `
                <div class="yt-icon-wrapper"><i class="fab fa-youtube"></i></div>
                <div class="flex-grow">
                    <h4 class="font-bold text-lg">${cfg.name}</h4>
                    <p class="text-xs text-slate-500 font-mono">ID: ${cfg.yt_id}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="editYT('${cfg.yt_id}')" class="text-slate-400 hover:text-indigo-500 transition-colors p-2" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteYT('${cfg.yt_id}')" class="text-slate-400 hover:text-red-500 transition-colors p-2" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            `;
      container.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="text-red-500">Error loading data.</div>`;
  }
}

/**
 * Load Discord metadata (channels and roles) for the YouTube modal,
 * populate selects, and initialize Select2 instances.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadYTDiscordData(guildId) {
  const res = await fetch(`/api/server/${guildId}/discord-data`);
  const data = await res.json();

  channelsMap = {};
  data.channels
    .filter((c) => c.type === 0 || c.type === 5)
    .forEach((c) => {
      channelsMap[c.id] = c.name;
    });

  const chSelect = document.getElementById("ytTargetChannel");

  // Use category-grouped dropdown
  if (typeof window.populateChannelDropdownWithCategories === "function") {
    window.populateChannelDropdownWithCategories(chSelect, data.channels, {
      channelTypes: [0, 5], // Text and announcement channels
      placeholder: "Select Text Channel",
      includeHash: true,
    });
  } else {
    // Fallback to simple population
    chSelect.innerHTML =
      '<option value="" disabled selected>Select Text Channel</option>';
    data.channels
      .filter((c) => c.type === 0 || c.type === 5)
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.text = `# ${c.name}`;
        chSelect.appendChild(opt);
      });
  }

  const roleSelect = document.getElementById("ytMentionRole");
  roleSelect.innerHTML = '<option value="" selected>None</option>';
  data.roles.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.text = `@${r.name}`;
    roleSelect.appendChild(opt);
  });

  $("#ytTargetChannel").select2({
    dropdownParent: $("#ytModal"),
    width: "100%",
    placeholder: "Select Text Channel",
  });

  $("#ytMentionRole").select2({
    dropdownParent: $("#ytModal"),
    width: "100%",
    placeholder: "None",
    allowClear: true,
  });
}

/**
 * Resolve and populate in-card channel names using `channelsMap`.
 * Intended for elements with `.channel-name` and `data-id` attributes.
 */
function resolveChannelNames() {
  document.querySelectorAll(".channel-name").forEach((span) => {
    const channelId = span.getAttribute("data-id");
    if (channelsMap[channelId]) {
      span.innerText = channelsMap[channelId];
    } else {
      span.innerText = "Unknown Channel";
    }
  });
}

// ==================== SEARCH & PREVIEW ====================

/**
 * Search for a YouTube channel via backend API and update the preview pane.
 */
async function searchChannel() {
  const query = document.getElementById("ytSearchInput").value;
  const err = document.getElementById("ytSearchError");
  const step2 = document.getElementById("yt-step-2");

  if (!query) return;

  err.classList.add("hidden");
  step2.classList.add("hidden");

  try {
    const res = await fetch("/api/youtube/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query }),
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById("ytPreviewImg").src = data.thumbnail;
      document.getElementById("ytPreviewName").innerText = data.name;
      document.getElementById("ytPreviewSubs").innerText = parseInt(
        data.subscribers
      ).toLocaleString();
      document.getElementById("ytPreviewVids").innerText = parseInt(
        data.video_count
      ).toLocaleString();
      document.getElementById("ytPreviewID").innerText = data.id;

      step2.classList.remove("hidden");
    } else {
      err.innerText = data.error || "Channel not found";
      err.classList.remove("hidden");
    }
  } catch (e) {
    err.innerText = "API Error";
    err.classList.remove("hidden");
  }
}

// ==================== SAVE / UPDATE CONFIGURATION ====================

/**
 * Persist the YouTube configuration for this guild (create or update).
 * Uses optimistic UI updates when editing an existing configuration.
 */
async function saveYTConfig() {
  const btn = document.getElementById("btnSaveYT");
  const btnText = document.getElementById("btnSaveYTText");
  const ytId = document.getElementById("ytPreviewID").innerText;
  const ytName = document.getElementById("ytPreviewName").innerText;
  const targetCh = document.getElementById("ytTargetChannel").value;
  const roleId = document.getElementById("ytMentionRole").value;
  const msg = document.getElementById("ytCustomMsg").value;

  if (!ytId || !targetCh) {
    showToast("Please select a target channel", "error");
    return;
  }

  btn.disabled = true;
  btnText.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

  const guildId = getGuildIdFromUrl();

  if (currentEditingYtId) {
    updateCardOptimistically(currentEditingYtId, ytName, targetCh);
  }

  try {
    const res = await fetch(`/api/server/${guildId}/youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yt_id: ytId,
        yt_name: ytName,
        target_channel: targetCh,
        role_id: roleId,
        message: msg,
      }),
    });

    const result = await res.json();

    if (res.ok) {
      const seededCount = result.seeded_count || 0;
      const action = currentEditingYtId ? "updated" : "added";
      showToast(
        `✅ Channel ${action}! Seeded ${seededCount} video${seededCount !== 1 ? "s" : ""
        }.`,
        "success"
      );
      closeYTModal();
      loadYTData(guildId);
    } else {
      showToast(result.error || "Failed to save", "error");
      if (currentEditingYtId) {
        loadYTData(guildId);
      }
    }
  } catch (e) {
    console.error(e);
    showToast("Error saving configuration", "error");
    if (currentEditingYtId) {
      loadYTData(guildId);
    }
  } finally {
    btn.disabled = false;
    btnText.innerHTML = "Save Changes";
  }
}

/**
 * Apply an optimistic visual update to an existing YouTube card
 * while the save operation is in progress.
 *
 * @param {string} ytId - YouTube channel ID
 * @param {string} ytName - Updated channel name
 * @param {string} targetChannelId - Target Discord channel ID
 */
function updateCardOptimistically(ytId, ytName, targetChannelId) {
  const card = document.querySelector(`[data-yt-id="${ytId}"]`);
  if (card) {
    const nameEl = card.querySelector("h4");
    const channelEl = card.querySelector(".channel-name");
    if (nameEl) nameEl.innerText = ytName;
    if (channelEl && channelsMap[targetChannelId]) {
      channelEl.innerText = `# ${channelsMap[targetChannelId]}`;
    }
  }
}

// ==================== EDIT MODE ====================

/**
 * Open the modal in edit mode for a specific YouTube configuration.
 *
 * @param {string} ytId - YouTube channel ID to edit
 */
async function editYT(ytId) {
  const guildId = getGuildIdFromUrl();

  try {
    const res = await fetch(`/api/server/${guildId}/youtube`);
    const data = await res.json();
    const config = data.configs.find((c) => c.yt_id === ytId);

    if (!config) {
      showToast("Configuration not found", "error");
      return;
    }

    currentEditingYtId = ytId;

    document.getElementById("ytModalTitle").innerText = "Edit YouTube Channel";

    document.getElementById("ytSearchInput").value = config.yt_id;
    document.getElementById("ytPreviewImg").src = config.thumbnail || "";
    document.getElementById("ytPreviewName").innerText = config.name;
    document.getElementById("ytPreviewSubs").innerText = "N/A";
    document.getElementById("ytPreviewVids").innerText = "N/A";
    document.getElementById("ytPreviewID").innerText = config.yt_id;
    document.getElementById("ytPreviewID").innerText = config.yt_id;
    $("#ytTargetChannel").val(config.target_channel).trigger("change");
    $("#ytMentionRole")
      .val(config.role_id || "")
      .trigger("change");
    document.getElementById("ytCustomMsg").value =
      config.message ||
      "🔔 {@role} **{channel_name}** has uploaded a new video!\n              \n              {video_url}";

    document.getElementById("yt-step-2").classList.remove("hidden");
    document.getElementById("ytModal").classList.remove("hidden");
  } catch (e) {
    console.error(e);
    showToast("Error loading configuration", "error");
  }
}

// ==================== MODAL CONTROLS ====================

/**
 * Open the YouTube configuration modal in "Add" mode.
 */
function openYTModal() {
  const guildId = getGuildIdFromUrl();

  currentEditingYtId = null;
  document.getElementById("ytModalTitle").innerText = "Add YouTube Channel";

  document.getElementById("ytSearchInput").value = "";
  document.getElementById("yt-step-2").classList.add("hidden");
  $("#ytTargetChannel").val("").trigger("change");
  $("#ytMentionRole").val("").trigger("change");
  document.getElementById("ytCustomMsg").value =
    "🔔 {@role} **{channel_name}** has uploaded a new video!\n              \n              {video_url}";

  document.getElementById("ytModal").classList.remove("hidden");

  if (!ytInit) {
    loadYTDiscordData(guildId);
    ytInit = true;
  }
}

/**
 * Close the YouTube modal and clear editing state.
 */
function closeYTModal() {
  document.getElementById("ytModal").classList.add("hidden");
  document.getElementById("yt-step-2").classList.add("hidden");
  document.getElementById("ytSearchInput").value = "";
  currentEditingYtId = null;
}

/**
 * Insert a template variable tag into the custom notification message.
 *
 * @param {string} tag - Placeholder tag to insert (e.g., "{video_url}")
 */
function insertYTVar(tag) {
  const input = document.getElementById("ytCustomMsg");
  input.value += tag;
}

// ==================== DELETE CONFIGURATION ====================

/**
 * Delete a YouTube notification configuration by channel ID.
 *
 * @param {string} id - YouTube channel ID
 */
async function deleteYT(id) {
  if (!confirm("Remove this YouTube notification?")) return;

  const guildId = getGuildIdFromUrl();
  const card = document.querySelector(`[data-yt-id="${id}"]`);

  if (card) {
    card.style.opacity = "0.5";
    card.style.pointerEvents = "none";
  }

  try {
    await fetch(`/api/server/${guildId}/youtube?yt_id=${id}`, {
      method: "DELETE",
    });
    showToast("Channel removed successfully", "success");
    loadYTData(guildId);
  } catch (e) {
    console.error(e);
    showToast("Error removing channel", "error");
    if (card) {
      card.style.opacity = "1";
      card.style.pointerEvents = "auto";
    }
  }
}

// ==================== TOAST NOTIFICATIONS ====================

/**
 * Display a toast notification.
 *
 * @param {string} message - Message to display
 * @param {"success"|"error"} [type="success"] - Toast style variant
 */
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"
    } mr-2"></i>
    ${message}
  `;

  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==================== EVENT BINDINGS ====================

document
  .getElementById("tab-youtube")
  ?.addEventListener("click", initYoutubeTab);

const addBtn = document.getElementById("addYoutubeBtn");
if (addBtn) {
  addBtn.addEventListener("click", openYTModal);
} else {
  // Fallback: handled by other initialization paths if needed
}



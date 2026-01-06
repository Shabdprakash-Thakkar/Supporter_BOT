// v5.0.0
// v4.0.0
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

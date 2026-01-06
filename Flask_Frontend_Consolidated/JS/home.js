// v5.0.0
// v4.0.0
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

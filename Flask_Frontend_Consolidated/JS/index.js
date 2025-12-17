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

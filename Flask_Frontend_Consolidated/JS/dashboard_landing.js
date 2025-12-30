// v4.0.0
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

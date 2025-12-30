// v4.0.0
/**
 * @file Server List UI Script
 * @description
 * Enhances the server list page with:
 *  - Live server search with animated filter results
 *  - Theme toggle icon sync
 *  - Navbar shadow on scroll
 *  - Staggered fade-in animation for server cards
 *  - Global fade-in-up keyframe definition
 */

document.addEventListener("DOMContentLoaded", function () {

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

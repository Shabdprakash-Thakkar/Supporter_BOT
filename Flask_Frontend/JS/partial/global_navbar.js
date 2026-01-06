// v5.0.0
// v4.0.0
// JS/partial/global_navbar.js

document.addEventListener("DOMContentLoaded", function () {
  const btn = document.getElementById("mobile-menu-btn");
  const menu = document.getElementById("mobile-menu");

  if (btn && menu) {
    // Safety: Clone button to remove any accidental duplicate listeners from other scripts
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.classList.toggle("hidden");

      // Icon Swap Logic
      const icon = newBtn.querySelector("i");
      if (icon) {
        if (menu.classList.contains("hidden")) {
          icon.classList.remove("fa-times");
          icon.classList.add("fa-bars");
        } else {
          icon.classList.remove("fa-bars");
          icon.classList.add("fa-times");
        }
      }
    });

    // Close menu when clicking outside
    document.addEventListener("click", function (e) {
      if (
        !menu.classList.contains("hidden") &&
        !menu.contains(e.target) &&
        !newBtn.contains(e.target)
      ) {
        menu.classList.add("hidden");
        const icon = newBtn.querySelector("i");
        if (icon) {
          icon.classList.remove("fa-times");
          icon.classList.add("fa-bars");
        }
      }
    });
  }
});

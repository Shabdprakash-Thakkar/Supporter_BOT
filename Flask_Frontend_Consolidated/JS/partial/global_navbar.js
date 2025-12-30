// v4.0.0
// ===== global_navbar.js =====
(function () {
  if (!document.getElementById('component-navbar')) return;
  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("mobile-menu-btn");
    const menu = document.getElementById("mobile-menu");

    if (btn && menu) {
      // Remove any existing event listeners to be safe
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.classList.toggle("hidden");

        // Icon Swap
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
    }
  });
})();
// ===== End of global_navbar.js =====

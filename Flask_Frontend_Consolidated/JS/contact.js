// v4.0.0
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

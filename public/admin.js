const adminPasswordInput = document.getElementById("adminPasswordInput");
const adminLoginButton = document.getElementById("adminLoginButton");
const adminAuthStatus = document.getElementById("adminAuthStatus");
const fetchOpts = { credentials: "include" };

function setAdminAuthStatus(message, isError = false) {
  if (!adminAuthStatus) return;
  adminAuthStatus.textContent = message;
  adminAuthStatus.style.color = isError ? "#e3a0a0" : "";
}

async function loginAndReturn() {
  const password = adminPasswordInput?.value || "";
  if (!password) {
    setAdminAuthStatus("Enter the admin password.", true);
    return;
  }

  try {
    const response = await fetch("/api/admin/login", {
      ...fetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Sign-in failed.");
    }
    window.location.assign("/");
  } catch (error) {
    setAdminAuthStatus(error.message || "Sign-in failed.", true);
  }
}

async function checkExistingSession() {
  try {
    const response = await fetch("/api/admin/me", fetchOpts);
    const data = await response.json();
    if (response.ok && data.admin) {
      window.location.replace("/");
    }
  } catch {
    /* ignore */
  }
}

if (adminLoginButton) {
  adminLoginButton.addEventListener("click", () => {
    loginAndReturn();
  });
}

if (adminPasswordInput) {
  adminPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginAndReturn();
    }
  });
}

checkExistingSession();

const links = document.querySelectorAll('a[href^="#"]');

for (const link of links) {
  link.addEventListener("click", (event) => {
    const href = link.getAttribute("href");
    if (!href || href === "#") return;

    const target = document.querySelector(href);
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

const navLinks = document.querySelectorAll(".nav a[href^='#']");
const sections = Array.from(document.querySelectorAll("main section[id]"));

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;

      for (const navLink of navLinks) {
        const href = navLink.getAttribute("href");
        const isActive = href === `#${entry.target.id}`;
        navLink.classList.toggle("active", isActive);
      }
    }
  },
  { rootMargin: "-35% 0px -55% 0px", threshold: 0 },
);

for (const section of sections) {
  observer.observe(section);
}

const currentPath = window.location.pathname.split("/").pop() || "index.html";
const pageLinks = document.querySelectorAll('.nav a[href$=".html"]');

for (const link of pageLinks) {
  const href = link.getAttribute("href");
  if (!href) continue;
  const targetPath = href.replace("./", "");
  link.classList.toggle("active", targetPath === currentPath);
}

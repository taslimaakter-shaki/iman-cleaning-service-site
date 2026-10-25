(() => {
  if (!window.matchMedia("(min-width: 768px)").matches) return;

  const scripts = [
    {
      src: "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
      integrity: "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z",
      crossOrigin: "anonymous"
    },
    {
      src: "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
      integrity: "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1",
      crossOrigin: "anonymous"
    },
    { src: "./assets/homepage-design-system.min.js?v=20260726-why-seo" },
    { src: "./data.js?v=20261013-residential-hourly-recurring" },
    { src: "./assets/homepage-chrome.min.js?v=20261001-no-why-us-menu" },
    { src: "./assets/homepage-sections.min.js?v=20261013-remove-offer-bar" }
  ];

  const load = (index) => {
    if (index >= scripts.length) return;
    const config = scripts[index];
    const script = document.createElement("script");
    script.src = config.src;
    if (config.integrity) script.integrity = config.integrity;
    if (config.crossOrigin) script.crossOrigin = config.crossOrigin;
    script.onload = () => load(index + 1);
    script.onerror = () => console.error("Homepage script failed to load:", config.src);
    document.head.appendChild(script);
  };

  load(0);
})();

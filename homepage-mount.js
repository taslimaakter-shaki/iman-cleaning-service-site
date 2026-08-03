(() => {
  let attempts = 0;
  const mount = () => {
    if (!window.ImanSite?.App || !window.React || !window.ReactDOM) {
      attempts += 1;
      if (attempts < 200) window.setTimeout(mount, 30);
      return;
    }

    const root = document.getElementById("root");
    if (!root) return;

    ReactDOM.createRoot(root).render(React.createElement(window.ImanSite.App));
  };

  mount();
})();

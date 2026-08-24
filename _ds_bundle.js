/* @ds-bundle: {"format":3,"namespace":"ImanCleaningDesignSystem_5652ad","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"FaqItem","sourcePath":"components/marketing/FaqItem.jsx"},{"name":"FeatureTile","sourcePath":"components/marketing/FeatureTile.jsx"},{"name":"ServiceCard","sourcePath":"components/marketing/ServiceCard.jsx"},{"name":"ServiceListCard","sourcePath":"components/marketing/ServiceListCard.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"ba8ee5777f7d","components/core/Button.jsx":"ac0e22130a37","components/core/Card.jsx":"7e9458727ce9","components/forms/Field.jsx":"dc79fbdc89a7","components/marketing/FaqItem.jsx":"272dfc43cfc1","components/marketing/FeatureTile.jsx":"cb355d878463","components/marketing/ServiceCard.jsx":"53140cbe34a0","components/marketing/ServiceListCard.jsx":"a4b2ad4d67bf","design_handoff_website_redesign/ui_kits/website/chrome.jsx":"5f2c787244da","design_handoff_website_redesign/ui_kits/website/data.js":"9c3346f5bf6b","design_handoff_website_redesign/ui_kits/website/sections.jsx":"0ae6ee0d7949","ui_kits/website/chrome.jsx":"5f2c787244da","ui_kits/website/data.js":"9c3346f5bf6b","ui_kits/website/sections.jsx":"0ae6ee0d7949"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ImanCleaningDesignSystem_5652ad = window.ImanCleaningDesignSystem_5652ad || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Badge — a small pill label for trust signals, tags, and statuses.
 * `tone` controls color; `check` prepends a ✓ for trust badges.
 */
function Badge({
  children,
  tone = "teal",
  check = false,
  size = "md",
  style,
  ...rest
}) {
  const tones = {
    teal: {
      color: "var(--teal-800)",
      background: "var(--teal-50)",
      border: "rgba(11,100,116,0.16)"
    },
    leaf: {
      color: "var(--leaf-800)",
      background: "var(--leaf-50)",
      border: "rgba(93,143,51,0.20)"
    },
    neutral: {
      color: "var(--slate-700)",
      background: "var(--mist)",
      border: "var(--border)"
    },
    solid: {
      color: "#fff",
      background: "var(--teal-700)",
      border: "transparent"
    },
    accent: {
      color: "var(--teal-900)",
      background: "var(--leaf-500)",
      border: "transparent"
    }
  };
  const sizes = {
    sm: {
      minHeight: 26,
      padding: "0 10px",
      fontSize: "0.72rem"
    },
    md: {
      minHeight: 34,
      padding: "0 14px",
      fontSize: "0.8rem"
    }
  };
  const t = tones[tone];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      borderRadius: "var(--radius-pill)",
      fontFamily: "var(--font-sans)",
      fontWeight: "var(--fw-bold)",
      letterSpacing: "0.01em",
      color: t.color,
      background: t.background,
      border: `1px solid ${t.border}`,
      ...sizes[size],
      ...style
    }
  }, rest), check && /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
    style: {
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6L9 17l-5-5",
    stroke: "currentColor",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the primary action element across the Iman site.
 * Pill-shaped, three variants, three sizes. Renders as <a> when `href` is set.
 */
function Button({
  children,
  variant = "primary",
  size = "md",
  href,
  type = "button",
  fullWidth = false,
  disabled = false,
  iconLeft,
  iconRight,
  style,
  ...rest
}) {
  const sizes = {
    sm: {
      minHeight: 42,
      padding: "0 18px",
      fontSize: "0.9rem"
    },
    md: {
      minHeight: 52,
      padding: "0 26px",
      fontSize: "1rem"
    },
    lg: {
      minHeight: 60,
      padding: "0 34px",
      fontSize: "1.06rem"
    }
  };
  const variants = {
    primary: {
      color: "var(--brand-contrast)",
      background: "linear-gradient(135deg, var(--teal-700), var(--teal-600))",
      border: "1px solid transparent",
      boxShadow: "var(--shadow-brand)"
    },
    accent: {
      color: "var(--teal-900)",
      background: "linear-gradient(135deg, var(--leaf-500), var(--leaf-600))",
      border: "1px solid transparent",
      boxShadow: "var(--shadow-accent)"
    },
    secondary: {
      color: "var(--brand)",
      background: "var(--paper)",
      border: "1px solid var(--border-strong)",
      boxShadow: "var(--shadow-xs)"
    },
    ghost: {
      color: "var(--brand)",
      background: "transparent",
      border: "1px solid transparent",
      boxShadow: "none"
    }
  };
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: fullWidth ? "100%" : "auto",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-sans)",
    fontWeight: "var(--fw-bold)",
    letterSpacing: "0.01em",
    lineHeight: 1,
    textDecoration: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-base) var(--ease-out), filter var(--dur-fast) var(--ease-out)",
    ...sizes[size],
    ...variants[variant],
    ...style
  };
  const onEnter = e => {
    if (disabled) return;
    e.currentTarget.style.transform = "translateY(-2px)";
    if (variant === "secondary") e.currentTarget.style.borderColor = "var(--brand)";
    if (variant === "ghost") e.currentTarget.style.background = "var(--teal-50)";
    if (variant === "primary" || variant === "accent") e.currentTarget.style.filter = "brightness(1.05)";
  };
  const onLeave = e => {
    e.currentTarget.style.transform = "translateY(0)";
    e.currentTarget.style.filter = "none";
    if (variant === "secondary") e.currentTarget.style.borderColor = "var(--border-strong)";
    if (variant === "ghost") e.currentTarget.style.background = "transparent";
  };
  const content = /*#__PURE__*/React.createElement(React.Fragment, null, iconLeft, children, iconRight);
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      style: base,
      onMouseEnter: onEnter,
      onMouseLeave: onLeave
    }, rest), content);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    style: base,
    onMouseEnter: onEnter,
    onMouseLeave: onLeave
  }, rest), content);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Card — the base white surface used for content blocks across the site.
 * `tone` swaps the background wash; `interactive` adds a lift on hover.
 */
function Card({
  children,
  tone = "paper",
  padding = "lg",
  interactive = false,
  as = "div",
  style,
  ...rest
}) {
  const tones = {
    paper: {
      background: "var(--surface-card)",
      border: "var(--border-subtle)"
    },
    teal: {
      background: "var(--teal-50)",
      border: "rgba(11,100,116,0.12)"
    },
    leaf: {
      background: "var(--leaf-50)",
      border: "rgba(93,143,51,0.16)"
    },
    brand: {
      background: "linear-gradient(150deg, var(--teal-900), var(--teal-700))",
      border: "transparent"
    },
    cream: {
      background: "var(--cream)",
      border: "var(--border-subtle)"
    }
  };
  const pads = {
    sm: "var(--space-5)",
    md: "var(--space-6)",
    lg: "var(--space-8)"
  };
  const t = tones[tone];
  const Tag = as;
  const onEnter = e => {
    if (!interactive) return;
    e.currentTarget.style.transform = "translateY(-4px)";
    e.currentTarget.style.boxShadow = "var(--shadow-lg)";
  };
  const onLeave = e => {
    if (!interactive) return;
    e.currentTarget.style.transform = "translateY(0)";
    e.currentTarget.style.boxShadow = "var(--shadow-sm)";
  };
  return /*#__PURE__*/React.createElement(Tag, _extends({
    onMouseEnter: onEnter,
    onMouseLeave: onLeave,
    style: {
      padding: pads[padding],
      borderRadius: "var(--radius-xl)",
      background: t.background,
      border: `1px solid ${t.border}`,
      boxShadow: "var(--shadow-sm)",
      color: tone === "brand" ? "var(--text-on-brand)" : "var(--text-body)",
      transition: "transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Field — labelled form control matching the Iman quote form styling.
 * Renders an input, select, or textarea based on `as`. Visual only; the live
 * quote form keeps its own field logic.
 */
function Field({
  label,
  as = "input",
  required = false,
  hint,
  options = [],
  invalid = false,
  id,
  style,
  ...rest
}) {
  const controlStyle = {
    width: "100%",
    minHeight: as === "textarea" ? 120 : 52,
    padding: "13px 16px",
    fontFamily: "var(--font-sans)",
    fontSize: "1rem",
    color: "var(--text-strong)",
    background: "var(--paper)",
    border: `1px solid ${invalid ? "var(--danger)" : "var(--border)"}`,
    borderRadius: "var(--radius-md)",
    outline: "none",
    resize: as === "textarea" ? "vertical" : undefined,
    transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)"
  };
  const onFocus = e => {
    e.currentTarget.style.borderColor = "var(--brand)";
    e.currentTarget.style.boxShadow = "0 0 0 3px var(--ring)";
  };
  const onBlur = e => {
    e.currentTarget.style.borderColor = invalid ? "var(--danger)" : "var(--border)";
    e.currentTarget.style.boxShadow = "none";
  };
  let control;
  if (as === "select") {
    control = /*#__PURE__*/React.createElement("select", _extends({
      id: id,
      style: controlStyle,
      onFocus: onFocus,
      onBlur: onBlur
    }, rest), options.map(o => /*#__PURE__*/React.createElement("option", {
      key: o.value ?? o,
      value: o.value ?? o
    }, o.label ?? o)));
  } else if (as === "textarea") {
    control = /*#__PURE__*/React.createElement("textarea", _extends({
      id: id,
      style: controlStyle,
      onFocus: onFocus,
      onBlur: onBlur
    }, rest));
  } else {
    control = /*#__PURE__*/React.createElement("input", _extends({
      id: id,
      style: controlStyle,
      onFocus: onFocus,
      onBlur: onBlur
    }, rest));
  }
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      display: "grid",
      gap: 7,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "0.88rem",
      fontWeight: "var(--fw-semibold)",
      color: "var(--text-strong)"
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--danger)"
    }
  }, " *")), control, hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "0.8rem",
      color: "var(--text-muted)",
      lineHeight: 1.5
    }
  }, hint));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/marketing/FaqItem.jsx
try { (() => {
/**
 * FaqItem — an accessible accordion row built on <details>/<summary>.
 * Used in the homepage FAQ and on service pages.
 */
function FaqItem({
  question,
  children,
  defaultOpen = false,
  style
}) {
  return /*#__PURE__*/React.createElement("details", {
    open: defaultOpen,
    style: {
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border-subtle)",
      background: "var(--surface-card)",
      boxShadow: "var(--shadow-xs)",
      overflow: "hidden",
      ...style
    }
  }, /*#__PURE__*/React.createElement("summary", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      padding: "20px 24px",
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-semibold)",
      fontSize: "1.08rem",
      color: "var(--text-strong)",
      cursor: "pointer",
      listStyle: "none"
    }
  }, question, /*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "22",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
    style: {
      flexShrink: 0,
      color: "var(--brand)"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 24px 22px",
      color: "var(--text-muted)",
      lineHeight: 1.7
    }
  }, children));
}
Object.assign(__ds_scope, { FaqItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/FaqItem.jsx", error: String((e && e.message) || e) }); }

// components/marketing/FeatureTile.jsx
try { (() => {
/**
 * FeatureTile — an icon badge + heading + supporting copy. The workhorse for
 * "why us", trust, and how-it-works grids. `layout` switches between a stacked
 * card and a horizontal row. Pass any SVG node as `icon`.
 */
function FeatureTile({
  icon,
  title,
  children,
  layout = "stack",
  number,
  style
}) {
  const iconBadge = /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      width: 52,
      height: 52,
      borderRadius: "var(--radius-md)",
      color: "var(--teal-700)",
      background: "var(--teal-50)",
      border: "1px solid rgba(11,100,116,0.14)",
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-bold)",
      fontSize: "1.15rem"
    }
  }, number ?? icon);
  if (layout === "row") {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
        ...style
      }
    }, iconBadge, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        fontSize: "1.18rem",
        color: "var(--text-strong)"
      }
    }, title), /*#__PURE__*/React.createElement("p", {
      style: {
        color: "var(--text-muted)",
        lineHeight: 1.65
      }
    }, children)));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 14,
      padding: "var(--space-6)",
      borderRadius: "var(--radius-lg)",
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      boxShadow: "var(--shadow-xs)",
      ...style
    }
  }, iconBadge, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: "1.18rem",
      color: "var(--text-strong)"
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      color: "var(--text-muted)",
      lineHeight: 1.65
    }
  }, children));
}
Object.assign(__ds_scope, { FeatureTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/FeatureTile.jsx", error: String((e && e.message) || e) }); }

// components/marketing/ServiceCard.jsx
try { (() => {
/**
 * ServiceCard — a service offering with image, title, price tag, blurb, and a
 * "what's included" link. Mirrors the home service grid. Content (names, prices)
 * is passed in as props so the live service data stays the source of truth.
 */
function ServiceCard({
  title,
  price,
  image,
  blurb,
  points = [],
  href = "#",
  featured = false,
  style
}) {
  return /*#__PURE__*/React.createElement("article", {
    style: {
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: "var(--surface-card)",
      border: `1px solid ${featured ? "rgba(11,100,116,0.28)" : "var(--border-subtle)"}`,
      borderRadius: "var(--radius-xl)",
      boxShadow: featured ? "var(--shadow-md)" : "var(--shadow-sm)",
      transition: "transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
      ...style
    },
    onMouseEnter: e => {
      e.currentTarget.style.transform = "translateY(-4px)";
      e.currentTarget.style.boxShadow = "var(--shadow-lg)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = "translateY(0)";
      e.currentTarget.style.boxShadow = featured ? "var(--shadow-md)" : "var(--shadow-sm)";
    }
  }, image && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      aspectRatio: "16 / 10",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: title,
    loading: "lazy",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }), featured && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 14,
      left: 14
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "accent",
    size: "sm"
  }, "Most requested"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12,
      padding: "var(--space-6)",
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: "1.3rem",
      color: "var(--text-strong)"
    }
  }, title), price && /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      fontFamily: "var(--font-sans)",
      fontWeight: "var(--fw-bold)",
      fontSize: "0.85rem",
      color: "var(--accent-deep)"
    }
  }, price)), blurb && /*#__PURE__*/React.createElement("p", {
    style: {
      color: "var(--text-muted)",
      lineHeight: 1.6
    }
  }, blurb), points.length > 0 && /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "grid",
      gap: 8
    }
  }, points.map((p, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    style: {
      display: "flex",
      gap: 9,
      fontSize: "0.92rem",
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
    style: {
      flexShrink: 0,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "11",
    fill: "var(--leaf-100)"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M17 9l-5.5 5.5L8 11",
    stroke: "var(--leaf-700)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), p))), /*#__PURE__*/React.createElement("a", {
    href: href,
    style: {
      marginTop: "auto",
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      fontWeight: "var(--fw-bold)",
      fontSize: "0.95rem",
      color: "var(--brand)"
    }
  }, "See what\u2019s included", /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 6l6 6-6 6",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))));
}
Object.assign(__ds_scope, { ServiceCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/ServiceCard.jsx", error: String((e && e.message) || e) }); }

// components/marketing/ServiceListCard.jsx
try { (() => {
/**
 * ServiceListCard — a category card (e.g. Residential / Commercial) with a photo
 * header and a clickable list of services, each showing a "Starts at …" price.
 * Clicking a row navigates to that service's detail page.
 */
function ServiceListCard({
  title,
  kicker,
  image,
  services = [],
  style
}) {
  return /*#__PURE__*/React.createElement("article", {
    style: {
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-2xl)",
      boxShadow: "var(--shadow-md)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      aspectRatio: "16 / 8",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: title,
    loading: "lazy",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "linear-gradient(180deg, rgba(5,54,64,0) 35%, rgba(5,54,64,.78))"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 22,
      bottom: 18
    }
  }, kicker && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginBottom: 4,
      fontFamily: "var(--font-sans)",
      fontSize: "0.74rem",
      fontWeight: "var(--fw-bold)",
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "var(--leaf-300)"
    }
  }, kicker), /*#__PURE__*/React.createElement("h3", {
    style: {
      color: "#fff",
      fontSize: "1.55rem"
    }
  }, title))), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: "8px 0",
      flex: 1
    }
  }, services.map(s => /*#__PURE__*/React.createElement("li", {
    key: s.name
  }, /*#__PURE__*/React.createElement("a", {
    href: s.href || "#",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "15px 22px",
      color: "var(--text-strong)",
      borderTop: "1px solid var(--border-subtle)",
      transition: "background var(--dur-fast) var(--ease-out)"
    },
    onMouseEnter: e => e.currentTarget.style.background = "var(--teal-50)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "grid",
      gap: 2,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: "1.05rem",
      fontWeight: "var(--fw-semibold)"
    }
  }, s.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "0.85rem",
      fontWeight: "var(--fw-semibold)",
      color: "var(--accent-deep)"
    }
  }, s.price && /^\d|^\$/.test(String(s.price).trim()) ? `Starts at ${s.price}` : s.price || "Custom quote")), /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
    style: {
      flexShrink: 0,
      color: "var(--brand)"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 6l6 6-6 6",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))))));
}
Object.assign(__ds_scope, { ServiceListCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/ServiceListCard.jsx", error: String((e && e.message) || e) }); }

// design_handoff_website_redesign/ui_kits/website/chrome.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Iman Cleaning — shared site chrome: Icon set, Header, Footer.
   Loaded by every UI-kit page. Exported to window.ImanChrome. */
(function () {
  const {
    Button,
    Badge
  } = window.ImanCleaningDesignSystem_5652ad;
  const D = window.IMAN_DATA;
  const Icon = ({
    name,
    size = 24,
    stroke = "currentColor",
    sw = 1.8
  }) => {
    const p = {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke,
      strokeWidth: sw,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    };
    const paths = {
      shield: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M9 12l2 2 4-4"
      })),
      quote: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M7 7h4v4c0 2-1.4 3.4-3.4 4M14 7h4v4c0 2-1.4 3.4-3.4 4"
      })),
      pin: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "10",
        r: "2.6"
      })),
      clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "9"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M12 7v5l3.5 2"
      })),
      phone: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M5 4h3l1.5 4.5L7.5 10a12 12 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z"
      })),
      arrow: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M5 12h14M13 6l6 6-6 6"
      })),
      star: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17l-5.4 2.7 1.2-6.1L3.3 9.4l6.1-.8L12 3z",
        fill: stroke,
        stroke: "none"
      })),
      check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M20 6L9 17l-5-5",
        strokeWidth: "2.4"
      })),
      sparkle: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z"
      })),
      mail: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "3",
        y: "5",
        width: "18",
        height: "14",
        rx: "2"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M4 7l8 6 8-6"
      })),
      menu: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 7h16M4 12h16M4 17h16"
      })),
      home: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 11l8-6 8 6"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M6 10v9h12v-9"
      })),
      building: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "5",
        y: "3",
        width: "14",
        height: "18",
        rx: "1.5"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"
      })),
      truck: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "2",
        y: "7",
        width: "12",
        height: "9",
        rx: "1"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M14 10h4l3 3v3h-7"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "7",
        cy: "18",
        r: "1.8"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "17",
        cy: "18",
        r: "1.8"
      })),
      calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "4",
        y: "5",
        width: "16",
        height: "16",
        rx: "2"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M4 9h16M8 3v4M16 3v4"
      })),
      camera: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 8h3l1.5-2h7L17 8h3v11H4z"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "13",
        r: "3.2"
      })),
      play: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "9"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M10 9l5 3-5 3z",
        fill: stroke,
        stroke: "none"
      })),
      leaf: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M5 19c0-8 6-13 14-13 0 8-6 13-14 13z"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M5 19c3-4 7-6 11-7"
      })),
      heart: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5c0 5-7 9.5-7 9.5z"
      })),
      message: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 5h16v11H8l-4 4z"
      }))
    };
    return /*#__PURE__*/React.createElement("svg", _extends({}, p, {
      "aria-hidden": "true",
      style: {
        flexShrink: 0
      }
    }), paths[name]);
  };
  function Header({
    active,
    onDark = false
  }) {
    const [scrolled, setScrolled] = React.useState(false);
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => {
      const onScroll = () => setScrolled(window.scrollY > 24);
      window.addEventListener("scroll", onScroll, {
        passive: true
      });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }, []);
    const nav = [{
      label: "Services",
      href: "./services-hub.html",
      key: "services"
    }, {
      label: "Why Iman",
      href: "./why-us.html",
      key: "why"
    }, {
      label: "Areas We Serve",
      href: "./areas.html",
      key: "areas"
    }, {
      label: "FAQs",
      href: "./faq.html",
      key: "faq"
    }, {
      label: "Contact",
      href: "./contact.html",
      key: "contact"
    }];
    return /*#__PURE__*/React.createElement("header", {
      className: "site-header is-homepage" + (scrolled ? " is-scrolled" : "") + (onDark ? " on-dark" : "")
    }, /*#__PURE__*/React.createElement("div", {
      className: "hdr-inner ds-shell"
    }, /*#__PURE__*/React.createElement("a", {
      href: "./index.html",
      className: "hdr-brand",
      "aria-label": "Iman Cleaning Service LLC home"
    }, /*#__PURE__*/React.createElement("img", {
      className: "hdr-mark",
      src: "./iman-logo-icon.png",
      alt: "Iman Cleaning Service LLC",
      width: "46",
      height: "46"
    }), /*#__PURE__*/React.createElement("span", {
      className: "hdr-words",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("strong", null, "IMAN"), /*#__PURE__*/React.createElement("small", null, "Cleaning Service LLC"))), /*#__PURE__*/React.createElement("nav", {
      className: "hdr-nav",
      "data-open": open,
      "aria-label": "Primary navigation"
    }, nav.map(n => /*#__PURE__*/React.createElement("a", {
      key: n.key,
      href: n.href,
      "aria-current": active === n.key ? "page" : undefined
    }, n.label))), /*#__PURE__*/React.createElement("div", {
      className: "hdr-actions"
    }, /*#__PURE__*/React.createElement(Button, {
      href: D.phoneHref,
      variant: "secondary",
      size: "sm",
      "aria-label": "Call Iman Cleaning Service",
      "data-conv": "call"
    }, "Call Us"), /*#__PURE__*/React.createElement(Button, {
      href: "./book-now.html",
      variant: "accent",
      size: "sm",
      "aria-label": "Book a cleaning service online",
      "data-conv": "book"
    }, "Book Online"), /*#__PURE__*/React.createElement("button", {
      className: "hdr-burger",
      "aria-label": open ? "Close menu" : "Open menu",
      "aria-expanded": open,
      onClick: () => setOpen(!open)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "menu",
      stroke: onDark && !scrolled ? "#fff" : "var(--ink)"
    })))));
  }
  function Footer() {
    const contacts = [{
      icon: "mail",
      h: "Email us",
      v: "Info@imancleaningservice.com",
      href: "mailto:Info@imancleaningservice.com"
    }, {
      icon: "pin",
      h: "Service area",
      v: "Queens, Brooklyn, Manhattan, Staten Island, and the Bronx",
      href: "./areas.html"
    }, {
      icon: "phone",
      h: "Call us",
      v: "929-803-4053",
      href: "tel:+19298034053"
    }, {
      icon: "clock",
      h: "Business hours",
      v: "Open 24 hours · 7 days a week"
    }];
    const socials = [{
      name: "Instagram",
      href: "https://www.instagram.com/imancleaningservicellc/",
      bg: "radial-gradient(circle at 30% 110%, #ffd35c 0%, #ff9a4d 22%, #fd3f6c 46%, #d534b8 70%, #3f5cff 100%)",
      fg: "#fff",
      path: "M7.8 3h8.4A4.8 4.8 0 0 1 21 7.8v8.4A4.8 4.8 0 0 1 16.2 21H7.8A4.8 4.8 0 0 1 3 16.2V7.8A4.8 4.8 0 0 1 7.8 3Zm0 1.8A3 3 0 0 0 4.8 7.8v8.4a3 3 0 0 0 3 3h8.4a3 3 0 0 0 3-3V7.8a3 3 0 0 0-3-3H7.8Zm8.9 1.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z"
    }, {
      name: "Facebook",
      href: "https://www.facebook.com/Imancleaningservicellc/",
      bg: "#1877f2",
      fg: "#fff",
      path: "M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.6 1.6-1.6H16V4.8c-.2 0-.9-.1-1.8-.1-2.7 0-4.3 1.6-4.3 4.5V11H7.5v3h2.4v7h3.6Z"
    }, {
      name: "YouTube",
      href: "https://www.youtube.com/@ImanCleaningServiceLLC",
      bg: "#ff0000",
      fg: "#fff",
      path: "M21.6 7.2a2.9 2.9 0 0 0-2-2A34.6 34.6 0 0 0 12 4.8a34.6 34.6 0 0 0-7.6.4 2.9 2.9 0 0 0-2 2A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 2.9 2.9 0 0 0 2 2 34.6 34.6 0 0 0 7.6.4 34.6 34.6 0 0 0 7.6-.4 2.9 2.9 0 0 0 2-2A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z"
    }, {
      name: "TikTok",
      href: "https://www.tiktok.com/@imancleaningservicellc",
      bg: "#111",
      fg: "#fff",
      path: "M14.6 3c.3 2 1.5 3.5 3.4 4.1v2.7a6.7 6.7 0 0 1-3.4-1.1v6.3a5 5 0 1 1-4.1-4.9v2.8a2.2 2.2 0 1 0 1.4 2V3h2.7Z"
    }, {
      name: "Google Business Profile",
      href: "https://share.google/EAX7wC22J4PyMKcNx",
      bg: "#fff",
      fg: "#fff",
      google: true
    }];
    const Google = () => /*#__PURE__*/React.createElement("svg", {
      width: "22",
      height: "22",
      viewBox: "0 0 24 24",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      fill: "#4285F4",
      d: "M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z"
    }), /*#__PURE__*/React.createElement("path", {
      fill: "#34A853",
      d: "M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z"
    }), /*#__PURE__*/React.createElement("path", {
      fill: "#FBBC04",
      d: "M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z"
    }), /*#__PURE__*/React.createElement("path", {
      fill: "#EA4335",
      d: "M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z"
    }));
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("footer", {
      className: "site-footer",
      "aria-label": "Website footer"
    }, /*#__PURE__*/React.createElement("div", {
      className: "ds-shell"
    }, /*#__PURE__*/React.createElement("div", {
      className: "footer-brand"
    }, /*#__PURE__*/React.createElement("span", {
      className: "footer-mark",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Iman Cleaning Service LLC"), /*#__PURE__*/React.createElement("span", null, "Residential & commercial cleaning"))), /*#__PURE__*/React.createElement("div", {
      className: "footer-grid"
    }, contacts.map(c => /*#__PURE__*/React.createElement("div", {
      key: c.h,
      className: "footer-cell"
    }, /*#__PURE__*/React.createElement("span", {
      className: "footer-ico",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: c.icon,
      size: 20,
      stroke: "#fff"
    })), /*#__PURE__*/React.createElement("h4", null, c.h), /*#__PURE__*/React.createElement("p", null, c.href ? /*#__PURE__*/React.createElement("a", {
      href: c.href
    }, c.v) : c.v))), /*#__PURE__*/React.createElement("div", {
      className: "footer-follow"
    }, /*#__PURE__*/React.createElement("h4", null, "Follow us for more"), /*#__PURE__*/React.createElement("div", {
      className: "social-row"
    }, socials.map(s => /*#__PURE__*/React.createElement("a", {
      key: s.name,
      className: "social-ico" + (s.google ? " is-google" : ""),
      href: s.href,
      target: "_blank",
      rel: "noopener noreferrer",
      "aria-label": s.name,
      style: {
        background: s.bg,
        color: s.fg
      }
    }, s.google ? /*#__PURE__*/React.createElement(Google, null) : /*#__PURE__*/React.createElement("svg", {
      width: "22",
      height: "22",
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      d: s.path
    })))))), /*#__PURE__*/React.createElement("div", {
      className: "footer-bottom"
    }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Iman Cleaning Service LLC. All rights reserved."), /*#__PURE__*/React.createElement("nav", {
      className: "footer-legal",
      "aria-label": "Legal"
    }, /*#__PURE__*/React.createElement("a", {
      href: "./privacy-policy.html"
    }, "Privacy Policy"), /*#__PURE__*/React.createElement("a", {
      href: "./sms-terms.html"
    }, "SMS Terms")))))));
  }
  window.ImanChrome = {
    Icon,
    Header,
    Footer
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_website_redesign/ui_kits/website/chrome.jsx", error: String((e && e.message) || e) }); }

// design_handoff_website_redesign/ui_kits/website/data.js
try { (() => {
/* Iman Cleaning — homepage content. Service names & prices mirror the live
   site exactly (do not diverge). Everything else is conversion-focused copy. */
window.IMAN_DATA = {
  phone: "929-803-4053",
  phoneHref: "tel:9298034053",
  nav: [{
    label: "Services",
    href: "#services"
  }, {
    label: "How it works",
    href: "#how"
  }, {
    label: "Why us",
    href: "#why"
  }, {
    label: "Service areas",
    href: "#areas"
  }, {
    label: "FAQs",
    href: "./faq.html"
  }],
  services: [{
    title: "Standard Cleaning",
    price: "Starting at $200",
    image: "../../home-hero-clean-living-room.jpg",
    blurb: "Regular upkeep that keeps your home reliably fresh between visits.",
    points: ["Kitchens, baths, bedrooms & living areas", "Weekly, biweekly, monthly, or one-time"],
    href: "#"
  }, {
    title: "Deep Cleaning",
    price: "Starting at $300",
    image: "../../contact-kitchen-hero.jpg",
    blurb: "First-time cleanings, seasonal resets, and heavier buildup.",
    points: ["Detailed high-touch & neglected areas", "Photos help us size the team accurately"],
    href: "#",
    featured: true
  }, {
    title: "Move-In / Move-Out",
    price: "Starting at $300",
    image: "../../home-hero-team.jpg",
    blurb: "A clean handoff for apartments, homes, and rental turnovers.",
    points: ["Empty-space cleaning for leases", "Ideal before photos, staging, or keys"],
    href: "#"
  }, {
    title: "Office & Commercial",
    price: "Custom quote",
    image: "../../home-hero-clean-living-room.jpg",
    blurb: "Offices, retail, clinics, restaurants, and recurring janitorial.",
    points: ["Walkthroughs for larger spaces", "Recurring janitorial options available"],
    href: "#"
  }],
  steps: [{
    n: "01",
    title: "Request your quote",
    body: "Send your details online or call us. Add photos of the space so we can quote accurately."
  }, {
    n: "02",
    title: "We confirm everything",
    body: "We call you back to review the scope, timing, and exact price — so it's all clear before you commit."
  }, {
    n: "03",
    title: "Approve & pay",
    body: "Happy with the quote? Confirm and pay to lock in your appointment for the day that works for you."
  }, {
    n: "04",
    title: "We clean, you relax",
    body: "On the scheduled day, an insured Iman crew arrives on time and leaves the space spotless."
  }],
  reasons: [{
    icon: "shield",
    title: "Fully Insured & Background Checked",
    body: "Licensed and insured cleaners you can trust in your home or business."
  }, {
    icon: "quote",
    title: "Upfront Pricing",
    body: "No hidden fees. You'll know the exact cost before service begins."
  }, {
    icon: "sparkle",
    title: "Supplies & Equipment Included",
    body: "We bring the professional products and tools needed for a thorough clean."
  }, {
    icon: "heart",
    title: "Satisfaction Guaranteed",
    body: "If we missed something, let us know before we leave and we'll make it right."
  }],
  serviceCategories: [{
    title: "Residential Cleaning",
    kicker: "Homes & apartments",
    image: "../../home-hero-clean-living-room.jpg",
    services: [{
      name: "Standard Cleaning",
      price: "$180",
      href: "./service-detail.html"
    }, {
      name: "Deep Cleaning",
      price: "$280",
      href: "./service-detail.html"
    }, {
      name: "Move-In / Move-Out",
      price: "$280",
      href: "./service-detail.html"
    }, {
      name: "Detailed Cleaning",
      price: "Custom quote",
      href: "./service-detail.html"
    }, {
      name: "Extreme Cleaning",
      price: "Custom quote",
      href: "./service-detail.html"
    }, {
      name: "Organization Services",
      price: "Custom quote",
      href: "./service-detail.html"
    }]
  }, {
    title: "Commercial Cleaning",
    kicker: "Offices & businesses",
    image: "../../assets/commercial-restaurant.png",
    services: [{
      name: "Office Cleaning",
      price: "Custom quote",
      href: "./office-cleaning.html"
    }, {
      name: "Retail Store Cleaning",
      price: "Custom quote",
      href: "./retail-store-cleaning.html"
    }, {
      name: "Restaurant Cleaning",
      price: "Custom quote",
      href: "./restaurant-cleaning.html"
    }, {
      name: "Medical & Clinic Cleaning",
      price: "Custom quote",
      href: "./medical-clinic-cleaning.html"
    }, {
      name: "Post-Construction Cleaning",
      price: "Custom quote",
      href: "./post-construction-cleaning.html"
    }, {
      name: "Janitorial / Recurring Cleaning",
      price: "Custom quote",
      href: "./janitorial-recurring-cleaning.html"
    }]
  }, {
    title: "Window Cleaning",
    kicker: "Homes & businesses",
    image: "../../assets/window-cleaning-card.jpg",
    services: [{
      name: "Interior & Exterior Glass",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }, {
      name: "Frames, Sills & Tracks",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }, {
      name: "Homes & Apartments",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }, {
      name: "Offices & Storefronts",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }]
  }],
  boroughs: ["Manhattan", "Brooklyn", "Queens", "The Bronx", "Staten Island"],
  faqs: [{
    q: "Do I get a price before the appointment is confirmed?",
    a: "Yes. Submit the quote request, and we review the space details before confirming the service scope and total.",
    open: true
  }, {
    q: "Do you clean in all five NYC boroughs?",
    a: "Yes. Iman Cleaning Service LLC serves Manhattan, Brooklyn, Queens, The Bronx, and Staten Island."
  }, {
    q: "Can I request commercial cleaning?",
    a: "Yes. Offices, retail stores, restaurants, clinics, and recurring janitorial requests can be submitted through the quote form. Larger jobs may need a phone consultation or walkthrough."
  }, {
    q: "What should I include in my quote request?",
    a: "Share your service type, address, preferred dates, space details, and photos if the job needs deeper review."
  }, {
    q: "What hours are available?",
    a: "Cleaning can be scheduled between 8:00 AM and 8:00 PM, seven days a week, based on availability."
  }, {
    q: "Why is Iman priced higher than a typical cleaning service?",
    a: "Because we don't cut the corners that cheaper services do. Iman Cleaning Service LLC is fully licensed and insured, our cleaners are trained professionals (not gig fill-ins), and we use top-quality, professional-grade supplies and equipment. We never rush a job — every clean is thorough and detailed, and we ask up front what you'd like us to pay extra attention to. You're paying for work done right by a team that keeps its word."
  }, {
    q: "My budget is low — is Iman right for me?",
    a: "Honestly, if price is your top priority, we may not be the best fit. We focus on quality over being the cheapest option — fully insured, trained cleaners, professional-grade supplies, and detailed work that isn't rushed. If that's what you're looking for, we'd love to help."
  }],
  review: {
    name: "Verified Google review",
    text: "They did a great job cleaning my house. They showed up on time, were friendly, and paid attention to the little things. My place looked and smelled so much better when they were done. Definitely worth it, and I’d use them again.",
    author: "Mahin Muhtasimul"
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_website_redesign/ui_kits/website/data.js", error: String((e && e.message) || e) }); }

// design_handoff_website_redesign/ui_kits/website/sections.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Iman Cleaning — homepage sections. Composes design-system components from
   the compiled bundle. Exported to window.ImanSite for index.html. */
const {
  Button,
  Badge,
  Card,
  ServiceCard,
  ServiceListCard,
  FeatureTile,
  FaqItem
} = window.ImanCleaningDesignSystem_5652ad;
const {
  Icon,
  Header,
  Footer
} = window.ImanChrome;
const D = window.IMAN_DATA;

/* ---- Hero -------------------------------------------------------------- */
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    className: "page-hero on-photo home-hero-photo",
    id: "top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell page-hero-inner"
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "leaf",
    check: true,
    size: "sm"
  }, "Fully Insured \u2022 Background-Checked Cleaners"), /*#__PURE__*/React.createElement("h1", null, "Reliable Cleaning Services in NYC & Long Island"), /*#__PURE__*/React.createElement("p", {
    className: "ds-lead"
  }, "Residential and commercial cleaning with clear quotes, flexible scheduling, and easy online booking."), /*#__PURE__*/React.createElement("div", {
    className: "page-hero-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    href: D.phoneHref,
    variant: "accent",
    size: "lg",
    "aria-label": "Call Iman Cleaning Service",
    "data-conv": "call"
  }, "Call Us"), /*#__PURE__*/React.createElement(Button, {
    href: "./book-now.html",
    variant: "secondary",
    size: "lg",
    "aria-label": "Book a cleaning service online",
    "data-conv": "book"
  }, "Book Online")), /*#__PURE__*/React.createElement("div", {
    className: "hero-trust-line",
    "aria-label": "Reviews and business hours"
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://share.google/EAX7wC22J4PyMKcNx",
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": "Read Iman Cleaning Service Google reviews",
    "data-conv": "google_reviews"
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\u2605\u2605\u2605\u2605\u2605"), " Read Our Reviews"), /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-divider",
    "aria-hidden": "true"
  }, "\u2022"), /*#__PURE__*/React.createElement("span", null, "Open 24 hours · 7 days a week"))));
}

/* ---- Proof strip ------------------------------------------------------- */
function ProofStrip() {
  const items = [["Fully insured", "Homes & businesses"], ["All 5 boroughs", "Across New York City"], ["Clear quote first", "Reviewed before booking"], ["Open daily", "8:00 AM – 8:00 PM"]];
  return /*#__PURE__*/React.createElement("section", {
    className: "proof"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell proof-grid"
  }, items.map(([t, s], i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "proof-item"
  }, /*#__PURE__*/React.createElement("strong", null, t), /*#__PURE__*/React.createElement("span", null, s)))));
}

/* ---- Services ---------------------------------------------------------- */
function Services() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section",
    id: "services"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker"
  }, "Start with the right service"), /*#__PURE__*/React.createElement("h2", null, "Choose the cleaning you need today")), /*#__PURE__*/React.createElement("div", {
    className: "two-cards"
  }, D.serviceCategories.map(c => /*#__PURE__*/React.createElement(ServiceListCard, _extends({
    key: c.title
  }, c))))));
}

/* ---- How it works (steps on a wash) ------------------------------------ */
function HowItWorks() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section section-wash",
    id: "how"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-head sec-head-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker"
  }, "Less stress before cleaning day"), /*#__PURE__*/React.createElement("h2", null, "How booking works, start to finish")), /*#__PURE__*/React.createElement("ol", {
    className: "steps"
  }, D.steps.map((s, i) => /*#__PURE__*/React.createElement("li", {
    key: s.n,
    className: "step"
  }, /*#__PURE__*/React.createElement("span", {
    className: "step-n"
  }, s.n), /*#__PURE__*/React.createElement("h3", null, s.title), /*#__PURE__*/React.createElement("p", null, s.body), i < D.steps.length - 1 && /*#__PURE__*/React.createElement("span", {
    className: "step-line",
    "aria-hidden": "true"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "steps-cta"
  }, /*#__PURE__*/React.createElement(Button, {
    href: "./quote.html",
    variant: "primary",
    size: "lg"
  }, "Get a clear quote"))));
}

/* ---- Why us (split: photo + reasons) ----------------------------------- */
function WhyUs() {
  return /*#__PURE__*/React.createElement("section", {
    className: "why-band",
    id: "why"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "why-band-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker",
    style: {
      color: "var(--leaf-300)"
    }
  }, "Why neighbors choose Iman"), /*#__PURE__*/React.createElement("h2", null, "Why NYC homeowners & businesses trust Iman"), /*#__PURE__*/React.createElement("p", null, "Trusted in homes and businesses across all five NYC boroughs \u2014 here's what you get with every visit.")), /*#__PURE__*/React.createElement("div", {
    className: "why-band-grid"
  }, D.reasons.map(r => /*#__PURE__*/React.createElement("div", {
    className: "why-band-card",
    key: r.title
  }, /*#__PURE__*/React.createElement("span", {
    className: "why-band-ico"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: r.icon,
    size: 24,
    stroke: "var(--leaf-300)"
  })), /*#__PURE__*/React.createElement("h3", null, r.title), /*#__PURE__*/React.createElement("p", null, r.body))))));
}

/* ---- Service areas ----------------------------------------------------- */
function Areas() {
  const areas = [{
    name: "Manhattan"
  }, {
    name: "Brooklyn"
  }, {
    name: "Queens"
  }, {
    name: "The Bronx"
  }, {
    name: "Staten Island"
  }, {
    name: "Long Island"
  }];
  return /*#__PURE__*/React.createElement("section", {
    className: "areas-band",
    id: "areas"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell areas-band-inner"
  }, /*#__PURE__*/React.createElement("h2", null, "Areas We Serve"), /*#__PURE__*/React.createElement("ul", {
    className: "areas-links",
    "aria-label": "Cleaning service areas"
  }, areas.map(area => /*#__PURE__*/React.createElement("li", {
    key: area.name
  }, area.href ? /*#__PURE__*/React.createElement("a", {
    href: area.href
  }, area.name) : /*#__PURE__*/React.createElement("span", null, area.name))))));
}

/* ---- Review band (dark teal) ------------------------------------------- */
function ReviewBand() {
  return /*#__PURE__*/React.createElement("section", {
    className: "review-band"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell review-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "review-stars"
  }, [0, 1, 2, 3, 4].map(i => /*#__PURE__*/React.createElement(Icon, {
    key: i,
    name: "star",
    size: 26,
    stroke: "var(--leaf-500)"
  }))), /*#__PURE__*/React.createElement("blockquote", null, "\u201C", D.review.text, "\u201D"), /*#__PURE__*/React.createElement("cite", null, /*#__PURE__*/React.createElement("span", null, "Mahin Muhtasimul"), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, " \xB7 "), /*#__PURE__*/React.createElement("a", {
    href: D.googleReviewsHref,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": "Read Iman Cleaning Service reviews on Google",
    "data-conv": "google_reviews"
  }, "Read Our Google Reviews"))));
}

/* ---- FAQ --------------------------------------------------------------- */
function Faq() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section",
    id: "faq"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell faq-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-head sec-head-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker"
  }, "Fast answers"), /*#__PURE__*/React.createElement("h2", null, "What people ask before booking")), /*#__PURE__*/React.createElement("div", {
    className: "faq-list"
  }, D.faqs.map(f => /*#__PURE__*/React.createElement(FaqItem, {
    key: f.q,
    question: f.q,
    defaultOpen: f.open
  }, f.a)))));
}

/* ---- Final CTA --------------------------------------------------------- */
function FinalCta() {
  return /*#__PURE__*/React.createElement("section", {
    className: "final-cta",
    id: "quote"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell final-inner"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker",
    style: {
      color: "var(--leaf-300)"
    }
  }, "Need a custom quote?"), /*#__PURE__*/React.createElement("h2", null, "Tell us about your cleaning needs."), /*#__PURE__*/React.createElement("p", null, "Share details about your space, what needs cleaning, and your preferred date. We\u2019ll review everything and prepare the right quote for you."), /*#__PURE__*/React.createElement("div", {
    className: "final-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    href: "./quote.html",
    variant: "accent",
    size: "lg",
    "aria-label": "Get a custom cleaning quote from Iman Cleaning Service",
    "data-conv": "quote",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow",
      size: 18
    })
  }, "Get a Custom Quote"), /*#__PURE__*/React.createElement(Button, {
    href: "tel:+19298034053",
    variant: "secondary",
    size: "lg",
    "aria-label": "Call Iman Cleaning Service at 929-803-4053",
    "data-conv": "call",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "phone",
      size: 18,
      stroke: "var(--brand)"
    })
  }, "Call Now"))));
}
function App() {
  return /*#__PURE__*/React.createElement("div", {
    className: "site-scroll"
  }, /*#__PURE__*/React.createElement(Header, {
    onDark: true
  }), /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(Services, null), /*#__PURE__*/React.createElement(Areas, null), /*#__PURE__*/React.createElement(WhyUs, null), /*#__PURE__*/React.createElement(ReviewBand, null), /*#__PURE__*/React.createElement(FinalCta, null)), /*#__PURE__*/React.createElement(Footer, null));
}
window.ImanSite = {
  App
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_website_redesign/ui_kits/website/sections.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/chrome.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Iman Cleaning — shared site chrome: Icon set, Header, Footer.
   Loaded by every UI-kit page. Exported to window.ImanChrome. */
(function () {
  const {
    Button,
    Badge
  } = window.ImanCleaningDesignSystem_5652ad;
  const D = window.IMAN_DATA;
  const Icon = ({
    name,
    size = 24,
    stroke = "currentColor",
    sw = 1.8
  }) => {
    const p = {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke,
      strokeWidth: sw,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    };
    const paths = {
      shield: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M9 12l2 2 4-4"
      })),
      quote: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M7 7h4v4c0 2-1.4 3.4-3.4 4M14 7h4v4c0 2-1.4 3.4-3.4 4"
      })),
      pin: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "10",
        r: "2.6"
      })),
      clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "9"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M12 7v5l3.5 2"
      })),
      phone: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M5 4h3l1.5 4.5L7.5 10a12 12 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z"
      })),
      arrow: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M5 12h14M13 6l6 6-6 6"
      })),
      star: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17l-5.4 2.7 1.2-6.1L3.3 9.4l6.1-.8L12 3z",
        fill: stroke,
        stroke: "none"
      })),
      check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M20 6L9 17l-5-5",
        strokeWidth: "2.4"
      })),
      sparkle: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z"
      })),
      mail: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "3",
        y: "5",
        width: "18",
        height: "14",
        rx: "2"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M4 7l8 6 8-6"
      })),
      menu: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 7h16M4 12h16M4 17h16"
      })),
      home: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 11l8-6 8 6"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M6 10v9h12v-9"
      })),
      building: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "5",
        y: "3",
        width: "14",
        height: "18",
        rx: "1.5"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"
      })),
      truck: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "2",
        y: "7",
        width: "12",
        height: "9",
        rx: "1"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M14 10h4l3 3v3h-7"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "7",
        cy: "18",
        r: "1.8"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "17",
        cy: "18",
        r: "1.8"
      })),
      calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
        x: "4",
        y: "5",
        width: "16",
        height: "16",
        rx: "2"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M4 9h16M8 3v4M16 3v4"
      })),
      camera: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 8h3l1.5-2h7L17 8h3v11H4z"
      }), /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "13",
        r: "3.2"
      })),
      play: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "9"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M10 9l5 3-5 3z",
        fill: stroke,
        stroke: "none"
      })),
      leaf: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M5 19c0-8 6-13 14-13 0 8-6 13-14 13z"
      }), /*#__PURE__*/React.createElement("path", {
        d: "M5 19c3-4 7-6 11-7"
      })),
      heart: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5c0 5-7 9.5-7 9.5z"
      })),
      message: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
        d: "M4 5h16v11H8l-4 4z"
      }))
    };
    return /*#__PURE__*/React.createElement("svg", _extends({}, p, {
      "aria-hidden": "true",
      style: {
        flexShrink: 0
      }
    }), paths[name]);
  };
  function Header({
    active,
    onDark = false
  }) {
    const [scrolled, setScrolled] = React.useState(false);
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => {
      const onScroll = () => setScrolled(window.scrollY > 24);
      window.addEventListener("scroll", onScroll, {
        passive: true
      });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }, []);
    const nav = [{
      label: "Services",
      href: "./services-hub.html",
      key: "services"
    }, {
      label: "Why Iman",
      href: "./why-us.html",
      key: "why"
    }, {
      label: "Areas We Serve",
      href: "./areas.html",
      key: "areas"
    }, {
      label: "FAQs",
      href: "./faq.html",
      key: "faq"
    }, {
      label: "Contact",
      href: "./contact.html",
      key: "contact"
    }];
    return /*#__PURE__*/React.createElement("header", {
      className: "site-header is-homepage" + (scrolled ? " is-scrolled" : "") + (onDark ? " on-dark" : "")
    }, /*#__PURE__*/React.createElement("div", {
      className: "hdr-inner ds-shell"
    }, /*#__PURE__*/React.createElement("a", {
      href: "./index.html",
      className: "hdr-brand",
      "aria-label": "Iman Cleaning Service LLC home"
    }, /*#__PURE__*/React.createElement("img", {
      className: "hdr-mark",
      src: "./iman-logo-icon.png",
      alt: "Iman Cleaning Service LLC",
      width: "46",
      height: "46"
    }), /*#__PURE__*/React.createElement("span", {
      className: "hdr-words",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("strong", null, "IMAN"), /*#__PURE__*/React.createElement("small", null, "Cleaning Service LLC"))), /*#__PURE__*/React.createElement("nav", {
      className: "hdr-nav",
      "data-open": open,
      "aria-label": "Primary navigation"
    }, nav.map(n => /*#__PURE__*/React.createElement("a", {
      key: n.key,
      href: n.href,
      "aria-current": active === n.key ? "page" : undefined
    }, n.label))), /*#__PURE__*/React.createElement("div", {
      className: "hdr-actions"
    }, /*#__PURE__*/React.createElement(Button, {
      href: D.phoneHref,
      variant: "secondary",
      size: "sm",
      "aria-label": "Call Iman Cleaning Service",
      "data-conv": "call"
    }, "Call Us"), /*#__PURE__*/React.createElement(Button, {
      href: "./book-now.html",
      variant: "accent",
      size: "sm",
      "aria-label": "Book a cleaning service online",
      "data-conv": "book"
    }, "Book Online"), /*#__PURE__*/React.createElement("button", {
      className: "hdr-burger",
      "aria-label": open ? "Close menu" : "Open menu",
      "aria-expanded": open,
      onClick: () => setOpen(!open)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "menu",
      stroke: onDark && !scrolled ? "#fff" : "var(--ink)"
    })))));
  }
  function Footer() {
    const contacts = [{
      icon: "mail",
      h: "Email us",
      v: "Info@imancleaningservice.com",
      href: "mailto:Info@imancleaningservice.com"
    }, {
      icon: "pin",
      h: "Service area",
      v: "Queens, Brooklyn, Manhattan, Staten Island, and the Bronx",
      href: "./areas.html"
    }, {
      icon: "phone",
      h: "Call us",
      v: "929-803-4053",
      href: "tel:+19298034053"
    }, {
      icon: "clock",
      h: "Business hours",
      v: "Open 24 hours · 7 days a week"
    }];
    const socials = [{
      name: "Instagram",
      href: "https://www.instagram.com/imancleaningservicellc/",
      bg: "radial-gradient(circle at 30% 110%, #ffd35c 0%, #ff9a4d 22%, #fd3f6c 46%, #d534b8 70%, #3f5cff 100%)",
      fg: "#fff",
      path: "M7.8 3h8.4A4.8 4.8 0 0 1 21 7.8v8.4A4.8 4.8 0 0 1 16.2 21H7.8A4.8 4.8 0 0 1 3 16.2V7.8A4.8 4.8 0 0 1 7.8 3Zm0 1.8A3 3 0 0 0 4.8 7.8v8.4a3 3 0 0 0 3 3h8.4a3 3 0 0 0 3-3V7.8a3 3 0 0 0-3-3H7.8Zm8.9 1.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z"
    }, {
      name: "Facebook",
      href: "https://www.facebook.com/Imancleaningservicellc/",
      bg: "#1877f2",
      fg: "#fff",
      path: "M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.6 1.6-1.6H16V4.8c-.2 0-.9-.1-1.8-.1-2.7 0-4.3 1.6-4.3 4.5V11H7.5v3h2.4v7h3.6Z"
    }, {
      name: "YouTube",
      href: "https://www.youtube.com/@ImanCleaningServiceLLC",
      bg: "#ff0000",
      fg: "#fff",
      path: "M21.6 7.2a2.9 2.9 0 0 0-2-2A34.6 34.6 0 0 0 12 4.8a34.6 34.6 0 0 0-7.6.4 2.9 2.9 0 0 0-2 2A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 2.9 2.9 0 0 0 2 2 34.6 34.6 0 0 0 7.6.4 34.6 34.6 0 0 0 7.6-.4 2.9 2.9 0 0 0 2-2A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z"
    }, {
      name: "TikTok",
      href: "https://www.tiktok.com/@imancleaningservicellc",
      bg: "#111",
      fg: "#fff",
      path: "M14.6 3c.3 2 1.5 3.5 3.4 4.1v2.7a6.7 6.7 0 0 1-3.4-1.1v6.3a5 5 0 1 1-4.1-4.9v2.8a2.2 2.2 0 1 0 1.4 2V3h2.7Z"
    }, {
      name: "Google Business Profile",
      href: "https://share.google/EAX7wC22J4PyMKcNx",
      bg: "#fff",
      fg: "#fff",
      google: true
    }];
    const Google = () => /*#__PURE__*/React.createElement("svg", {
      width: "22",
      height: "22",
      viewBox: "0 0 24 24",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      fill: "#4285F4",
      d: "M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5c-.3 1.4-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.6Z"
    }), /*#__PURE__*/React.createElement("path", {
      fill: "#34A853",
      d: "M12 24c3.2 0 5.9-1.1 7.8-3.1l-3.8-3c-1 .7-2.3 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.5v3.1A12 12 0 0 0 12 24Z"
    }), /*#__PURE__*/React.createElement("path", {
      fill: "#FBBC04",
      d: "M5.4 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.7H1.5A12 12 0 0 0 0 12c0 1.9.5 3.7 1.5 5.3l3.9-3.1Z"
    }), /*#__PURE__*/React.createElement("path", {
      fill: "#EA4335",
      d: "M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.9 1.1 15.2 0 12 0A12 12 0 0 0 1.5 6.7l3.9 3.1c.9-2.8 3.5-5 6.6-5Z"
    }));
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("footer", {
      className: "site-footer",
      "aria-label": "Website footer"
    }, /*#__PURE__*/React.createElement("div", {
      className: "ds-shell"
    }, /*#__PURE__*/React.createElement("div", {
      className: "footer-brand"
    }, /*#__PURE__*/React.createElement("span", {
      className: "footer-mark",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Iman Cleaning Service LLC"), /*#__PURE__*/React.createElement("span", null, "Residential & commercial cleaning"))), /*#__PURE__*/React.createElement("div", {
      className: "footer-grid"
    }, contacts.map(c => /*#__PURE__*/React.createElement("div", {
      key: c.h,
      className: "footer-cell"
    }, /*#__PURE__*/React.createElement("span", {
      className: "footer-ico",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: c.icon,
      size: 20,
      stroke: "#fff"
    })), /*#__PURE__*/React.createElement("h4", null, c.h), /*#__PURE__*/React.createElement("p", null, c.href ? /*#__PURE__*/React.createElement("a", {
      href: c.href
    }, c.v) : c.v))), /*#__PURE__*/React.createElement("div", {
      className: "footer-follow"
    }, /*#__PURE__*/React.createElement("h4", null, "Follow us for more"), /*#__PURE__*/React.createElement("div", {
      className: "social-row"
    }, socials.map(s => /*#__PURE__*/React.createElement("a", {
      key: s.name,
      className: "social-ico" + (s.google ? " is-google" : ""),
      href: s.href,
      target: "_blank",
      rel: "noopener noreferrer",
      "aria-label": s.name,
      style: {
        background: s.bg,
        color: s.fg
      }
    }, s.google ? /*#__PURE__*/React.createElement(Google, null) : /*#__PURE__*/React.createElement("svg", {
      width: "22",
      height: "22",
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      d: s.path
    })))))), /*#__PURE__*/React.createElement("div", {
      className: "footer-bottom"
    }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Iman Cleaning Service LLC. All rights reserved."), /*#__PURE__*/React.createElement("nav", {
      className: "footer-legal",
      "aria-label": "Legal"
    }, /*#__PURE__*/React.createElement("a", {
      href: "./privacy-policy.html"
    }, "Privacy Policy"), /*#__PURE__*/React.createElement("a", {
      href: "./sms-terms.html"
    }, "SMS Terms")))))));
  }
  window.ImanChrome = {
    Icon,
    Header,
    Footer
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/data.js
try { (() => {
/* Iman Cleaning — homepage content. Service names & prices mirror the live
   site exactly (do not diverge). Everything else is conversion-focused copy. */
window.IMAN_DATA = {
  phone: "929-803-4053",
  phoneHref: "tel:9298034053",
  nav: [{
    label: "Services",
    href: "#services"
  }, {
    label: "How it works",
    href: "#how"
  }, {
    label: "Why us",
    href: "#why"
  }, {
    label: "Service areas",
    href: "#areas"
  }, {
    label: "FAQs",
    href: "./faq.html"
  }],
  services: [{
    title: "Standard Cleaning",
    price: "Starting at $200",
    image: "../../home-hero-clean-living-room.jpg",
    blurb: "Regular upkeep that keeps your home reliably fresh between visits.",
    points: ["Kitchens, baths, bedrooms & living areas", "Weekly, biweekly, monthly, or one-time"],
    href: "#"
  }, {
    title: "Deep Cleaning",
    price: "Starting at $300",
    image: "../../contact-kitchen-hero.jpg",
    blurb: "First-time cleanings, seasonal resets, and heavier buildup.",
    points: ["Detailed high-touch & neglected areas", "Photos help us size the team accurately"],
    href: "#",
    featured: true
  }, {
    title: "Move-In / Move-Out",
    price: "Starting at $300",
    image: "../../home-hero-team.jpg",
    blurb: "A clean handoff for apartments, homes, and rental turnovers.",
    points: ["Empty-space cleaning for leases", "Ideal before photos, staging, or keys"],
    href: "#"
  }, {
    title: "Office & Commercial",
    price: "Custom quote",
    image: "../../home-hero-clean-living-room.jpg",
    blurb: "Offices, retail, clinics, restaurants, and recurring janitorial.",
    points: ["Walkthroughs for larger spaces", "Recurring janitorial options available"],
    href: "#"
  }],
  steps: [{
    n: "01",
    title: "Request your quote",
    body: "Send your details online or call us. Add photos of the space so we can quote accurately."
  }, {
    n: "02",
    title: "We confirm everything",
    body: "We call you back to review the scope, timing, and exact price — so it's all clear before you commit."
  }, {
    n: "03",
    title: "Approve & pay",
    body: "Happy with the quote? Confirm and pay to lock in your appointment for the day that works for you."
  }, {
    n: "04",
    title: "We clean, you relax",
    body: "On the scheduled day, an insured Iman crew arrives on time and leaves the space spotless."
  }],
  reasons: [{
    icon: "shield",
    title: "Fully Insured & Background Checked",
    body: "Licensed and insured cleaners you can trust in your home or business."
  }, {
    icon: "quote",
    title: "Upfront Pricing",
    body: "No hidden fees. You'll know the exact cost before service begins."
  }, {
    icon: "sparkle",
    title: "Supplies & Equipment Included",
    body: "We bring the professional products and tools needed for a thorough clean."
  }, {
    icon: "heart",
    title: "Satisfaction Guaranteed",
    body: "If we missed something, let us know before we leave and we'll make it right."
  }],
  serviceCategories: [{
    title: "Residential Cleaning",
    kicker: "Homes & apartments",
    image: "../../home-hero-clean-living-room.jpg",
    services: [{
      name: "Standard Cleaning",
      price: "$180",
      href: "./service-detail.html"
    }, {
      name: "Deep Cleaning",
      price: "$280",
      href: "./service-detail.html"
    }, {
      name: "Move-In / Move-Out",
      price: "$280",
      href: "./service-detail.html"
    }, {
      name: "Detailed Cleaning",
      price: "Custom quote",
      href: "./service-detail.html"
    }, {
      name: "Extreme Cleaning",
      price: "Custom quote",
      href: "./service-detail.html"
    }, {
      name: "Organization Services",
      price: "Custom quote",
      href: "./service-detail.html"
    }]
  }, {
    title: "Commercial Cleaning",
    kicker: "Offices & businesses",
    image: "../../assets/commercial-restaurant.png",
    services: [{
      name: "Office Cleaning",
      price: "Custom quote",
      href: "./office-cleaning.html"
    }, {
      name: "Retail Store Cleaning",
      price: "Custom quote",
      href: "./retail-store-cleaning.html"
    }, {
      name: "Restaurant Cleaning",
      price: "Custom quote",
      href: "./restaurant-cleaning.html"
    }, {
      name: "Medical & Clinic Cleaning",
      price: "Custom quote",
      href: "./medical-clinic-cleaning.html"
    }, {
      name: "Post-Construction Cleaning",
      price: "Custom quote",
      href: "./post-construction-cleaning.html"
    }, {
      name: "Janitorial / Recurring Cleaning",
      price: "Custom quote",
      href: "./janitorial-recurring-cleaning.html"
    }]
  }, {
    title: "Window Cleaning",
    kicker: "Homes & businesses",
    image: "../../assets/window-cleaning-card.jpg",
    services: [{
      name: "Interior & Exterior Glass",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }, {
      name: "Frames, Sills & Tracks",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }, {
      name: "Homes & Apartments",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }, {
      name: "Offices & Storefronts",
      price: "Custom quote",
      href: "./quote.html?service=window-cleaning"
    }]
  }],
  boroughs: ["Manhattan", "Brooklyn", "Queens", "The Bronx", "Staten Island"],
  faqs: [{
    q: "Do I get a price before the appointment is confirmed?",
    a: "Yes. Submit the quote request, and we review the space details before confirming the service scope and total.",
    open: true
  }, {
    q: "Do you clean in all five NYC boroughs?",
    a: "Yes. Iman Cleaning Service LLC serves Manhattan, Brooklyn, Queens, The Bronx, and Staten Island."
  }, {
    q: "Can I request commercial cleaning?",
    a: "Yes. Offices, retail stores, restaurants, clinics, and recurring janitorial requests can be submitted through the quote form. Larger jobs may need a phone consultation or walkthrough."
  }, {
    q: "What should I include in my quote request?",
    a: "Share your service type, address, preferred dates, space details, and photos if the job needs deeper review."
  }, {
    q: "What hours are available?",
    a: "Cleaning can be scheduled between 8:00 AM and 8:00 PM, seven days a week, based on availability."
  }, {
    q: "Why is Iman priced higher than a typical cleaning service?",
    a: "Because we don't cut the corners that cheaper services do. Iman Cleaning Service LLC is fully licensed and insured, our cleaners are trained professionals (not gig fill-ins), and we use top-quality, professional-grade supplies and equipment. We never rush a job — every clean is thorough and detailed, and we ask up front what you'd like us to pay extra attention to. You're paying for work done right by a team that keeps its word."
  }, {
    q: "My budget is low — is Iman right for me?",
    a: "Honestly, if price is your top priority, we may not be the best fit. We focus on quality over being the cheapest option — fully insured, trained cleaners, professional-grade supplies, and detailed work that isn't rushed. If that's what you're looking for, we'd love to help."
  }],
  review: {
    name: "Verified Google review",
    text: "They did a great job cleaning my house. They showed up on time, were friendly, and paid attention to the little things. My place looked and smelled so much better when they were done. Definitely worth it, and I’d use them again.",
    author: "Mahin Muhtasimul"
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/data.js", error: String((e && e.message) || e) }); }

// ui_kits/website/sections.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Iman Cleaning — homepage sections. Composes design-system components from
   the compiled bundle. Exported to window.ImanSite for index.html. */
const {
  Button,
  Badge,
  Card,
  ServiceCard,
  ServiceListCard,
  FeatureTile,
  FaqItem
} = window.ImanCleaningDesignSystem_5652ad;
const {
  Icon,
  Header,
  Footer
} = window.ImanChrome;
const D = window.IMAN_DATA;

/* ---- Hero -------------------------------------------------------------- */
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    className: "page-hero on-photo home-hero-photo",
    id: "top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell page-hero-inner"
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "leaf",
    check: true,
    size: "sm"
  }, "Fully Insured \u2022 Background-Checked Cleaners"), /*#__PURE__*/React.createElement("h1", null, "Reliable Cleaning Services in NYC & Long Island"), /*#__PURE__*/React.createElement("p", {
    className: "ds-lead"
  }, "Residential and commercial cleaning with clear quotes, flexible scheduling, and easy online booking."), /*#__PURE__*/React.createElement("div", {
    className: "page-hero-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    href: D.phoneHref,
    variant: "accent",
    size: "lg",
    "aria-label": "Call Iman Cleaning Service",
    "data-conv": "call"
  }, "Call Us"), /*#__PURE__*/React.createElement(Button, {
    href: "./book-now.html",
    variant: "secondary",
    size: "lg",
    "aria-label": "Book a cleaning service online",
    "data-conv": "book"
  }, "Book Online")), /*#__PURE__*/React.createElement("div", {
    className: "hero-trust-line",
    "aria-label": "Reviews and business hours"
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://share.google/EAX7wC22J4PyMKcNx",
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": "Read Iman Cleaning Service Google reviews",
    "data-conv": "google_reviews"
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\u2605\u2605\u2605\u2605\u2605"), " Read Our Reviews"), /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-divider",
    "aria-hidden": "true"
  }, "\u2022"), /*#__PURE__*/React.createElement("span", null, "Open 24 hours · 7 days a week"))));
}

/* ---- Proof strip ------------------------------------------------------- */
function ProofStrip() {
  const items = [["Fully insured", "Homes & businesses"], ["All 5 boroughs", "Across New York City"], ["Clear quote first", "Reviewed before booking"], ["Open daily", "8:00 AM – 8:00 PM"]];
  return /*#__PURE__*/React.createElement("section", {
    className: "proof"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell proof-grid"
  }, items.map(([t, s], i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "proof-item"
  }, /*#__PURE__*/React.createElement("strong", null, t), /*#__PURE__*/React.createElement("span", null, s)))));
}

/* ---- Services ---------------------------------------------------------- */
function Services() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section",
    id: "services"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker"
  }, "Start with the right service"), /*#__PURE__*/React.createElement("h2", null, "Choose the cleaning you need today")), /*#__PURE__*/React.createElement("div", {
    className: "two-cards"
  }, D.serviceCategories.map(c => /*#__PURE__*/React.createElement(ServiceListCard, _extends({
    key: c.title
  }, c))))));
}

/* ---- How it works (steps on a wash) ------------------------------------ */
function HowItWorks() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section section-wash",
    id: "how"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-head sec-head-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker"
  }, "Less stress before cleaning day"), /*#__PURE__*/React.createElement("h2", null, "How booking works, start to finish")), /*#__PURE__*/React.createElement("ol", {
    className: "steps"
  }, D.steps.map((s, i) => /*#__PURE__*/React.createElement("li", {
    key: s.n,
    className: "step"
  }, /*#__PURE__*/React.createElement("span", {
    className: "step-n"
  }, s.n), /*#__PURE__*/React.createElement("h3", null, s.title), /*#__PURE__*/React.createElement("p", null, s.body), i < D.steps.length - 1 && /*#__PURE__*/React.createElement("span", {
    className: "step-line",
    "aria-hidden": "true"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "steps-cta"
  }, /*#__PURE__*/React.createElement(Button, {
    href: "./quote.html",
    variant: "primary",
    size: "lg"
  }, "Get a clear quote"))));
}

/* ---- Why us (split: photo + reasons) ----------------------------------- */
function WhyUs() {
  return /*#__PURE__*/React.createElement("section", {
    className: "why-band",
    id: "why"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "why-band-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker",
    style: {
      color: "var(--leaf-300)"
    }
  }, "Why neighbors choose Iman"), /*#__PURE__*/React.createElement("h2", null, "Why NYC homeowners & businesses trust Iman"), /*#__PURE__*/React.createElement("p", null, "Trusted in homes and businesses across all five NYC boroughs \u2014 here's what you get with every visit.")), /*#__PURE__*/React.createElement("div", {
    className: "why-band-grid"
  }, D.reasons.map(r => /*#__PURE__*/React.createElement("div", {
    className: "why-band-card",
    key: r.title
  }, /*#__PURE__*/React.createElement("span", {
    className: "why-band-ico"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: r.icon,
    size: 24,
    stroke: "var(--leaf-300)"
  })), /*#__PURE__*/React.createElement("h3", null, r.title), /*#__PURE__*/React.createElement("p", null, r.body))))));
}

/* ---- Service areas ----------------------------------------------------- */
function Areas() {
  const areas = [{
    name: "Manhattan"
  }, {
    name: "Brooklyn"
  }, {
    name: "Queens"
  }, {
    name: "The Bronx"
  }, {
    name: "Staten Island"
  }, {
    name: "Long Island"
  }];
  return /*#__PURE__*/React.createElement("section", {
    className: "areas-band",
    id: "areas"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell areas-band-inner"
  }, /*#__PURE__*/React.createElement("h2", null, "Areas We Serve"), /*#__PURE__*/React.createElement("ul", {
    className: "areas-links",
    "aria-label": "Cleaning service areas"
  }, areas.map(area => /*#__PURE__*/React.createElement("li", {
    key: area.name
  }, area.href ? /*#__PURE__*/React.createElement("a", {
    href: area.href
  }, area.name) : /*#__PURE__*/React.createElement("span", null, area.name))))));
}

/* ---- Review band (dark teal) ------------------------------------------- */
function ReviewBand() {
  return /*#__PURE__*/React.createElement("section", {
    className: "review-band"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell review-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "review-stars"
  }, [0, 1, 2, 3, 4].map(i => /*#__PURE__*/React.createElement(Icon, {
    key: i,
    name: "star",
    size: 26,
    stroke: "var(--leaf-500)"
  }))), /*#__PURE__*/React.createElement("blockquote", null, "\u201C", D.review.text, "\u201D"), /*#__PURE__*/React.createElement("cite", null, /*#__PURE__*/React.createElement("span", null, "Mahin Muhtasimul"), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, " \xB7 "), /*#__PURE__*/React.createElement("a", {
    href: D.googleReviewsHref,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": "Read Iman Cleaning Service reviews on Google",
    "data-conv": "google_reviews"
  }, "Read Our Google Reviews"))));
}

/* ---- FAQ --------------------------------------------------------------- */
function Faq() {
  return /*#__PURE__*/React.createElement("section", {
    className: "section",
    id: "faq"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell faq-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-head sec-head-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker"
  }, "Fast answers"), /*#__PURE__*/React.createElement("h2", null, "What people ask before booking")), /*#__PURE__*/React.createElement("div", {
    className: "faq-list"
  }, D.faqs.map(f => /*#__PURE__*/React.createElement(FaqItem, {
    key: f.q,
    question: f.q,
    defaultOpen: f.open
  }, f.a)))));
}

/* ---- Final CTA --------------------------------------------------------- */
function FinalCta() {
  return /*#__PURE__*/React.createElement("section", {
    className: "final-cta",
    id: "quote"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-shell final-inner"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-kicker",
    style: {
      color: "var(--leaf-300)"
    }
  }, "Need a custom quote?"), /*#__PURE__*/React.createElement("h2", null, "Tell us about your cleaning needs."), /*#__PURE__*/React.createElement("p", null, "Share details about your space, what needs cleaning, and your preferred date. We\u2019ll review everything and prepare the right quote for you."), /*#__PURE__*/React.createElement("div", {
    className: "final-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    href: "./quote.html",
    variant: "accent",
    size: "lg",
    "aria-label": "Get a custom cleaning quote from Iman Cleaning Service",
    "data-conv": "quote",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow",
      size: 18
    })
  }, "Get a Custom Quote"), /*#__PURE__*/React.createElement(Button, {
    href: "tel:+19298034053",
    variant: "secondary",
    size: "lg",
    "aria-label": "Call Iman Cleaning Service at 929-803-4053",
    "data-conv": "call",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "phone",
      size: 18,
      stroke: "var(--brand)"
    })
  }, "Call Now"))));
}
function App() {
  return /*#__PURE__*/React.createElement("div", {
    className: "site-scroll"
  }, /*#__PURE__*/React.createElement(Header, {
    onDark: true
  }), /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(Services, null), /*#__PURE__*/React.createElement(Areas, null), /*#__PURE__*/React.createElement(WhyUs, null), /*#__PURE__*/React.createElement(ReviewBand, null), /*#__PURE__*/React.createElement(FinalCta, null)), /*#__PURE__*/React.createElement(Footer, null));
}
window.ImanSite = {
  App
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/sections.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.FaqItem = __ds_scope.FaqItem;

__ds_ns.FeatureTile = __ds_scope.FeatureTile;

__ds_ns.ServiceCard = __ds_scope.ServiceCard;

__ds_ns.ServiceListCard = __ds_scope.ServiceListCard;

})();

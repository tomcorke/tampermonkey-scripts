// ==UserScript==
// @name         Backpack override detector
// @namespace    http://tomcorke.com/
// @version      0.1
// @description  Detect and highlight Backpack overrides in the DOM
// @author       Tom Corke
// @match        http://localhost:5000/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.localhost
// @grant        none
// @source       https://raw.githubusercontent.com/tomcorke/tampermonkey-scripts/main/backpack-override-detector.js
// ==/UserScript==

(function () {
  "use strict";

  class EventEmitter {
    constructor() {
      this.handlers = {};
    }
    send(event, ...data) {
      if (!event) {
        return;
      }
      if (!this.handlers[event]) {
        return;
      }
      const h = this.handlers[event];
      h.forEach(
        (handler) =>
          new Promise((resolve) => {
            try {
              handler(...data);
            } catch (e) {
              console.error(e);
            }
            resolve();
          })
      );
    }
    on(event, handler) {
      if (!this.handlers[event]) {
        this.handlers[event] = [];
      }
      this.handlers[event].push(handler);
    }
  }

  const createToggleElement = (initialState = false, labelText = undefined) => {
    const events = new EventEmitter();

    const w = document.createElement("div");

    const outer = document.createElement("div");
    const inner = document.createElement("div");
    Object.assign(outer.style, {
      width: "48px",
      height: "24px",
      borderRadius: "3px",
      background: "#aaa",
      position: "relative",
      cursor: "pointer",
      boxShadow: "inset 0 0 1px 10px #aaa, inset 0 0 0 20px rgba(0,0,0,0.5)",
    });
    Object.assign(inner.style, {
      width: "20px",
      height: "20px",
      borderRadius: "2px",
      left: "2px",
      top: "2px",
      position: "absolute",
      background: "#111",
      transition: "left 0.2s ease-out, background-color 0.2s ease-out",
    });

    if (labelText) {
      const label = document.createElement("label");
      Object.assign(label.style, { display: "flex", alignItems: "center" });
      Object.assign(outer.style, { marginLeft: "0.5em" });
      label.innerHTML = labelText;
      label.appendChild(outer);
      w.appendChild(label);
    } else {
      w.appendChild(outer);
    }
    outer.appendChild(inner);

    let state = initialState;

    const updateDisplay = () => {
      if (state) {
        Object.assign(inner.style, {
          left: "calc(100% - (20px + 2px))",
          background: "#5f2",
        });
      } else {
        delete inner.style.right;
        Object.assign(inner.style, { left: "2px", background: "#111" });
      }
    };

    const setState = (newState) => {
      state = newState;
      events.send("change", state);
      updateDisplay();
    };

    updateDisplay();

    outer.addEventListener("click", () => {
      setState(!state);
    });

    return { element: w, events };
  };

  const findCssRules = (el) => {
    const sheets = Array.from(document.styleSheets);
    const ret = [];
    const matches = el.matches.bind(el);

    sheets.forEach((sheet) => {
      try {
        const rules = sheet.rules || sheet.cssRules;
        Array.from(rules).forEach((rule) => {
          if (matches(rule.selectorText)) {
            ret.push(rule);
          }
        });
      } catch (e) {
        // Do nothing if we couldn't access rules
      }
    });
    return ret;
  };

  const hasOwnNonBackpackClass = (element) =>
    Array.from(element.classList).some((cn) => !cn.startsWith("Bpk"));

  const isBackpackClassRule = (rule) => {
    return rule.selectorText.startsWith(".Bpk");
  };

  const isNonBackpackClassRule = (rule) => {
    return (
      rule.selectorText.startsWith(".") &&
      rule.selectorText.match(/^\.[a-zA-Z0-9_-]+$/)
    );
  };

  const scan = () => {
    const elements = Array.from(
      document.querySelectorAll("div,span,h1,h2,h3,h4,li,a,button")
    );

    return elements
      .map((e) => {
        if (!hasOwnNonBackpackClass(e)) {
          return false;
        }
        const rules = findCssRules(e);

        const overriddenProperties = rules.reduce((acc, rule, index) => {
          // Skip this rule if it is a backpack class
          // or if it not a non-backpack class that could be overridden by a backpack class
          if (isBackpackClassRule(rule) || !isNonBackpackClassRule(rule)) {
            return acc;
          }

          // Find properties in any of those backpack rules that change the value of a known property in this rule

          // List properties from this rule
          const properties = Array.from(rule.styleMap.entries());

          const overridden = properties
            .map(([key, value]) => {
              // Find backpack rules that appear after it in the ordered rules, which match their order of appearance
              // and the order they are applied to the element. Anything before this would have been correctly overridden
              // by our non-backpack rule, so we don't care about it.
              const afterRules = rules.slice(index + 1);
              // Reverse this list so we can iterate through them starting with the last
              // the last thing to set a property value is the one that takes priority
              afterRules.reverse();

              for (const afterRule of afterRules) {
                // List properties from the rule we're checking for overrides
                const afterRuleProps = Array.from(afterRule.styleMap.entries());
                // Find a property that matches the key of the current property we're checking, if any exist
                const matchingProp = afterRuleProps.find(
                  ([bKey]) => bKey === key
                );

                // If we couldn't find one, try the next rule
                if (!matchingProp) {
                  continue;
                }

                // If we found a matching prop first in a non-Backpack rule, we're fine.
                if (!afterRule.selectorText.startsWith(".Bpk")) {
                  return undefined;
                }

                // We have found the "first" matching property in a CSS rule
                // If it has the same value as our expected one, then regardless of the overrides
                // we are seeing the intended style

                // Allow for CSS keyword values - some things are primitive, but some things are complex.
                // toString() flattens it all to string representations we can easily compare.
                const getValue = (v) => v.toString();

                // If this property sets the same value as our custom class, it is overridden but has no negative effect.
                // TODO: Flag this so we can still see them
                if (getValue(matchingProp[1]) === getValue(value)) {
                  return undefined;
                }

                // Otherwise we can say that the value has been changed, and is not what we intended
                // Return the key, and both before and after values so we can print them and do other things with them
                return {
                  key,
                  before: getValue(value),
                  after: getValue(matchingProp[1]),
                  rule: rule.selectorText,
                };
              }

              // If we didn't return at some point during the for loop, we didn't find any overrides for this property
              return undefined;
            })
            // Filter out undefined values, leaving us with just the overridden properties
            .filter((p) => p);

          if (overridden.length > 0) {
            // Merge new overridden property matches with any existing ones
            return [...acc, ...overridden];
          }

          return acc;
        }, []);

        return { element: e, overriddenProperties };
      })
      .filter((p) => p && p.overriddenProperties.length > 0);
  };

  let results = [];

  let wrapper = undefined;
  let text = undefined;

  const createWrapper = () => {
    if (wrapper) {
      text.innerHTML = `${results.length} overridden styles detected!`;
      return wrapper;
    }

    wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      position: "fixed",
      right: "10px",
      bottom: "10px",
      background: "rgb(5,32,60)",
      padding: "10px",
      borderRadius: "5px",
      color: "white",
      display: "flex",
      flexFlow: "column",
      alignItems: "flex-end",
    });

    text = document.createElement("div");
    text.innerHTML = `${results.length} overridden styles detected!`;
    wrapper.appendChild(text);

    document.body.appendChild(wrapper);

    // Create toggle to highlight all results
    const { element: showHighlightToggle, events: showHighlightToggleEvents } =
      createToggleElement(false, "Highlight Elements: ");
    Object.assign(showHighlightToggle.style, { marginTop: "10px" });
    wrapper.appendChild(showHighlightToggle);
    showHighlightToggleEvents.on("change", (state) => {
      results.forEach(({ element }) => {
        Object.assign(element.style, {
          boxShadow: state
            ? "0 0 2px 2px red, inset 0 0 0 500px rgba(255,0,0,0.5)"
            : element.dataset.originalBoxShadow,
        });
      });
    });

    // Create toggle to "fix" styles for results
    const {
      element: fixElementPropertiesToggle,
      events: fixElementPropertiesToggleEvents,
    } = createToggleElement(false, "Fix Properties: ");
    Object.assign(fixElementPropertiesToggle.style, { marginTop: "10px" });
    wrapper.appendChild(fixElementPropertiesToggle);
    fixElementPropertiesToggleEvents.on("change", (state) => {
      results.forEach(({ element, overriddenProperties: props }) => {
        props.forEach(({ key, before, after }) => {
          Object.assign(element.style, {
            [key]: state ? before : "",
          });
        });
      });
    });

    return wrapper;
  };

  let initialisedElements = new Set();

  const update = () => {
    results = scan();

    if (results.length > 0) {
      // Overridden props detected!
      createWrapper();

      console.group("Overridden styles detected in elements on this page");
      results.forEach(({ element, overriddenProperties: props }) => {
        // Print to console
        console.log(element, props);

        if (!initialisedElements.has(element)) {
          element.dataset.originalBoxShadow = element.style.boxShadow;
          initialisedElements.add(element);
        }
      });
      console.groupEnd();
    }
  };

  update();

  let updateTimeout = undefined;
  const throttledUpdate = () => {
    if (updateTimeout) {
      return;
    }
    updateTimeout = setTimeout(() => {
      clearTimeout(updateTimeout);
      update();
    }, 500);
  };

  const observer = new MutationObserver(() => throttledUpdate());
  observer.observe(document.body, { childList: true, subtree: true });
})();

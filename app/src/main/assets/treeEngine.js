/**
 * TreeEngine – flatten JSON tree + VirtualList (virtual scroll).
 * Used by app.js: TreeEngine.flattenTree, TreeEngine.VirtualList
 */
(function (global) {
  "use strict";

  const ROW_HEIGHT = 34;

  /**
   * Flatten data into rows for the virtual list.
   * @param {*} data
   * @param {{ collapsedPaths: Set, arrayPages: Object, pageSize: number, visiblePaths: Set|null }} opts
   * @returns {Array}
   */
  function flattenTree(data, opts) {
    const collapsedPaths = opts.collapsedPaths || new Set();
    const arrayPages = opts.arrayPages || {};
    const pageSize = opts.pageSize || 50;
    const visiblePaths = opts.visiblePaths; // null = show all

    const rows = [];

    function isVisible(path) {
      if (!visiblePaths) return true;
      return visiblePaths.has(path);
    }

    function walk(value, path, key, level) {
      // When filtering, skip branches that are not part of the match path set.
      if (visiblePaths && !isVisible(path)) return;

      const isObj = value !== null && typeof value === "object";

      if (!isObj) {
        rows.push({
          type: "leaf",
          path,
          key: key != null ? key : path,
          value,
          level,
        });
        return;
      }

      const isArray = Array.isArray(value);
      const keys = isArray ? value.map((_, i) => i) : Object.keys(value);
      const count = keys.length;
      // When filtering, force-expand so matched leaves are reachable.
      const collapsed = visiblePaths ? false : collapsedPaths.has(path);

      rows.push({
        type: "node",
        path,
        key: key != null ? key : path === "root" ? "root" : path,
        isArray,
        count,
        collapsed,
        level,
      });

      if (collapsed) return;

      if (isArray && count > pageSize && !visiblePaths) {
        // Pagination only when not filtering (filter may need any index).
        const pageIndex = arrayPages[path] || 0;
        const totalPages = Math.ceil(count / pageSize) || 1;
        const start = pageIndex * pageSize;
        const end = Math.min(count, start + pageSize);

        rows.push({
          type: "pagination",
          path,
          pageIndex,
          pageSize,
          total: count,
          totalPages,
          level: level + 1,
        });

        for (let i = start; i < end; i++) {
          walk(value[i], path + "/" + i, i, level + 1);
        }
      } else if (isArray && visiblePaths) {
        // Filtering: only walk children that appear in visiblePaths.
        for (let i = 0; i < count; i++) {
          const childPath = path + "/" + i;
          if (isVisible(childPath)) walk(value[i], childPath, i, level + 1);
        }
      } else {
        for (const k of keys) {
          const childPath = path + "/" + k;
          if (!visiblePaths || isVisible(childPath)) {
            walk(value[k], childPath, k, level + 1);
          }
        }
      }
    }

    if (data === null || data === undefined) return rows;
    walk(data, "root", "root", 0);
    return rows;
  }

  /**
   * VirtualList – renders only visible rows inside a scrollable viewport.
   */
  class VirtualList {
    constructor(viewportEl, renderRowFn) {
      this.viewport = viewportEl;
      this.renderRow = renderRowFn;
      this.rows = [];
      this.rowHeight = ROW_HEIGHT;
      this._spacer = null;
      this._content = null;
      this._boundScroll = this._onScroll.bind(this);
      this._raf = null;

      this._setup();
      this.viewport.addEventListener("scroll", this._boundScroll, { passive: true });
    }

    _setup() {
      this.viewport.innerHTML = "";
      this._spacer = document.createElement("div");
      this._spacer.style.position = "relative";
      this._spacer.style.width = "100%";
      this._content = document.createElement("div");
      this._content.style.position = "absolute";
      this._content.style.left = "0";
      this._content.style.right = "0";
      this._content.style.top = "0";
      this._spacer.appendChild(this._content);
      this.viewport.appendChild(this._spacer);
    }

    setRows(rows) {
      this.rows = rows || [];
      this._spacer.style.height = this.rows.length * this.rowHeight + "px";
      // Keep scroll position when possible; clamp if list shortened.
      const maxScroll = Math.max(0, this.rows.length * this.rowHeight - this.viewport.clientHeight);
      if (this.viewport.scrollTop > maxScroll) this.viewport.scrollTop = maxScroll;
      this._renderVisible();
    }

    _onScroll() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._renderVisible();
      });
    }

    _renderVisible() {
      const scrollTop = this.viewport.scrollTop;
      const viewH = this.viewport.clientHeight || 400;
      const buffer = 10;
      const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - buffer);
      const end = Math.min(this.rows.length, Math.ceil((scrollTop + viewH) / this.rowHeight) + buffer);

      this._content.style.transform = `translateY(${start * this.rowHeight}px)`;
      this._content.innerHTML = "";

      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        const el = this.renderRow(this.rows[i]);
        if (el) {
          el.style.height = this.rowHeight + "px";
          el.style.boxSizing = "border-box";
          frag.appendChild(el);
        }
      }
      this._content.appendChild(frag);
    }
  }

  global.TreeEngine = {
    flattenTree,
    VirtualList,
    ROW_HEIGHT,
  };
})(window);

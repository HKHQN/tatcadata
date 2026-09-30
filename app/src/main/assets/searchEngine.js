/**
 * SearchEngine – filter / search over JSON tree.
 * Used by app.js: SearchEngine.searchTree, SearchEngine.isFilterActive, SearchEngine.escapeRegExp
 */
(function (global) {
  "use strict";

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isFilterActive(filterState) {
    if (!filterState) return false;
    if (filterState.query && String(filterState.query).trim()) return true;
    if (filterState.types && filterState.types.size > 0) return true;
    return false;
  }

  function valueType(v) {
    if (v === null) return "null";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "string";
    return "object";
  }

  function matchesQuery(keyStr, valueStr, filterState) {
    const q = filterState.query;
    if (!q || !String(q).trim()) return true;

    let re;
    try {
      const src = filterState.mode === "regex" ? q : escapeRegExp(q);
      const flags = filterState.caseSensitive ? "" : "i";
      if (filterState.mode === "exact") {
        re = new RegExp("^" + src + "$", flags);
      } else {
        re = new RegExp(src, flags);
      }
    } catch (e) {
      return false;
    }

    const target = filterState.target || "both";
    if (target === "key") return re.test(keyStr);
    if (target === "value") return re.test(valueStr);
    return re.test(keyStr) || re.test(valueStr);
  }

  function matchesType(v, types) {
    if (!types || types.size === 0) return true;
    return types.has(valueType(v));
  }

  /**
   * Search tree and return { active, matches: Set<path>, visible: Set<path> }.
   * visible includes matched leaves and all their ancestors so the tree can expand to them.
   */
  function searchTree(data, filterState) {
    const active = isFilterActive(filterState);
    const matches = new Set();
    const visible = new Set();

    if (!active || data == null) {
      return { active: false, matches, visible: null };
    }

    function addAncestors(path) {
      // path like "root/foo/0/bar"
      const parts = path.split("/");
      let cur = "";
      for (let i = 0; i < parts.length; i++) {
        cur = i === 0 ? parts[0] : cur + "/" + parts[i];
        visible.add(cur);
      }
    }

    function walk(value, path, key) {
      const isObj = value !== null && typeof value === "object";

      if (!isObj) {
        const keyStr = String(key != null ? key : path);
        const valueStr = value === null || value === undefined ? String(value) : String(value);
        const typeOk = matchesType(value, filterState.types);
        const queryOk = matchesQuery(keyStr, valueStr, filterState);
        if (typeOk && queryOk) {
          matches.add(path);
          addAncestors(path);
        }
        return;
      }

      // Node itself can match on key name when target includes key
      const keyStr = String(key != null ? key : (path === "root" ? "root" : path));
      const nodeQueryOk =
        filterState.query &&
        String(filterState.query).trim() &&
        (filterState.target === "key" || filterState.target === "both")
          ? matchesQuery(keyStr, "", filterState)
          : false;

      // Always walk children; mark node visible only if a descendant matches or node key matches
      const isArray = Array.isArray(value);
      const keys = isArray ? value.map((_, i) => i) : Object.keys(value);

      let childMatched = false;
      for (const k of keys) {
        const childPath = path + "/" + k;
        const before = matches.size;
        walk(value[k], childPath, k);
        if (matches.size > before) childMatched = true;
      }

      if (nodeQueryOk || childMatched) {
        visible.add(path);
        if (nodeQueryOk) matches.add(path);
        addAncestors(path);
      }
    }

    walk(data, "root", "root");
    // Always keep root if anything matched
    if (matches.size > 0) visible.add("root");

    return { active: true, matches, visible };
  }

  global.SearchEngine = {
    escapeRegExp,
    isFilterActive,
    searchTree,
  };
})(window);

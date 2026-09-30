/**
 * Bank Van Hung Bian - Vanilla HTML/CSS/JS version
 * Firebase Auth + Realtime Database + JSON deep-merge + Tree view (virtual scroll
 * + tìm kiếm/bộ lọc nâng cao + phân trang), dùng treeEngine.js và searchEngine.js.
 */

// ===================== Firebase Config =====================
const firebaseConfig = {
  apiKey: "AIzaSyA02bvnhfmcoMJV8wz40O2YBISgSPvMhCE",
  authDomain: "bankvanhungbian.firebaseapp.com",
  databaseURL: "https://bankvanhungbian-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "bankvanhungbian",
  storageBucket: "bankvanhungbian.firebasestorage.app",
  messagingSenderId: "54989417529",
  appId: "1:54989417529:web:767b5ff40d379a339671e8"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// ===================== DOM refs =====================
const loadingEl = document.getElementById("loading");
const loginScreen = document.getElementById("login-screen");
const homeScreen = document.getElementById("home-screen");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const authBtn = document.getElementById("auth-btn");
const googleLoginBtn = document.getElementById("google-login");
const authBtnText = document.getElementById("auth-btn-text");
const authSpinner = document.getElementById("auth-spinner");
const switchModeBtn = document.getElementById("switch-mode");
const loginSubtitle = document.getElementById("login-subtitle");

const logoutBtn = document.getElementById("logout-btn");
const uploadBtn = document.getElementById("upload-btn");
const uploadText = document.getElementById("upload-text");
const uploadSpinner = document.getElementById("upload-spinner");
const fileInput = document.getElementById("file-input");

const skeletonEl = document.getElementById("skeleton");
const emptyMsg = document.getElementById("empty-msg");
const treeViewportEl = document.getElementById("tree-viewport");
const hintEl = document.getElementById("hint");
const matchInfoEl = document.getElementById("match-info");
const dataStatsEl = document.getElementById("data-stats");

const searchInput = document.getElementById("search-input");
const searchSpinner = document.getElementById("search-spinner");
const searchClearBtn = document.getElementById("search-clear");
const filterToggleBtn = document.getElementById("filter-toggle");
const filterPanel = document.getElementById("filter-panel");
const filterTargetSelect = document.getElementById("filter-target");
const filterModeSelect = document.getElementById("filter-mode");
const filterCaseCheckbox = document.getElementById("filter-case");
const filterTypeCheckboxes = Array.from(document.querySelectorAll(".filter-type"));
const pageSizeSelect = document.getElementById("page-size");
const filterResetBtn = document.getElementById("filter-reset");

// ===================== State =====================
let isRegister = false;
let dataListener = null;
let lastData = null;
let isMerging = false; // đang hợp nhất -> tạm dừng vẽ lại cây để khỏi giật

const collapsedPaths = new Set(); // node nào đang bị thu gọn
let arrayPages = {}; // { [path]: trang hiện tại } cho từng mảng dài
let pageSize = 50;

const filterState = {
  query: "",
  target: "both", // "key" | "value" | "both"
  mode: "contains", // "contains" | "exact" | "regex"
  caseSensitive: false,
  types: new Set(), // rỗng = không lọc theo kiểu dữ liệu
};

let currentVisiblePaths = null; // null = không lọc, hiển thị bình thường
let searchDebounceTimer = null;
const SEARCH_DEBOUNCE_MS = 250;

// ===================== Helpers =====================
function showAlert(title, message) {
  window.alert(`${title}\n\n${message}`);
}

function setAuthLoading(on) {
  authBtn.disabled = on;
  authSpinner.classList.toggle("hidden", !on);
  authBtnText.classList.toggle("hidden", on);
}

function setUploadLoading(on) {
  uploadBtn.disabled = on;
  uploadSpinner.classList.toggle("hidden", !on);
  uploadText.classList.toggle("hidden", on);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Tô sáng phần text khớp với từ khóa đang tìm (an toàn XSS: escape trước, chèn <mark> sau).
function highlightMatches(rawStr) {
  const str = String(rawStr);
  if (!filterState.query) return escapeHtml(str);

  let re;
  try {
    const src = filterState.mode === "regex" ? filterState.query : SearchEngine.escapeRegExp(filterState.query);
    re = new RegExp(src, filterState.caseSensitive ? "g" : "gi");
  } catch (e) {
    return escapeHtml(str);
  }

  let result = "";
  let lastIndex = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(str)) !== null) {
    result += escapeHtml(str.slice(lastIndex, m.index));
    result += `<mark>${escapeHtml(m[0])}</mark>`;
    lastIndex = m.index + m[0].length;
    if (m[0].length === 0) {
      re.lastIndex++; // tránh vòng lặp vô hạn khi regex khớp chuỗi rỗng
      if (re.lastIndex > str.length) break;
    }
  }
  result += escapeHtml(str.slice(lastIndex));
  return result;
}

// (Hợp nhất dữ liệu đã chuyển sang mergeEngine.js: thuật toán delta + chỉ mục Map)


// ===================== JSON Tree: render 1 dòng (dùng bởi VirtualList) =====================
function renderRow(row) {
  const el = document.createElement("div");
  el.style.paddingLeft = row.level * 16 + "px";
  el.dataset.path = row.path; // dùng để mở popup khi click nội dung

  if (row.type === "node") {
    el.className = "tree-row tree-node-row";
    const label = row.path === "root" ? "root" : String(row.key);
    const countLabel = row.isArray ? `[${row.count}]` : `{${row.count}}`;
    el.innerHTML = `
      <span class="tree-toggle" data-action="toggle" data-path="${escapeHtml(row.path)}">${row.collapsed ? "▶" : "▼"}</span>
      <span class="tree-key">${escapeHtml(label)} ${countLabel}</span>
    `;
    return el;
  }

  if (row.type === "pagination") {
    el.className = "tree-row tree-pagination-row";
    el.removeAttribute("data-path"); // pagination không mở popup
    const from = row.pageIndex * row.pageSize + 1;
    const to = Math.min(row.total, from + row.pageSize - 1);
    el.innerHTML = `
      <button class="page-btn" data-action="page-prev" data-path="${escapeHtml(row.path)}" ${row.pageIndex === 0 ? "disabled" : ""}>‹ Trước</button>
      <span class="page-info">${from}-${to} / ${row.total} · Trang ${row.pageIndex + 1}/${row.totalPages}</span>
      <button class="page-btn" data-action="page-next" data-path="${escapeHtml(row.path)}" ${row.pageIndex >= row.totalPages - 1 ? "disabled" : ""}>Sau ›</button>
    `;
    return el;
  }

  // leaf
  el.className = "tree-row";
  el.title = `${row.key}: ${row.value}`; // xem đầy đủ khi giá trị bị cắt bớt (ellipsis)
  el.innerHTML = `
    <span class="tree-key">${highlightMatches(String(row.key))}: </span>
    <span class="tree-value">${highlightMatches(String(row.value))}</span>
  `;
  return el;
}

// ===================== Virtual list instance =====================
const virtualList = new TreeEngine.VirtualList(treeViewportEl, renderRow);

/** Tính tổng số lượng dữ liệu (ưu tiên field quantity / _count / count nếu có) */
function computeTotalQuantity(data) {
  if (data == null) return 0;

  // Nếu root là mảng các object có original/quantity
  if (Array.isArray(data)) {
    let total = 0;
    for (const item of data) {
      if (item && typeof item === "object") {
        if (typeof item.quantity === "number") total += item.quantity;
        else if (typeof item._count === "number") total += item._count;
        else if (typeof item.count === "number") total += item.count;
        else total += 1;
      } else {
        total += 1;
      }
    }
    return total;
  }

  // Nếu root là object, đếm số key lá hoặc đệ quy nhẹ
  if (typeof data === "object") {
    // Ưu tiên nếu có field tổng sẵn
    if (typeof data.totalQuantity === "number") return data.totalQuantity;
    if (typeof data.total === "number") return data.total;
    // Đếm số entry ở cấp 1
    return Object.keys(data).length;
  }

  return 1;
}

function updateDataStats() {
  if (!lastData) {
    dataStatsEl.classList.add("hidden");
    return;
  }
  const totalQty = computeTotalQuantity(lastData);
  const isArray = Array.isArray(lastData);
  const uniqueCount = isArray ? lastData.length : Object.keys(lastData || {}).length;

  if (isArray && totalQty !== uniqueCount) {
    dataStatsEl.textContent = `Tổng số lượng dữ liệu: ${totalQty.toLocaleString("vi-VN")} (sau hợp nhất còn ${uniqueCount.toLocaleString("vi-VN")} mục duy nhất theo original)`;
  } else {
    dataStatsEl.textContent = `Tổng số lượng dữ liệu load được: ${totalQty.toLocaleString("vi-VN")}`;
  }
  dataStatsEl.classList.remove("hidden");
}

function refreshTree() {
  if (!lastData) {
    virtualList.setRows([]);
    updateDataStats();
    return;
  }
  const rows = TreeEngine.flattenTree(lastData, {
    collapsedPaths,
    arrayPages,
    pageSize,
    visiblePaths: currentVisiblePaths,
  });
  virtualList.setRows(rows);

  if (currentVisiblePaths && rows.length === 0) {
    emptyMsg.textContent = "Không tìm thấy kết quả phù hợp";
    emptyMsg.classList.remove("hidden");
    treeViewportEl.classList.add("hidden");
  } else {
    emptyMsg.classList.add("hidden");
    treeViewportEl.classList.remove("hidden");
  }
  updateDataStats();
}

function setSearching(on) {
  searchSpinner.classList.toggle("hidden", !on);
}

function updateMatchInfo(searchResult) {
  if (!searchResult.active) {
    matchInfoEl.classList.add("hidden");
    hintEl.classList.remove("hidden");
    return;
  }
  hintEl.classList.add("hidden");
  matchInfoEl.classList.remove("hidden");
  const count = searchResult.matches.size;
  matchInfoEl.textContent =
    count > 0 ? `Tìm thấy ${count} kết quả phù hợp với bộ lọc` : "Không tìm thấy kết quả nào phù hợp với bộ lọc";
}

// Chạy thuật toán lọc (duyệt cây 1 lần) rồi vẽ lại. debounce=true dùng khi gọi
// từ sự kiện gõ phím liên tục (ô tìm kiếm); các control rời rạc (select/checkbox)
// gọi ngay lập tức vì không cần debounce.
function applyFilter({ debounce } = { debounce: false }) {
  if (debounce) {
    clearTimeout(searchDebounceTimer);
    setSearching(true);
    searchDebounceTimer = setTimeout(runFilterNow, SEARCH_DEBOUNCE_MS);
  } else {
    clearTimeout(searchDebounceTimer);
    runFilterNow();
  }
}

function runFilterNow() {
  setSearching(false);
  const result = SearchEngine.searchTree(lastData, filterState);
  currentVisiblePaths = result.visible;
  updateMatchInfo(result);
  refreshTree();
}

// ===================== Wiring: tìm kiếm & bộ lọc =====================
searchInput.addEventListener("input", () => {
  filterState.query = searchInput.value;
  searchClearBtn.classList.toggle("hidden", !filterState.query);
  applyFilter({ debounce: true });
});

searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  filterState.query = "";
  searchClearBtn.classList.add("hidden");
  applyFilter({ debounce: false });
  searchInput.focus();
});

filterToggleBtn.addEventListener("click", () => {
  filterPanel.classList.toggle("hidden");
});

filterTargetSelect.addEventListener("change", () => {
  filterState.target = filterTargetSelect.value;
  applyFilter({ debounce: false });
});

filterModeSelect.addEventListener("change", () => {
  filterState.mode = filterModeSelect.value;
  applyFilter({ debounce: false });
});

filterCaseCheckbox.addEventListener("change", () => {
  filterState.caseSensitive = filterCaseCheckbox.checked;
  applyFilter({ debounce: false });
});

filterTypeCheckboxes.forEach((cb) => {
  cb.addEventListener("change", () => {
    filterState.types = new Set(filterTypeCheckboxes.filter((c) => c.checked).map((c) => c.value));
    applyFilter({ debounce: false });
  });
});

pageSizeSelect.addEventListener("change", () => {
  pageSize = parseInt(pageSizeSelect.value, 10) || 50;
  arrayPages = {}; // đổi kích thước trang -> quay về trang đầu cho mọi mảng
  refreshTree();
});

filterResetBtn.addEventListener("click", () => {
  filterState.query = "";
  filterState.target = "both";
  filterState.mode = "contains";
  filterState.caseSensitive = false;
  filterState.types = new Set();

  searchInput.value = "";
  searchClearBtn.classList.add("hidden");
  filterTargetSelect.value = "both";
  filterModeSelect.value = "contains";
  filterCaseCheckbox.checked = false;
  filterTypeCheckboxes.forEach((c) => (c.checked = false));

  applyFilter({ debounce: false });
});

// Click "▶/▼" để thu gọn/mở rộng, hoặc nút phân trang — dùng event delegation
// (1 listener duy nhất) để không phải gắn listener cho từng dòng.
// Click vào nội dung dòng (không phải nút action) → mở popup chi tiết node.
treeViewportEl.addEventListener("click", (e) => {
  const actionTarget = e.target.closest("[data-action]");
  if (actionTarget) {
    const { action, path } = actionTarget.dataset;
    if (action === "toggle") {
      if (collapsedPaths.has(path)) collapsedPaths.delete(path);
      else collapsedPaths.add(path);
    } else if (action === "page-prev") {
      arrayPages[path] = Math.max(0, (arrayPages[path] || 0) - 1);
    } else if (action === "page-next") {
      arrayPages[path] = (arrayPages[path] || 0) + 1;
    } else {
      return;
    }
    refreshTree();
    return;
  }

  // Click vào content của dòng → mở popup
  const row = e.target.closest(".tree-row[data-path]");
  if (row && row.dataset.path) {
    openDetailPopup(row.dataset.path);
  }
});

// ===================== Auth UI =====================
function updateAuthModeUI() {
  loginSubtitle.textContent = isRegister ? "Đăng ký tài khoản" : "Đăng nhập";
  authBtnText.textContent = isRegister ? "Đăng ký" : "Đăng nhập";
  switchModeBtn.textContent = isRegister
    ? "Đã có tài khoản? Đăng nhập"
    : "Chưa có tài khoản? Đăng ký";
}

// Google OAuth: bật Google provider trong Firebase Console > Authentication.
googleLoginBtn?.addEventListener("click", async () => {
  setAuthLoading(true);
  googleLoginBtn.disabled = true;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await auth.signInWithPopup(provider);
  } catch (err) {
    // Popup bị chặn hoặc không hỗ trợ: chuyển sang redirect.
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err.code)) {
      try { await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); }
      catch (redirectErr) { showAlert("Lỗi đăng nhập Google", redirectErr.message || String(redirectErr)); }
    } else if (err.code !== "auth/popup-closed-by-user") {
      showAlert("Lỗi đăng nhập Google", err.message || String(err));
    }
  } finally {
    setAuthLoading(false);
    googleLoginBtn.disabled = false;
  }
});

switchModeBtn.addEventListener("click", () => {
  isRegister = !isRegister;
  updateAuthModeUI();
});

authBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showAlert("Lỗi", "Vui lòng nhập đầy đủ email và mật khẩu");
    return;
  }

  setAuthLoading(true);
  try {
    if (isRegister) {
      await auth.createUserWithEmailAndPassword(email, password);
      showAlert("Thành công", "Đăng ký thành công!");
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (err) {
    showAlert("Lỗi", err.message || String(err));
  } finally {
    setAuthLoading(false);
  }
});

// Enter key
[emailInput, passwordInput].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") authBtn.click();
  });
});

logoutBtn.addEventListener("click", () => auth.signOut());


// ===================== Thanh tiến độ hợp nhất =====================
const progressEl = document.getElementById("merge-progress");
function setProgress(label, frac, detail) {
  progressEl.classList.remove("hidden");
  const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
  document.getElementById("progress-label").textContent = label;
  document.getElementById("progress-pct").textContent = pct + "%";
  document.getElementById("progress-bar").style.width = pct + "%";
  if (detail !== undefined) document.getElementById("progress-detail").textContent = detail;
}
function hideProgress() {
  if (!isMerging) progressEl.classList.add("hidden");
}

// ===================== Upload =====================
uploadBtn.addEventListener("click", () => fileInput.click());

/** Path dữ liệu riêng của từng user: users/{uid}/appData */
function userDataRef(uid) {
  return db.ref(`users/${uid}/appData`);
}

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = ""; // reset so same file can be re-selected

  if (!file) return;

  if (
    !file.name.toLowerCase().endsWith(".json") &&
    file.type !== "application/json"
  ) {
    showAlert("Lỗi", "Vui lòng chọn file .json");
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    showAlert("Lỗi", "Bạn cần đăng nhập trước khi upload");
    return;
  }

  setUploadLoading(true);
  isMerging = true;
  const nf = (n) => n.toLocaleString("vi-VN");
  setProgress("Đang đọc file…", 0.02);
  try {
    const newJson = JSON.parse(await file.text());
    const ref = userDataRef(user.uid);

    setProgress("Đang chuẩn bị dữ liệu…", 0.05);
    // Dùng bản dữ liệu realtime đã có sẵn -> không phải tải lại toàn bộ từ Firebase.
    const current = lastData != null ? lastData : (await ref.get()).val();

    const stats = await MergeEngine.merge(ref, current, newJson, (phase, f, s) => {
      const label = phase === "analyze" ? "Đang so khớp & bỏ qua dữ liệu trùng…" : "Đang ghi dữ liệu mới…";
      const p = phase === "analyze" ? 0.05 + f * 0.55 : 0.6 + f * 0.4;
      setProgress(label, p, `Mới: ${nf(s.added)} · Trùng bỏ qua: ${nf(s.skipped)} · Cập nhật: ${nf(s.updated)}`);
    });

    setProgress("Hoàn tất", 1,
      `Mới: ${nf(stats.added)} · Trùng bỏ qua: ${nf(stats.skipped)} · Cập nhật: ${nf(stats.updated)}`);
    showAlert("Thành công",
      `Đã hợp nhất xong!\n• Thêm mới: ${nf(stats.added)}\n• Trùng (bỏ qua): ${nf(stats.skipped)}\n• Cập nhật: ${nf(stats.updated)}`);
  } catch (err) {
    console.error(err);
    showAlert("Lỗi", "Không thể xử lý file JSON: " + (err.message || err));
  } finally {
    isMerging = false;
    setUploadLoading(false);
    setTimeout(hideProgress, 1500);
    if (lastData) { // vẽ lại cây đúng 1 lần sau khi hợp nhất xong
      emptyMsg.classList.add("hidden");
      treeViewportEl.classList.remove("hidden");
      if (SearchEngine.isFilterActive(filterState)) runFilterNow(); else refreshTree();
    }
  }
});

// ===================== Auth state & data listener =====================
auth.onAuthStateChanged((user) => {
  loadingEl.classList.add("hidden");

  if (dataListener) {
    dataListener.off();
    dataListener = null;
  }

  if (user) {
    loginScreen.classList.add("hidden");
    homeScreen.classList.remove("hidden");

    // Hiệu ứng loading: hiện skeleton trong lúc chờ lần tải dữ liệu đầu tiên từ Firebase.
    skeletonEl.classList.remove("hidden");
    emptyMsg.classList.add("hidden");
    treeViewportEl.classList.add("hidden");

    dataListener = userDataRef(user.uid);
    dataListener.on("value", (snap) => {
      lastData = snap.val();
      skeletonEl.classList.add("hidden");
      if (isMerging) return;

      if (!lastData) {
        emptyMsg.textContent = "Chưa có dữ liệu";
        emptyMsg.classList.remove("hidden");
        treeViewportEl.classList.add("hidden");
        virtualList.setRows([]);
        updateDataStats();
        return;
      }

      // Dữ liệu mới -> chạy lại bộ lọc hiện tại (nếu có) trên dữ liệu mới.
      if (SearchEngine.isFilterActive(filterState)) {
        runFilterNow();
      } else {
        emptyMsg.classList.add("hidden");
        treeViewportEl.classList.remove("hidden");
        refreshTree();
      }
    });
  } else {
    homeScreen.classList.add("hidden");
    loginScreen.classList.remove("hidden");

    lastData = null;
    collapsedPaths.clear();
    arrayPages = {};
    currentVisiblePaths = null;
    virtualList.setRows([]);
    skeletonEl.classList.add("hidden");
    emptyMsg.textContent = "Chưa có dữ liệu";
    emptyMsg.classList.remove("hidden");
    treeViewportEl.classList.add("hidden");
    updateDataStats();
  }
});

// ===================== Detail Popup: xem node + tìm kiếm ngay trong subtree =====================
const detailModal = document.getElementById("detail-modal");
const detailTitle = document.getElementById("detail-title");
const detailPathEl = document.getElementById("detail-path");
const detailTypeEl = document.getElementById("detail-type");
const detailContent = document.getElementById("detail-content");
const detailMatches = document.getElementById("detail-matches");
const detailMatchInfo = document.getElementById("detail-match-info");
const detailSearchInput = document.getElementById("detail-search");
const detailSearchClear = document.getElementById("detail-search-clear");
const detailCloseBtn = document.getElementById("detail-close");
const detailCopyBtn = document.getElementById("detail-copy");
const detailLoadAllBtn = document.getElementById("detail-load-all");

/** State của popup hiện tại */
let detailState = {
  path: null,
  value: null,
  query: "",
  matches: null, // { matches: Set, visible: Set } từ SearchEngine trên subtree
};

/** Lấy giá trị tại path dạng "root/foo/0/bar" từ lastData */
function getValueAtPath(data, path) {
  if (!path || path === "root") return data;
  const parts = path.split("/").slice(1); // bỏ "root"
  let cur = data;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    // key số trên array
    const key = Array.isArray(cur) && /^\d+$/.test(p) ? Number(p) : p;
    cur = cur[key];
  }
  return cur;
}

function typeLabel(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === "object") return `object{${Object.keys(v).length}}`;
  return typeof v;
}

/** Highlight text theo query của popup (an toàn XSS) */
function highlightDetail(rawStr, query) {
  const str = String(rawStr);
  if (!query || !String(query).trim()) return escapeHtml(str);
  let re;
  try {
    const src = filterState.mode === "regex" ? query : SearchEngine.escapeRegExp(query);
    re = new RegExp(src, filterState.caseSensitive ? "g" : "gi");
  } catch (e) {
    return escapeHtml(str);
  }
  let result = "";
  let lastIndex = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(str)) !== null) {
    result += escapeHtml(str.slice(lastIndex, m.index));
    result += `<mark>${escapeHtml(m[0])}</mark>`;
    lastIndex = m.index + m[0].length;
    if (m[0].length === 0) {
      re.lastIndex++;
      if (re.lastIndex > str.length) break;
    }
  }
  result += escapeHtml(str.slice(lastIndex));
  return result;
}

function formatJsonForDisplay(value, query) {
  if (value === null || value === undefined) {
    return highlightDetail(String(value), query);
  }
  if (typeof value !== "object") {
    return highlightDetail(String(value), query);
  }
  // Object / array: pretty JSON, rồi highlight
  try {
    const pretty = JSON.stringify(value, null, 2);
    // Giới hạn hiển thị nếu quá lớn để tránh đơ UI
    const MAX = 400000;
    if (pretty.length > MAX) {
      return highlightDetail(pretty.slice(0, MAX) + "\n\n… (đã cắt bớt vì dữ liệu quá lớn)", query);
    }
    return highlightDetail(pretty, query);
  } catch (e) {
    return escapeHtml(String(value));
  }
}

/** Chạy search trên subtree của node đang mở popup */
function runDetailSearch() {
  const q = detailState.query;
  const value = detailState.value;
  if (!q || !String(q).trim() || value == null) {
    detailState.matches = null;
    detailMatchInfo.classList.add("hidden");
    detailMatches.classList.add("hidden");
    detailContent.classList.remove("hidden");
    detailContent.innerHTML = formatJsonForDisplay(value, "");
    detailLoadAllBtn.disabled = true;
    return;
  }

  // Dùng lại filterState (mode, target, case, types) nhưng chỉ query của popup
  const scopedFilter = {
    ...filterState,
    query: q,
  };
  const result = SearchEngine.searchTree(value, scopedFilter);
  detailState.matches = result;

  if (!result.active || result.matches.size === 0) {
    detailMatchInfo.textContent = "Không tìm thấy kết quả nào trong node này";
    detailMatchInfo.classList.remove("hidden");
    detailMatches.classList.add("hidden");
    detailContent.classList.remove("hidden");
    detailContent.innerHTML = formatJsonForDisplay(value, q);
    detailLoadAllBtn.disabled = true;
    return;
  }

  detailMatchInfo.textContent = `Tìm thấy ${result.matches.size} kết quả trong node này`;
  detailMatchInfo.classList.remove("hidden");

  // Hiển thị danh sách match (load hết ngay, không phân trang)
  const items = [];
  const prefix = detailState.path === "root" ? "root" : detailState.path;
  // Duyệt matches theo thứ tự path
  const sorted = Array.from(result.matches).sort();
  for (const relPath of sorted) {
    // relPath từ searchTree bắt đầu bằng "root" (của subtree)
    const fullPath = relPath === "root" ? prefix : prefix + relPath.slice(4); // bỏ "root"
    const leafVal = getValueAtPath(value, relPath);
    if (leafVal !== null && typeof leafVal === "object") continue; // chỉ hiện leaf
    const keyPart = relPath === "root" ? "(node)" : relPath.split("/").pop();
    items.push(`
      <div class="modal-match-item">
        <div class="mm-path">${escapeHtml(fullPath)}</div>
        <div class="mm-kv">
          <strong>${highlightDetail(String(keyPart), q)}</strong>:
          ${highlightDetail(leafVal === null || leafVal === undefined ? String(leafVal) : String(leafVal), q)}
        </div>
      </div>
    `);
  }

  if (items.length === 0) {
    // Chỉ match node key, không có leaf
    detailContent.classList.remove("hidden");
    detailMatches.classList.add("hidden");
    detailContent.innerHTML = formatJsonForDisplay(value, q);
  } else {
    detailContent.classList.add("hidden");
    detailMatches.classList.remove("hidden");
    detailMatches.innerHTML = items.join("");
  }
  detailLoadAllBtn.disabled = false;
}

/** Lưu vị trí cuộn để khôi phục khi đóng popup (cần thiết khi body.modal-open dùng position:fixed) */
let _modalScrollY = 0;

function openDetailPopup(path) {
  if (!lastData) return;
  const value = getValueAtPath(lastData, path);
  if (value === undefined) {
    showAlert("Lỗi", "Không tìm thấy dữ liệu tại path: " + path);
    return;
  }

  detailState = { path, value, query: "", matches: null };
  detailSearchInput.value = "";
  detailSearchClear.classList.add("hidden");

  const label = path === "root" ? "root" : path.split("/").pop();
  detailTitle.textContent = path === "root" ? "Chi tiết root" : `Chi tiết: ${label}`;
  detailPathEl.textContent = path;
  detailTypeEl.textContent = typeLabel(value);

  detailContent.classList.remove("hidden");
  detailMatches.classList.add("hidden");
  detailMatchInfo.classList.add("hidden");
  detailContent.innerHTML = formatJsonForDisplay(value, "");
  detailLoadAllBtn.disabled = true;

  // Nếu đang có bộ lọc global, pre-fill ô tìm trong popup để xem ngay
  if (filterState.query && String(filterState.query).trim()) {
    detailSearchInput.value = filterState.query;
    detailState.query = filterState.query;
    detailSearchClear.classList.remove("hidden");
    runDetailSearch();
  }

  // Khóa cuộn nền (đặc biệt quan trọng trên mobile)
  _modalScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.classList.add("modal-open");
  document.body.style.top = `-${_modalScrollY}px`;

  detailModal.classList.remove("hidden");
  // Tránh auto-focus trên mobile (bàn phím ảo che nội dung); desktop vẫn focus để gõ nhanh
  const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches
    || ("ontouchstart" in window);
  if (!isTouch) {
    try { detailSearchInput.focus(); } catch (_) {}
  }
}

function closeDetailPopup() {
  detailModal.classList.add("hidden");
  detailState = { path: null, value: null, query: "", matches: null };
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, _modalScrollY);
}

detailCloseBtn.addEventListener("click", closeDetailPopup);
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) closeDetailPopup();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !detailModal.classList.contains("hidden")) {
    closeDetailPopup();
  }
});

detailSearchInput.addEventListener("input", () => {
  detailState.query = detailSearchInput.value;
  detailSearchClear.classList.toggle("hidden", !detailState.query);
  runDetailSearch();
});

detailSearchClear.addEventListener("click", () => {
  detailSearchInput.value = "";
  detailState.query = "";
  detailSearchClear.classList.add("hidden");
  runDetailSearch();
  detailSearchInput.focus();
});

/**
 * Sao chép text vào clipboard — hỗ trợ Clipboard API + fallback cho mobile / HTTP / trình duyệt cũ.
 */
async function copyTextToClipboard(text) {
  // 1) Clipboard API (HTTPS / localhost)
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // rơi xuống fallback
    }
  }

  // 2) Fallback: textarea tạm + execCommand('copy')
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:0;";
  document.body.appendChild(ta);

  let ok = false;
  try {
    // iOS cần range selection đặc biệt
    const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, ta.value.length);
    } else {
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
    }
    ok = document.execCommand("copy");
  } catch (_) {
    ok = false;
  } finally {
    document.body.removeChild(ta);
  }
  return ok;
}

detailCopyBtn.addEventListener("click", async () => {
  // Cho phép copy cả khi value === null (JSON null hợp lệ)
  if (detailState.path == null || detailState.value === undefined) return;

  let text;
  try {
    text =
      typeof detailState.value === "object"
        ? JSON.stringify(detailState.value, null, 2)
        : String(detailState.value);
  } catch (err) {
    showAlert("Lỗi", "Không thể chuyển dữ liệu sang JSON: " + (err.message || err));
    return;
  }

  const ok = await copyTextToClipboard(text);
  if (ok) {
    const old = detailCopyBtn.textContent;
    detailCopyBtn.textContent = "✓ Đã sao chép";
    detailCopyBtn.disabled = true;
    setTimeout(() => {
      detailCopyBtn.textContent = old;
      detailCopyBtn.disabled = false;
    }, 1500);
  } else {
    showAlert("Lỗi", "Không thể sao chép. Trình duyệt có thể chặn clipboard — hãy thử giữ chọn và copy thủ công.");
  }
});

/**
 * "Tải hết kết quả tìm trong node":
 * - Áp dụng query của popup lên bộ lọc chính
 * - Giới hạn hiển thị cây chính chỉ còn các path thuộc subtree của node này
 *   (load ngay toàn bộ match, không phân trang).
 */
detailLoadAllBtn.addEventListener("click", () => {
  if (!detailState.path || !detailState.matches || detailState.matches.matches.size === 0) return;

  // Đồng bộ query & filter chính với popup
  filterState.query = detailState.query;
  searchInput.value = detailState.query;
  searchClearBtn.classList.toggle("hidden", !filterState.query);

  // Chạy search toàn cây rồi chỉ giữ path nằm trong subtree của node
  const fullResult = SearchEngine.searchTree(lastData, filterState);
  if (!fullResult.active) {
    closeDetailPopup();
    return;
  }

  const prefix = detailState.path === "root" ? "root" : detailState.path;
  const scopedVisible = new Set();
  const scopedMatches = new Set();

  for (const p of fullResult.visible) {
    if (p === prefix || p.startsWith(prefix + "/")) {
      scopedVisible.add(p);
    }
  }
  for (const p of fullResult.matches) {
    if (p === prefix || p.startsWith(prefix + "/")) {
      scopedMatches.add(p);
    }
  }
  // Luôn giữ các ancestor để cây mở được tới node
  const parts = prefix.split("/");
  let cur = "";
  for (let i = 0; i < parts.length; i++) {
    cur = i === 0 ? parts[0] : cur + "/" + parts[i];
    scopedVisible.add(cur);
  }

  currentVisiblePaths = scopedVisible;
  updateMatchInfo({ active: true, matches: scopedMatches });
  // Khi lọc, flattenTree đã force-expand và bỏ pagination → load hết ngay
  refreshTree();
  closeDetailPopup();
});

// js/shift-preference-guoxi.js
// 國璽寒假排班意願調查前端（Excel 風格表格 + 方格按鈕版）
// - 支援 8 個班別
// - 每格按鈕：上面顯示「時段」「目前 X 人」
// - 底下獨立一行顯示完整姓名，可左右滑動

// TODO: 這裡改成你的 GAS Web App URL
const API_BASE =
  'https://script.google.com/macros/s/AKfycbxL2_QzEbsT2426X-kD-973yiuvB44wxD6NHtpjNv79onidl64RxLF6NULI985X-Jmo/exec';

const libraryIdInput = document.getElementById('library-id');
const LIBRARY = libraryIdInput ? libraryIdInput.value : '國璽';

const staffIdInput = document.getElementById('staff-id');
const staffNameInput = document.getElementById('staff-name');
const staffNoteInput = document.getElementById('staff-note');

const btnLoad = document.getElementById('btn-load');
const btnSubmit = document.getElementById('btn-submit');
const btnClear = document.getElementById('btn-clear');

const statusEl = document.getElementById('status');
const slotsTbody = document.getElementById('slots-tbody');

let currentSlots = []; // 從後端取得的 slot + stats
let currentSelected = []; // 目前選取中的 slot_id

function setStatus(msg, color) {
  statusEl.textContent = msg || '';
  statusEl.style.color = color || ''; // 不指定時用原本 CSS 顏色
}

/**
 * 取得「週X」字樣
 */
function getWeekdayName(dateObj) {
  const weekdayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return weekdayNames[dateObj.getDay()];
}

/**
 * 從 slot 取得日期 & 週幾資訊
 */
function getDateInfo(slot) {
  // 優先用 slot.date（GAS 回傳 Date）
  if (slot.date) {
    const d = new Date(slot.date);
    if (!isNaN(d.getTime())) {
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const weekday = getWeekdayName(d);
      return {
        displayDate: `${m}/${day}`,
        weekday,
        jsDate: d,
      };
    }
  }

  // fallback：從 slot_id 解析 yyyy-mm-dd
  if (slot.slot_id && /^\d{4}-\d{2}-\d{2}/.test(slot.slot_id)) {
    const parts = slot.slot_id.split(/[-_]/);
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const dNum = Number(parts[2]);
    if (y && m && dNum) {
      const d = new Date(y, m - 1, dNum);
      if (!isNaN(d.getTime())) {
        const weekday = getWeekdayName(d);
        return {
          displayDate: `${m}/${dNum}`,
          weekday,
          jsDate: d,
        };
      }
    }
  }

  // 再不行，就用 date_label 或 slot_id
  return {
    displayDate: slot.date_label || slot.slot_id || '',
    weekday: '',
    jsDate: null,
  };
}

/**
 * 依日期分組：key = yyyy-mm-dd（若無則用 date_label）
 */
function groupByDate(slots) {
  const map = {};
  slots.forEach((s) => {
    let key = '';
    if (s.slot_id && /^\d{4}-\d{2}-\d{2}/.test(s.slot_id)) {
      key = s.slot_id.slice(0, 10); // yyyy-mm-dd
    } else if (s.date) {
      const d = new Date(s.date);
      if (!isNaN(d.getTime())) {
        key = d.toISOString().slice(0, 10);
      }
    } else if (s.date_label) {
      key = s.date_label;
    } else {
      key = s.slot_id || '';
    }
    if (!map[key]) map[key] = [];
    map[key].push(s);
  });
  return map;
}

/**
 * 依 slot_id suffix 取得當天對應的班別
 * 例如 suffix = "_1" → 找出 slot_id 結尾為 _1 的那筆
 */
function getSlotBySuffix(slots, suffix) {
  if (!Array.isArray(slots)) return null;
  return slots.find((s) => s.slot_id && s.slot_id.endsWith(suffix)) || null;
}

/**
 * 切換某個 slot_id 的選取狀態（被方格按鈕點擊時呼叫）
 */
function toggleSlotSelection(slotId, btnEl) {
  const idx = currentSelected.indexOf(slotId);
  if (idx === -1) {
    currentSelected.push(slotId);
    btnEl.classList.add('selected');
  } else {
    currentSelected.splice(idx, 1);
    btnEl.classList.remove('selected');
  }
}

/**
 * 沒有對應班別時，畫出一個空白格子，避免整行崩掉
 */
function buildEmptySlotCell() {
  const td = document.createElement('td');
  td.className = 'slot-cell';
  const dummy = document.createElement('div');
  dummy.className = 'slot-btn';
  dummy.style.opacity = '0.3';
  dummy.style.cursor = 'default';
  dummy.textContent = '—';
  td.appendChild(dummy);
  return td;
}

/**
 * 渲染 Excel 風格的班表（table）
 * ★ 國璽樓：8 個班別 (_1 到 _8)
 */
function renderSlots() {
  slotsTbody.innerHTML = '';

  if (!currentSlots.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 10; // 日期 / 週 / 8個班別
    td.style.textAlign = 'center';
    td.style.padding = '8px';
    td.textContent = '尚未載入班表。請先輸入學號與姓名，然後點「查詢」。';
    tr.appendChild(td);
    slotsTbody.appendChild(tr);
    return;
  }

  const grouped = groupByDate(currentSlots);
  const dateKeys = Object.keys(grouped).sort(); // 依日期排序

  dateKeys.forEach((key) => {
    const slots = grouped[key];

    // 取這一天中，第一個 slot 來計算日期 / 週幾
    const dateInfo = getDateInfo(slots[0]);

    // 國璽樓：8 個班別
    const slot1 = getSlotBySuffix(slots, '_1');
    const slot2 = getSlotBySuffix(slots, '_2');
    const slot3 = getSlotBySuffix(slots, '_3');
    const slot4 = getSlotBySuffix(slots, '_4');
    const slot5 = getSlotBySuffix(slots, '_5');
    const slot6 = getSlotBySuffix(slots, '_6');
    const slot7 = getSlotBySuffix(slots, '_7');
    const slot8 = getSlotBySuffix(slots, '_8');

    const tr = document.createElement('tr');

    // 日期
    const tdDate = document.createElement('td');
    tdDate.className = 'date-col';
    tdDate.textContent = dateInfo.displayDate;
    tr.appendChild(tdDate);

    // 週
    const tdWeek = document.createElement('td');
    tdWeek.className = 'week-col';
    tdWeek.textContent = dateInfo.weekday || '';
    tr.appendChild(tdWeek);

    // 8 個班別
    tr.appendChild(slot1 ? buildSlotCell(slot1) : buildEmptySlotCell());
    tr.appendChild(slot2 ? buildSlotCell(slot2) : buildEmptySlotCell());
    tr.appendChild(slot3 ? buildSlotCell(slot3) : buildEmptySlotCell());
    tr.appendChild(slot4 ? buildSlotCell(slot4) : buildEmptySlotCell());
    tr.appendChild(slot5 ? buildSlotCell(slot5) : buildEmptySlotCell());
    tr.appendChild(slot6 ? buildSlotCell(slot6) : buildEmptySlotCell());
    tr.appendChild(slot7 ? buildSlotCell(slot7) : buildEmptySlotCell());
    tr.appendChild(slot8 ? buildSlotCell(slot8) : buildEmptySlotCell());

    slotsTbody.appendChild(tr);
  });
}

/**
 * 建立單一班別那格：
 * - 按鈕：時段＋目前 X 人
 * - 按鈕下方：完整姓名，可左右滑動
 */
function buildSlotCell(slot) {
  const td = document.createElement('td');
  td.className = 'slot-cell';

  const btn = document.createElement('div');
  btn.className = 'slot-btn';
  btn.setAttribute('data-slot-id', slot.slot_id);

  if (currentSelected.includes(slot.slot_id)) {
    btn.classList.add('selected');
  }

  btn.addEventListener('click', () => {
    toggleSlotSelection(slot.slot_id, btn);
  });

  const mainLabel = document.createElement('div');
  mainLabel.className = 'slot-label-main';
  mainLabel.textContent = slot.time_label || ''; // 時段

  const meta = document.createElement('div');
  meta.className = 'slot-meta';
  const count = Number(slot.count || 0);
  meta.textContent = `目前 ${count} 人`; // 只顯人數，不顯姓名

  btn.appendChild(mainLabel);
  btn.appendChild(meta);
  td.appendChild(btn);

  // 姓名列表（按鈕下方，可左右滑動）
  const fullNames = slot.names || '';
  if (fullNames) {
    const namesDiv = document.createElement('div');
    namesDiv.className = 'slot-names-scroll';
    namesDiv.textContent = fullNames; // 直接顯示完整名單
    td.appendChild(namesDiv);
  }

  return td;
}

/**
 * 載入個人狀態（state）
 */
async function loadState() {
  const staff_id = staffIdInput.value.trim();
  const name = staffNameInput.value.trim();

  if (!staff_id) {
    alert('請先輸入學號');
    return;
  }

  setStatus('載入中...');
  btnLoad.disabled = true;
  btnSubmit.disabled = true;

  try {
    const url = `${API_BASE}?action=state&library=${encodeURIComponent(LIBRARY)}&staff_id=${encodeURIComponent(staff_id)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();

    if (!data.ok) {
      setStatus('讀取失敗：' + (data.code || 'UNKNOWN'), '#EA0000');
      btnLoad.disabled = false;
      return;
    }

    currentSlots = data.slots || [];
    currentSelected = data.selectedSlots || [];

    // 如果後端有回姓名 / 備註，且前端沒填，就帶回來
    if (data.staff) {
      if (data.staff.name && !name) {
        staffNameInput.value = data.staff.name;
      }
      if (data.staff.note && !staffNoteInput.value) {
        staffNoteInput.value = data.staff.note;
      }
    }

    // 記住 ID，下次自動帶入（localStorage）
    try {
      localStorage.setItem(`pt_${LIBRARY}_staff_id`, staff_id);
    } catch (e) {}

    renderSlots();
    setStatus('載入完成，請點選格子勾選 / 取消時段後按「提交」。');
    btnSubmit.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('讀取時發生錯誤，請稍後再試。', '#EA0000');
  } finally {
    btnLoad.disabled = false;
  }
}

/**
 * 送出最新意願（submit）
 */
async function submitSelection() {
  const staff_id = staffIdInput.value.trim();
  const name = staffNameInput.value.trim();
  const note = staffNoteInput.value.trim(); // 可以多行

  if (!staff_id || !name) {
    alert('請輸入學號與姓名');
    return;
  }

  setStatus('送出中...');
  btnSubmit.disabled = true;

  const payload = {
    staff_id,
    name,
    note,
    slots: currentSelected,
  };

  try {
    const form = new URLSearchParams();
    form.append('payload', JSON.stringify(payload));

    const res = await fetch(`${API_BASE}?action=submit&library=${encodeURIComponent(LIBRARY)}`, {
      method: 'POST',
      body: form,
    });

    const data = await res.json();
    if (!data.ok) {
      setStatus('送出失敗：' + (data.code || 'UNKNOWN'), '#EA0000');
      btnSubmit.disabled = false;
      return;
    }

    setStatus(
      '已送出！系統需要5分鐘更新統計與人數顯示。若需修改，請於5分鐘後可重新載入後再送出。',
      '#EA0000'
    );
  } catch (err) {
    console.error(err);
    setStatus('送出時發生錯誤，請稍後再試。', '#EA0000');
  } finally {
    btnSubmit.disabled = false;
  }
}

/**
 * 清除本頁所有選取（只影響畫面與 currentSelected，需送出才生效）
 */
function clearAllSelection() {
  currentSelected = [];
  const btns = slotsTbody.querySelectorAll('.slot-btn.selected');
  btns.forEach((b) => b.classList.remove('selected'));
  setStatus('已清除本頁的所有選取，若要生效請重新送出。');
}

// 綁定事件
btnLoad.addEventListener('click', async () => {
  await loadState();
});
btnSubmit.addEventListener('click', submitSelection);
btnClear.addEventListener('click', clearAllSelection);

// 載入頁面時，自動帶出上次使用的 ID，並顯示預設提示列
window.addEventListener('DOMContentLoaded', () => {
  try {
    const lastId = localStorage.getItem(`pt_${LIBRARY}_staff_id`);
    if (lastId) staffIdInput.value = lastId;
  } catch (e) {}

  renderSlots();
});

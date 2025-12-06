// js/shift-preference.js
// 過年排班意願調查（單館）前端（Excel 風格表格 + 方格按鈕版）
// - 讀取個人既有勾選（state）
// - 每個時段格子都是可切換的按鈕（點一下選取、再點一次取消）
// - 只顯示精簡姓名，完整名單放在 tooltip

// TODO: 這裡改成你的 GAS Web App URL
const API_BASE = 'https://script.google.com/macros/s/AKfycbzJrqIgxtDbd0PmbVq04qZT0X_5hJ6IVj83AiW6IhD0NYsLWVTj3SvwMPcxYQDDTyaL/exec';

const staffIdInput    = document.getElementById('staff-id');
const staffNameInput  = document.getElementById('staff-name');
const staffNoteInput  = document.getElementById('staff-note');

const btnLoad         = document.getElementById('btn-load');
const btnSubmit       = document.getElementById('btn-submit');
const btnClear        = document.getElementById('btn-clear');

const statusEl        = document.getElementById('status');
const slotsTbody      = document.getElementById('slots-tbody');

let currentSlots      = []; // 從後端取得的 slot + stats
let currentSelected   = []; // 目前勾選中的 slot_id

function setStatus(msg) {
  statusEl.textContent = msg || '';
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
        jsDate: d
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
          jsDate: d
        };
      }
    }
  }

  // 再不行，就用 date_label 或 slot_id
  return {
    displayDate: slot.date_label || slot.slot_id || '',
    weekday: '',
    jsDate: null
  };
}

/**
 * 依日期分組：key = yyyy-mm-dd（若無則用 date_label）
 */
function groupByDate(slots) {
  const map = {};
  slots.forEach(s => {
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
 * 將名字清單壓縮成簡短顯示用：只顯前 2 個 + …
 * 例如：王小明、林小華、陳大頭 → 王小明、林小華…
 */
function buildShortNames(names, maxNames = 2, maxLen = 24) {
  if (!names) return '';
  const arr = names
    .split(/[、,，]/)
    .map(s => s.trim())
    .filter(Boolean);

  if (!arr.length) return '';

  let short = arr.slice(0, maxNames).join('、');

  // 若原本就很長或人數很多，加 …
  if (arr.length > maxNames || names.length > maxLen) {
    short += '…';
  }

  return short;
}

/**
 * 渲染 Excel 風格的班表（table）
 */
function renderSlots() {
  slotsTbody.innerHTML = '';

  if (!currentSlots.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.padding = '8px';
    td.textContent = '尚未載入班表。請先輸入學號與姓名，然後點「查詢 / 載入班表」。';
    tr.appendChild(td);
    slotsTbody.appendChild(tr);
    return;
  }

  const grouped = groupByDate(currentSlots);
  const dateKeys = Object.keys(grouped).sort(); // 依日期排序

  dateKeys.forEach(key => {
    const slots = grouped[key];

    // 取這一天中，第一個 slot 來計算日期 / 週幾
    const dateInfo = getDateInfo(slots[0]);

    // 預期三個班別：_1 / _2 / _3
    const morning = slots.find(s => s.time_label && s.time_label.indexOf('8:00') !== -1) ||
                    slots.find(s => /_1$/.test(s.slot_id)) || slots[0];
    const noon    = slots.find(s => s.time_label && s.time_label.indexOf('11:00') !== -1) ||
                    slots.find(s => /_2$/.test(s.slot_id)) || slots[1] || slots[0];
    const afternoon = slots.find(s => s.time_label && s.time_label.indexOf('13:30') !== -1) ||
                      slots.find(s => /_3$/.test(s.slot_id)) || slots[2] || slots[0];

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

    // 上午班
    tr.appendChild(buildSlotCell(morning));

    // 中午班
    tr.appendChild(buildSlotCell(noon));

    // 下午班
    tr.appendChild(buildSlotCell(afternoon));

    slotsTbody.appendChild(tr);
  });
}

/**
 * 建立三個班別那格（每格是一個可點選的「方塊按鈕」）
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
  mainLabel.textContent = slot.time_label || '';

  const meta = document.createElement('div');
  meta.className = 'slot-meta';

  const count = Number(slot.count || 0);
  const fullNames = slot.names || '';
  const shortNames = buildShortNames(fullNames);

  // 顯示精簡文字，但把完整名單放在 title（桌機可 hover，看得到全名）
  meta.textContent = `目前 ${count} 人${shortNames ? '｜' + shortNames : ''}`;
  if (fullNames) {
    meta.title = `目前名單：${fullNames}`;
  }

  btn.appendChild(mainLabel);
  btn.appendChild(meta);
  td.appendChild(btn);

  return td;
}

/**
 * 載入個人狀態（state）
 */
async function loadState() {
  const staff_id = staffIdInput.value.trim();
  const name = staffNameInput.value.trim();

  if (!staff_id) {
    alert('請先輸入學號 / ID 碼');
    return;
  }

  setStatus('載入中...');
  btnLoad.disabled = true;
  btnSubmit.disabled = true;

  try {
    const url = `${API_BASE}?action=state&staff_id=${encodeURIComponent(staff_id)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();

    if (!data.ok) {
      setStatus('讀取失敗：' + (data.code || 'UNKNOWN'));
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
      localStorage.setItem('pt_staff_id', staff_id);
    } catch (e) {}

    renderSlots();
    setStatus('載入完成，請點選格子勾選 / 取消時段後按「送出最新意願」。');
    btnSubmit.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('讀取時發生錯誤，請稍後再試。');
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
  const note = staffNoteInput.value.trim();

  if (!staff_id || !name) {
    alert('請輸入學號 / ID 碼與姓名');
    return;
  }

  setStatus('送出中...');
  btnSubmit.disabled = true;

  const payload = {
    staff_id,
    name,
    note,
    slots: currentSelected
  };

  try {
    const form = new URLSearchParams();
    form.append('payload', JSON.stringify(payload));

    const res = await fetch(`${API_BASE}?action=submit`, {
      method: 'POST',
      body: form
    });

    const data = await res.json();
    if (!data.ok) {
      setStatus('送出失敗：' + (data.code || 'UNKNOWN'));
      btnSubmit.disabled = false;
      return;
    }

    setStatus('已送出！系統會在數分鐘內更新統計與人數顯示。若需修改，可重新載入後再送出。');
  } catch (err) {
    console.error(err);
    setStatus('送出時發生錯誤，請稍後再試。');
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
  btns.forEach(b => b.classList.remove('selected'));
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
    const lastId = localStorage.getItem('pt_staff_id');
    if (lastId) staffIdInput.value = lastId;
  } catch (e) {}

  renderSlots();
});

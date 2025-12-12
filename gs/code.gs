/***********************
 * 共用設定
 ***********************/
// 館別清單
const VALID_LIBRARIES = ['濟時', '國璽'];

// 取得工作表名稱（加入館別後綴）
function getSheetName_(type, library) {
  if (!library || !VALID_LIBRARIES.includes(library)) {
    throw new Error('無效的館別：' + library);
  }
  return type + '_' + library;
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表：' + name);
  return sheet;
}

/**
 * 備註欄位換行處理：
 * - 把 \r\n、\r 統一成 \n
 * - Google 試算表會把 \n 視為「同一格中的換行」
 */
function normalizeNote_(note) {
  if (!note) return "";
  return String(note)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/***********************
 * 讀取 slots & stats & responses
 ***********************/
function readSlots_(library) {
  library = library || '濟時'; // 預設值
  const sheetName = getSheetName_('slots', library);
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values.shift();

  const idx = {
    slot_id: header.indexOf('slot_id'),
    date: header.indexOf('date'),
    date_label: header.indexOf('date_label'),
    time_label: header.indexOf('time_label'),
    hours: header.indexOf('hours')
  };

  return values
    .filter(row => row[idx.slot_id])
    .map(row => ({
      slot_id: String(row[idx.slot_id]),
      date: row[idx.date],
      date_label: String(row[idx.date_label] || ''),
      time_label: String(row[idx.time_label] || ''),
      hours: Number(row[idx.hours] || 0)
    }));
}

function readResponsesMap_(library) {
  library = library || '濟時'; // 預設值
  const sheetName = getSheetName_('responses', library);
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  const header = values.shift();
  const idx = {
    staff_id: header.indexOf('staff_id'),
    name: header.indexOf('name'),
    slots_str: header.indexOf('slots_str'),
    note: header.indexOf('note')  // 可能不存在，下面會處理
  };

  const map = {};
  values.forEach(row => {
    const staff_id = String(row[idx.staff_id] || '').trim();
    if (!staff_id) return;

    const name      = String(row[idx.name] || '').trim();
    const slots_str = String(row[idx.slots_str] || '');
    const note      = idx.note >= 0 ? String(row[idx.note] || '') : '';

    const slots = slots_str
      ? slots_str.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    map[staff_id] = { staff_id, name, slots, slots_str, note };
  });
  return map;
}

function readStatsMap_(library) {
  library = library || '濟時'; // 預設值
  const sheetName = getSheetName_('stats', library);
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  const header = values.shift();
  const idx = {
    slot_id: header.indexOf('slot_id'),
    count: header.indexOf('count'),
    names: header.indexOf('names')
  };

  const map = {};
  values.forEach(row => {
    const slot_id = String(row[idx.slot_id] || '').trim();
    if (!slot_id) return;
    map[slot_id] = {
      count: Number(row[idx.count] || 0),
      names: String(row[idx.names] || '')
    };
  });
  return map;
}

/***********************
 * Web API
 *   GET  ?action=state&staff_id=4123
 *   POST ?action=submit & payload={...}
 ***********************/
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'state';
    const library = (e && e.parameter && e.parameter.library) || '濟時';

    if (action === 'state') {
      return handleState_(e, library);
    }

    return jsonResponse_({ ok: false, code: 'UNKNOWN_ACTION' });
  } catch (err) {
    return jsonResponse_({ ok: false, code: 'SERVER_ERROR', message: String(err) });
  }
}

function handleState_(e, library) {
  library = library || '濟時'; // 預設值
  const staff_id = (e.parameter && e.parameter.staff_id) ? String(e.parameter.staff_id).trim() : '';

  const slots = readSlots_(library);
  const responsesMap = readResponsesMap_(library);
  const statsMap = readStatsMap_(library);

  const staff = staff_id && responsesMap[staff_id]
    ? responsesMap[staff_id]
    : { staff_id, name: '', slots: [], note: '' };

  // 把 stats 合併進 slots
  const slotsWithStats = slots.map(s => {
    const stat = statsMap[s.slot_id] || { count: 0, names: '' };
    return Object.assign({}, s, stat);
  });

  const payload = {
    ok: true,
    code: 'STATE_OK',
    staff: {
      staff_id: staff.staff_id || staff_id,
      name: staff.name || '',
      note: staff.note || ''
    },
    selectedSlots: staff.slots,
    slots: slotsWithStats
  };

  return jsonResponse_(payload);
}

function doPost(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'submit';
    const library = (e && e.parameter && e.parameter.library) || '濟時';

    if (action === 'submit') {
      return handleSubmit_(e, library);
    }

    return jsonResponse_({ ok: false, code: 'UNKNOWN_ACTION' });
  } catch (err) {
    return jsonResponse_({ ok: false, code: 'SERVER_ERROR', message: String(err) });
  }
}

function handleSubmit_(e, library) {
  library = library || '濟時'; // 預設值
  const payloadStr = (e.parameter && e.parameter.payload) ? String(e.parameter.payload) : '';
  if (!payloadStr) {
    return jsonResponse_({ ok: false, code: 'NO_PAYLOAD' });
  }

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (err) {
    return jsonResponse_({ ok: false, code: 'BAD_JSON' });
  }

  const staff_id = String(payload.staff_id || '').trim();
  const name     = String(payload.name || '').trim();
  const rawNote  = String(payload.note || '');
  const note     = normalizeNote_(rawNote);
  const slots    = Array.isArray(payload.slots) ? payload.slots : [];

  if (!staff_id || !name) {
    return jsonResponse_({ ok: false, code: 'MISSING_FIELDS' });
  }

  const slots_str = slots
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .join(',');

  const queueSheetName = getSheetName_('queue', library);
  const sheet = getSheet_(queueSheetName);
  const now = new Date();

  // 如果 queue 沒有表頭，自動加一列
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'staff_id', 'name', 'slots_str', 'note', 'processed']);
  }

  sheet.appendRow([now, staff_id, name, slots_str, note, false]);

  return jsonResponse_({ ok: true, code: 'ENQUEUED' });
}

function jsonResponse_(obj) {
  const out = ContentService
    .createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
  return out;
}

/***********************
 * 背景：處理 queue + 重算 stats
 *   → 設時間觸發器：每 5 分鐘跑一次 processQueue
 ***********************/
function processQueue(library) {
  library = library || '濟時'; // 預設值
  const queueSheetName = getSheetName_('queue', library);
  const respSheetName = getSheetName_('responses', library);
  const queueSheet = getSheet_(queueSheetName);
  const respSheet  = getSheet_(respSheetName);

  const values = queueSheet.getDataRange().getValues();
  if (values.length < 2) return;

  const header = values[0];
  const idx = {
    timestamp: header.indexOf('timestamp'),
    staff_id:  header.indexOf('staff_id'),
    name:      header.indexOf('name'),
    slots_str: header.indexOf('slots_str'),
    note:      header.indexOf('note'),
    processed: header.indexOf('processed')
  };

  const updatesMap = {}; // staff_id => { name, slots_str, note }

  // 找出未處理的 queue
  const range = queueSheet.getRange(2, 1, values.length - 1, header.length);
  const rows = range.getValues();

  rows.forEach((row, i) => {
    const processed = row[idx.processed] === true;
    if (processed) return;

    const staff_id = String(row[idx.staff_id] || '').trim();
    if (!staff_id) return;

    const name      = String(row[idx.name] || '').trim();
    const slots_str = String(row[idx.slots_str] || '').trim();
    const note      = idx.note >= 0 ? String(row[idx.note] || '') : '';

    updatesMap[staff_id] = { staff_id, name, slots_str, note };

    // 標記 processed = true
    row[idx.processed] = true;
    rows[i] = row;
  });

  // 寫回 queue（已標 processed）
  range.setValues(rows);

  if (Object.keys(updatesMap).length === 0) {
    return;
  }

  // 讀取現有 responses
  const respValues = respSheet.getDataRange().getValues();
  let respHeader, respRows;

  if (respValues.length === 0) {
    // 第一次建立 responses
    respHeader = ['staff_id', 'name', 'slots_str', 'note', 'updated_at'];
    respRows = [];
  } else {
    respHeader = respValues[0];
    respRows   = respValues.slice(1);

    // 若原本沒有 note 欄，動態補一欄
    if (respHeader.indexOf('note') === -1) {
      respHeader.push('note');
      const noteColIndex = respHeader.length - 1;
      respRows = respRows.map(row => {
        const newRow = row.slice();
        newRow[noteColIndex] = newRow[noteColIndex] || '';
        return newRow;
      });
    }

    // 若原本沒有 updated_at 也補一欄
    if (respHeader.indexOf('updated_at') === -1) {
      respHeader.push('updated_at');
      const uaColIndex = respHeader.length - 1;
      respRows = respRows.map(row => {
        const newRow = row.slice();
        newRow[uaColIndex] = newRow[uaColIndex] || '';
        return newRow;
      });
    }
  }

  const ridx = {
    staff_id:  respHeader.indexOf('staff_id'),
    name:      respHeader.indexOf('name'),
    slots_str: respHeader.indexOf('slots_str'),
    note:      respHeader.indexOf('note'),
    updated_at:respHeader.indexOf('updated_at')
  };

  const rowMap = {};
  respRows.forEach((row, i) => {
    const sid = String(row[ridx.staff_id] || '').trim();
    if (!sid) return;
    rowMap[sid] = { row, index: i };
  });

  const now = new Date();

  Object.keys(updatesMap).forEach(staff_id => {
    const u = updatesMap[staff_id];
    if (rowMap[staff_id]) {
      const obj = rowMap[staff_id];
      const row = obj.row;
      row[ridx.staff_id]   = staff_id;
      row[ridx.name]       = u.name;
      row[ridx.slots_str]  = u.slots_str;
      row[ridx.note]       = u.note;
      row[ridx.updated_at] = now;
      respRows[obj.index]  = row;
    } else {
      const newRow = [];
      newRow[ridx.staff_id]   = staff_id;
      newRow[ridx.name]       = u.name;
      newRow[ridx.slots_str]  = u.slots_str;
      newRow[ridx.note]       = u.note;
      newRow[ridx.updated_at] = now;
      respRows.push(newRow);
    }
  });

  // 重建 responses 整張表
  respSheet.clear();
  respSheet.appendRow(respHeader);
  if (respRows.length > 0) {
    respSheet.getRange(2, 1, respRows.length, respHeader.length).setValues(respRows);
  }

  // 重算 stats
  recomputeStats_(library);
}

// 為兩個館別建立獨立的觸發器函數
function processQueueJishi() {
  processQueue('濟時');
}

function processQueueGuoxi() {
  processQueue('國璽');
}

function recomputeStats_(library) {
  library = library || '濟時'; // 預設值
  const slots         = readSlots_(library);
  const responsesMap  = readResponsesMap_(library);

  // 先建立每個 slot 的容器，namesSet 用來避免名稱重複計算
  const stats = {};
  slots.forEach(s => {
    stats[s.slot_id] = { count: 0, namesSet: {} };
  });

  Object.values(responsesMap).forEach(r => {
    const name = r.name || '';
    if (!name) return;

    r.slots.forEach(slot_id => {
      if (!stats[slot_id]) {
        stats[slot_id] = { count: 0, namesSet: {} };
      }
      if (!stats[slot_id].namesSet[name]) {
        stats[slot_id].namesSet[name] = true;
        stats[slot_id].count++;
      }
    });
  });

  const statsSheetName = getSheetName_('stats', library);
  const sheet = getSheet_(statsSheetName);
  sheet.clear();
  sheet.appendRow(['slot_id', 'count', 'names']);

  const rows = [];
  slots.forEach(s => {
    const st = stats[s.slot_id] || { count: 0, namesSet: {} };
    const names = Object.keys(st.namesSet);
    rows.push([
      s.slot_id,
      st.count,
      names.join('、')
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

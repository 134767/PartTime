/************************************************
 * 純試算版：從 responses 重新計算 stats
 * - 不含 queue、不含 Web API
 * - 只要按一次 recomputeStatsSimple() 就會更新 stats 表
 ************************************************/

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('找不到工作表：' + name);
  }
  return sheet;
}

/**
 * 讀取 slots 表，只取 slot_id
 */
function readSlotsSimple_(library) {
  library = library || '濟時';
  const sheetName = getSheetName_('slots', library);
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values.shift(); // 第一列標題
  const idxSlotId = header.indexOf('slot_id');
  if (idxSlotId === -1) {
    throw new Error('slots 工作表找不到欄位「slot_id」');
  }

  const slots = values
    .map(row => String(row[idxSlotId] || '').trim())
    .filter(id => id !== '');

  return slots;
}

/**
 * 讀取 responses 表，回傳陣列：
 * [ { staff_id, name, slots: [slot_id, ...] }, ... ]
 */
function readResponsesSimple_(library) {
  library = library || '濟時';
  const sheetName = getSheetName_('responses', library);
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values.shift();
  const idxStaffId  = header.indexOf('staff_id');
  const idxName     = header.indexOf('name');
  const idxSlotsStr = header.indexOf('slots_str');

  if (idxStaffId === -1 || idxName === -1 || idxSlotsStr === -1) {
    throw new Error('responses 工作表至少要有欄位：staff_id, name, slots_str');
  }

  const result = [];

  values.forEach(row => {
    const staff_id = String(row[idxStaffId] || '').trim();
    const name     = String(row[idxName] || '').trim();
    const slotsStr = String(row[idxSlotsStr] || '').trim();

    if (!staff_id && !name && !slotsStr) {
      // 空列就略過
      return;
    }

    const slots = slotsStr
      ? slotsStr.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    result.push({ staff_id, name, slots });
  });

  return result;
}

/**
 * 主程式：重算 stats 表
 * - 對每一個 slot_id 計算：
 *   count：有幾個人選
 *   names：有哪些姓名（用「、」串起來）
 */
function recomputeStatsSimple(library) {
  library = library || '濟時';
  const slotIds = readSlotsSimple_(library);
  const responses = readResponsesSimple_(library);

  // 建立統計容器 { slot_id: { count, namesSet } }
  const stats = {};

  slotIds.forEach(id => {
    stats[id] = {
      count: 0,
      // 用物件當 set，避免同一個人重複加到同一時段
      namesSet: {}
    };
  });

  responses.forEach(r => {
    const name = r.name || '';
    if (!name) return; // 沒姓名就不統計

    r.slots.forEach(slot_id => {
      if (!stats[slot_id]) {
        // 有人填了一個 slots 表裡不存在的 slot_id，就先開一個
        stats[slot_id] = { count: 0, namesSet: {} };
      }
      if (!stats[slot_id].namesSet[name]) {
        stats[slot_id].namesSet[name] = true;
        stats[slot_id].count++;
      }
    });
  });

  // 寫回 stats 表
  const sheetName = getSheetName_('stats', library);
  const sheet = getSheet_(sheetName);
  sheet.clear();

  // 標題列
  sheet.appendRow(['slot_id', 'count', 'names']);

  // 按 slots 表的順序輸出
  const rows = slotIds.map(id => {
    const info = stats[id] || { count: 0, namesSet: {} };
    const names = Object.keys(info.namesSet);
    return [id, info.count, names.join('、')];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

// ✅ onOpen 已移除：避免在 Web App / 獨立專案環境呼叫 getUi() 出錯
